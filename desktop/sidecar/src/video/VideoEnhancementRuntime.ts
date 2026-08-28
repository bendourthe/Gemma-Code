import { randomUUID } from "node:crypto";
import * as path from "node:path";

import {
  DEFAULT_VIDEO_ENHANCEMENT_TIMEOUT_MS,
  MAX_VIDEO_ENHANCEMENT_JOB_ID_LENGTH,
  VideoEnhancementService,
  isAbsoluteLocalMp4Path,
  validateVideoEnhancementRequest,
  type RationalFrameRate,
  type VideoEnhancementBackendRunContext,
  type VideoEnhancementError,
  type VideoEnhancementErrorCode,
  type VideoEnhancementInterpolationPresetId,
  type VideoEnhancementMode,
  type VideoEnhancementProgress,
  type VideoEnhancementProgressStage,
  type VideoEnhancementRequest,
  type VideoEnhancementResult,
  type VideoEnhancementStagedSuccess,
  type VideoEnhancementUpscalePresetId,
  type VideoSourceIdentity,
} from "../../../../core/video/VideoEnhancement.js";
import {
  createVideoEnhancementDurableProvenance,
  createVideoEnhancementEmbeddedProvenance,
  serializeVideoWorkflowMetadata,
  type VideoEnhancementDurableProvenance,
  type VideoWorkflowMetadata,
} from "../../../../core/video/WorkflowMetadata.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MEDIA_TYPE_PATTERN = /^video\/mp4(?:\s*;|$)/i;
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const MAX_WORKFLOW_DEPTH = 12;
const MAX_WORKFLOW_ENTRIES = 10_000;
const INVALID_JSON_VALUE = Symbol("invalid-json-value");

export const VIDEO_ENHANCEMENT_BACKEND_ID = "video2x";

export type VideoEnhancementRuntimeJobState =
  | "queued"
  | "running"
  | "interrupted"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";

export type VideoEnhancementRuntimeErrorCode =
  | VideoEnhancementErrorCode
  | "ineligible_source"
  | "id_conflict"
  | "invalid_state"
  | "not_found"
  | "interrupted";

export interface VideoGenerationOutputSnapshot {
  readonly outputId: string;
  readonly generationId: string;
  readonly jobState: "queued" | "running" | "interrupted" | "done" | "failed";
  readonly pillar: "image" | "video";
  readonly mediaType: string;
  readonly path: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: RationalFrameRate;
  readonly workflow: Readonly<Record<string, unknown>>;
  readonly threadId: string | null;
}

export interface VideoEnhancementRuntimeIssue {
  readonly code: VideoEnhancementRuntimeErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly stage: VideoEnhancementProgressStage;
  readonly diagnostics: string | null;
  readonly terminationConfirmed: boolean | null;
}

export interface VideoEnhancementPreparedProvenance {
  readonly provenanceRecordId: string;
  readonly preProvenanceContainerSha256: string;
  readonly publishedContainerSha256: string;
  readonly embeddedWorkflow: VideoWorkflowMetadata;
  readonly durableProvenance: VideoEnhancementDurableProvenance;
}

export interface PublishedVideoEnhancementOutput extends VideoEnhancementPreparedProvenance {
  readonly outputId: string;
  readonly path: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: RationalFrameRate;
  /** Storage projection of embeddedWorkflow. These values must be identical. */
  readonly workflow: VideoWorkflowMetadata;
}

