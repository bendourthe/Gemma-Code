import { stat } from "node:fs/promises";

import {
  GenerationIndex,
  GenerationQueue,
  redactWorkflow,
  type CompletionOutboxRecord,
  type EnhancementRunRecord,
  type GenerationJob,
} from "../../../../core/generations/index.js";
import {
  VIDEO_ENHANCEMENT_ERROR_CODES,
  VIDEO_ENHANCEMENT_PROGRESS_STAGES,
  isAbsoluteLocalMp4Path,
  validateVideoEnhancementRequest,
  type RationalFrameRate,
  type VideoEnhancementErrorCode,
  type VideoEnhancementProgress,
  type VideoEnhancementProgressStage,
  type VideoEnhancementRequest,
} from "../../../../core/video/VideoEnhancement.js";
import {
  createVideoEnhancementDurableProvenance,
  createVideoEnhancementEmbeddedProvenance,
  serializeVideoWorkflowMetadata,
  type VideoEnhancementDurableProvenance,
  type VideoWorkflowMetadata,
} from "../../../../core/video/WorkflowMetadata.js";
import {
  VIDEO_ENHANCEMENT_BACKEND_ID,
  VideoEnhancementRuntimePortError,
  type PublishedVideoEnhancementOutput,
  type StoredVideoEnhancementJob,
  type VideoEnhancementAtomicCompletionInput,
  type VideoEnhancementQueueEnqueueInput,
  type VideoEnhancementQueueFinishInput,
  type VideoEnhancementQueuePort,
  type VideoEnhancementRuntimeErrorCode,
  type VideoEnhancementRuntimeIssue,
  type VideoEnhancementRunRecord,
  type VideoEnhancementStoragePort,
  type VideoGenerationOutputSnapshot,
} from "./VideoEnhancementRuntime.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_ID_LENGTH = 256;
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_ENTRIES = 20_000;
const VIDEO_ENHANCEMENT_JOB_TYPE = "video_enhancement";
const PARAMETER_SCHEMA_VERSION = 1;

const CORE_ERROR_CODES = new Set<string>(VIDEO_ENHANCEMENT_ERROR_CODES);
const PROGRESS_STAGES = new Set<string>(VIDEO_ENHANCEMENT_PROGRESS_STAGES);

interface PersistedEnhancementParameters {
  readonly schemaVersion: 1;
  readonly kind: "video_enhancement";
  readonly estimatedVramGB: number;
  readonly idempotencyKey: string | null;
  readonly attempt: number;
  readonly retryOfChildJobId: string | null;
  readonly sourceOutput: VideoGenerationOutputSnapshot;
  readonly createdAt: string;
}

interface NormalizedEnhancementProvenance {
  readonly record: VideoEnhancementRunRecord;
  readonly embeddedWorkflow: VideoWorkflowMetadata;
  readonly durableProvenance: VideoEnhancementDurableProvenance;
}

/** Adapter-owned durable projection, including the selected backend identity. */
export interface PersistedVideoEnhancementJob extends StoredVideoEnhancementJob {
  readonly backendId: typeof VIDEO_ENHANCEMENT_BACKEND_ID;
}

export interface PersistedVideoEnhancementQueueEnqueueResult {
  readonly created: boolean;
  readonly job: PersistedVideoEnhancementJob;
}

export interface PersistedVideoEnhancementAtomicCompletionResult {
  readonly committed: boolean;
  readonly job: PersistedVideoEnhancementJob | null;
}

/**
 * Production bridge between the semantic enhancement runtime and the shared
 * generation database. The injected queue and index must share one
 * GenerationDatabase owner so completeEnhancement remains one transaction.
 */
