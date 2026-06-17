/**
 * PanelExecutor -- fans one prompt across N distinct registry models, collects
 * a labeled candidate answer from each, and fuses them through the F1 judge
 * (`FusionAgent`) into one grounded answer.
 *
 * v1.6.0 adoption-openrouter-fusion Phase 2 (OF004 + OF005). This is the
 * headline capability of the local panel-fusion technique reverse-engineered
 * from OpenRouter Fusion: a diverse panel of small local models proposes, one
 * local judge fuses. It is built on the existing orchestration spine -- it
 * reuses the `LLMClient` port (`../llm/types.ts`) for dispatch and the
 * `FusionAgent` judge for synthesis, the same way the Orchestrator reuses the
 * PlannerAgent / DAGExecutor / CriticAgent trio.
 *
 * Sequential fan-out (the honest single-GPU MVP). On one consumer GPU the
 * panelists run one at a time; co-residency / concurrency is comparison item
 * F3 and lands in Phase 3, gated behind the `GpuScheduler`'s VRAM budget. The
 * public surface here does not change when Phase 3 parallelises -- `run` stays
 * the entry point; only the internal dispatch loop is upgraded.
 *
 * F5 -- tool isolation. Panelists are dispatched as plain chat completions with
 * NO `tools` array: this executor grants panelists no per-panelist tool access
 * and never an open-internet default (that is the dropped item D2). Any tool a
 * panelist needs must flow through Nexus's existing gated, tiered tool registry
 * via the standard AgentLoop surface, not a grant minted here. The judge's
 * untrusted-input boundary + candidate redaction live in `FusionAgent`.
 */

