/**
 * v1.16.0 Phase 1.3 (adoption item A1) -- model resolution for the gateway.
 *
 * The gateway's public model list is the INSTALLED, chat-capable slice of
 * `NexusModelRegistry` (via the reconciling `ModelsService`), so `/v1/models`
 * shows exactly what the user actually has on disk / in Ollama -- never a
 * catalog-only row the caller cannot run.
 *
 * Routing a model id to a runtime goes through the injected `ServingAdapter`
 * list (see `adapters.ts`), so this module only ever holds the `LLMClient` port
 * and never a concrete client -- the discipline the `no-llm-outside-llm-folder`
 * boundary rule encodes. Because adapters come from the same
 * `nexus.llm.localAdapters` manifests the outbound registry uses, a
 * user-registered runtime (an MLX server, say) is servable for free.
 *
 * An adapter is chosen by asking each chat-capable adapter what it has loaded
 * (`listModels`) and matching the requested id or its tag. Adapters that are not
 * running are skipped silently -- a stopped LM Studio must not break an
 * Ollama-served request.
 */

import type { LLMClient } from "../../../../modules/coding/llm/types.js";
import type { ListedModelDto } from "../models/modelsService.js";
import type { ServingAdapter } from "./adapters.js";
import { notFound } from "./errors.js";

/** A model the gateway is willing to serve, in gateway-neutral shape. */
export interface ServingModel {
  /** The id a client passes as `model`. */
  readonly id: string;
  readonly displayName: string;
  /** Registry provenance, surfaced as OpenAI's `owned_by`. */
  readonly ownedBy: string;
  /** Alternate id (the Ollama tag) also accepted for this model. */
  readonly tag?: string;
}

/** A resolved route: the client to call and the name to call it with. */
export interface ResolvedModel {
  readonly client: LLMClient;
  /** The model name as the chosen runtime knows it. */
  readonly modelName: string;
  readonly adapter: string;
}

export interface ModelRouterOptions {
  /** Installed-model source; the sidecar passes `ModelsService.list`. */
  readonly listInstalled: () => Promise<readonly ListedModelDto[]>;
  /** Routable runtimes, in preference order. Resolved lazily per request. */
  readonly adapters: () => readonly ServingAdapter[];
}

/** Registry sources whose models are actually runnable on this host. */
const RUNNABLE_SOURCES: ReadonlySet<ListedModelDto["source"]> = new Set(["registry", "external"]);

/**
 * A model is chat-servable when the registry types it as an LLM. Diffusion /
 * embed / VAE rows are installed but are not `/v1/chat/completions` models, so
 * exposing them would only produce confusing upstream failures.
 */
function isChatServable(m: ListedModelDto): boolean {
  return m.installed && RUNNABLE_SOURCES.has(m.source) && (m.type === undefined || m.type === "llm");
}

export class ModelRouter {
  private readonly _opts: ModelRouterOptions;

  constructor(opts: ModelRouterOptions) {
    this._opts = opts;
  }

  /** The installed chat-capable models, deduped by id, in registry order. */
  async listModels(): Promise<readonly ServingModel[]> {
    const installed = await this._opts.listInstalled();
    const out = new Map<string, ServingModel>();
    for (const m of installed) {
      if (!isChatServable(m)) continue;
      if (out.has(m.id)) continue;
      out.set(m.id, {
        id: m.id,
        displayName: m.displayName,
        ownedBy: m.source === "external" ? "external" : "nexus",
        tag: m.tag,
      });
    }
    return [...out.values()];
  }

  /**
   * Resolve `requested` (an id or an Ollama tag) to a live runtime. Throws a
   * 404 `ServingHttpError` when the model is not installed, and a 404 with a
   * distinct code when it is installed but no local runtime currently serves it
   * (Ollama stopped, LM Studio closed) -- those are different user problems.
   */
  async resolve(requested: string): Promise<ResolvedModel> {
    const models = await this.listModels();
    const match = models.find((m) => m.id === requested || m.tag === requested);
    if (!match) {
      throw notFound(
        `Model "${requested}" is not installed. Call GET /v1/models for the installed models, ` +
          `or install it from Nexus Settings > Models.`,
        "model_not_found",
      );
    }

    const candidates = [match.id, match.tag].filter((v): v is string => typeof v === "string");
    for (const adapter of this._opts.adapters()) {
      if (!adapter.chat) continue;
      const client = adapter.createClient();
      let loaded: readonly { name: string }[];
      try {
        loaded = await client.listModels();
      } catch {
        // Runtime not running / unreachable: try the next adapter.
        continue;
      }
      const hit = loaded.find((l) => candidates.includes(l.name));
      if (hit) {
        return { client, modelName: hit.name, adapter: adapter.name };
      }
    }

    throw notFound(
      `Model "${requested}" is installed but no local runtime is currently serving it. ` +
        `Start the runtime that hosts it (for example Ollama or LM Studio) and retry.`,
      "model_not_loaded",
    );
  }
}