export class VideoEnhancementPersistenceAdapter
  implements VideoEnhancementQueuePort, VideoEnhancementStoragePort
{
  constructor(
    private readonly queue: GenerationQueue,
    private readonly index: GenerationIndex,
  ) {}

  async getGenerationOutput(
    parentJobId: string,
    outputId: string,
  ): Promise<VideoGenerationOutputSnapshot | null> {
    if (!isOpaqueId(parentJobId) || !isOpaqueId(outputId)) return null;
    const job = this.queue.get(parentJobId);
    const output = this.index.getOutput(outputId);
    if (
      !job ||
      !output ||
      job.id !== output.jobId ||
      job.state !== "done" ||
      job.pillar !== "video" ||
      output.pillar !== "video" ||
      this.index.getOutputForJob(parentJobId)?.id !== outputId ||
      !isAbsoluteLocalMp4Path(output.outputPath) ||
      !HASH_PATTERN.test(output.contentHash)
    ) {
      return null;
    }

    const workflow = normalizeWorkflow(output.workflow);
    if (!workflow) return null;
    const mediaStat = await safeFileStat(output.outputPath);
    if (!mediaStat) return null;

    const enhancement = this.index.getEnhancementRun(parentJobId);
    if (enhancement) {
      if (
        enhancement.state !== "completed" ||
        enhancement.outputId !== output.id ||
        enhancement.provenanceRecordId === null ||
        enhancement.provenance === null
      ) {
        return null;
      }
      const provenance = normalizeEnhancementProvenance(enhancement.provenance);
      if (
        !provenance ||
        !enhancementProvenanceMatches(
          provenance,
          enhancement,
          job,
          output.id,
          output.contentHash,
        ) ||
        !jsonEqual(
          output.workflow,
          redactWorkflow(
            provenance.embeddedWorkflow as unknown as Record<string, unknown>,
          ),
        )
      ) {
        return null;
      }
      const facts = provenance.durableProvenance.output;
      return freezeSnapshot({
        outputId: output.id,
        generationId: job.id,
        jobState: "done",
        pillar: "video",
        mediaType: "video/mp4",
        path: output.outputPath,
        contentHash: output.contentHash,
        sizeBytes: mediaStat.size,
        durationSeconds: facts.durationSeconds,
        width: facts.width,
        height: facts.height,
        frameRate: facts.frameRate,
        workflow,
        threadId: job.threadId,
      });
    }

    if (workflow.enhancement !== undefined) return null;
    const frameRate = frameRateFromFps(workflow.fps);
    if (!frameRate) return null;
    return freezeSnapshot({
      outputId: output.id,
      generationId: job.id,
      jobState: "done",
      pillar: "video",
      mediaType: "video/mp4",
      path: output.outputPath,
      contentHash: output.contentHash,
      sizeBytes: mediaStat.size,
      durationSeconds: workflow.durationSeconds,
      width: workflow.width,
      height: workflow.height,
      frameRate,
      workflow,
      threadId: job.threadId,
    });
  }

  async enqueueEnhancement(
    input: VideoEnhancementQueueEnqueueInput,
  ): Promise<PersistedVideoEnhancementQueueEnqueueResult> {
    const normalized = await this.normalizeEnqueueInput(input);
    const matchingIdempotencyJobs = normalized.idempotencyKey
      ? this.findJobsByIdempotencyKey(
          normalized.parentJobId,
          normalized.sourceOutputId,
          normalized.idempotencyKey,
        )
      : [];
    if (matchingIdempotencyJobs.length > 1) {
      throw conflict("The persisted idempotency key is not unique.");
    }
    const idempotent = matchingIdempotencyJobs[0];
    if (idempotent) {
      const parameters = normalizeParameters(idempotent.parameters);
      if (
        !parameters ||
        !idempotencyInputsMatch(idempotent, parameters, normalized)
      ) {
        throw conflict(
          "The idempotency key belongs to different immutable enhancement inputs.",
        );
      }
      const job = await this.getEnhancement(idempotent.id);
      if (!job) {
        throw conflict("The idempotent enhancement record is malformed.");
      }
      return Object.freeze({ created: false, job });
    }

    const collision = this.queue.get(normalized.childJobId);
    if (collision) {
      const parameters = normalizeParameters(collision.parameters);
      if (
        !parameters ||
        !exactEnqueueInputsMatch(collision, parameters, normalized)
      ) {
        throw conflict(
          "The enhancement child ID belongs to different immutable inputs.",
        );
      }
      const job = await this.getEnhancement(collision.id);
      if (!job)
        throw conflict("The colliding enhancement record is malformed.");
      return Object.freeze({ created: false, job });
    }

    const parameters: PersistedEnhancementParameters = Object.freeze({
      schemaVersion: PARAMETER_SCHEMA_VERSION,
      kind: VIDEO_ENHANCEMENT_JOB_TYPE,
      estimatedVramGB: normalized.estimatedVramGB,
      idempotencyKey: normalized.idempotencyKey,
      attempt: normalized.attempt,
      retryOfChildJobId: normalized.retryOfChildJobId,
      sourceOutput: normalized.sourceOutput,
      createdAt: normalized.createdAt,
    });
    try {
      this.queue.enqueue({
        id: normalized.childJobId,
        pillar: "video",
        jobType: VIDEO_ENHANCEMENT_JOB_TYPE,
        parameters: parameters as unknown as Record<string, unknown>,
        priority: normalized.priority,
        threadId: normalized.sourceOutput.threadId ?? undefined,
        parentId: normalized.parentJobId,
        enhancement: {
          request: normalized.request,
          sourceOutputId: normalized.sourceOutputId,
          backendId: normalized.backendId,
        },
      });
    } catch (error) {
      throw conflict(
        error instanceof Error
          ? `Enhancement persistence rejected the enqueue: ${error.message}`
          : "Enhancement persistence rejected the enqueue.",
      );
    }
    const job = await this.getEnhancement(normalized.childJobId);
    if (!job) {
      throw new VideoEnhancementRuntimePortError(
        "internal_error",
        "The newly persisted enhancement could not be reconstructed.",
        true,
        "preflight",
      );
    }
    return Object.freeze({ created: true, job });
  }

  async getEnhancement(
    childJobId: string,
  ): Promise<PersistedVideoEnhancementJob | null> {
    if (!isOpaqueId(childJobId)) return null;
    const job = this.queue.get(childJobId);
    const run = this.index.getEnhancementRun(childJobId);
    if (!job || !run) return null;
    return this.reconstructEnhancement(job, run);
  }

  async listEnhancements(): Promise<readonly PersistedVideoEnhancementJob[]> {
    const jobs = this.queue
      .list()
      .filter((job) => job.jobType === VIDEO_ENHANCEMENT_JOB_TYPE);
    const reconstructed = await Promise.all(
      jobs.map((job) => this.getEnhancement(job.id)),
    );
    return Object.freeze(
      reconstructed.filter(
        (job): job is PersistedVideoEnhancementJob => job !== null,
      ),
    );
  }

  async listEnhancementsForParent(
    parentJobId: string,
  ): Promise<readonly PersistedVideoEnhancementJob[]> {
    if (!isOpaqueId(parentJobId)) return Object.freeze([]);
    const reconstructed = await Promise.all(
      this.index
        .listEnhancementRunsForParent(parentJobId)
        .map((run) => this.getEnhancement(run.childJobId)),
    );
    return Object.freeze(
      reconstructed.filter(
        (job): job is PersistedVideoEnhancementJob => job !== null,
      ),
    );
  }

  listPendingCompletions(limit?: number): readonly CompletionOutboxRecord[] {
    return Object.freeze(this.index.listPendingCompletions(limit));
  }

  markCompletionDelivered(id: string, deliveredAt?: string): boolean {
    if (
      !isOpaqueId(id) ||
      (deliveredAt !== undefined && !isTimestamp(deliveredAt))
    ) {
      return false;
    }
    return this.index.markCompletionDelivered(id, deliveredAt);
  }

  async persistEnhancementProgress(input: {
    readonly childJobId: string;
    readonly progress: VideoEnhancementProgress;
    readonly updatedAt: string;
  }): Promise<boolean> {
    if (
      !isOpaqueId(input.childJobId) ||
      !isTimestamp(input.updatedAt) ||
      !normalizeProgress(input.progress, input.childJobId)
    ) {
      return false;
    }
    return this.queue.updateEnhancementProgress(
      input.childJobId,
      input.progress,
    );
  }

  async requestEnhancementCancellation(input: {
    readonly childJobId: string;
    readonly requestedAt: string;
  }): Promise<PersistedVideoEnhancementJob | null> {
    if (!isOpaqueId(input.childJobId) || !isTimestamp(input.requestedAt)) {
      return null;
    }
    if (!this.queue.requestEnhancementCancellation(input.childJobId)) {
      return null;
    }
    return this.getEnhancement(input.childJobId);
  }

  async finishEnhancement(
    input: VideoEnhancementQueueFinishInput,
  ): Promise<PersistedVideoEnhancementJob | null> {
    if (
      !isOpaqueId(input.childJobId) ||
      !isTimestamp(input.finishedAt) ||
      input.expectedStates.length === 0
    ) {
      return null;
    }
    const run = this.index.getEnhancementRun(input.childJobId);
    if (!run) return null;
    const enrichingCancelledEvidence =
      run.state === "cancelled" && input.state === "cancelled";
    if (
      !enrichingCancelledEvidence &&
      !input.expectedStates.includes(run.state as never)
    ) {
      return this.getEnhancement(input.childJobId);
    }
    if (input.state === "interrupted") {
      this.queue.markEnhancementInterrupted(
        input.childJobId,
        input.error.message,
        input.error.stage,
        input.error.diagnostics,
        input.error.terminationConfirmed,
      );
    } else {
      this.queue.markEnhancementFailed(input.childJobId, {
        code: persistedErrorCode(input.state, input.error.code),
        message: input.error.message,
        retryable: input.error.retryable,
        stage: input.error.stage,
        diagnostics: input.error.diagnostics,
        terminationConfirmed: input.error.terminationConfirmed,
      });
    }
    return this.getEnhancement(input.childJobId);
  }

  async completeEnhancement(
    input: VideoEnhancementAtomicCompletionInput,
  ): Promise<PersistedVideoEnhancementAtomicCompletionResult> {
    const current = await this.getEnhancement(input.childJobId);
    const run = this.index.getEnhancementRun(input.childJobId);
    if (
      !current ||
      !run ||
      current.state !== "running" ||
      run.state !== "running" ||
      run.cancellationRequested
    ) {
      return Object.freeze({ committed: false, job: current });
    }
    const completion = await normalizeAtomicCompletion(input, current, run);
    try {
      this.queue.completeEnhancement({
        childJobId: input.childJobId,
        output: {
          id: completion.output.outputId,
          outputPath: completion.output.path,
          contentHash: completion.output.contentHash,
          workflow: completion.embeddedWorkflow as unknown as Record<
            string,
            unknown
          >,
        },
        provenanceRecordId: completion.provenanceRecordId,
        provenance: completion.enhancement as unknown as Record<
          string,
          unknown
        >,
        outbox: {
          id: completion.outbox.eventId,
          payload: completion.outbox.payload as unknown as Record<
            string,
            unknown
          >,
        },
        completedAt: completion.finishedAt,
      });
    } catch {
      return Object.freeze({
        committed: false,
        job: await this.getEnhancement(input.childJobId),
      });
    }
    return Object.freeze({
      committed: true,
      job: await this.getEnhancement(input.childJobId),
    });
  }

  private async normalizeEnqueueInput(
    input: VideoEnhancementQueueEnqueueInput,
  ): Promise<VideoEnhancementQueueEnqueueInput> {
    if (
      !isOpaqueId(input.childJobId) ||
      !isOpaqueId(input.parentJobId) ||
      !isOpaqueId(input.sourceOutputId) ||
      input.backendId !== VIDEO_ENHANCEMENT_BACKEND_ID ||
      input.childJobId === input.parentJobId ||
      !(input.priority === "interactive" || input.priority === "batch") ||
      !isPositiveFinite(input.estimatedVramGB) ||
      !isPositiveSafeInteger(input.attempt) ||
      !isTimestamp(input.createdAt) ||
      !isNullableOpaqueId(input.retryOfChildJobId) ||
      !isIdempotencyKey(input.idempotencyKey)
    ) {
      throw invalidRequest("Enhancement enqueue metadata is malformed.");
    }
    const validation = validateVideoEnhancementRequest(input.request);
    if (!validation.ok) {
      throw invalidRequest(validation.error.message);
    }
    const request = validation.value;
    const sourceOutput = normalizePersistedSnapshot(input.sourceOutput);
    const currentOutput = await this.getGenerationOutput(
      input.parentJobId,
      input.sourceOutputId,
    );
    if (
      !sourceOutput ||
      !currentOutput ||
      !jsonEqual(sourceOutput, currentOutput) ||
      request.parentJobId !== input.parentJobId ||
      input.sourceOutputId !== sourceOutput.outputId ||
      request.requestedAt !== input.createdAt ||
      !sourceIdentityMatches(request, sourceOutput)
    ) {
      throw invalidRequest(
        "Enhancement source identity does not match the completed parent output.",
      );
    }
    this.assertRetryLineage(input);
    return Object.freeze({ ...input, request, sourceOutput });
  }

  private assertRetryLineage(input: VideoEnhancementQueueEnqueueInput): void {
    if (input.retryOfChildJobId === null) {
      if (input.attempt !== 1) {
        throw invalidRequest("A first enhancement attempt must use attempt 1.");
      }
      return;
    }
    if (input.retryOfChildJobId === input.childJobId) {
      throw invalidRequest("An enhancement cannot retry itself.");
    }
    const priorJob = this.queue.get(input.retryOfChildJobId);
    const priorRun = this.index.getEnhancementRun(input.retryOfChildJobId);
    const priorParameters = priorJob
      ? normalizeParameters(priorJob.parameters)
      : null;
    if (
      !priorJob ||
      !priorRun ||
      !priorParameters ||
      priorRun.state === "queued" ||
      priorRun.state === "running" ||
      priorRun.state === "completed" ||
      !priorRun.retryable ||
      priorRun.parentJobId !== input.parentJobId ||
      priorRun.sourceOutputId !== input.sourceOutputId ||
      input.attempt !== priorParameters.attempt + 1
    ) {
      throw invalidRequest(
        "Enhancement retry lineage is missing, non-retryable, or inconsistent.",
      );
    }
  }

  private findJobsByIdempotencyKey(
    parentJobId: string,
    sourceOutputId: string,
    idempotencyKey: string,
  ): GenerationJob[] {
    return this.queue.list().filter((job) => {
      if (
        job.parentId !== parentJobId ||
        job.enhancement?.sourceOutputId !== sourceOutputId
      ) {
        return false;
      }
      return (
        normalizeParameters(job.parameters)?.idempotencyKey === idempotencyKey
      );
    });
  }

  private async reconstructEnhancement(
    job: GenerationJob,
    run: EnhancementRunRecord,
  ): Promise<PersistedVideoEnhancementJob | null> {
    const parameters = normalizeParameters(job.parameters);
    if (
      !parameters ||
      job.id !== run.childJobId ||
      job.jobType !== VIDEO_ENHANCEMENT_JOB_TYPE ||
      job.pillar !== "video" ||
      job.parentId === null ||
      job.parentId !== run.parentJobId ||
      job.enhancement === null ||
      job.enhancement.backendId !== VIDEO_ENHANCEMENT_BACKEND_ID ||
      job.enhancement.sourceOutputId !== run.sourceOutputId ||
      run.requestId !== job.enhancement.request.requestId ||
      !jsonEqual(job.enhancement, run.metadata)
    ) {
      return null;
    }
    const requestValidation = validateVideoEnhancementRequest(
      job.enhancement.request,
    );
    if (
      !requestValidation.ok ||
      requestValidation.value.parentJobId !== job.parentId ||
      requestValidation.value.requestedAt !== parameters.createdAt ||
      !sourceIdentityMatches(requestValidation.value, parameters.sourceOutput)
    ) {
      return null;
    }
    const state = mapStoredState(job, run);
    if (!state) return null;
    const progress = run.progress
      ? normalizeProgress(run.progress, job.id, run.requestId)
      : null;
    if (run.progress && !progress) return null;

    let output: PublishedVideoEnhancementOutput | null = null;
    if (run.state === "completed") {
      output = await this.reconstructPublishedOutput(job, run);
      if (!output) return null;
    } else if (
      run.outputId !== null ||
      run.provenanceRecordId !== null ||
      run.provenance !== null
    ) {
      return null;
    }

    const error = issueFromRun(run, progress?.stage ?? "preflight");
    const expectsError =
      state === "failed" ||
      state === "cancelled" ||
      state === "timed_out" ||
      state === "interrupted";
    if (expectsError !== (error !== null)) return null;
    return Object.freeze({
      childJobId: job.id,
      parentJobId: job.parentId,
      sourceOutputId: run.sourceOutputId,
      backendId: job.enhancement.backendId,
      state,
      priority: job.priority,
      estimatedVramGB: parameters.estimatedVramGB,
      request: requestValidation.value,
      sourceOutput: parameters.sourceOutput,
      idempotencyKey: parameters.idempotencyKey,
      attempt: parameters.attempt,
      retryOfChildJobId: parameters.retryOfChildJobId,
      cancelRequested: run.cancellationRequested,
      progress,
      error,
      output,
      createdAt: parameters.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.completedAt,
    });
  }

  private async reconstructPublishedOutput(
    job: GenerationJob,
    run: EnhancementRunRecord,
  ): Promise<PublishedVideoEnhancementOutput | null> {
    if (!run.provenance || !run.outputId || !run.provenanceRecordId)
      return null;
    const output = this.index.getOutput(run.outputId);
    const provenance = normalizeEnhancementProvenance(run.provenance);
    if (
      !output ||
      !provenance ||
      output.jobId !== job.id ||
      output.pillar !== "video" ||
      output.id !== run.outputId ||
      !isAbsoluteLocalMp4Path(output.outputPath) ||
      !HASH_PATTERN.test(output.contentHash) ||
      !enhancementProvenanceMatches(
        provenance,
        run,
        job,
        output.id,
        output.contentHash,
      ) ||
      !jsonEqual(
        output.workflow,
        redactWorkflow(
          provenance.embeddedWorkflow as unknown as Record<string, unknown>,
        ),
      )
    ) {
      return null;
    }
    const mediaStat = await safeFileStat(output.outputPath);
    if (!mediaStat) return null;
    const facts = provenance.durableProvenance.output;
    return Object.freeze({
      outputId: output.id,
      path: output.outputPath,
      contentHash: output.contentHash,
      sizeBytes: mediaStat.size,
      durationSeconds: facts.durationSeconds,
      width: facts.width,
      height: facts.height,
      frameRate: Object.freeze({ ...facts.frameRate }),
      workflow: provenance.embeddedWorkflow,
      provenanceRecordId: provenance.durableProvenance.provenanceRecordId,
      preProvenanceContainerSha256:
        provenance.durableProvenance.output.preProvenanceContainerSha256,
      publishedContainerSha256:
        provenance.durableProvenance.publishedContainerSha256,
      embeddedWorkflow: provenance.embeddedWorkflow,
      durableProvenance: provenance.durableProvenance,
    });
  }
}

