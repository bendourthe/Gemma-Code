/**
 * v1.0.0 Phase 8.1 -- GpuScheduler.
 *
 * Cross-module FIFO GPU job queue. The four Nexus pillars (Coding, Chat,
 * Image, Video) plus the Fine-tuning trainer all contend for a single
 * consumer-class GPU; this scheduler serializes their requests so two
 * pipelines never race for VRAM. The scheduler is a shared-core service:
 * any pillar that needs GPU time `enqueue()`s a `GpuJob` and receives a
 * `JobHandle`.
 *
 * Foreground-module-wins: callers tell the scheduler which module the user
 * is currently looking at via `setForegroundModule(id)`. Pending jobs whose
 * `moduleId` matches the foreground module are reordered to the head of the
 * queue ahead of any background jobs. Their original FIFO order among
 * themselves is preserved.
 *
 * VRAM gating: each job declares `estimatedVramGB`. The scheduler refuses
 * to enqueue a job whose estimate exceeds the host's free VRAM (resolved
 * via the injected `vramProvider`) and rejects the returned promise with
 * `InsufficientVramError`.
 *
 * Telemetry: every state transition publishes a `job.queued`,
 * `job.started`, `job.completed`, or `job.failed` event on the injected
 * `TelemetryBus`. The `source` is always `gpu-scheduler` and the payload
 * carries the originating module + job metadata.
 *
 * Cancellation: `JobHandle.cancel()` aborts the job's `AbortSignal`. If
 * the job has not started yet it is dropped from the queue and a
 * `job.cancelled` event is published; if it is already running the
 * caller's `run(signal)` is expected to honour the abort.
 *
 * Coding module integration note: only the streaming-LLM-token-generation
 * call enqueues a job; tool calls themselves are CPU-bound and do NOT go
 * through the scheduler. Image + Video pipelines route every generation
 * through the scheduler.
 *
 * v1.6.0 adoption-openrouter-fusion Phase 3 (OF007) -- panel co-residency.
 * `enqueuePanel()` admits a *bounded* set of small models as one scheduler job
 * (preserving the single-active-job ceiling for the GPU as a whole) and runs
 * its members concurrently when their summed `estimatedVramGB` fits free VRAM,
 * or **degrades to sequential** fan-out when it does not. This never OOMs (a
 * panel that does not fit is run one member at a time, peaking at the largest
 * single member, not the sum) and never rejects on summed VRAM (unlike a plain
 * `enqueue`, which still rejects a single job that exceeds free VRAM). A hard
 * panel-size cap (`DEFAULT_PANEL_SIZE_CAP`, overridable per panel) bounds how
 * many models can ever be co-resident. Optional `keepAlive` coordination keeps
 * the panel's models resident for the run's duration and releases them after
 * (see `ModelPinRegistry.holdForPanel`). Non-panel workloads are unchanged.
 */

import type { TelemetryBus } from "../telemetry/TelemetryBus.js";
import { conservativeResidentVramGb } from "../registry/moeFootprint.js";
import {
  evaluateModelSwap,
  type ModelSwapDecision,
} from "./modelSwap.js";

export type GpuModuleId = "coding" | "chat" | "image" | "video" | "tuning";

export type JobPriority = "foreground" | "background";

export interface GpuJob {
  readonly moduleId: GpuModuleId;
  readonly jobType: string;
  readonly estimatedVramGB: number;
  readonly priority: JobPriority;
  /** Optional human-readable id used in telemetry payloads. */
  readonly id?: string;
  /** Optional model id surfaced through the Local Model Status widget. */
  readonly modelId?: string;
  readonly run: (signal: AbortSignal) => Promise<unknown>;
}

export type JobState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface JobHandle {
  readonly id: string;
  readonly moduleId: GpuModuleId;
  readonly jobType: string;
  readonly estimatedVramGB: number;
  readonly modelId?: string;
  /** Resolves with the value returned by `run()` (or rejects on failure). */
  readonly completion: Promise<unknown>;
  readonly cancel: () => void;
  /** Current state, evaluated lazily. */
  readonly state: () => JobState;
}

export interface ActiveJobSnapshot {
  readonly id: string;
  readonly moduleId: GpuModuleId;
  readonly jobType: string;
  readonly modelId?: string;
  readonly estimatedVramGB: number;
  readonly startedAt: number;
}

