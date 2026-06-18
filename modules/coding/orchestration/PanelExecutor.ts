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
 * Sequential fan-out (the honest single-GPU MVP) by default. On one consumer
 * GPU the panelists run one at a time. Co-residency / concurrency is comparison
 * item F3: the `GpuScheduler.enqueuePanel` primitive (Phase 3, OF007) admits a
 * bounded panel as one scheduler job that runs concurrently when its summed
 * VRAM fits free VRAM and degrades to sequential when it does not.
 *
 * v1.6.0 Phase 4 (OF011, closing OF007.P3.A) wires that primitive in: passing a
 * `concurrency` backend (a `GpuScheduler` + per-model VRAM estimates, optionally
 * a `ModelPinRegistry` keep-alive coordinator) routes the fan-out through
 * `enqueuePanel({ keepAlive })`, so a fitting panel is gathered concurrently and
 * a too-large one degrades to sequential -- with no OOM and no public-surface
 * change (`run` stays the entry point; the dispatch path is selected internally).
 * When no `concurrency` backend is supplied, `run` keeps the sequential MVP loop.
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
import type {
  GpuModuleId,
  JobPriority,
  PanelJob,
  PanelKeepAliveCoordinator,
  PanelRunOutcome,
} from "../../../core/scheduler/GpuScheduler.js";

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

/**
 * Minimal scheduler port the concurrent fan-out depends on: the single method
 * `GpuScheduler` exposes for panel co-residency (OF007). Declared structurally
 * so the executor stays decoupled from the concrete scheduler and a test can
 * inject a deterministic fake.
 */
export interface PanelScheduler {
  enqueuePanel(panel: PanelJob): Promise<{ completion: Promise<PanelRunOutcome> }>;
}

/**
 * v1.6.0 Phase 4 (OF011, closing OF007.P3.A) -- the optional GPU-scheduler
 * backend that turns `run`'s sequential MVP loop into VRAM-gated co-residency.
 * When supplied, the fan-out is dispatched as one `enqueuePanel` job: the
 * scheduler runs the panel concurrently when the summed `vramFor` estimates fit
 * free VRAM and degrades to sequential when they do not (no OOM, no rejection).
 */
export interface PanelConcurrencyBackend {
  /** The GPU scheduler that admits the panel as one co-residency job. */
  readonly scheduler: PanelScheduler;
  /** Per-model VRAM estimate (GB) used for the concurrent/sequential decision. */
  readonly vramFor: (modelId: string) => number;
  /** Optional keep-alive coordinator held for the run's duration (OF008). */
  readonly keepAlive?: PanelKeepAliveCoordinator;
  /** GPU module the panel job is attributed to. Defaults to `coding`. */
  readonly moduleId?: GpuModuleId;
  /** Scheduler priority for the panel job. Defaults to `foreground`. */
  readonly priority?: JobPriority;
  /** Hard co-residency cap forwarded to `enqueuePanel`. Defaults to the
   * scheduler's own `DEFAULT_PANEL_SIZE_CAP`; members beyond it are reported
   * back as `skipped`. */
  readonly maxPanelSize?: number;
}

export interface PanelExecutorOptions {
  readonly clientFactory: LLMClientFactory;
  readonly judge: PanelJudge;
  /** Sampling options forwarded to each panelist request. */
  readonly panelOptions?: LLMOptions;
  /** Hard panel-size cap (safety bound; the concurrency backend adds its own
   * VRAM-aware co-residency cap on top). */
  readonly maxPanelSize?: number;
  /** Optional usable-model gate; unresolvable ids are recorded as skipped. */
  readonly modelResolver?: PanelModelResolver;
  /**
   * v1.6.0 Phase 4 (OF011) -- optional GPU-scheduler backend. When supplied,
   * `run` routes the fan-out through `GpuScheduler.enqueuePanel` (concurrent
   * when VRAM fits, sequential otherwise). When omitted, `run` uses the
   * in-process sequential MVP loop.
   */
  readonly concurrency?: PanelConcurrencyBackend;
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

/** Narrow a scheduler member-result `value` (typed `unknown`) to a candidate. */
function isPanelCandidate(value: unknown): value is PanelCandidate {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PanelCandidate).model === "string" &&
    typeof (value as PanelCandidate).answer === "string" &&
    typeof (value as PanelCandidate).ok === "boolean"
  );
}

// ---------------------------------------------------------------------------
// PanelExecutor
// ---------------------------------------------------------------------------