async function normalizeAtomicCompletion(
  input: VideoEnhancementAtomicCompletionInput,
  current: StoredVideoEnhancementJob,
  run: EnhancementRunRecord,
): Promise<VideoEnhancementAtomicCompletionInput> {
  if (
    input.expectedState !== "running" ||
    !isTimestamp(input.finishedAt) ||
    input.childJobId !== current.childJobId ||
    run.cancellationRequested
  ) {
    throw invalidCompletion("The enhancement is not eligible for completion.");
  }
  const provenance = normalizeEnhancementProvenance(input.enhancement);
  const embeddedWorkflow = normalizeWorkflow(input.embeddedWorkflow);
  if (
    !provenance ||
    !embeddedWorkflow ||
    embeddedWorkflow.enhancement === undefined ||
    !jsonEqual(provenance.embeddedWorkflow, embeddedWorkflow) ||
    !jsonEqual(provenance.durableProvenance, input.durableProvenance) ||
    !jsonEqual(input.output.workflow, embeddedWorkflow) ||
    !jsonEqual(input.output.embeddedWorkflow, embeddedWorkflow) ||
    !jsonEqual(input.output.durableProvenance, provenance.durableProvenance) ||
    input.provenanceRecordId !==
      provenance.durableProvenance.provenanceRecordId ||
    input.output.provenanceRecordId !== input.provenanceRecordId ||
    input.output.preProvenanceContainerSha256 !==
      provenance.durableProvenance.output.preProvenanceContainerSha256 ||
    input.output.publishedContainerSha256 !==
      provenance.durableProvenance.publishedContainerSha256 ||
    input.output.contentHash !==
      provenance.durableProvenance.publishedContainerSha256 ||
    input.output.outputId !== provenance.record.outputId ||
    input.output.path === current.sourceOutput.path ||
    !isAbsoluteLocalMp4Path(input.output.path) ||
    input.output.durationSeconds !==
      provenance.durableProvenance.output.durationSeconds ||
    input.output.width !== provenance.durableProvenance.output.width ||
    input.output.height !== provenance.durableProvenance.output.height ||
    !frameRatesEqual(
      input.output.frameRate,
      provenance.durableProvenance.output.frameRate,
    ) ||
    !enhancementProvenanceMatches(
      provenance,
      run,
      { id: current.childJobId, parentId: current.parentJobId },
      input.output.outputId,
      input.output.contentHash,
      false,
    ) ||
    provenance.record.attempt !== current.attempt ||
    provenance.record.retryOfChildJobId !== current.retryOfChildJobId ||
    !jsonEqual(provenance.record.request, current.request)
  ) {
    throw invalidCompletion(
      "Atomic completion identities, hashes, workflow, or provenance do not agree.",
    );
  }
  if (!validCompletionOutbox(input, current)) {
    throw invalidCompletion("Atomic completion outbox data is inconsistent.");
  }
  const mediaStat = await safeFileStat(input.output.path);
  if (!mediaStat || mediaStat.size !== input.output.sizeBytes) {
    throw invalidCompletion(
      "The published enhancement output is missing or its size changed.",
    );
  }
  return Object.freeze({
    ...input,
    embeddedWorkflow,
    durableProvenance: provenance.durableProvenance,
    output: Object.freeze({ ...input.output, workflow: embeddedWorkflow }),
    enhancement: provenance.record,
  });
}

