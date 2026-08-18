/**
 * v1.16.0 Phase 1.1 (adoption item A1) -- serving-gateway runtime seam.
 * v1.18.0 Phase 5 (OI-A3) -- ACP mounts on the same LoopbackHttpServer.
 *
 * Owns the gateway + its settings store as one lazily-built unit, mirroring the
 * `ModelsRuntime` pattern (`models/modelsService.ts`) that the `models.*` IPC
 * uses: production builds the real disk-backed thing on first `serving.*` call,
 * tests inject a fake through `HandlerContext.serving`.
 *
 * Keeping the gateway's construction here (rather than in `main.ts`) is
 * deliberate -- `main.ts` is excluded from coverage, so the lifecycle logic lives
 * in a module the test suite can actually reach.
 */

import * as path from "node:path";
import { JsonFileSettingsStore, type SettingsStore } from "../../../../core/storage/SettingsStore.js";
import { nexusHome } from "../../../../core/storage/paths.js";
import { createHeadlessOllamaClient } from "../../../../modules/coding/llm/headlessOllamaClient.js";
import type { LLMClient } from "../../../../modules/coding/llm/types.js";
import { createModelsRuntime, type ModelsRuntime } from "../models/modelsService.js";
import { AcpAgent } from "../acp/AcpAgent.js";
import { ACP_KEYS, acpEndpoint } from "../acp/config.js";
import {
  LOCAL_ADAPTERS_KEY,
  resolveServingAdapters,
  type ServingAdapter,
} from "./adapters.js";
import { SERVING_KEYS, type ServingConfig, resolveServingConfig } from "./config.js";
import { ServingGateway, type ServingStatus } from "./gateway.js";

/** ACP mount status on the shared control surface. */
export interface AcpStatus {
  readonly enabled: boolean;
  readonly running: boolean;
  readonly host: string;
  readonly port: number;
  readonly endpoint: string;
  readonly token: string;
}

/** The gateway + the settings store the `serving.*` / `acp.*` IPC mutates. */
export interface ServingRuntime {
  readonly gateway: ServingGateway;
  readonly acp: AcpAgent;
  readonly settings: SettingsStore;
  /** Re-read settings and reconcile the listener; returns the live serving status. */
  sync(): Promise<ServingStatus>;
  /** Persist serving `enabled`, reconcile the listener, return the live status. */
  setEnabled(enabled: boolean): Promise<ServingStatus>;
  status(): Promise<ServingStatus>;
  setAcpEnabled(enabled: boolean): Promise<AcpStatus>;
  acpStatus(): Promise<AcpStatus>;
}

export interface CreateServingRuntimeOptions {
  readonly settings?: SettingsStore;
  readonly models?: ModelsRuntime;
  readonly env?: NodeJS.ProcessEnv;
  readonly log?: (message: string) => void;
  /** Override the ACP LLM (tests inject a scripted client). */
  readonly acpLlm?: LLMClient;
}

function envFlag(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return undefined;
}

/**
 * Build the serving runtime. The models runtime is resolved lazily on the first
 * model listing so an unreachable Ollama or a missing catalog never blocks
 * gateway startup (the gateway then simply serves an empty model list).
 */
export function createServingRuntime(opts: CreateServingRuntimeOptions = {}): ServingRuntime {
  const settings =
    opts.settings ??
    new JsonFileSettingsStore({ filePath: path.join(nexusHome(), "settings.json") });

  let modelsPromise: Promise<ModelsRuntime> | null = null;
  const resolveModels = async (): Promise<ModelsRuntime> => {
    if (opts.models) return opts.models;
    if (!modelsPromise) modelsPromise = createModelsRuntime();
    return modelsPromise;
  };

  // The user's `nexus.llm.localAdapters` manifests are read once per config sync
  // (not per request) and layered over the built-in Ollama + LM Studio adapters,
  // so a newly registered loopback runtime becomes servable on the next toggle
  // without a sidecar restart.
  let adapters: readonly ServingAdapter[] = resolveServingAdapters(undefined, opts.env);

  const gateway = new ServingGateway({
    listInstalled: async () => {
      try {
        const { service } = await resolveModels();
        return await service.list();
      } catch {
        return [];
      }
    },
    adapters: () => adapters,
    log: opts.log,
  });

  const acp = new AcpAgent({
    llm: opts.acpLlm ?? createHeadlessOllamaClient(),
  });
  gateway.surface.mount(acp.asRoute());

  const readServingConfig = (): Promise<ServingConfig> =>
    resolveServingConfig({ settings, env: opts.env });

  const readAcpEnabled = async (): Promise<boolean> => {
    const stored = await settings.get<boolean>(ACP_KEYS.enabled);
    if (typeof stored === "boolean") return stored;
    return envFlag(opts.env?.NEXUS_ACP_ENABLED ?? process.env.NEXUS_ACP_ENABLED) ?? false;
  };

  const refreshAdapters = async (): Promise<void> => {
    try {
      adapters = resolveServingAdapters(await settings.get(LOCAL_ADAPTERS_KEY), opts.env);
    } catch {
      // Unreadable settings: keep the built-ins rather than losing all routing.
    }
  };

  const toAcpStatus = (config: ServingConfig, acpEnabled: boolean): AcpStatus => {
    const port = gateway.boundPort ?? config.port;
    return {
      enabled: acpEnabled,
      running: gateway.running && acpEnabled,
      host: config.host,
      port,
      endpoint: acpEndpoint(config.host, port),
      token: config.token,
    };
  };

  const sync = async (): Promise<ServingStatus> => {
    const config = await readServingConfig();
    const acpEnabled = await readAcpEnabled();
    await refreshAdapters();
    acp.setEnabled(acpEnabled);
    await gateway.applyConfig({ ...config, acpEnabled });
    return gateway.status(config);
  };

  return {
    gateway,
    acp,
    settings,
    sync,
    async setEnabled(enabled: boolean): Promise<ServingStatus> {
      await settings.set(SERVING_KEYS.enabled, enabled);
      return sync();
    },
    async status(): Promise<ServingStatus> {
      const config = await readServingConfig();
      return gateway.status(config);
    },
    async setAcpEnabled(enabled: boolean): Promise<AcpStatus> {
      await settings.set(ACP_KEYS.enabled, enabled);
      const serving = await sync();
      return toAcpStatus(
        {
          enabled: serving.enabled,
          host: serving.host,
          port: serving.port,
          token: serving.token,
        },
        enabled,
      );
    },
    async acpStatus(): Promise<AcpStatus> {
      const config = await readServingConfig();
      const acpEnabled = await readAcpEnabled();
      return toAcpStatus(config, acpEnabled);
    },
  };
}