export interface QueuedJobSnapshot {
  readonly id: string;
  readonly moduleId: GpuModuleId;
  readonly jobType: string;
  readonly modelId?: string;
  readonly estimatedVramGB: number;
  readonly priority: JobPriority;
  readonly enqueuedAt: number;
}

export interface SchedulerSnapshot {
  readonly active: ActiveJobSnapshot | null;
  readonly queued: readonly QueuedJobSnapshot[];
  readonly foregroundModule: GpuModuleId | null;
}

export type VramProvider = () => Promise<number> | number;

export interface RoutingSwapRequest {
  readonly sessionId: string;
  readonly fromModelId: string;
  readonly toModelId: string;
  readonly fromVramGB: number;
  readonly toVramGB: number;
  readonly workerResident?: boolean;
}

export interface GpuSchedulerOptions {
  readonly telemetry: TelemetryBus;
  /** Returns free VRAM in GB. CPU-only hosts may return system RAM analog. */
  readonly vramProvider: VramProvider;
  /** Initial foreground module. Defaults to `null`. */
  readonly foregroundModule?: GpuModuleId | null;
  /** Override for the id generator (tests). */
  readonly idGenerator?: () => string;
  /** Override for the clock (tests). */
  readonly now?: () => number;
  /**
   * v2.1.0 Phase 2 -- coalesce routing swap requests for the same session
   * that arrive within this many ms (anti-thrash). 0 disables batching.
   */
  readonly swapBatchWindowMs?: number;
}

export class InsufficientVramError extends Error {
  readonly requiredGB: number;
  readonly availableGB: number;
  constructor(requiredGB: number, availableGB: number) {
    super(
      `Insufficient VRAM: job requires ${requiredGB.toFixed(2)} GB, ` +
        `but only ${availableGB.toFixed(2)} GB free.`,
    );
    this.name = "InsufficientVramError";
    this.requiredGB = requiredGB;
    this.availableGB = availableGB;
  }
}

export class JobCancelledError extends Error {
  constructor(jobId: string) {
    super(`GPU job ${jobId} cancelled before completion.`);
    this.name = "JobCancelledError";
  }
}

// ---------------------------------------------------------------------------
// Panel co-residency (v1.6.0 adoption-openrouter-fusion Phase 3, OF007)
// ---------------------------------------------------------------------------

/** Default hard cap on how many models may ever be co-resident in one panel. */
export const DEFAULT_PANEL_SIZE_CAP = 3;

/**
 * v1.18.0 Phase 3 (LG-A3) -- conservative residency GB for panel / job
 * estimates. Re-exported so scheduler callers thread `totalParams` through the
 * same path that never substitutes active MoE compute for resident footprint.
 */
export { conservativeResidentVramGb };

/** One member of a panel: a model id, its VRAM estimate, and its work. */
export interface PanelMemberJob {
  readonly modelId: string;
  readonly estimatedVramGB: number;
  readonly run: (signal: AbortSignal) => Promise<unknown>;
}

/**
 * Minimal keep-alive port the scheduler invokes around a panel run so the
 * panelist models stay resident for the run's duration. `ModelPinRegistry`
 * structurally implements this via `holdForPanel` (OF008); the scheduler
 * depends only on this interface, never on the concrete registry.
 */
export interface PanelKeepAliveCoordinator {
  holdForPanel(models: readonly string[]): { release(): void };
}

/** A co-residency request: a bounded set of models fanned out as one job. */
export interface PanelJob {
  readonly moduleId: GpuModuleId;
  readonly jobType: string;
  readonly priority: JobPriority;
  /** Optional human-readable id used in telemetry payloads. */
  readonly id?: string;
  /** The panel members. Members beyond the cap are dropped (see `maxPanelSize`). */
  readonly members: readonly PanelMemberJob[];
  /** Hard co-residency cap. Defaults to `DEFAULT_PANEL_SIZE_CAP`. */
  readonly maxPanelSize?: number;
  /** Optional keep-alive coordination held for the run's duration (OF008). */
  readonly keepAlive?: PanelKeepAliveCoordinator;
}