function validCompletionOutbox(
  input: VideoEnhancementAtomicCompletionInput,
  current: StoredVideoEnhancementJob,
): boolean {
  const payload = input.outbox.payload;
  return (
    isOpaqueId(input.outbox.eventId) &&
    input.outbox.eventType === "video.enhancement.completed" &&
    input.outbox.aggregateId === current.childJobId &&
    input.outbox.occurredAt === input.finishedAt &&
    input.outbox.threadId === current.sourceOutput.threadId &&
    payload.childJobId === current.childJobId &&
    payload.parentJobId === current.parentJobId &&
    payload.sourceOutputId === current.sourceOutputId &&
    payload.sourceContentHash === current.sourceOutput.contentHash &&
    payload.outputId === input.output.outputId &&
    payload.outputContentHash === input.output.contentHash &&
    payload.provenanceRecordId === input.provenanceRecordId &&
    payload.preProvenanceContainerSha256 ===
      input.output.preProvenanceContainerSha256 &&
    payload.publishedContainerSha256 ===
      input.output.publishedContainerSha256 &&
    payload.attempt === current.attempt
  );
}

function normalizeEnhancementProvenance(
  value: unknown,
): NormalizedEnhancementProvenance | null {
  const record = snapshotJsonRecord(value);
  if (!record) return null;
  const embeddedWorkflow = normalizeWorkflow(record.embeddedWorkflow);
  if (!embeddedWorkflow || embeddedWorkflow.enhancement === undefined)
    return null;
  let durableProvenance: VideoEnhancementDurableProvenance;
  try {
    const embedded = createVideoEnhancementEmbeddedProvenance(
      embeddedWorkflow.enhancement,
    );
    durableProvenance = createVideoEnhancementDurableProvenance(
      embedded,
      record.publishedContainerSha256 as string,
    );
  } catch {
    return null;
  }
  if (
    !jsonEqual(record.durableProvenance, durableProvenance) ||
    !isOpaqueId(record.childJobId) ||
    !isOpaqueId(record.parentJobId) ||
    !isOpaqueId(record.sourceGenerationId) ||
    !isOpaqueId(record.sourceOutputId) ||
    !HASH_PATTERN.test(String(record.sourceContentHash)) ||
    !isOpaqueId(record.outputId) ||
    !HASH_PATTERN.test(String(record.outputContentHash)) ||
    !isOpaqueId(record.provenanceRecordId) ||
    !HASH_PATTERN.test(String(record.preProvenanceContainerSha256)) ||
    !HASH_PATTERN.test(String(record.publishedContainerSha256)) ||
    !isTimestamp(record.startedAt) ||
    !isTimestamp(record.completedAt) ||
    !isNonnegativeSafeInteger(record.durationMs) ||
    !isPositiveSafeInteger(record.attempt) ||
    !isNullableOpaqueId(record.retryOfChildJobId) ||
    record.outcome !== "succeeded" ||
    !Array.isArray(record.warnings) ||
    !record.warnings.every((warning) => typeof warning === "string") ||
    !snapshotJsonRecord(record.progress)
  ) {
    return null;
  }
  const requestValidation = validateVideoEnhancementRequest(record.request);
  if (!requestValidation.ok) return null;
  return {
    record: Object.freeze({
      ...(record as unknown as VideoEnhancementRunRecord),
      request: requestValidation.value,
      embeddedWorkflow,
      durableProvenance,
    }),
    embeddedWorkflow,
    durableProvenance,
  };
}