import type { LLMClient, LLMMessage, LLMOptions } from "../llm/types.js";
import { formatForUser } from "../utils/errors.js";
import type { PanelCandidate, FusionResult, PanelJudge } from "./FusionAgent.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Resolves a model id to an `LLMClient`. On a single Ollama backend every model
 * id maps to the same client (only the request's `model` field differs); the
 * factory indirection keeps the executor honest about "one client per panelist"
 * and lets tests inject a distinct mock per model id.
 */
export type LLMClientFactory = (modelId: string) => LLMClient;

/**
 * Optional gate that filters a panel spec to usable (installed / known) models.
 * Synchronous so `run` stays a simple sequential loop; callers that hold an
 * async registry pre-compute the installed set and pass `{ isUsable: id =>
 * set.has(id) }`. When omitted, every distinct spec id is dispatched.
 */
export interface PanelModelResolver {
  isUsable(modelId: string): boolean;
}

export interface PanelExecutorOptions {
  readonly clientFactory: LLMClientFactory;
  readonly judge: PanelJudge;
  /** Sampling options forwarded to each panelist request. */
  readonly panelOptions?: LLMOptions;
  /** Hard panel-size cap (safety bound; Phase 3 adds VRAM-aware capping). */
  readonly maxPanelSize?: number;
  /** Optional usable-model gate; unresolvable ids are recorded as skipped. */
  readonly modelResolver?: PanelModelResolver;
}

export interface PanelRunResult {
  /** Every candidate collected, in dispatch order (failed ones included). */
  readonly candidates: readonly PanelCandidate[];
  /** The fused answer + schema-conformance verdict from the judge. */
  readonly fusion: FusionResult;
  /** The distinct, resolved, capped panel that was actually dispatched. */
  readonly dispatched: readonly string[];
  /** Spec ids dropped by de-duplication is implicit; these were dropped by the
   * resolver gate or the panel-size cap. */
  readonly skipped: readonly string[];
  /** Count of panelists that produced a usable candidate. */
  readonly succeeded: number;
  /** Count of panelists that failed. */
  readonly failed: number;
}

/** Default hard cap on panel size when the caller does not set one. */
export const DEFAULT_MAX_PANEL_SIZE = 5;

// ---------------------------------------------------------------------------
// PanelExecutor
// ---------------------------------------------------------------------------

export class PanelExecutor {
  private readonly _clientFactory: LLMClientFactory;
  private readonly _judge: PanelJudge;
  private readonly _panelOptions: LLMOptions;
  private readonly _maxPanelSize: number;
  private readonly _resolver: PanelModelResolver | null;

  constructor(options: PanelExecutorOptions) {
    this._clientFactory = options.clientFactory;
    this._judge = options.judge;
    this._panelOptions = options.panelOptions ?? {};
    this._maxPanelSize = Math.max(1, options.maxPanelSize ?? DEFAULT_MAX_PANEL_SIZE);
    this._resolver = options.modelResolver ?? null;
  }

  /**
   * Fan `prompt` across the distinct models in `panelSpec`, collect a labeled
   * candidate from each, then fuse the survivors through the judge.
   *
   * Distinctness, resolver filtering, and the panel-size cap are applied before
   * dispatch. A panelist that throws is recorded as a failed candidate and the
   * run continues, so the panel still fuses whatever survived.
   *
   * @throws if the panel is empty after de-duplication, resolution, and capping.
   */
  async run(prompt: string, panelSpec: readonly string[]): Promise<PanelRunResult> {
    const { panel, skipped } = this._resolvePanel(panelSpec);
    if (panel.length === 0) {
      throw new Error(
        "PanelExecutor: panel is empty after de-duplication and resolution; supply at least one usable distinct model",
      );
    }

    // Sequential fan-out: one panelist at a time (single-GPU MVP). Phase 3 (F3)
    // turns this loop concurrent behind the GpuScheduler's VRAM budget.
    const candidates: PanelCandidate[] = [];
    for (const modelId of panel) {
      candidates.push(await this._dispatchPanelist(prompt, modelId));
    }

    const fusion = await this._judge.fuse(prompt, candidates);
    const succeeded = candidates.filter((c) => c.ok).length;
    return {
      candidates,
      fusion,
      dispatched: panel,
      skipped,
      succeeded,
      failed: candidates.length - succeeded,
    };
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Reduce the raw spec to a distinct, resolver-approved, capped panel. Returns
   * the panel to dispatch plus the ids dropped by the resolver gate or the cap
   * (duplicate ids are silently collapsed -- distinctness is the contract).
   */
  private _resolvePanel(spec: readonly string[]): {
    panel: string[];
    skipped: string[];
  } {
    const seen = new Set<string>();
    const distinct: string[] = [];
    const skipped: string[] = [];
    for (const raw of spec) {
      const id = raw.trim();
      if (id.length === 0 || seen.has(id)) continue;
      seen.add(id);
      if (this._resolver && !this._resolver.isUsable(id)) {
        skipped.push(id);
        continue;
      }
      distinct.push(id);
    }
    if (distinct.length > this._maxPanelSize) {
      skipped.push(...distinct.slice(this._maxPanelSize));
      return { panel: distinct.slice(0, this._maxPanelSize), skipped };
    }
    return { panel: distinct, skipped };
  }

  /**
   * Dispatch one panelist: a plain chat completion on `modelId` with the shared
   * `prompt`. No `tools` are granted (F5). A failure is captured as a non-`ok`
   * candidate so the panel survives a single panelist dying.
   */
  private async _dispatchPanelist(
    prompt: string,
    modelId: string,
  ): Promise<PanelCandidate> {
    try {
      const client = this._clientFactory(modelId);
      const messages: LLMMessage[] = [{ role: "user", content: prompt }];
      const stream = client.streamChat({
        model: modelId,
        messages,
        stream: true,
        options: this._panelOptions,
        // Intentionally no `tools`: panelists get no per-panelist tool grant.
      });
      let answer = "";
      for await (const chunk of stream) {
        answer += chunk.message.content ?? "";
      }
      return { model: modelId, answer, ok: true };
    } catch (err) {
      return { model: modelId, answer: "", ok: false, error: formatForUser(err) };
    }
  }
}