export class PanelExecutor {
  private readonly _clientFactory: LLMClientFactory;
  private readonly _judge: PanelJudge;
  private readonly _panelOptions: LLMOptions;
  private readonly _maxPanelSize: number;
  private readonly _resolver: PanelModelResolver | null;
  private readonly _concurrency: PanelConcurrencyBackend | null;

  constructor(options: PanelExecutorOptions) {
    this._clientFactory = options.clientFactory;
    this._judge = options.judge;
    this._panelOptions = options.panelOptions ?? {};
    this._maxPanelSize = Math.max(1, options.maxPanelSize ?? DEFAULT_MAX_PANEL_SIZE);
    this._resolver = options.modelResolver ?? null;
    this._concurrency = options.concurrency ?? null;
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

    // When a GPU-scheduler backend is wired (Phase 4, OF011) the fan-out runs
    // as one co-residency job (concurrent when VRAM fits, sequential when it
    // does not); otherwise it stays the sequential single-GPU MVP loop.
    const { candidates, dispatched, skipped: extraSkipped } =
      this._concurrency !== null
        ? await this._runConcurrent(prompt, panel, this._concurrency)
        : await this._runSequential(prompt, panel);

    const fusion = await this._judge.fuse(prompt, candidates);
    const succeeded = candidates.filter((c) => c.ok).length;
    return {
      candidates,
      fusion,
      dispatched,
      skipped: [...skipped, ...extraSkipped],
      succeeded,
      failed: candidates.length - succeeded,
    };
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /** Result of a dispatch strategy: the labeled candidates plus the panel that
   * was actually dispatched and any members the strategy itself dropped. */
  private async _runSequential(
    prompt: string,
    panel: readonly string[],
  ): Promise<{
    candidates: PanelCandidate[];
    dispatched: readonly string[];
    skipped: readonly string[];
  }> {
    // Sequential fan-out: one panelist at a time (single-GPU MVP).
    const candidates: PanelCandidate[] = [];
    for (const modelId of panel) {
      candidates.push(await this._dispatchPanelist(prompt, modelId));
    }
    return { candidates, dispatched: panel, skipped: [] };
  }

  /**
   * Concurrent fan-out via the GPU scheduler (OF011, closing OF007.P3.A).
   * Builds one `enqueuePanel` job whose members each dispatch a panelist, holds
   * keep-alive for the run, and maps the scheduler's per-member results back
   * into labeled candidates. The scheduler decides concurrent vs sequential on
   * the summed VRAM estimate, so a fitting panel is gathered concurrently and a
   * too-large one degrades to sequential -- never OOM. Members the scheduler's
   * co-residency cap drops are returned as `skipped` and never fused.
   */
  private async _runConcurrent(
    prompt: string,
    panel: readonly string[],
    backend: PanelConcurrencyBackend,
  ): Promise<{
    candidates: PanelCandidate[];
    dispatched: readonly string[];
    skipped: readonly string[];
  }> {
    const job: PanelJob = {
      moduleId: backend.moduleId ?? "coding",
      jobType: "fusion-panel",
      priority: backend.priority ?? "foreground",
      members: panel.map((modelId) => ({
        modelId,
        estimatedVramGB: backend.vramFor(modelId),
        run: () => this._dispatchPanelist(prompt, modelId),
      })),
      ...(backend.maxPanelSize !== undefined
        ? { maxPanelSize: backend.maxPanelSize }
        : {}),
      ...(backend.keepAlive ? { keepAlive: backend.keepAlive } : {}),
    };

    const handle = await backend.scheduler.enqueuePanel(job);
    const outcome = await handle.completion;

    // Each member's `run` is `_dispatchPanelist`, which never throws (a dead
    // panelist is captured as a non-`ok` candidate), so a member result is
    // normally `{ ok: true, value: PanelCandidate }`. A non-`ok` member result
    // (the scheduler caught a throw) is defensively mapped to a failed
    // candidate so the panel still fuses the survivors.
    const candidates: PanelCandidate[] = outcome.results.map((result) =>
      result.ok && isPanelCandidate(result.value)
        ? result.value
        : {
            model: result.modelId,
            answer: "",
            ok: false,
            error: result.error ?? "panel member did not produce a candidate",
          },
    );

    return {
      candidates,
      dispatched: outcome.admitted,
      skipped: outcome.droppedByCap,
    };
  }

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