function enhancementProvenanceMatches(
  provenance: NormalizedEnhancementProvenance,
  run: EnhancementRunRecord,
  job: Pick<GenerationJob, "id" | "parentId">,
  outputId: string,
  outputHash: string,
  requireStoredCompletion = true,
): boolean {
  const record = provenance.record;
  const durable = provenance.durableProvenance;
  return (
    job.parentId !== null &&
    record.childJobId === job.id &&
    record.parentJobId === job.parentId &&
    record.parentJobId === run.parentJobId &&
    record.sourceGenerationId === durable.source.generationId &&
    record.sourceOutputId === run.sourceOutputId &&
    record.sourceOutputId === durable.source.outputId &&
    record.sourceContentHash === durable.source.sha256 &&
    record.outputId === outputId &&
    record.outputContentHash === outputHash &&
    record.outputContentHash === durable.publishedContainerSha256 &&
    (!requireStoredCompletion ||
      record.provenanceRecordId === run.provenanceRecordId) &&
    record.provenanceRecordId === durable.provenanceRecordId &&
    record.preProvenanceContainerSha256 ===
      durable.output.preProvenanceContainerSha256 &&
    record.publishedContainerSha256 === durable.publishedContainerSha256 &&
    record.parentJobId === durable.parentJobId &&
    record.childJobId === durable.childJobId &&
    record.request.requestId === run.requestId &&
    jsonEqual(record.request, run.metadata.request) &&
    jsonEqual(record.backend, durable.backend) &&
    jsonEqual(record.execution, durable.execution) &&
    jsonEqual(record.stages, durable.stages) &&
    record.startedAt === durable.startedAt &&
    record.completedAt === durable.completedAt &&
    record.durationMs === durable.durationMs
  );
}

