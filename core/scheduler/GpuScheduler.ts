/**
 * v1.0.0 Phase 8.1 -- GpuScheduler.
 *
 * Cross-module FIFO GPU job queue. The four Nexus pillars (Coding, Chat,
 * Image, Video) all contend for a single consumer-class GPU; this scheduler
 * serializes their requests so two pipelines never race for VRAM. The
 * scheduler is a shared-core service: any pillar that needs GPU time
 * `enqueue()`s a `GpuJob` and receives a `JobHandle`.
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
 */

import type { TelemetryBus } from "../telemetry/TelemetryBus.js";

export type GpuModuleId = "coding" | "chat" | "image" | "video";

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
  private _queue: QueueEntry[] = [];
  private _active: QueueEntry | null = null;
  private _foregroundModule: GpuModuleId | null;
  private _pumping = false;

  constructor(opts: GpuSchedulerOptions) {
    this._telemetry = opts.telemetry;
    this._vramProvider = opts.vramProvider;
    this._idGenerator = opts.idGenerator ?? defaultId;
    this._now = opts.now ?? (() => Date.now());
    this._foregroundModule = opts.foregroundModule ?? null;
  }

  get foregroundModule(): GpuModuleId | null {
    return this._foregroundModule;
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