export interface StoredVideoEnhancementJob {
  readonly childJobId: string;
  readonly parentJobId: string;
  readonly sourceOutputId: string;
  readonly backendId: string;
  readonly state: VideoEnhancementRuntimeJobState;
  readonly priority: "interactive" | "batch";
  readonly estimatedVramGB: number;
  readonly request: VideoEnhancementRequest;
  readonly sourceOutput: VideoGenerationOutputSnapshot;
  readonly idempotencyKey: string | null;
  readonly attempt: number;
  readonly retryOfChildJobId: string | null;
  readonly cancelRequested: boolean;
  readonly progress: VideoEnhancementProgress | null;
  readonly error: VideoEnhancementRuntimeIssue | null;
  readonly output: PublishedVideoEnhancementOutput | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface VideoEnhancementQueueEnqueueInput {
  readonly childJobId: string;
  readonly parentJobId: string;
  readonly sourceOutputId: string;
  readonly backendId: string;
  readonly priority: "interactive" | "batch";
  readonly estimatedVramGB: number;
  readonly request: VideoEnhancementRequest;
  readonly sourceOutput: VideoGenerationOutputSnapshot;
  readonly idempotencyKey: string | null;
  readonly attempt: number;
  readonly retryOfChildJobId: string | null;
  readonly createdAt: string;
}

export interface VideoEnhancementQueueEnqueueResult {
  readonly created: boolean;
  readonly job: StoredVideoEnhancementJob;
}

export interface VideoEnhancementQueueFinishInput {
  readonly childJobId: string;
  readonly expectedStates: readonly ("queued" | "running" | "interrupted")[];
  readonly state: "failed" | "cancelled" | "timed_out" | "interrupted";
  readonly error: VideoEnhancementRuntimeIssue;
  readonly finishedAt: string;
}

/**
 * Semantic adapter over the existing generation queue. Implementations must
 * compare terminal transitions atomically and return the authoritative row.
 */
export interface VideoEnhancementQueuePort {
  enqueueEnhancement(
    input: VideoEnhancementQueueEnqueueInput,
  ): Promise<VideoEnhancementQueueEnqueueResult>;
  getEnhancement(childJobId: string): Promise<StoredVideoEnhancementJob | null>;
  persistEnhancementProgress(input: {
    readonly childJobId: string;
    readonly progress: VideoEnhancementProgress;
    readonly updatedAt: string;
  }): Promise<boolean>;
  requestEnhancementCancellation(input: {
    readonly childJobId: string;
    readonly requestedAt: string;
  }): Promise<StoredVideoEnhancementJob | null>;
  finishEnhancement(
    input: VideoEnhancementQueueFinishInput,
  ): Promise<StoredVideoEnhancementJob | null>;
}

export interface ValidatedVideoEnhancementMedia extends VideoEnhancementPreparedProvenance {
  /** Metadata-bearing staged copy, distinct from the backend staged output. */
  readonly stagedPath: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: RationalFrameRate;
}

export interface VideoEnhancementRunRecord {
  readonly childJobId: string;
  readonly parentJobId: string;
  readonly sourceGenerationId: string;
  readonly sourceOutputId: string;
  readonly sourceContentHash: string;
  readonly outputId: string;
  readonly outputContentHash: string;
  readonly provenanceRecordId: string;
  readonly preProvenanceContainerSha256: string;
  readonly publishedContainerSha256: string;
  readonly embeddedWorkflow: VideoWorkflowMetadata;
  readonly durableProvenance: VideoEnhancementDurableProvenance;
  readonly request: VideoEnhancementRequest;
  readonly backend: VideoEnhancementStagedSuccess["backend"];
  readonly stages: VideoEnhancementStagedSuccess["stages"];
  readonly execution: VideoEnhancementStagedSuccess["execution"];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly warnings: readonly string[];
  readonly progress: VideoEnhancementStagedSuccess["progress"];
  readonly attempt: number;
  readonly retryOfChildJobId: string | null;
  readonly outcome: "succeeded";
}

export interface VideoEnhancementCompletionOutboxRecord {
  readonly eventId: string;
  readonly eventType: "video.enhancement.completed";
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly threadId: string | null;
  readonly payload: Readonly<{
    childJobId: string;
    parentJobId: string;
    sourceOutputId: string;
    sourceContentHash: string;
    outputId: string;
    outputContentHash: string;
    provenanceRecordId: string;
    preProvenanceContainerSha256: string;
    publishedContainerSha256: string;
    attempt: number;
  }>;
}

export interface VideoEnhancementAtomicCompletionInput {
  readonly childJobId: string;
  readonly expectedState: "running";
  readonly provenanceRecordId: string;
  readonly embeddedWorkflow: VideoWorkflowMetadata;
  readonly durableProvenance: VideoEnhancementDurableProvenance;
  readonly output: PublishedVideoEnhancementOutput;
  readonly enhancement: VideoEnhancementRunRecord;
  readonly outbox: VideoEnhancementCompletionOutboxRecord;
  readonly finishedAt: string;
}

export interface VideoEnhancementAtomicCompletionResult {
  readonly committed: boolean;
  readonly job: StoredVideoEnhancementJob | null;
}

/**
 * Storage lookup plus the one transaction that publishes durable success.
 * A binding may delegate completeEnhancement to the queue when both share one
 * database owner, but it must still perform one transaction.
 */
export interface VideoEnhancementStoragePort {
  getGenerationOutput(
    parentJobId: string,
    outputId: string,
  ): Promise<VideoGenerationOutputSnapshot | null>;
  completeEnhancement(
    input: VideoEnhancementAtomicCompletionInput,
  ): Promise<VideoEnhancementAtomicCompletionResult>;
}

export interface VideoEnhancementMediaPort {
  verifySource(
    expected: VideoSourceIdentity,
    signal: AbortSignal,
  ): Promise<VideoSourceIdentity>;
  validateAndWriteProvenance(input: {
    readonly job: StoredVideoEnhancementJob;
    readonly staged: VideoEnhancementStagedSuccess;
    readonly signal: AbortSignal;
  }): Promise<ValidatedVideoEnhancementMedia>;
}

/** Publication promotes one collision-safe output but does not expose it. */
export interface VideoEnhancementPublicationPort {
  publish(input: {
    readonly childJobId: string;
    readonly desiredOutputId: string;
    readonly source: VideoGenerationOutputSnapshot;
    readonly validated: ValidatedVideoEnhancementMedia;
    readonly signal: AbortSignal;
  }): Promise<PublishedVideoEnhancementOutput>;
  quarantine(input: {
    readonly childJobId: string;
    readonly output: PublishedVideoEnhancementOutput;
    readonly reason: VideoEnhancementRuntimeIssue;
  }): Promise<void>;
  /** Remove a retained staged artifact or quarantine an internally tracked publish. */
  discard?(input: {
    readonly childJobId: string;
    readonly reason: VideoEnhancementRuntimeIssue;
  }): Promise<void>;
  /** Release post-publish tracking only after durable completion commits. */
  finalize?(input: {
    readonly childJobId: string;
    readonly output: PublishedVideoEnhancementOutput;
  }): Promise<void>;
}

export interface VideoEnhancementGpuJobHandle {
  readonly completion: Promise<unknown>;
  readonly cancel: () => void;
  readonly state: () =>
    "queued" | "running" | "completed" | "failed" | "cancelled";
}

export interface VideoEnhancementSchedulerPort {
  enqueue(job: {
    readonly moduleId: "video";
    readonly jobType: "video_enhancement";
    readonly estimatedVramGB: number;
    readonly priority: "foreground" | "background";
    readonly id: string;
    readonly run: (signal: AbortSignal) => Promise<unknown>;
  }): Promise<VideoEnhancementGpuJobHandle>;
}

export interface VideoEnhancementServicePort {
  run(
    input: unknown,
    context: VideoEnhancementBackendRunContext,
  ): Promise<VideoEnhancementResult>;
}

export interface VideoEnhancementRuntimeClock {
  now(): Date;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(token: unknown): void;
}

export interface EnqueueVideoEnhancementInput {
  readonly parentJobId: string;
  readonly sourceOutputId: string;
  readonly mode: VideoEnhancementMode;
  readonly upscalePreset?: VideoEnhancementUpscalePresetId;
  readonly interpolationPreset?: VideoEnhancementInterpolationPresetId;
  readonly timeoutMs?: number;
  readonly priority?: "interactive" | "batch";
  readonly estimatedVramGB?: number;
  readonly idempotencyKey?: string;
  readonly retryOfChildJobId?: string;
}

export type EnqueueVideoEnhancementResult =
  | {
      readonly ok: true;
      readonly created: boolean;
      readonly job: StoredVideoEnhancementJob;
    }
  | { readonly ok: false; readonly error: VideoEnhancementRuntimeIssue };

export type VideoEnhancementExecutionOutcome =
  | {
      readonly ok: true;
      readonly state: "succeeded";
      readonly childJobId: string;
      readonly output: PublishedVideoEnhancementOutput;
    }
  | {
      readonly ok: false;
      readonly state: "failed" | "cancelled" | "timed_out" | "interrupted";
      readonly childJobId: string;
      readonly error: VideoEnhancementRuntimeIssue;
    };

export class VideoEnhancementRuntimePortError extends Error {
  constructor(
    readonly code: VideoEnhancementRuntimeErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly stage: VideoEnhancementProgressStage,
    readonly diagnostics: string | null = null,
    readonly terminationConfirmed: boolean | null = null,
  ) {
    super(message);
    this.name = "VideoEnhancementRuntimePortError";
  }
}

interface ActiveExecution {
  readonly childJobId: string;
  readonly controller: AbortController;
  readonly stopPromise: Promise<"cancel" | "timeout">;
  readonly resolveStop: (kind: "cancel" | "timeout") => void;
  handle: VideoEnhancementGpuJobHandle | null;
  signal: AbortSignal;
  stopKind: "cancel" | "timeout" | null;
  acceptingProgress: boolean;
  progressTail: Promise<void>;
  progressFailure: unknown;
  progressRejected: boolean;
  settlement: Promise<void>;
}

interface VideoEnhancementRuntimeOptions {
  readonly queue: VideoEnhancementQueuePort;
  readonly storage: VideoEnhancementStoragePort;
  readonly scheduler: VideoEnhancementSchedulerPort;
  readonly service: VideoEnhancementServicePort | VideoEnhancementService;
  readonly media: VideoEnhancementMediaPort;
  readonly publication: VideoEnhancementPublicationPort;
  readonly clock?: VideoEnhancementRuntimeClock;
  readonly childIdFactory?: () => string;
  readonly requestIdFactory?: (childJobId: string) => string;
  readonly outputIdFactory?: (childJobId: string) => string;
  readonly eventIdFactory?: (childJobId: string) => string;
}

const SYSTEM_CLOCK: VideoEnhancementRuntimeClock = Object.freeze({
  now: () => new Date(),
  setTimeout: (callback: () => void, delayMs: number) =>
    globalThis.setTimeout(callback, delayMs),
  clearTimeout: (token: unknown) =>
    globalThis.clearTimeout(token as ReturnType<typeof globalThis.setTimeout>),
});

export class VideoEnhancementRuntime {
  private readonly active = new Map<string, ActiveExecution>();
  private readonly settlements = new Set<Promise<void>>();
  private readonly clock: VideoEnhancementRuntimeClock;
  private readonly childIdFactory: () => string;
  private readonly requestIdFactory: (childJobId: string) => string;
  private readonly outputIdFactory: (childJobId: string) => string;
  private readonly eventIdFactory: (childJobId: string) => string;
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor(private readonly options: VideoEnhancementRuntimeOptions) {
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.childIdFactory =
      options.childIdFactory ?? (() => `enhancement-${randomUUID()}`);
    this.requestIdFactory = options.requestIdFactory ?? (() => randomUUID());
    this.outputIdFactory =
      options.outputIdFactory ?? ((childJobId) => `${childJobId}:output`);
    this.eventIdFactory =
      options.eventIdFactory ?? ((childJobId) => `${childJobId}:completed`);
  }

  activeCount(): number {
    return this.active.size;
  }

  activeSignal(childJobId: string): AbortSignal | null {
    return this.active.get(childJobId)?.signal ?? null;
  }

  /**
   * Stop only native work active in this process. Queued children remain queued;
   * active children become interrupted/retryable before their scheduler handle
   * is cancelled, so restart recovery can never present a false success.
   */
  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shuttingDown = true;
    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown(): Promise<void> {
    const active = [...this.active.values()];
    await Promise.all(
      active.map(async (execution) => {
        try {
          await this.options.queue.finishEnhancement({
            childJobId: execution.childJobId,
            expectedStates: ["running"],
            state: "interrupted",
            error: issue(
              "interrupted",
              "Video enhancement was interrupted by sidecar shutdown.",
              true,
              "preflight",
            ),
            finishedAt: this.nowIso(),
          });
        } finally {
          this.stopActive(execution, "cancel");
        }
      }),
    );
    await Promise.all([...this.settlements]);
  }