export type PanelExecutionMode = "concurrent" | "sequential";

/** The outcome of running one member of a panel. */
export interface PanelMemberResult {
  readonly modelId: string;
  /** False when the member's `run` threw; the panel survives a member dying. */
  readonly ok: boolean;
  /** The value returned by `run` when `ok` is true. */
  readonly value?: unknown;
  /** The failure message when `ok` is false. */
  readonly error?: string;
}

/** The outcome of one panel run. The `completion` of a `PanelJobHandle`. */
export interface PanelRunOutcome {
  /** `concurrent` when the summed VRAM fit free VRAM; else `sequential`. */
  readonly mode: PanelExecutionMode;
  /** Model ids actually dispatched (after the panel-size cap). */
  readonly admitted: readonly string[];
  /** Model ids dropped by the panel-size cap. */
  readonly droppedByCap: readonly string[];
  /** Peak VRAM reserved: the sum in concurrent mode, the largest single
   * member in sequential mode (only one is ever resident at a time). */
  readonly reservedVramGB: number;
  /** Free VRAM observed at admission time (the basis for the mode decision). */
  readonly freeVramGB: number;
  /** Per-member results, in dispatch order. */
  readonly results: readonly PanelMemberResult[];
}

/** A `JobHandle` whose `completion` resolves to a `PanelRunOutcome`. */
export interface PanelJobHandle extends Omit<JobHandle, "completion"> {
  readonly completion: Promise<PanelRunOutcome>;
}

interface QueueEntry {
  readonly id: string;
  readonly job: GpuJob;
  readonly enqueuedAt: number;
  readonly abortController: AbortController;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  state: JobState;
}

let _autoSeq = 0;
function defaultId(): string {
  _autoSeq += 1;
  return `job-${Date.now().toString(36)}-${_autoSeq.toString(36)}`;
}

export class GpuScheduler {
  private readonly _telemetry: TelemetryBus;
  private readonly _vramProvider: VramProvider;
  private readonly _idGenerator: () => string;
  private readonly _now: () => number;
  private readonly _swapBatchWindowMs: number;
  private _queue: QueueEntry[] = [];
  private _active: QueueEntry | null = null;
  private _foregroundModule: GpuModuleId | null;
  private _pumping = false;
  private _lastFreeVramGB: number | null = null;
  private readonly _swapBatch = new Map<
    string,
    { readonly at: number; readonly decision: ModelSwapDecision }
  >();

  constructor(opts: GpuSchedulerOptions) {
    this._telemetry = opts.telemetry;
    this._vramProvider = opts.vramProvider;
    this._idGenerator = opts.idGenerator ?? defaultId;
    this._now = opts.now ?? (() => Date.now());
    this._foregroundModule = opts.foregroundModule ?? null;
    this._swapBatchWindowMs = Math.max(0, opts.swapBatchWindowMs ?? 50);
  }

  get foregroundModule(): GpuModuleId | null {
    return this._foregroundModule;
  }

  /**
   * v2.1.0 Phase 2 -- consult live VRAM (or the last sampled value) before
   * honoring a routing model swap. Batches near-simultaneous requests for the
   * same session. Never drops the request: a no-fit result is `deferred`.
   *
   * DEVIATION: this is a cost model, not an Ollama load/unload. keepWorkerResident
   * is advisory for the caller; prefetch of predicted swaps is not implemented.
   */
  evaluateRoutingSwap(req: RoutingSwapRequest): ModelSwapDecision {
    const now = this._now();
    const batched = this._swapBatch.get(req.sessionId);
    if (
      this._swapBatchWindowMs > 0 &&
      batched &&
      now - batched.at <= this._swapBatchWindowMs
    ) {
      this._publishSwap(req, batched.decision, true);
      return batched.decision;
    }

    let free = this._lastFreeVramGB;
    try {
      const sampled = this._vramProvider();
      if (typeof sampled === "number" && Number.isFinite(sampled)) {
        free = sampled;
        this._lastFreeVramGB = sampled;
      }
    } catch {
      free = this._lastFreeVramGB;
    }

    const activeModule = this._active?.job.moduleId ?? null;
    const decision = evaluateModelSwap({
      fromVramGB: req.fromVramGB,
      toVramGB: req.toVramGB,
      freeVramGB: free,
      activeModule,
      diffusionActive: activeModule === "image" || activeModule === "video",
      workerResident: req.workerResident,
    });
    this._swapBatch.set(req.sessionId, { at: now, decision });
    this._publishSwap(req, decision, false);
    return decision;
  }