function normalizeWorkflow(value: unknown): VideoWorkflowMetadata | null {
  const record = snapshotJsonRecord(value);
  if (
    !record ||
    !isText(record.tool) ||
    !isText(record.version) ||
    record.kind !== "video" ||
    !(
      record.mode === "text2video" ||
      record.mode === "image2video" ||
      record.mode === "audio2video"
    ) ||
    !isText(record.modelId) ||
    typeof record.prompt !== "string" ||
    !(
      record.negativePrompt === undefined ||
      typeof record.negativePrompt === "string"
    ) ||
    !isPositiveSafeInteger(record.width) ||
    !isPositiveSafeInteger(record.height) ||
    !isPositiveFinite(record.durationSeconds) ||
    !isPositiveFinite(record.fps) ||
    !isPositiveSafeInteger(record.frameCount) ||
    !isPositiveSafeInteger(record.steps) ||
    !isPositiveFinite(record.cfgScale) ||
    !isText(record.sampler) ||
    !Number.isSafeInteger(record.seed) ||
    !isTimestamp(record.timestamp)
  ) {
    return null;
  }
  try {
    const candidate = record as unknown as VideoWorkflowMetadata;
    const normalized = JSON.parse(
      serializeVideoWorkflowMetadata(candidate),
    ) as VideoWorkflowMetadata;
    return Object.freeze(normalized);
  } catch {
    return null;
  }
}

function normalizeParameters(
  value: unknown,
): PersistedEnhancementParameters | null {
  const record = snapshotJsonRecord(value);
  if (
    !record ||
    record.schemaVersion !== PARAMETER_SCHEMA_VERSION ||
    record.kind !== VIDEO_ENHANCEMENT_JOB_TYPE ||
    !isPositiveFinite(record.estimatedVramGB) ||
    !isIdempotencyKey(record.idempotencyKey) ||
    !isPositiveSafeInteger(record.attempt) ||
    !isNullableOpaqueId(record.retryOfChildJobId) ||
    !isTimestamp(record.createdAt)
  ) {
    return null;
  }
  const sourceOutput = normalizePersistedSnapshot(record.sourceOutput);
  if (!sourceOutput) return null;
  return Object.freeze({
    schemaVersion: 1,
    kind: VIDEO_ENHANCEMENT_JOB_TYPE,
    estimatedVramGB: record.estimatedVramGB,
    idempotencyKey: record.idempotencyKey,
    attempt: record.attempt,
    retryOfChildJobId: record.retryOfChildJobId,
    sourceOutput,
    createdAt: record.createdAt,
  });
}