  async enqueue(
    input: EnqueueVideoEnhancementInput,
  ): Promise<EnqueueVideoEnhancementResult> {
    try {
      if (this.shuttingDown) {
        return enqueueFailure(
          issue(
            "invalid_state",
            "Video enhancement is shutting down and cannot accept new work.",
            true,
          ),
        );
      }
      if (!isOpaqueId(input.parentJobId) || !isOpaqueId(input.sourceOutputId)) {
        return enqueueFailure(
          issue(
            "invalid_request",
            "Parent and source output IDs must be non-empty bounded identifiers.",
            false,
          ),
        );
      }
      const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
      if (input.idempotencyKey !== undefined && idempotencyKey === null) {
        return enqueueFailure(
          issue(
            "invalid_request",
            "Idempotency key must be a non-empty bounded single-line value.",
            false,
          ),
        );
      }

      const outputValue = await this.options.storage.getGenerationOutput(
        input.parentJobId,
        input.sourceOutputId,
      );
      const output = snapshotEligibleOutput(
        outputValue,
        input.parentJobId,
        input.sourceOutputId,
      );
      if (!output.ok) return enqueueFailure(output.error);

      let attempt = 1;
      let retryOfChildJobId: string | null = null;
      if (input.retryOfChildJobId !== undefined) {
        if (!isOpaqueId(input.retryOfChildJobId)) {
          return enqueueFailure(
            issue(
              "invalid_request",
              "Retry child ID must be a non-empty bounded identifier.",
              false,
            ),
          );
        }
        const previous = await this.options.queue.getEnhancement(
          input.retryOfChildJobId,
        );
        if (
          !previous ||
          !isTerminalState(previous.state) ||
          previous.state === "succeeded" ||
          !previous.error?.retryable ||
          previous.parentJobId !== input.parentJobId ||
          previous.sourceOutputId !== input.sourceOutputId
        ) {
          return enqueueFailure(
            issue(
              "invalid_state",
              "Retry target is missing, non-terminal, non-retryable, or belongs to another source.",
              false,
            ),
          );
        }
        attempt = previous.attempt + 1;
        retryOfChildJobId = previous.childJobId;
      }

      const childJobId = this.childIdFactory();
      const requestId = this.requestIdFactory(childJobId);
      if (
        !isOpaqueId(childJobId) ||
        childJobId === input.parentJobId ||
        !isOpaqueId(requestId)
      ) {
        return enqueueFailure(
          issue(
            "id_conflict",
            "Enhancement identity generation produced an invalid or colliding ID.",
            true,
          ),
        );
      }

      const requestedAt = this.nowIso();
      const requestValue = buildRequest(
        input,
        requestId,
        output.value,
        requestedAt,
      );
      const validation = validateVideoEnhancementRequest(requestValue);
      if (!validation.ok) {
        return enqueueFailure(copyCoreIssue(validation.error));
      }
      const request = validation.value;
      const estimatedVramGB = input.estimatedVramGB ?? 8;
      if (!Number.isFinite(estimatedVramGB) || estimatedVramGB <= 0) {
        return enqueueFailure(
          issue(
            "invalid_request",
            "Estimated VRAM must be a finite positive number.",
            false,
          ),
        );
      }

      const queued = await this.options.queue.enqueueEnhancement({
        childJobId,
        parentJobId: input.parentJobId,
        sourceOutputId: input.sourceOutputId,
        backendId: VIDEO_ENHANCEMENT_BACKEND_ID,
        priority: input.priority ?? "interactive",
        estimatedVramGB,
        request,
        sourceOutput: output.value,
        idempotencyKey,
        attempt,
        retryOfChildJobId,
        createdAt: requestedAt,
      });
      if (!queued.created && idempotencyKey === null) {
        return enqueueFailure(
          issue(
            "id_conflict",
            "A generated enhancement child ID already exists.",
            true,
          ),
        );
      }
      if (
        !jobMatchesEnqueue(queued.job, request, output.value, idempotencyKey)
      ) {
        return enqueueFailure(
          issue(
            "id_conflict",
            "The persisted enhancement identity belongs to different immutable inputs.",
            false,
          ),
        );
      }
      return Object.freeze({
        ok: true,
        created: queued.created,
        job: queued.job,
      });
    } catch {
      return enqueueFailure(
        issue(
          "internal_error",
          "Video enhancement could not be enqueued.",
          true,
        ),
      );
    }
  }

  /**
   * Run one child already claimed by the existing queue pump. This method
   * never searches for or claims another job.
   */
  async runClaimed(
    childJobId: string,
  ): Promise<VideoEnhancementExecutionOutcome> {
    const stored = await this.safeGetJob(childJobId);
    if (!stored) return outcomeFailure(childJobId, "failed", notFoundIssue());
    if (stored.state === "interrupted") return outcomeFromJob(stored);
    if (isTerminalState(stored.state)) return outcomeFromJob(stored);
    if (stored.state !== "running") {
      return outcomeFailure(
        childJobId,
        "failed",
        issue(
          "invalid_state",
          "Only a running child claimed by the generation queue can execute.",
          true,
        ),
      );
    }
    if (this.shuttingDown) {
      return this.finishFailure(
        stored,
        issue(
          "interrupted",
          "Video enhancement was interrupted by sidecar shutdown.",
          true,
          "preflight",
        ),
        "interrupted",
      );
    }
    if (this.active.has(childJobId)) {
      return outcomeFailure(
        childJobId,
        "failed",
        issue(
          "invalid_state",
          "This enhancement child is already active in this runtime.",
          true,
        ),
      );
    }

    const normalized = snapshotStoredJob(stored);
    if (!normalized) {
      return this.finishFailure(
        stored,
        issue(
          "internal_error",
          "Persisted enhancement inputs are malformed.",
          false,
        ),
      );
    }

    const active = createActive(childJobId);
    this.active.set(childJobId, active);
    const timer = this.clock.setTimeout(() => {
      this.stopActive(active, "timeout");
    }, normalized.request.timeoutMs);

    try {
      const admissionPromise = this.options.scheduler.enqueue({
        moduleId: "video",
        jobType: "video_enhancement",
        estimatedVramGB: normalized.estimatedVramGB,
        priority:
          normalized.priority === "interactive" ? "foreground" : "background",
        id: normalized.childJobId,
        run: (schedulerSignal) =>
          this.runPipeline(normalized, active, schedulerSignal),
      });
      active.settlement = admissionPromise.then(
        async (handle) => {
          if (active.stopKind) handle.cancel();
          try {
            await handle.completion;
          } catch {
            // The queue state carries the typed terminal result.
          }
        },
        () => undefined,
      );
      this.settlements.add(active.settlement);
      void active.settlement.finally(() => {
        this.settlements.delete(active.settlement);
      });

      const admission = await Promise.race([
        admissionPromise.then(
          (handle) => ({ kind: "handle" as const, handle }),
          (error: unknown) => ({ kind: "error" as const, error }),
        ),
        active.stopPromise.then((kind) => ({
          kind: "stop" as const,
          stop: kind,
        })),
      ]);
      if (admission.kind === "stop") {
        return this.finishStop(normalized, admission.stop);
      }
      if (admission.kind === "error") {
        return this.finishFailure(
          normalized,
          issue(
            "backend_unavailable",
            "The GPU scheduler could not admit the enhancement job.",
            true,
          ),
        );
      }

      active.handle = admission.handle;
      if (active.stopKind) active.handle.cancel();
      const settled = await active.handle.completion.then(
        (value) => ({ kind: "completion" as const, value }),
        (error: unknown) => ({ kind: "error" as const, error }),
      );
      if (settled.kind === "error") {
        const authoritative = await this.safeGetJob(childJobId);
        if (authoritative && isTerminalState(authoritative.state)) {
          return outcomeFromJob(authoritative);
        }
        if (active.controller.signal.aborted) {
          return this.finishStop(normalized, active.stopKind ?? "cancel");
        }
        return this.finishFailure(
          normalized,
          issue(
            "internal_error",
            "The scheduled enhancement job failed unexpectedly.",
            true,
          ),
        );
      }
      return isExecutionOutcome(settled.value)
        ? settled.value
        : this.finishFailure(
            normalized,
            issue(
              "internal_error",
              "The scheduled enhancement job returned an invalid result.",
              true,
            ),
          );
    } finally {
      active.acceptingProgress = false;
      this.clock.clearTimeout(timer);
      this.active.delete(childJobId);
    }
  }