  private _publishSwap(
    req: RoutingSwapRequest,
    decision: ModelSwapDecision,
    batched: boolean,
  ): void {
    this._telemetry.publish({
      kind: "scheduler.swap",
      source: "gpu-scheduler",
      payload: {
        sessionId: req.sessionId,
        fromModelId: req.fromModelId,
        toModelId: req.toModelId,
        outcome: decision.outcome,
        reason: decision.reason,
        keepWorkerResident: decision.keepWorkerResident,
        batched,
      },
    });
  }

  /**
   * Update the active foreground module. Pending jobs whose `moduleId`
   * matches are reordered to the head of the queue while preserving their
   * relative FIFO order among themselves and among the bumped-down
   * background jobs.
   */
  setForegroundModule(id: GpuModuleId | null): void {
    this._foregroundModule = id;
    if (id === null) return;
    const matching: QueueEntry[] = [];
    const rest: QueueEntry[] = [];
    for (const entry of this._queue) {
      if (entry.job.moduleId === id) {
        matching.push(entry);
      } else {
        rest.push(entry);
      }
    }
    this._queue = [...matching, ...rest];
  }

  /**
   * Enqueue a job. Validates against the current free-VRAM ceiling first.
   */
  async enqueue(job: GpuJob): Promise<JobHandle> {
    const freeGB = await Promise.resolve(this._vramProvider());
    this._lastFreeVramGB = freeGB;
    if (job.estimatedVramGB > freeGB) {
      const err = new InsufficientVramError(job.estimatedVramGB, freeGB);
      this._publish("job.failed", {
        jobId: job.id ?? "<rejected>",
        moduleId: job.moduleId,
        jobType: job.jobType,
        reason: "insufficient-vram",
        requiredGB: job.estimatedVramGB,
        availableGB: freeGB,
      });
      throw err;
    }
    return this._admit(job);
  }

  /**
   * Admit a panel as one scheduler job that fans its members out concurrently
   * when their summed VRAM fits free VRAM, or sequentially when it does not.
   *
   * Unlike `enqueue`, a panel is **never rejected** on summed VRAM: a panel
   * that does not fit degrades to sequential fan-out (one member resident at a
   * time) rather than throwing `InsufficientVramError`. The panel occupies a
   * single queue slot, so the single-active-job ceiling for the GPU as a whole
   * is preserved; concurrency happens only *within* the admitted panel. Members
   * beyond `maxPanelSize` (default `DEFAULT_PANEL_SIZE_CAP`) are dropped before
   * dispatch and reported in the outcome's `droppedByCap`.
   *
   * @throws if the panel has no members (after the cap leaves an empty set).
   */
  async enqueuePanel(panel: PanelJob): Promise<PanelJobHandle> {
    const cap = Math.max(1, panel.maxPanelSize ?? DEFAULT_PANEL_SIZE_CAP);
    const admitted = panel.members.slice(0, cap);
    const droppedByCap = panel.members.slice(cap).map((m) => m.modelId);
    if (admitted.length === 0) {
      throw new Error(
        "GpuScheduler.enqueuePanel: panel has no members to dispatch",
      );
    }
    const summedVramGB = admitted.reduce((sum, m) => sum + m.estimatedVramGB, 0);
    const id = panel.id ?? this._idGenerator();
    const wrapped: GpuJob = {
      moduleId: panel.moduleId,
      jobType: panel.jobType,
      estimatedVramGB: summedVramGB,
      priority: panel.priority,
      id,
      run: (signal) =>
        this._runPanel(id, panel, admitted, droppedByCap, summedVramGB, signal),
    };
    // The wrapped run resolves to a PanelRunOutcome, so the base handle's
    // `completion: Promise<unknown>` is narrowed to Promise<PanelRunOutcome>
    // at this well-defined boundary.
    return this._admit(wrapped) as unknown as PanelJobHandle;
  }