function normalizePersistedSnapshot(
  value: unknown,
): VideoGenerationOutputSnapshot | null {
  const record = snapshotJsonRecord(value);
  if (
    !record ||
    !isOpaqueId(record.outputId) ||
    !isOpaqueId(record.generationId) ||
    record.jobState !== "done" ||
    record.pillar !== "video" ||
    record.mediaType !== "video/mp4" ||
    typeof record.path !== "string" ||
    !isAbsoluteLocalMp4Path(record.path) ||
    typeof record.contentHash !== "string" ||
    !HASH_PATTERN.test(record.contentHash) ||
    !isPositiveSafeInteger(record.sizeBytes) ||
    !isPositiveFinite(record.durationSeconds) ||
    !isPositiveSafeInteger(record.width) ||
    !isPositiveSafeInteger(record.height) ||
    !isFrameRate(record.frameRate) ||
    !(record.threadId === null || isOpaqueId(record.threadId))
  ) {
    return null;
  }
  const workflow = normalizeWorkflow(record.workflow);
  if (!workflow) return null;
  const expected = workflow.enhancement?.output;
  const expectedFrameRate =
    expected?.frameRate ?? frameRateFromFps(workflow.fps);
  if (
    !expectedFrameRate ||
    record.durationSeconds !==
      (expected?.durationSeconds ?? workflow.durationSeconds) ||
    record.width !== (expected?.width ?? workflow.width) ||
    record.height !== (expected?.height ?? workflow.height) ||
    !frameRatesEqual(record.frameRate, expectedFrameRate)
  ) {
    return null;
  }
  return freezeSnapshot({
    outputId: record.outputId,
    generationId: record.generationId,
    jobState: "done",
    pillar: "video",
    mediaType: "video/mp4",
    path: record.path,
    contentHash: record.contentHash,
    sizeBytes: record.sizeBytes,
    durationSeconds: record.durationSeconds,
    width: record.width,
    height: record.height,
    frameRate: record.frameRate,
    workflow,
    threadId: record.threadId,
  });
}

function freezeSnapshot(
  value: VideoGenerationOutputSnapshot,
): VideoGenerationOutputSnapshot {
  return Object.freeze({
    ...value,
    frameRate: Object.freeze({ ...value.frameRate }),
    workflow: Object.freeze({ ...value.workflow }),
  });
}

function normalizeProgress(
  value: unknown,
  childJobId: string,
  requestId?: string,
): VideoEnhancementProgress | null {
  const record = snapshotJsonRecord(value);
  if (
    !record ||
    !isOpaqueId(record.requestId) ||
    record.childJobId !== childJobId ||
    (requestId !== undefined && record.requestId !== requestId) ||
    !PROGRESS_STAGES.has(String(record.stage)) ||
    !isPositiveSafeInteger(record.stageIndex) ||
    !isPositiveSafeInteger(record.stageCount) ||
    record.stageIndex > record.stageCount ||
    typeof record.message !== "string" ||
    !optionalNonnegative(record.processedFrames) ||
    !optionalPositive(record.totalFrames) ||
    !optionalBoundedPercent(record.percent) ||
    !optionalNonnegative(record.processingFps) ||
    !optionalNonnegative(record.elapsedMs) ||
    !optionalNonnegative(record.remainingMs)
  ) {
    return null;
  }
  return Object.freeze(record as unknown as VideoEnhancementProgress);
}

function mapStoredState(
  job: GenerationJob,
  run: EnhancementRunRecord,
): StoredVideoEnhancementJob["state"] | null {
  if (run.state === "queued" && job.state === "queued") return "queued";
  if (run.state === "running" && job.state === "running") return "running";
  if (
    run.state === "interrupted" &&
    job.state === "interrupted" &&
    run.retryable
  ) {
    return "interrupted";
  }
  if (run.state === "completed" && job.state === "done" && !run.retryable) {
    return "succeeded";
  }
  if (run.state === "cancelled" && job.state === "failed") return "cancelled";
  if (run.state === "failed" && job.state === "failed") {
    return run.errorCode === "process_timeout" ? "timed_out" : "failed";
  }
  return null;
}

function issueFromRun(
  run: EnhancementRunRecord,
  stage: VideoEnhancementProgressStage,
): VideoEnhancementRuntimeIssue | null {
  if (
    run.state === "queued" ||
    run.state === "running" ||
    run.state === "completed"
  ) {
    return null;
  }
  const code: VideoEnhancementRuntimeErrorCode =
    run.state === "interrupted"
      ? "interrupted"
      : run.state === "cancelled"
        ? "cancelled"
        : (run.errorCode ?? "internal_error");
  return Object.freeze({
    code,
    message:
      run.errorMessage ??
      (run.state === "interrupted"
        ? "Video enhancement was interrupted."
        : "Video enhancement failed without a durable error message."),
    retryable: run.state === "interrupted" ? true : run.retryable,
    stage: run.errorStage ?? stage,
    diagnostics: run.errorDiagnostics,
    terminationConfirmed: run.errorTerminationConfirmed,
  });
}