  async cancel(childJobId: string): Promise<VideoEnhancementExecutionOutcome> {
    let requested: StoredVideoEnhancementJob | null;
    try {
      requested = await this.options.queue.requestEnhancementCancellation({
        childJobId,
        requestedAt: this.nowIso(),
      });
    } catch {
      return outcomeFailure(
        childJobId,
        "failed",
        issue(
          "internal_error",
          "Enhancement cancellation could not be persisted.",
          true,
        ),
      );
    }
    if (!requested) {
      return outcomeFailure(childJobId, "failed", notFoundIssue());
    }
    if (requested.state === "succeeded") return outcomeFromJob(requested);
    const active = this.active.get(childJobId);
    if (active) {
      this.stopActive(active, "cancel");
      await active.settlement;
      const settled = await this.safeGetJob(childJobId);
      if (settled && isTerminalState(settled.state)) {
        return outcomeFromJob(settled);
      }
      return this.finishStop(requested, "cancel");
    }
    if (isTerminalState(requested.state)) return outcomeFromJob(requested);
    return this.finishFailure(
      requested,
      issue("cancelled", "Video enhancement was cancelled.", true, "preflight"),
      "cancelled",
    );
  }

  /** Interrupted enhancement processes are never resumed implicitly. */
  async recoverInterrupted(
    childJobId: string,
  ): Promise<VideoEnhancementExecutionOutcome> {
    const job = await this.safeGetJob(childJobId);
    if (!job) return outcomeFailure(childJobId, "failed", notFoundIssue());
    if (job.state !== "interrupted") {
      return isTerminalState(job.state)
        ? outcomeFromJob(job)
        : outcomeFailure(
            childJobId,
            "failed",
            issue(
              "invalid_state",
              "Only an interrupted enhancement can be reconciled as interrupted.",
              false,
            ),
          );
    }
    return outcomeFromJob(job);
  }

  private async runPipeline(
    job: StoredVideoEnhancementJob,
    active: ActiveExecution,
    schedulerSignal: AbortSignal,
  ): Promise<VideoEnhancementExecutionOutcome> {
    const combined = combineAbortSignals(
      active.controller.signal,
      schedulerSignal,
    );
    active.signal = combined.signal;
    let published: PublishedVideoEnhancementOutput | null = null;
    let publicationPrepared = false;
    let currentStage: VideoEnhancementProgressStage = "preflight";
    try {
      if (active.stopKind || combined.signal.aborted) {
        return this.finishStop(job, active.stopKind ?? "cancel");
      }
      const sourceCheck = await this.verifyCurrentSource(job, combined.signal);
      if (!sourceCheck.ok) return this.finishFailure(job, sourceCheck.error);
      if (active.stopKind || combined.signal.aborted) {
        return this.finishStop(job, active.stopKind ?? "cancel");
      }

      const result = await this.options.service.run(job.request, {
        childJobId: job.childJobId,
        signal: combined.signal,
        onProgress: (progress) => {
          if (!active.acceptingProgress || active.stopKind) return;
          currentStage = progress.stage;
          const snapshot = snapshotProgress(progress);
          active.progressTail = active.progressTail
            .then(async () => {
              const accepted =
                await this.options.queue.persistEnhancementProgress({
                  childJobId: job.childJobId,
                  progress: snapshot,
                  updatedAt: this.nowIso(),
                });
              if (!accepted) {
                active.progressRejected = true;
                active.controller.abort();
                active.handle?.cancel();
              }
            })
            .catch((error: unknown) => {
              active.progressFailure = error;
              active.controller.abort();
              active.handle?.cancel();
            });
        },
      });
      active.acceptingProgress = false;
      await active.progressTail;
      if (active.progressFailure) {
        return this.finishFailure(
          job,
          issue(
            "internal_error",
            "Enhancement progress could not be persisted.",
            true,
            currentStage,
          ),
        );
      }
      if (active.progressRejected) {
        const authoritative = await this.safeGetJob(job.childJobId);
        if (authoritative && isTerminalState(authoritative.state)) {
          return outcomeFromJob(authoritative);
        }
        return this.finishStop(job, "cancel");
      }
      if (active.stopKind || combined.signal.aborted) {
        const observed = result.ok
          ? issue(
              active.stopKind === "timeout" ? "process_timeout" : "cancelled",
              active.stopKind === "timeout"
                ? "Video enhancement exceeded its configured deadline."
                : "Video enhancement was cancelled.",
              true,
              currentStage,
              null,
              true,
            )
          : copyCoreIssue(result.error);
        return this.finishStop(job, active.stopKind ?? "cancel", observed);
      }
      if (!result.ok) {
        return this.finishFailure(job, copyCoreIssue(result.error));
      }

      currentStage = "validate";
      const validatedValue =
        await this.options.media.validateAndWriteProvenance({
          job,
          staged: result,
          signal: combined.signal,
        });
      const validated = snapshotValidatedMedia(validatedValue, result, job);
      if (!validated) {
        return this.finishFailure(
          job,
          issue(
            "output_invalid",
            "Validated enhancement media was malformed.",
            false,
            "validate",
          ),
        );
      }
      publicationPrepared = true;
      if (active.stopKind || combined.signal.aborted) {
        const stopped = await this.finishStop(job, active.stopKind ?? "cancel");
        if (!stopped.ok) {
          await this.discardPublication(job.childJobId, null, stopped.error);
          publicationPrepared = false;
        }
        return stopped;
      }

      currentStage = "publish";
      const desiredOutputId = this.outputIdFactory(job.childJobId);
      if (
        !isOpaqueId(desiredOutputId) ||
        desiredOutputId === job.sourceOutputId
      ) {
        const invalidOutput = issue(
          "output_conflict",
          "Enhancement output identity is invalid or collides with its source.",
          false,
          "publish",
        );
        await this.discardPublication(job.childJobId, null, invalidOutput);
        publicationPrepared = false;
        return this.finishFailure(job, invalidOutput);
      }
      const publishedValue = await this.options.publication.publish({
        childJobId: job.childJobId,
        desiredOutputId,
        source: job.sourceOutput,
        validated,
        signal: combined.signal,
      });
      published = snapshotPublishedOutput(
        publishedValue,
        desiredOutputId,
        validated,
        job.sourceOutput,
      );
      if (!published) {
        const malformedPublication = issue(
          "publish_failed",
          "Published enhancement output did not match the validated artifact.",
          false,
          "publish",
        );
        await this.discardPublication(
          job.childJobId,
          null,
          malformedPublication,
        );
        publicationPrepared = false;
        return this.finishFailure(job, malformedPublication);
      }
      if (active.stopKind || combined.signal.aborted) {
        const stopped = await this.finishStop(job, active.stopKind ?? "cancel");
        if (!stopped.ok) {
          await this.discardPublication(
            job.childJobId,
            published,
            stopped.error,
          );
          publicationPrepared = false;
        }
        return stopped;
      }

      const sourceAfterPublish = await this.options.media.verifySource(
        job.request.source,
        combined.signal,
      );
      if (!sourcesEqual(sourceAfterPublish, job.request.source)) {
        const sourceChanged = issue(
          "source_changed",
          "The original source changed during enhancement publication.",
          false,
          "publish",
        );
        await this.discardPublication(job.childJobId, published, sourceChanged);
        publicationPrepared = false;
        return this.finishFailure(job, sourceChanged);
      }
      if (active.stopKind || combined.signal.aborted) {
        const stopped = await this.finishStop(job, active.stopKind ?? "cancel");
        if (!stopped.ok) {
          await this.discardPublication(
            job.childJobId,
            published,
            stopped.error,
          );
          publicationPrepared = false;
        }
        return stopped;
      }

      currentStage = "provenance";
      const finishedAt = this.nowIso();
      const completion = await this.options.storage.completeEnhancement(
        buildAtomicCompletion(
          job,
          result,
          published,
          this.eventIdFactory(job.childJobId),
          finishedAt,
        ),
      );
      if (!completion.committed) {
        const authoritative =
          completion.job ?? (await this.safeGetJob(job.childJobId));
        const rejection = authoritative?.cancelRequested
          ? await this.finishStop(job, "cancel")
          : authoritative && isTerminalState(authoritative.state)
            ? outcomeFromJob(authoritative)
            : outcomeFailure(
                job.childJobId,
                "failed",
                issue(
                  "publish_failed",
                  "Atomic enhancement completion was rejected.",
                  true,
                  "provenance",
                ),
              );
        if (!rejection.ok) {
          await this.discardPublication(
            job.childJobId,
            published,
            rejection.error,
          );
          publicationPrepared = false;
        }
        return rejection;
      }
      publicationPrepared = false;
      await this.finalizePublication(job.childJobId, published).catch(
        () => undefined,
      );
      return outcomeSuccess(job.childJobId, published);
    } catch (error) {
      const mapped = mapPortError(error, currentStage);
      if (publicationPrepared) {
        await this.discardPublication(job.childJobId, published, mapped);
        publicationPrepared = false;
      }
      const authoritative = await this.safeGetJob(job.childJobId);
      if (authoritative && isTerminalState(authoritative.state)) {
        return outcomeFromJob(authoritative);
      }
      if (
        active.stopKind ||
        combined.signal.aborted ||
        authoritative?.cancelRequested
      ) {
        return this.finishStop(job, active.stopKind ?? "cancel");
      }
      return this.finishFailure(job, mapped);
    } finally {
      active.acceptingProgress = false;
      combined.dispose();
    }
  }