  /**
   * Build a queue entry for `job`, push it, apply foreground bumping, emit the
   * `job.queued` event, kick the pump, and return the handle. Shared by
   * `enqueue` (after its VRAM gate) and `enqueuePanel` (which manages VRAM
   * itself via the concurrent/sequential decision).
   */
  private _admit(job: GpuJob): JobHandle {
    const id = job.id ?? this._idGenerator();
    const abortController = new AbortController();
    let resolveFn!: (v: unknown) => void;
    let rejectFn!: (r: unknown) => void;
    const completion = new Promise<unknown>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    const entry: QueueEntry = {
      id,
      job,
      enqueuedAt: this._now(),
      abortController,
      resolve: resolveFn,
      reject: rejectFn,
      state: "queued",
    };

    this._queue.push(entry);
    // Reorder foreground-priority callers to head if the current foreground
    // module matches. Bumps preserve relative FIFO order.
    if (this._foregroundModule === job.moduleId) {
      this.setForegroundModule(this._foregroundModule);
    }

    this._publish("job.queued", {
      jobId: id,
      moduleId: job.moduleId,
      jobType: job.jobType,
      modelId: job.modelId,
      estimatedVramGB: job.estimatedVramGB,
      priority: job.priority,
    });

    // Kick the pump. Fire-and-forget; errors surface through completion.
    void this._pump();

    const handle: JobHandle = {
      id,
      moduleId: job.moduleId,
      jobType: job.jobType,
      estimatedVramGB: job.estimatedVramGB,
      modelId: job.modelId,
      completion,
      cancel: () => this._cancel(entry),
      state: () => entry.state,
    };
    return handle;
  }

  /**
   * v2.4.8 follow-up: abort the running job from another surface (a studio
   * page asking to take the GPU). Returns false when nothing is running. The
   * pump tags the final state once `run()` rejects.
   */
  cancelActive(): boolean {
    if (!this._active) return false;
    this._cancel(this._active);
    return true;
  }

  snapshot(): SchedulerSnapshot {
    const active = this._active
      ? {
          id: this._active.id,
          moduleId: this._active.job.moduleId,
          jobType: this._active.job.jobType,
          modelId: this._active.job.modelId,
          estimatedVramGB: this._active.job.estimatedVramGB,
          startedAt: this._active.enqueuedAt,
        }
      : null;
    const queued: QueuedJobSnapshot[] = this._queue.map((entry) => ({
      id: entry.id,
      moduleId: entry.job.moduleId,
      jobType: entry.job.jobType,
      modelId: entry.job.modelId,
      estimatedVramGB: entry.job.estimatedVramGB,
      priority: entry.job.priority,
      enqueuedAt: entry.enqueuedAt,
    }));
    return { active, queued, foregroundModule: this._foregroundModule };
  }

  private _cancel(entry: QueueEntry): void {
    if (entry.state === "completed" || entry.state === "cancelled" || entry.state === "failed") {
      return;
    }
    const idx = this._queue.indexOf(entry);
    if (idx >= 0) {
      // Pending -- drop from queue and resolve cancellation immediately.
      this._queue.splice(idx, 1);
      entry.state = "cancelled";
      entry.abortController.abort();
      this._publish("job.cancelled", {
        jobId: entry.id,
        moduleId: entry.job.moduleId,
        jobType: entry.job.jobType,
        reason: "dequeued",
      });
      entry.reject(new JobCancelledError(entry.id));
      return;
    }
    if (this._active === entry) {
      // Running -- signal abort; the run() implementation is expected to
      // honour the AbortSignal and reject. The pump tags the final state.
      entry.abortController.abort();
      this._publish("job.cancelled", {
        jobId: entry.id,
        moduleId: entry.job.moduleId,
        jobType: entry.job.jobType,
        reason: "abort-signal",
      });
    }
  }