function persistedErrorCode(
  state: VideoEnhancementQueueFinishInput["state"],
  code: VideoEnhancementRuntimeErrorCode,
): VideoEnhancementErrorCode {
  if (state === "cancelled") return "cancelled";
  if (state === "timed_out") return "process_timeout";
  return CORE_ERROR_CODES.has(code)
    ? (code as VideoEnhancementErrorCode)
    : "internal_error";
}

function idempotencyInputsMatch(
  job: GenerationJob,
  parameters: PersistedEnhancementParameters,
  input: VideoEnhancementQueueEnqueueInput,
): boolean {
  const existing = job.enhancement;
  return (
    existing !== null &&
    job.parentId === input.parentJobId &&
    existing.sourceOutputId === input.sourceOutputId &&
    existing.backendId === VIDEO_ENHANCEMENT_BACKEND_ID &&
    job.priority === input.priority &&
    parameters.estimatedVramGB === input.estimatedVramGB &&
    parameters.attempt === input.attempt &&
    parameters.retryOfChildJobId === input.retryOfChildJobId &&
    parameters.idempotencyKey === input.idempotencyKey &&
    jsonEqual(parameters.sourceOutput, input.sourceOutput) &&
    requestTransformsEqual(existing.request, input.request) &&
    sourceIdentityMatches(input.request, parameters.sourceOutput)
  );
}

function exactEnqueueInputsMatch(
  job: GenerationJob,
  parameters: PersistedEnhancementParameters,
  input: VideoEnhancementQueueEnqueueInput,
): boolean {
  return (
    idempotencyInputsMatch(job, parameters, input) &&
    job.id === input.childJobId &&
    jsonEqual(job.enhancement?.request, input.request) &&
    parameters.createdAt === input.createdAt
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

function sourceIdentityMatches(
  request: VideoEnhancementRequest,
  output: VideoGenerationOutputSnapshot,
): boolean {
  return (
    request.source.path === output.path &&
    request.source.sha256 === output.contentHash &&
    request.source.sizeBytes === output.sizeBytes &&
    request.source.durationSeconds === output.durationSeconds &&
    request.source.width === output.width &&
    request.source.height === output.height &&
    frameRatesEqual(request.source.frameRate, output.frameRate)
  );
}

function frameRateFromFps(fps: number): RationalFrameRate | null {
  if (!isPositiveFinite(fps)) return null;
  if (Number.isSafeInteger(fps)) {
    return Object.freeze({ numerator: fps, denominator: 1 });
  }
  const denominator = 1_000_000;
  const numerator = Math.round(fps * denominator);
  if (!isPositiveSafeInteger(numerator)) return null;
  const divisor = greatestCommonDivisor(numerator, denominator);
  return Object.freeze({
    numerator: numerator / divisor,
    denominator: denominator / divisor,
  });
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function frameRatesEqual(
  left: RationalFrameRate,
  right: RationalFrameRate,
): boolean {
  return (
    left.numerator === right.numerator && left.denominator === right.denominator
  );
}

function isFrameRate(value: unknown): value is RationalFrameRate {
  const record = snapshotJsonRecord(value);
  return Boolean(
    record &&
    isPositiveSafeInteger(record.numerator) &&
    isPositiveSafeInteger(record.denominator),
  );
}

async function safeFileStat(
  filePath: string,
): Promise<{ readonly size: number } | null> {
  try {
    const result = await stat(filePath);
    return result.isFile() && isPositiveSafeInteger(result.size)
      ? { size: result.size }
      : null;
  } catch {
    return null;
  }
}

function snapshotJsonRecord(value: unknown): Record<string, unknown> | null {
  const counter = { entries: 0 };
  const snapshot = snapshotJson(value, 0, counter);
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? (snapshot as Record<string, unknown>)
    : null;
}

function snapshotJson(
  value: unknown,
  depth: number,
  counter: { entries: number },
): unknown {
  if (depth > MAX_JSON_DEPTH || counter.entries > MAX_JSON_ENTRIES) return null;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const entry of value) {
      counter.entries += 1;
      const copied = snapshotJson(entry, depth + 1, counter);
      if (copied === null && entry !== null) return null;
      result.push(copied);
    }
    return result;
  }
  if (!value || typeof value !== "object") return null;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    counter.entries += 1;
    const copied = snapshotJson(entry, depth + 1, counter);
    if (copied === null && entry !== null) return null;
    result[key] = copied;
  }
  return result;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson(
          (value as Record<string, unknown>)[key],
        )}`,
    )
    .join(",")}}`;
}

function isOpaqueId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    value.trim() === value &&
    !/[\r\n\0]/u.test(value)
  );
}

function isNullableOpaqueId(value: unknown): value is string | null {
  return value === null || isOpaqueId(value);
}

function isIdempotencyKey(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length > 0 &&
      value.length <= MAX_IDEMPOTENCY_KEY_LENGTH &&
      value.trim() === value &&
      !/[\r\n\0]/u.test(value))
  );
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function optionalNonnegative(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && value >= 0);
}

function optionalPositive(value: unknown): boolean {
  return value === undefined || isPositiveSafeInteger(value);
}

function optionalBoundedPercent(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 100)
  );
}

function conflict(message: string): VideoEnhancementRuntimePortError {
  return new VideoEnhancementRuntimePortError(
    "id_conflict",
    message,
    false,
    "preflight",
  );
}

function invalidRequest(message: string): VideoEnhancementRuntimePortError {
  return new VideoEnhancementRuntimePortError(
    "invalid_request",
    message,
    false,
    "preflight",
  );
}

function invalidCompletion(message: string): VideoEnhancementRuntimePortError {
  return new VideoEnhancementRuntimePortError(
    "provenance_failed",
    message,
    false,
    "provenance",
  );
}