  private async verifyCurrentSource(
    job: StoredVideoEnhancementJob,
    signal: AbortSignal,
  ): Promise<
    | { readonly ok: true }
    | { readonly ok: false; readonly error: VideoEnhancementRuntimeIssue }
  > {
    const current = await this.options.storage.getGenerationOutput(
      job.parentJobId,
      job.sourceOutputId,
    );
    const normalized = snapshotEligibleOutput(
      current,
      job.parentJobId,
      job.sourceOutputId,
    );
    if (
      !normalized.ok ||
      !sourceOutputsEqual(normalized.value, job.sourceOutput)
    ) {
      return {
        ok: false,
        error: issue(
          "source_changed",
          "The source generation output no longer matches the queued snapshot.",
          false,
          "preflight",
        ),
      };
    }
    const verified = await this.options.media.verifySource(
      job.request.source,
      signal,
    );
    if (!sourcesEqual(verified, job.request.source)) {
      return {
        ok: false,
        error: issue(
          "source_changed",
          "The original source bytes or media facts changed before enhancement.",
          false,
          "preflight",
        ),
      };
    }
    return { ok: true };
  }

  private async finishStop(
    job: StoredVideoEnhancementJob,
    kind: "cancel" | "timeout",
    observed?: VideoEnhancementRuntimeIssue,
  ): Promise<VideoEnhancementExecutionOutcome> {
    const authoritative = await this.safeGetJob(job.childJobId);
    if (authoritative && isTerminalState(authoritative.state)) {
      if (
        observed &&
        (authoritative.state === "interrupted" ||
          authoritative.state === "cancelled")
      ) {
        const terminalState = authoritative.state;
        return this.finishFailure(
          job,
          issue(
            terminalState === "interrupted" ? "interrupted" : "cancelled",
            authoritative.error?.message ??
              (terminalState === "interrupted"
                ? "Video enhancement was interrupted by sidecar shutdown."
                : "Video enhancement was cancelled."),
            true,
            observed.stage,
            observed.diagnostics,
            observed.terminationConfirmed,
          ),
          terminalState,
        );
      }
      return outcomeFromJob(authoritative);
    }
    return this.finishFailure(
      job,
      kind === "timeout"
        ? issue(
            "process_timeout",
            "Video enhancement exceeded its configured deadline.",
            true,
            observed?.stage ?? "preflight",
            observed?.diagnostics ?? null,
            observed?.terminationConfirmed ?? null,
          )
        : issue(
            "cancelled",
            "Video enhancement was cancelled.",
            true,
            observed?.stage ?? "preflight",
            observed?.diagnostics ?? null,
            observed?.terminationConfirmed ?? null,
          ),
      kind === "timeout" ? "timed_out" : "cancelled",
    );
  }

  private async finishFailure(
    job: StoredVideoEnhancementJob,
    error: VideoEnhancementRuntimeIssue,
    forcedState?: "failed" | "cancelled" | "timed_out" | "interrupted",
  ): Promise<VideoEnhancementExecutionOutcome> {
    const state = forcedState ?? terminalStateForIssue(error);
    try {
      const authoritative = await this.options.queue.finishEnhancement({
        childJobId: job.childJobId,
        expectedStates: ["queued", "running", "interrupted"],
        state,
        error,
        finishedAt: this.nowIso(),
      });
      if (authoritative && isTerminalState(authoritative.state)) {
        return outcomeFromJob(authoritative);
      }
    } catch {
      // The runtime still returns a typed failure and never fabricates success.
    }
    return outcomeFailure(job.childJobId, state, error);
  }

  private async quarantine(
    output: PublishedVideoEnhancementOutput,
    childJobId: string,
    reason: VideoEnhancementRuntimeIssue,
  ): Promise<void> {
    try {
      await this.options.publication.quarantine({ childJobId, output, reason });
    } catch {
      // Quarantine is best effort after success has already been withheld.
    }
  }

  private async discardPublication(
    childJobId: string,
    output: PublishedVideoEnhancementOutput | null,
    reason: VideoEnhancementRuntimeIssue,
  ): Promise<void> {
    try {
      if (this.options.publication.discard) {
        await this.options.publication.discard({ childJobId, reason });
      } else if (output) {
        await this.quarantine(output, childJobId, reason);
      }
    } catch {
      // Cleanup is best effort after success has already been withheld.
    }
  }

  private async finalizePublication(
    childJobId: string,
    output: PublishedVideoEnhancementOutput,
  ): Promise<void> {
    try {
      await this.options.publication.finalize?.({ childJobId, output });
    } catch {
      // Durable completion is authoritative; tracking expiry remains a fallback.
    }
  }

  private stopActive(
    active: ActiveExecution,
    kind: "cancel" | "timeout",
  ): void {
    if (active.stopKind) return;
    active.stopKind = kind;
    active.acceptingProgress = false;
    active.controller.abort();
    active.handle?.cancel();
    active.resolveStop(kind);
  }

  private async safeGetJob(
    childJobId: string,
  ): Promise<StoredVideoEnhancementJob | null> {
    try {
      return await this.options.queue.getEnhancement(childJobId);
    } catch {
      return null;
    }
  }

  private nowIso(): string {
    return this.clock.now().toISOString();
  }
}

function createActive(childJobId: string): ActiveExecution {
  const controller = new AbortController();
  let resolveStop!: (kind: "cancel" | "timeout") => void;
  const stopPromise = new Promise<"cancel" | "timeout">((resolve) => {
    resolveStop = resolve;
  });
  return {
    childJobId,
    controller,
    stopPromise,
    resolveStop,
    handle: null,
    signal: controller.signal,
    stopKind: null,
    acceptingProgress: true,
    progressTail: Promise.resolve(),
    progressFailure: null,
    progressRejected: false,
    settlement: Promise.resolve(),
  };
}

function combineAbortSignals(
  first: AbortSignal,
  second: AbortSignal,
): { readonly signal: AbortSignal; readonly dispose: () => void } {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (first.aborted || second.aborted) controller.abort();
  first.addEventListener("abort", abort, { once: true });
  second.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      first.removeEventListener("abort", abort);
      second.removeEventListener("abort", abort);
    },
  };
}