  /**
   * Run an admitted panel. Re-reads free VRAM at run start (the panel is now
   * the active job, so this is the moment its members would actually load),
   * decides concurrent vs sequential, holds keep-alive for the run's duration,
   * and collects a per-member result. A member that throws is recorded as a
   * non-`ok` result so the panel survives a single member dying.
   */
  private async _runPanel(
    id: string,
    panel: PanelJob,
    members: readonly PanelMemberJob[],
    droppedByCap: readonly string[],
    summedVramGB: number,
    signal: AbortSignal,
  ): Promise<PanelRunOutcome> {
    const freeVramGB = await Promise.resolve(this._vramProvider());
    const mode: PanelExecutionMode =
      summedVramGB <= freeVramGB ? "concurrent" : "sequential";
    const reservedVramGB =
      mode === "concurrent"
        ? summedVramGB
        : members.reduce((max, m) => Math.max(max, m.estimatedVramGB), 0);

    this._publish("job.started", {
      jobId: id,
      moduleId: panel.moduleId,
      jobType: panel.jobType,
      panelEvent: "panel.scheduled",
      panelMode: mode,
      panelSize: members.length,
      droppedByCap: droppedByCap.length,
      reservedVramGB,
      freeVramGB,
    });

    const hold = panel.keepAlive?.holdForPanel(members.map((m) => m.modelId)) ?? null;
    try {
      let results: PanelMemberResult[];
      if (mode === "concurrent") {
        results = await Promise.all(
          members.map((m) => this._runPanelMember(m, signal)),
        );
      } else {
        results = [];
        for (const member of members) {
          if (signal.aborted) break;
          results.push(await this._runPanelMember(member, signal));
        }
      }
      return {
        mode,
        admitted: members.map((m) => m.modelId),
        droppedByCap,
        reservedVramGB,
        freeVramGB,
        results,
      };
    } finally {
      hold?.release();
    }
  }

  /** Run one panel member, capturing a throw as a non-`ok` result. */
  private async _runPanelMember(
    member: PanelMemberJob,
    signal: AbortSignal,
  ): Promise<PanelMemberResult> {
    try {
      const value = await member.run(signal);
      return { modelId: member.modelId, ok: true, value };
    } catch (err) {
      return {
        modelId: member.modelId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async _pump(): Promise<void> {
    if (this._pumping) return;
    this._pumping = true;
    try {
      while (this._queue.length > 0) {
        const next = this._queue.shift();
        if (!next) break;
        if (next.state === "cancelled") continue;
        this._active = next;
        next.state = "running";
        this._publish("job.started", {
          jobId: next.id,
          moduleId: next.job.moduleId,
          jobType: next.job.jobType,
          modelId: next.job.modelId,
          estimatedVramGB: next.job.estimatedVramGB,
        });
        try {
          const value = await next.job.run(next.abortController.signal);
          if (next.abortController.signal.aborted) {
            next.state = "cancelled";
            next.reject(new JobCancelledError(next.id));
          } else {
            next.state = "completed";
            this._publish("job.completed", {
              jobId: next.id,
              moduleId: next.job.moduleId,
              jobType: next.job.jobType,
              modelId: next.job.modelId,
            });
            next.resolve(value);
          }
        } catch (err) {
          if (next.abortController.signal.aborted) {
            next.state = "cancelled";
            next.reject(new JobCancelledError(next.id));
          } else {
            next.state = "failed";
            this._publish("job.failed", {
              jobId: next.id,
              moduleId: next.job.moduleId,
              jobType: next.job.jobType,
              reason: "run-threw",
              message: err instanceof Error ? err.message : String(err),
            });
            next.reject(err);
          }
        } finally {
          if (this._active === next) this._active = null;
        }
      }
    } finally {
      this._pumping = false;
    }
  }

  private _publish(
    kind:
      | "job.queued"
      | "job.started"
      | "job.completed"
      | "job.failed"
      | "job.cancelled",
    payload: Record<string, unknown>,
  ): void {
    // The TelemetryBus typings declare a closed `TelemetryEventKind` union.
    // `job.cancelled` is published with the closest available kind
    // (`job.failed`) re-tagged via payload.reason. The bus is lenient about
    // payload shape; this keeps the public scheduler API faithful to the
    // Phase 8.1 spec while staying within the v1.0.0 Phase 2.6 enum.
    const busKind: "job.queued" | "job.started" | "job.completed" | "job.failed" =
      kind === "job.cancelled" ? "job.failed" : kind;
    this._telemetry.publish({
      kind: busKind,
      source: "gpu-scheduler",
      payload: { ...payload, schedulerEvent: kind },
    });
  }
}