function buildRequest(
  input: EnqueueVideoEnhancementInput,
  requestId: string,
  output: VideoGenerationOutputSnapshot,
  requestedAt: string,
): unknown {
  const common = {
    requestId,
    parentJobId: input.parentJobId,
    source: sourceIdentity(output),
    requestedAt,
    timeoutMs: input.timeoutMs ?? DEFAULT_VIDEO_ENHANCEMENT_TIMEOUT_MS,
  };
  if (input.mode === "upscale") {
    return { ...common, mode: input.mode, upscalePreset: input.upscalePreset };
  }
  if (input.mode === "interpolate") {
    return {
      ...common,
      mode: input.mode,
      interpolationPreset: input.interpolationPreset,
    };
  }
  return {
    ...common,
    mode: input.mode,
    upscalePreset: input.upscalePreset,
    interpolationPreset: input.interpolationPreset,
  };
}

function sourceIdentity(
  output: VideoGenerationOutputSnapshot,
): VideoSourceIdentity {
  return Object.freeze({
    path: output.path,
    sha256: output.contentHash,
    sizeBytes: output.sizeBytes,
    durationSeconds: output.durationSeconds,
    width: output.width,
    height: output.height,
    frameRate: Object.freeze({ ...output.frameRate }),
  });
}

function snapshotEligibleOutput(
  value: VideoGenerationOutputSnapshot | null,
  expectedGenerationId: string,
  expectedOutputId: string,
):
  | { readonly ok: true; readonly value: VideoGenerationOutputSnapshot }
  | { readonly ok: false; readonly error: VideoEnhancementRuntimeIssue } {
  if (!value) {
    return {
      ok: false,
      error: issue(
        "not_found",
        "The requested source generation output was not found.",
        false,
      ),
    };
  }
  if (
    value.generationId !== expectedGenerationId ||
    value.outputId !== expectedOutputId
  ) {
    return {
      ok: false,
      error: issue(
        "ineligible_source",
        "The source output identity does not match the requested generation.",
        false,
      ),
    };
  }
  if (value.jobState !== "done") {
    return {
      ok: false,
      error: issue(
        "ineligible_source",
        "Only a completed generation output can be enhanced.",
        true,
      ),
    };
  }
  if (value.pillar !== "video" || !MEDIA_TYPE_PATTERN.test(value.mediaType)) {
    return {
      ok: false,
      error: issue(
        "ineligible_source",
        "Only completed MP4 video outputs can be enhanced.",
        false,
      ),
    };
  }
  const workflow = snapshotJsonRecord(value.workflow);
  if (
    !isOpaqueId(value.generationId) ||
    !isOpaqueId(value.outputId) ||
    !isAbsoluteLocalMp4Path(value.path) ||
    !HASH_PATTERN.test(value.contentHash) ||
    !isPositiveSafeInteger(value.sizeBytes) ||
    !isPositiveFinite(value.durationSeconds) ||
    !isPositiveSafeInteger(value.width) ||
    !isPositiveSafeInteger(value.height) ||
    !isFrameRate(value.frameRate) ||
    !workflow ||
    !(value.threadId === null || isOpaqueId(value.threadId))
  ) {
    return {
      ok: false,
      error: issue(
        "source_invalid",
        "The source output is missing valid immutable media or workflow facts.",
        false,
      ),
    };
  }
  return {
    ok: true,
    value: Object.freeze({
      outputId: value.outputId,
      generationId: value.generationId,
      jobState: "done",
      pillar: "video",
      mediaType: value.mediaType,
      path: value.path,
      contentHash: value.contentHash,
      sizeBytes: value.sizeBytes,
      durationSeconds: value.durationSeconds,
      width: value.width,
      height: value.height,
      frameRate: Object.freeze({ ...value.frameRate }),
      workflow,
      threadId: value.threadId,
    }),
  };
}

function snapshotStoredJob(
  value: StoredVideoEnhancementJob,
): StoredVideoEnhancementJob | null {
  const validation = validateVideoEnhancementRequest(value.request);
  const source = snapshotEligibleOutput(
    value.sourceOutput,
    value.parentJobId,
    value.sourceOutputId,
  );
  if (
    !validation.ok ||
    !source.ok ||
    validation.value.parentJobId !== value.parentJobId ||
    value.backendId !== VIDEO_ENHANCEMENT_BACKEND_ID ||
    !sourcesEqual(validation.value.source, sourceIdentity(source.value)) ||
    value.childJobId === value.parentJobId ||
    !isOpaqueId(value.childJobId) ||
    !Number.isFinite(value.estimatedVramGB) ||
    value.estimatedVramGB <= 0 ||
    !Number.isSafeInteger(value.attempt) ||
    value.attempt < 1
  ) {
    return null;
  }
  return Object.freeze({
    ...value,
    request: validation.value,
    sourceOutput: source.value,
  });
}

function snapshotValidatedMedia(
  value: ValidatedVideoEnhancementMedia,
  staged: VideoEnhancementStagedSuccess,
  job: StoredVideoEnhancementJob,
): ValidatedVideoEnhancementMedia | null {
  const provenance = snapshotPreparedProvenance(value);
  if (
    pathsEqual(value.stagedPath, staged.stagedPath) ||
    pathsEqual(value.stagedPath, staged.source.path) ||
    !isCanonicalAbsoluteLocalMp4Path(value.stagedPath) ||
    !HASH_PATTERN.test(value.contentHash) ||
    value.contentHash !== value.publishedContainerSha256 ||
    !isPositiveSafeInteger(value.sizeBytes) ||
    !isPositiveFinite(value.durationSeconds) ||
    !isPositiveSafeInteger(value.width) ||
    !isPositiveSafeInteger(value.height) ||
    !isFrameRate(value.frameRate) ||
    !provenance ||
    provenance.durableProvenance.parentJobId !== job.parentJobId ||
    provenance.durableProvenance.requestId !== job.request.requestId ||
    provenance.durableProvenance.childJobId !== job.childJobId ||
    provenance.durableProvenance.mode !== job.request.mode ||
    provenance.durableProvenance.source.generationId !==
      job.sourceOutput.generationId ||
    provenance.durableProvenance.source.outputId !== job.sourceOutputId ||
    provenance.durableProvenance.source.sha256 !==
      job.sourceOutput.contentHash ||
    provenance.durableProvenance.source.sizeBytes !==
      job.sourceOutput.sizeBytes ||
    provenance.durableProvenance.output.durationSeconds !==
      value.durationSeconds ||
    provenance.durableProvenance.output.width !== value.width ||
    provenance.durableProvenance.output.height !== value.height ||
    !frameRatesEqual(
      provenance.durableProvenance.output.frameRate,
      value.frameRate,
    ) ||
    !jsonValuesEqual(provenance.durableProvenance.backend, staged.backend) ||
    !jsonValuesEqual(
      provenance.durableProvenance.execution,
      staged.execution,
    ) ||
    !jsonValuesEqual(provenance.durableProvenance.stages, staged.stages) ||
    provenance.durableProvenance.startedAt !== staged.startedAt ||
    provenance.durableProvenance.completedAt !== staged.completedAt ||
    provenance.durableProvenance.durationMs !== staged.durationMs
  ) {
    return null;
  }
  return Object.freeze({
    stagedPath: value.stagedPath,
    contentHash: value.contentHash,
    sizeBytes: value.sizeBytes,
    durationSeconds: value.durationSeconds,
    width: value.width,
    height: value.height,
    frameRate: Object.freeze({ ...value.frameRate }),
    ...provenance,
  });
}

function snapshotPublishedOutput(
  value: PublishedVideoEnhancementOutput,
  expectedOutputId: string,
  validated: ValidatedVideoEnhancementMedia,
  source: VideoGenerationOutputSnapshot,
): PublishedVideoEnhancementOutput | null {
  const workflow = snapshotJsonRecord(value.workflow);
  const provenance = snapshotPreparedProvenance(value);
  if (
    value.outputId !== expectedOutputId ||
    value.outputId === source.outputId ||
    !isAbsoluteLocalMp4Path(value.path) ||
    pathsEqual(value.path, source.path) ||
    pathsEqual(value.path, validated.stagedPath) ||
    value.contentHash !== validated.contentHash ||
    value.sizeBytes !== validated.sizeBytes ||
    value.durationSeconds !== validated.durationSeconds ||
    value.width !== validated.width ||
    value.height !== validated.height ||
    !frameRatesEqual(value.frameRate, validated.frameRate) ||
    !workflow ||
    !provenance ||
    !jsonValuesEqual(workflow, provenance.embeddedWorkflow) ||
    !preparedProvenanceEqual(provenance, validated)
  ) {
    return null;
  }
  return Object.freeze({
    outputId: value.outputId,
    path: value.path,
    contentHash: value.contentHash,
    sizeBytes: value.sizeBytes,
    durationSeconds: value.durationSeconds,
    width: value.width,
    height: value.height,
    frameRate: Object.freeze({ ...value.frameRate }),
    workflow: provenance.embeddedWorkflow,
    ...provenance,
  });
}

function snapshotPreparedProvenance(
  value: VideoEnhancementPreparedProvenance,
): VideoEnhancementPreparedProvenance | null {
  if (
    !HASH_PATTERN.test(value.preProvenanceContainerSha256) ||
    !HASH_PATTERN.test(value.publishedContainerSha256)
  ) {
    return null;
  }
  const workflowRecord = snapshotJsonRecord(value.embeddedWorkflow);
  const durableRecord = snapshotJsonRecord(value.durableProvenance);
  if (!workflowRecord || !durableRecord) return null;
  let embeddedWorkflow: VideoWorkflowMetadata;
  let durableProvenance: VideoEnhancementDurableProvenance;
  try {
    const embeddedProvenance = createVideoEnhancementEmbeddedProvenance(
      workflowRecord.enhancement,
    );
    embeddedWorkflow = Object.freeze({
      ...workflowRecord,
      enhancement: embeddedProvenance,
    }) as VideoWorkflowMetadata;
    serializeVideoWorkflowMetadata(embeddedWorkflow);
    durableProvenance = createVideoEnhancementDurableProvenance(
      embeddedProvenance,
      value.publishedContainerSha256,
    );
  } catch {
    return null;
  }
  if (
    value.provenanceRecordId !== durableProvenance.provenanceRecordId ||
    value.preProvenanceContainerSha256 !==
      durableProvenance.output.preProvenanceContainerSha256 ||
    value.publishedContainerSha256 !==
      durableProvenance.publishedContainerSha256 ||
    !jsonValuesEqual(durableRecord, durableProvenance)
  ) {
    return null;
  }
  return Object.freeze({
    provenanceRecordId: durableProvenance.provenanceRecordId,
    preProvenanceContainerSha256:
      durableProvenance.output.preProvenanceContainerSha256,
    publishedContainerSha256: durableProvenance.publishedContainerSha256,
    embeddedWorkflow,
    durableProvenance,
  });
}

function preparedProvenanceEqual(
  left: VideoEnhancementPreparedProvenance,
  right: VideoEnhancementPreparedProvenance,
): boolean {
  return (
    left.provenanceRecordId === right.provenanceRecordId &&
    left.preProvenanceContainerSha256 === right.preProvenanceContainerSha256 &&
    left.publishedContainerSha256 === right.publishedContainerSha256 &&
    jsonValuesEqual(left.embeddedWorkflow, right.embeddedWorkflow) &&
    jsonValuesEqual(left.durableProvenance, right.durableProvenance)
  );
}

function buildAtomicCompletion(
  job: StoredVideoEnhancementJob,
  staged: VideoEnhancementStagedSuccess,
  output: PublishedVideoEnhancementOutput,
  eventId: string,
  finishedAt: string,
): VideoEnhancementAtomicCompletionInput {
  return Object.freeze({
    childJobId: job.childJobId,
    expectedState: "running",
    provenanceRecordId: output.provenanceRecordId,
    embeddedWorkflow: output.embeddedWorkflow,
    durableProvenance: output.durableProvenance,
    output,
    enhancement: Object.freeze({
      childJobId: job.childJobId,
      parentJobId: job.parentJobId,
      sourceGenerationId: job.sourceOutput.generationId,
      sourceOutputId: job.sourceOutputId,
      sourceContentHash: job.sourceOutput.contentHash,
      outputId: output.outputId,
      outputContentHash: output.contentHash,
      provenanceRecordId: output.provenanceRecordId,
      preProvenanceContainerSha256: output.preProvenanceContainerSha256,
      publishedContainerSha256: output.publishedContainerSha256,
      embeddedWorkflow: output.embeddedWorkflow,
      durableProvenance: output.durableProvenance,
      request: job.request,
      backend: output.durableProvenance.backend,
      stages: output.durableProvenance.stages,
      execution: output.durableProvenance.execution,
      startedAt: output.durableProvenance.startedAt,
      completedAt: output.durableProvenance.completedAt,
      durationMs: output.durableProvenance.durationMs,
      warnings: staged.warnings,
      progress: staged.progress,
      attempt: job.attempt,
      retryOfChildJobId: job.retryOfChildJobId,
      outcome: "succeeded",
    }),
    outbox: Object.freeze({
      eventId,
      eventType: "video.enhancement.completed",
      aggregateId: job.childJobId,
      occurredAt: finishedAt,
      threadId: job.sourceOutput.threadId,
      payload: Object.freeze({
        childJobId: job.childJobId,
        parentJobId: job.parentJobId,
        sourceOutputId: job.sourceOutputId,
        sourceContentHash: job.sourceOutput.contentHash,
        outputId: output.outputId,
        outputContentHash: output.contentHash,
        provenanceRecordId: output.provenanceRecordId,
        preProvenanceContainerSha256: output.preProvenanceContainerSha256,
        publishedContainerSha256: output.publishedContainerSha256,
        attempt: job.attempt,
      }),
    }),
    finishedAt,
  });
}

function jobMatchesEnqueue(
  job: StoredVideoEnhancementJob,
  request: VideoEnhancementRequest,
  sourceOutput: VideoGenerationOutputSnapshot,
  idempotencyKey: string | null,
): boolean {
  return (
    isOpaqueId(job.childJobId) &&
    job.childJobId !== job.parentJobId &&
    job.parentJobId === request.parentJobId &&
    job.sourceOutputId === sourceOutput.outputId &&
    job.backendId === VIDEO_ENHANCEMENT_BACKEND_ID &&
    job.idempotencyKey === idempotencyKey &&
    sourcesEqual(job.request.source, request.source) &&
    requestTransformsEqual(job.request, request) &&
    sourceOutputsEqual(job.sourceOutput, sourceOutput)
  );
}

function requestTransformsEqual(
  left: VideoEnhancementRequest,
  right: VideoEnhancementRequest,
): boolean {
  return (
    left.mode === right.mode &&
    left.upscalePreset === right.upscalePreset &&
    left.interpolationPreset === right.interpolationPreset &&
    left.timeoutMs === right.timeoutMs
  );
}

function sourceOutputsEqual(
  left: VideoGenerationOutputSnapshot,
  right: VideoGenerationOutputSnapshot,
): boolean {
  return (
    left.outputId === right.outputId &&
    left.generationId === right.generationId &&
    left.jobState === right.jobState &&
    left.pillar === right.pillar &&
    left.mediaType === right.mediaType &&
    left.path === right.path &&
    left.contentHash === right.contentHash &&
    left.sizeBytes === right.sizeBytes &&
    left.durationSeconds === right.durationSeconds &&
    left.width === right.width &&
    left.height === right.height &&
    frameRatesEqual(left.frameRate, right.frameRate) &&
    left.threadId === right.threadId &&
    jsonRecordsEqual(left.workflow, right.workflow)
  );
}

function sourcesEqual(
  left: VideoSourceIdentity,
  right: VideoSourceIdentity,
): boolean {
  return (
    left.path === right.path &&
    left.sha256 === right.sha256 &&
    left.sizeBytes === right.sizeBytes &&
    left.durationSeconds === right.durationSeconds &&
    left.width === right.width &&
    left.height === right.height &&
    frameRatesEqual(left.frameRate, right.frameRate)
  );
}

function frameRatesEqual(
  left: RationalFrameRate,
  right: RationalFrameRate,
): boolean {
  return (
    left.numerator === right.numerator && left.denominator === right.denominator
  );
}

function snapshotProgress(
  progress: VideoEnhancementProgress,
): VideoEnhancementProgress {
  return Object.freeze({ ...progress });
}

function terminalStateForIssue(
  error: VideoEnhancementRuntimeIssue,
): "failed" | "cancelled" | "timed_out" | "interrupted" {
  if (error.code === "cancelled") return "cancelled";
  if (error.code === "process_timeout") return "timed_out";
  if (error.code === "interrupted") return "interrupted";
  return "failed";
}

function isTerminalState(state: VideoEnhancementRuntimeJobState): boolean {
  return (
    state === "succeeded" ||
    state === "failed" ||
    state === "cancelled" ||
    state === "timed_out" ||
    state === "interrupted"
  );
}

function outcomeFromJob(
  job: StoredVideoEnhancementJob,
): VideoEnhancementExecutionOutcome {
  if (job.state === "succeeded" && job.output) {
    return outcomeSuccess(job.childJobId, job.output);
  }
  const state =
    job.state === "cancelled" ||
    job.state === "timed_out" ||
    job.state === "interrupted"
      ? job.state
      : "failed";
  const fallback =
    state === "cancelled"
      ? issue("cancelled", "Video enhancement was cancelled.", true)
      : state === "timed_out"
        ? issue(
            "process_timeout",
            "Video enhancement exceeded its configured deadline.",
            true,
          )
        : state === "interrupted"
          ? issue(
              "interrupted",
              "Video enhancement was interrupted by a prior runtime shutdown.",
              true,
            )
          : issue(
              "internal_error",
              "Video enhancement failed without a durable error record.",
              true,
            );
  return outcomeFailure(job.childJobId, state, job.error ?? fallback);
}

function outcomeSuccess(
  childJobId: string,
  output: PublishedVideoEnhancementOutput,
): VideoEnhancementExecutionOutcome {
  return Object.freeze({ ok: true, state: "succeeded", childJobId, output });
}

function outcomeFailure(
  childJobId: string,
  state: "failed" | "cancelled" | "timed_out" | "interrupted",
  error: VideoEnhancementRuntimeIssue,
): VideoEnhancementExecutionOutcome {
  return Object.freeze({ ok: false, state, childJobId, error });
}

function enqueueFailure(
  error: VideoEnhancementRuntimeIssue,
): EnqueueVideoEnhancementResult {
  return Object.freeze({ ok: false, error });
}

function issue(
  code: VideoEnhancementRuntimeErrorCode,
  message: string,
  retryable: boolean,
  stage: VideoEnhancementProgressStage = "preflight",
  diagnostics: string | null = null,
  terminationConfirmed: boolean | null = null,
): VideoEnhancementRuntimeIssue {
  return Object.freeze({
    code,
    message,
    retryable,
    stage,
    diagnostics,
    terminationConfirmed,
  });
}

function copyCoreIssue(
  error: VideoEnhancementError,
): VideoEnhancementRuntimeIssue {
  return issue(
    error.code,
    error.message,
    error.retryable,
    error.stage,
    error.diagnostics,
    error.terminationConfirmed,
  );
}

function mapPortError(
  error: unknown,
  stage: VideoEnhancementProgressStage,
): VideoEnhancementRuntimeIssue {
  if (error instanceof VideoEnhancementRuntimePortError) {
    return issue(
      error.code,
      error.message,
      error.retryable,
      error.stage,
      error.diagnostics,
      error.terminationConfirmed,
    );
  }
  const code =
    stage === "validate"
      ? "output_invalid"
      : stage === "provenance"
        ? "provenance_failed"
        : stage === "publish"
          ? "publish_failed"
          : "source_invalid";
  return issue(
    code,
    "A video enhancement lifecycle operation failed unexpectedly.",
    code !== "source_invalid",
    stage,
  );
}

function notFoundIssue(): VideoEnhancementRuntimeIssue {
  return issue("not_found", "Enhancement child job was not found.", false);
}

function normalizeIdempotencyKey(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (
    value.length < 1 ||
    value.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
    /[\r\n\0]/.test(value)
  ) {
    return null;
  }
  return value;
}

function isOpaqueId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_VIDEO_ENHANCEMENT_JOB_ID_LENGTH &&
    !/[\r\n\0]/.test(value)
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFrameRate(value: unknown): value is RationalFrameRate {
  return (
    !!value &&
    typeof value === "object" &&
    isPositiveSafeInteger((value as RationalFrameRate).numerator) &&
    isPositiveSafeInteger((value as RationalFrameRate).denominator)
  );
}

function pathsEqual(left: string, right: string): boolean {
  const normalizedLeft = left.replace(/\\/g, "/");
  const normalizedRight = right.replace(/\\/g, "/");
  const windowsStyle =
    /^[a-z]:\//i.test(normalizedLeft) || normalizedLeft.startsWith("//");
  return windowsStyle
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function isCanonicalAbsoluteLocalMp4Path(value: unknown): value is string {
  if (!isAbsoluteLocalMp4Path(value)) return false;
  const windowsStyle = /^[a-z]:[\\/]/i.test(value) || /^[/\\]{2}/.test(value);
  const normalized = windowsStyle
    ? path.win32.normalize(value)
    : path.posix.normalize(value);
  return pathsEqual(value, normalized);
}

function snapshotJsonRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  const counter = { entries: 0 };
  const cloned = snapshotJsonValue(value, 0, counter);
  return cloned !== INVALID_JSON_VALUE &&
    cloned !== null &&
    typeof cloned === "object" &&
    !Array.isArray(cloned)
    ? (cloned as Readonly<Record<string, unknown>>)
    : null;
}

function snapshotJsonValue(
  value: unknown,
  depth: number,
  counter: { entries: number },
): unknown | typeof INVALID_JSON_VALUE {
  if (depth > MAX_WORKFLOW_DEPTH || counter.entries > MAX_WORKFLOW_ENTRIES)
    return INVALID_JSON_VALUE;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number")
    return Number.isFinite(value) ? value : INVALID_JSON_VALUE;
  if (Array.isArray(value)) {
    counter.entries += value.length;
    if (counter.entries > MAX_WORKFLOW_ENTRIES) return INVALID_JSON_VALUE;
    const output: unknown[] = [];
    for (const item of value) {
      const cloned = snapshotJsonValue(item, depth + 1, counter);
      if (cloned === INVALID_JSON_VALUE) return INVALID_JSON_VALUE;
      output.push(cloned);
    }
    return Object.freeze(output);
  }
  if (!value || typeof value !== "object") return INVALID_JSON_VALUE;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    return INVALID_JSON_VALUE;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  counter.entries += keys.length;
  if (counter.entries > MAX_WORKFLOW_ENTRIES) return INVALID_JSON_VALUE;
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      return INVALID_JSON_VALUE;
    const cloned = snapshotJsonValue(descriptor.value, depth + 1, counter);
    if (cloned === INVALID_JSON_VALUE) return INVALID_JSON_VALUE;
    output[key] = cloned;
  }
  return Object.freeze(output);
}

function jsonRecordsEqual(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  return jsonValuesEqual(left, right);
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left, sortedKeys) === JSON.stringify(right, sortedKeys);
}

function sortedKeys(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) output[key] = source[key];
    return output;
  }
  return value;
}

function isExecutionOutcome(
  value: unknown,
): value is VideoEnhancementExecutionOutcome {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<VideoEnhancementExecutionOutcome>;
  return (
    typeof candidate.childJobId === "string" &&
    ((candidate.ok === true && candidate.state === "succeeded") ||
      (candidate.ok === false &&
        (candidate.state === "failed" ||
          candidate.state === "cancelled" ||
          candidate.state === "timed_out" ||
          candidate.state === "interrupted")))
  );
}
