import { createHash } from "node:crypto";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type {
  VideoEnhancementError,
  VideoEnhancementProgress,
  VideoEnhancementRequest,
  VideoEnhancementResult,
  VideoEnhancementStagedSuccess,
  VideoSourceIdentity,
} from "../../core/video/VideoEnhancement";
import {
  createVideoEnhancementDurableProvenance,
  createVideoEnhancementEmbeddedProvenance,
  type VideoWorkflowMetadata,
} from "../../core/video/WorkflowMetadata";
import {
  VideoEnhancementRuntime,
  VideoEnhancementRuntimePortError,
  type EnqueueVideoEnhancementInput,
  type PublishedVideoEnhancementOutput,
  type StoredVideoEnhancementJob,
  type ValidatedVideoEnhancementMedia,
  type VideoEnhancementAtomicCompletionInput,
  type VideoEnhancementGpuJobHandle,
  type VideoEnhancementMediaPort,
  type VideoEnhancementPublicationPort,
  type VideoEnhancementQueueEnqueueInput,
  type VideoEnhancementQueueFinishInput,
  type VideoEnhancementQueuePort,
  type VideoEnhancementRuntimeClock,
  type VideoEnhancementSchedulerPort,
  type VideoEnhancementServicePort,
  type VideoEnhancementStoragePort,
  type VideoGenerationOutputSnapshot,
} from "../sidecar/src/video/VideoEnhancementRuntime";

const SOURCE_PATH = path.resolve("fixtures/source-video.mp4");
const STAGED_PATH = path.resolve("fixtures/staged-enhancement.mp4");
const METADATA_STAGED_PATH = path.resolve(
  "fixtures/staged-enhancement.metadata.mp4",
);
const PUBLISHED_PATH = path.resolve("outputs/enhancement-child-1.mp4");
const SOURCE_BYTES = Buffer.from("deterministic-original-video-bytes");
const ENHANCED_BYTES = Buffer.from("deterministic-enhanced-video-bytes");
const PUBLISHED_BYTES = Buffer.from(
  "deterministic-enhanced-video-bytes-with-embedded-provenance",
);
const SOURCE_HASH = sha256(SOURCE_BYTES);
const PRE_PROVENANCE_HASH = sha256(ENHANCED_BYTES);
const OUTPUT_HASH = sha256(PUBLISHED_BYTES);
const NOW = new Date("2026-08-28T12:00:00.000Z");

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function generationOutput(
  overrides: Partial<VideoGenerationOutputSnapshot> = {},
): VideoGenerationOutputSnapshot {
  return {
    outputId: "source-output-1",
    generationId: "parent-video-1",
    jobState: "done",
    pillar: "video",
    mediaType: "video/mp4",
    path: SOURCE_PATH,
    contentHash: SOURCE_HASH,
    sizeBytes: SOURCE_BYTES.length,
    durationSeconds: 2,
    width: 640,
    height: 360,
    frameRate: { numerator: 24, denominator: 1 },
    workflow: { kind: "video", modelId: "qwen-video" },
    threadId: "thread-1",
    ...overrides,
  };
}

function enqueueInput(
  overrides: Partial<EnqueueVideoEnhancementInput> = {},
): EnqueueVideoEnhancementInput {
  return {
    parentJobId: "parent-video-1",
    sourceOutputId: "source-output-1",
    mode: "upscale",
    upscalePreset: "animation-upscale-2x",
    timeoutMs: 60_000,
    ...overrides,
  };
}

function runtimeIssue(
  code: VideoEnhancementError["code"] | "interrupted",
  retryable = true,
) {
  return {
    code,
    message: `test ${code}`,
    retryable,
    stage: "preflight" as const,
    diagnostics: null,
    terminationConfirmed: null,
  };
}

function coreIssue(code: VideoEnhancementError["code"]): VideoEnhancementError {
  return {
    code,
    message: `test ${code}`,
    retryable: true,
    stage: "preflight",
    diagnostics: null,
    terminationConfirmed: null,
  };
}

class FakeQueue implements VideoEnhancementQueuePort {
  readonly jobs = new Map<string, StoredVideoEnhancementJob>();
  readonly progressWrites: VideoEnhancementProgress[] = [];
  readonly finishes: VideoEnhancementQueueFinishInput[] = [];
  rejectProgress = false;
  throwProgress = false;

  async enqueueEnhancement(
    input: VideoEnhancementQueueEnqueueInput,
  ): Promise<{ created: boolean; job: StoredVideoEnhancementJob }> {
    if (input.idempotencyKey) {
      const existing = [...this.jobs.values()].find(
        (job) =>
          job.parentJobId === input.parentJobId &&
          job.sourceOutputId === input.sourceOutputId &&
          job.idempotencyKey === input.idempotencyKey,
      );
      if (existing) return { created: false, job: existing };
    }
    const collision = this.jobs.get(input.childJobId);
    if (collision) return { created: false, job: collision };
    const job: StoredVideoEnhancementJob = {
      ...input,
      state: "queued",
      cancelRequested: false,
      progress: null,
      error: null,
      output: null,
      startedAt: null,
      finishedAt: null,
    };
    this.jobs.set(job.childJobId, job);
    return { created: true, job };
  }

  async getEnhancement(
    childJobId: string,
  ): Promise<StoredVideoEnhancementJob | null> {
    return this.jobs.get(childJobId) ?? null;
  }

  async persistEnhancementProgress(input: {
    childJobId: string;
    progress: VideoEnhancementProgress;
  }): Promise<boolean> {
    if (this.throwProgress) throw new Error("progress storage unavailable");
    const job = this.jobs.get(input.childJobId);
    if (
      !job ||
      job.state !== "running" ||
      job.cancelRequested ||
      this.rejectProgress
    ) {
      return false;
    }
    this.progressWrites.push(input.progress);
    this.jobs.set(job.childJobId, { ...job, progress: input.progress });
    return true;
  }

  async requestEnhancementCancellation(input: {
    childJobId: string;
    requestedAt: string;
  }): Promise<StoredVideoEnhancementJob | null> {
    const job = this.jobs.get(input.childJobId);
    if (!job) return null;
    if (terminal(job.state)) return job;
    const cancelled: StoredVideoEnhancementJob = {
      ...job,
      cancelRequested: true,
    };
    this.jobs.set(job.childJobId, cancelled);
    return cancelled;
  }

  async finishEnhancement(
    input: VideoEnhancementQueueFinishInput,
  ): Promise<StoredVideoEnhancementJob | null> {
    this.finishes.push(input);
    const job = this.jobs.get(input.childJobId);
    if (!job) return null;
    if (terminal(job.state)) return job;
    if (
      !input.expectedStates.includes(
        job.state as "queued" | "running" | "interrupted",
      )
    ) {
      return job;
    }
    const finished: StoredVideoEnhancementJob = {
      ...job,
      state: input.state,
      error: input.error,
      finishedAt: input.finishedAt,
    };
    this.jobs.set(job.childJobId, finished);
    return finished;
  }

  claim(childJobId: string): StoredVideoEnhancementJob {
    const job = this.require(childJobId);
    const running: StoredVideoEnhancementJob = {
      ...job,
      state: "running",
      startedAt: NOW.toISOString(),
    };
    this.jobs.set(childJobId, running);
    return running;
  }

  interrupt(childJobId: string): StoredVideoEnhancementJob {
    const job = this.require(childJobId);
    const interrupted: StoredVideoEnhancementJob = {
      ...job,
      state: "interrupted",
      error: runtimeIssue("interrupted"),
      finishedAt: NOW.toISOString(),
    };
    this.jobs.set(childJobId, interrupted);
    return interrupted;
  }

  succeed(
    childJobId: string,
    output: PublishedVideoEnhancementOutput,
    finishedAt: string,
  ): StoredVideoEnhancementJob {
    const job = this.require(childJobId);
    const succeeded: StoredVideoEnhancementJob = {
      ...job,
      state: "succeeded",
      output,
      error: null,
      finishedAt,
    };
    this.jobs.set(childJobId, succeeded);
    return succeeded;
  }

  private require(childJobId: string): StoredVideoEnhancementJob {
    const job = this.jobs.get(childJobId);
    if (!job) throw new Error(`missing fake job ${childJobId}`);
    return job;
  }
}

function terminal(state: StoredVideoEnhancementJob["state"]): boolean {
  return !["queued", "running"].includes(state);
}

class FakeStorage implements VideoEnhancementStoragePort {
  output: VideoGenerationOutputSnapshot | null = generationOutput();
  readonly completions: VideoEnhancementAtomicCompletionInput[] = [];
  rejectCompletion = false;
  nullReadbackAfterCommit = false;
  beforeComplete: (() => void | Promise<void>) | null = null;
  completionGate: Promise<void> | null = null;

  constructor(private readonly queue: FakeQueue) {}

  async getGenerationOutput(
    parentJobId: string,
    outputId: string,
  ): Promise<VideoGenerationOutputSnapshot | null> {
    if (
      !this.output ||
      this.output.generationId !== parentJobId ||
      this.output.outputId !== outputId
    ) {
      return null;
    }
    return this.output;
  }

  async completeEnhancement(
    input: VideoEnhancementAtomicCompletionInput,
  ): Promise<{ committed: boolean; job: StoredVideoEnhancementJob | null }> {
    await this.completionGate;
    await this.beforeComplete?.();
    this.completions.push(input);
    const job = this.queue.jobs.get(input.childJobId) ?? null;
    if (
      this.rejectCompletion ||
      !job ||
      job.state !== input.expectedState ||
      job.cancelRequested
    ) {
      return { committed: false, job };
    }
    const succeeded = this.queue.succeed(
      input.childJobId,
      input.output,
      input.finishedAt,
    );
    return {
      committed: true,
      job: this.nullReadbackAfterCommit ? null : succeeded,
    };
  }
}

class FakeMedia implements VideoEnhancementMediaPort {
  readonly sourceBytes = Buffer.from(SOURCE_BYTES);
  verifyCalls = 0;
  validateError: Error | null = null;
  overrideVerified: VideoSourceIdentity | null = null;
  preparedOverrides: Partial<ValidatedVideoEnhancementMedia> = {};

  async verifySource(
    expected: VideoSourceIdentity,
  ): Promise<VideoSourceIdentity> {
    this.verifyCalls += 1;
    if (this.overrideVerified) return this.overrideVerified;
    return {
      ...expected,
      sha256: sha256(this.sourceBytes),
      sizeBytes: this.sourceBytes.length,
      frameRate: { ...expected.frameRate },
    };
  }

  async validateAndWriteProvenance(input: {
    job: StoredVideoEnhancementJob;
    staged: VideoEnhancementStagedSuccess;
  }): Promise<ValidatedVideoEnhancementMedia> {
    if (this.validateError) throw this.validateError;
    return validatedMedia(input.job, input.staged, this.preparedOverrides);
  }
}

function validatedMedia(
  job: StoredVideoEnhancementJob,
  staged: VideoEnhancementStagedSuccess,
  overrides: Partial<ValidatedVideoEnhancementMedia> = {},
): ValidatedVideoEnhancementMedia {
  const embeddedProvenance = createVideoEnhancementEmbeddedProvenance({
    schemaVersion: 1,
    nexusRelease: "v2.3.0",
    provenanceRecordId: `provenance-${job.childJobId}`,
    parentJobId: job.parentJobId,
    requestId: job.request.requestId,
    childJobId: job.childJobId,
    mode: job.request.mode,
    upscalePreset: job.request.upscalePreset ?? null,
    interpolationPreset: job.request.interpolationPreset ?? null,
    presetRouting: "explicit",
    source: {
      generationId: job.sourceOutput.generationId,
      outputId: job.sourceOutputId,
      sha256: job.sourceOutput.contentHash,
      sizeBytes: job.sourceOutput.sizeBytes,
      durationSeconds: job.sourceOutput.durationSeconds,
      width: job.sourceOutput.width,
      height: job.sourceOutput.height,
      frameRate: job.sourceOutput.frameRate,
    },
    output: {
      preProvenanceContainerSha256: PRE_PROVENANCE_HASH,
      sizeBytes: ENHANCED_BYTES.length,
      durationSeconds: 2,
      width: 1280,
      height: 720,
      frameRate: { numerator: 24, denominator: 1 },
      frameCount: 48,
    },
    backend: staged.backend,
    execution: staged.execution,
    stages: staged.stages,
    validation: {
      containerReadable: true,
      videoStreamReadable: true,
      positiveSize: true,
      positiveDuration: true,
      dimensionsMatch: true,
      frameRateMatch: true,
      durationWithinTolerance: true,
      durationToleranceSeconds: 0.25,
      frameCount: "observed",
      audioPreservation: "preserved",
      subtitlePreservation: "not_observed",
    },
    startedAt: staged.startedAt,
    completedAt: staged.completedAt,
    durationMs: staged.durationMs,
    outcome: "completed",
  });
  const durableProvenance = createVideoEnhancementDurableProvenance(
    embeddedProvenance,
    OUTPUT_HASH,
  );
  const embeddedWorkflow: VideoWorkflowMetadata = {
    tool: "nexus",
    version: "2.3.0",
    kind: "video",
    mode: "text2video",
    modelId: "qwen-video",
    prompt: "deterministic runtime fixture",
    width: 640,
    height: 360,
    durationSeconds: 2,
    fps: 24,
    frameCount: 48,
    steps: 20,
    cfgScale: 3.5,
    sampler: "euler",
    seed: 17,
    timestamp: NOW.toISOString(),
    enhancement: embeddedProvenance,
  };
  return {
    stagedPath: METADATA_STAGED_PATH.replace(
      "staged-enhancement",
      job.childJobId,
    ),
    contentHash: OUTPUT_HASH,
    sizeBytes: PUBLISHED_BYTES.length,
    durationSeconds: 2,
    width: 1280,
    height: 720,
    frameRate: { numerator: 24, denominator: 1 },
    provenanceRecordId: embeddedProvenance.provenanceRecordId,
    preProvenanceContainerSha256: PRE_PROVENANCE_HASH,
    publishedContainerSha256: OUTPUT_HASH,
    embeddedWorkflow,
    durableProvenance,
    ...overrides,
  };
}

class FakePublication implements VideoEnhancementPublicationPort {
  readonly published: string[] = [];
  readonly validatedInputs: ValidatedVideoEnhancementMedia[] = [];
  readonly quarantined: PublishedVideoEnhancementOutput[] = [];
  override: Partial<PublishedVideoEnhancementOutput> = {};
  onPublish: (() => void) | null = null;

  async publish(input: {
    childJobId: string;
    desiredOutputId: string;
    validated: ValidatedVideoEnhancementMedia;
  }): Promise<PublishedVideoEnhancementOutput> {
    this.published.push(input.childJobId);
    this.validatedInputs.push(input.validated);
    this.onPublish?.();
    return {
      outputId: input.desiredOutputId,
      path: PUBLISHED_PATH.replace("child-1", input.childJobId),
      contentHash: input.validated.contentHash,
      sizeBytes: input.validated.sizeBytes,
      durationSeconds: input.validated.durationSeconds,
      width: input.validated.width,
      height: input.validated.height,
      frameRate: input.validated.frameRate,
      workflow: input.validated.embeddedWorkflow,
      provenanceRecordId: input.validated.provenanceRecordId,
      preProvenanceContainerSha256:
        input.validated.preProvenanceContainerSha256,
      publishedContainerSha256: input.validated.publishedContainerSha256,
      embeddedWorkflow: input.validated.embeddedWorkflow,
      durableProvenance: input.validated.durableProvenance,
      ...this.override,
    };
  }

  async quarantine(input: {
    output: PublishedVideoEnhancementOutput;
  }): Promise<void> {
    this.quarantined.push(input.output);
  }
}

class FakeScheduler implements VideoEnhancementSchedulerPort {
  readonly jobs = new Map<
    string,
    { controller: AbortController; handle: VideoEnhancementGpuJobHandle }
  >();
  rejectAdmission = false;

  async enqueue(job: {
    id: string;
    run: (signal: AbortSignal) => Promise<unknown>;
  }): Promise<VideoEnhancementGpuJobHandle> {
    if (this.rejectAdmission) throw new Error("no VRAM");
    const controller = new AbortController();
    let state: ReturnType<VideoEnhancementGpuJobHandle["state"]> = "queued";
    const completion = Promise.resolve().then(async () => {
      state = "running";
      try {
        const value = await job.run(controller.signal);
        state = controller.signal.aborted ? "cancelled" : "completed";
        return value;
      } catch (error) {
        state = controller.signal.aborted ? "cancelled" : "failed";
        throw error;
      }
    });
    const handle: VideoEnhancementGpuJobHandle = {
      completion,
      cancel: () => {
        controller.abort();
      },
      state: () => state,
    };
    this.jobs.set(job.id, { controller, handle });
    return handle;
  }
}

class FakeService implements VideoEnhancementServicePort {
  readonly calls: Array<{
    request: VideoEnhancementRequest;
    context: Parameters<VideoEnhancementServicePort["run"]>[1];
  }> = [];
  hook: (
    request: VideoEnhancementRequest,
    context: Parameters<VideoEnhancementServicePort["run"]>[1],
  ) => Promise<VideoEnhancementResult> = async (request, context) => {
    context.onProgress?.(progress(request, context.childJobId, 25));
    context.onProgress?.(progress(request, context.childJobId, 75));
    return stagedSuccess(request, context.childJobId);
  };

  async run(
    input: unknown,
    context: Parameters<VideoEnhancementServicePort["run"]>[1],
  ): Promise<VideoEnhancementResult> {
    const request = input as VideoEnhancementRequest;
    this.calls.push({ request, context });
    return this.hook(request, context);
  }
}

function progress(
  request: VideoEnhancementRequest,
  childJobId: string,
  percent: number,
): VideoEnhancementProgress {
  return {
    requestId: request.requestId,
    childJobId,
    stage: "upscale",
    stageIndex: 1,
    stageCount: 1,
    processedFrames: percent,
    totalFrames: 100,
    percent,
    message: `Upscaling ${percent}%`,
  };
}

function stagedSuccess(
  request: VideoEnhancementRequest,
  childJobId: string,
): VideoEnhancementStagedSuccess {
  return {
    ok: true,
    outcome: "staged",
    requestId: request.requestId,
    parentJobId: request.parentJobId,
    childJobId,
    source: request.source,
    stagedPath: STAGED_PATH,
    backend: {
      id: "video2x",
      compatibilityId: "video2x-6.4.0",
      version: "6.4.0",
      executableSha256: "c".repeat(64),
      provenance: "user-supplied-unverified",
      configurationSource: "setting",
    },
    stages: [
      {
        stageIndex: 1,
        parameters: {
          stage: "upscale",
          presetId: "animation-upscale-2x",
          contentClass: "animation",
          scaleFactor: 2,
        },
        backend: {
          processor: "realesrgan",
          model: "realesr-animevideov3",
          normalizedArguments: { scaleFactor: 2 },
        },
        startedAt: "2026-08-28T12:00:00.000Z",
        completedAt: "2026-08-28T12:00:01.000Z",
        durationMs: 1_000,
        exitCode: 0,
        outcome: "staged",
      },
    ],
    execution: {
      platform: { os: "win32", architecture: "x64", avx2: "available" },
      selectedDevice: { id: 0, type: "discrete_gpu", name: "Test GPU" },
    },
    startedAt: "2026-08-28T12:00:00.000Z",
    completedAt: "2026-08-28T12:00:01.000Z",
    durationMs: 1_000,
    warnings: [],
    progress: { percent: 100, processedFrames: 100, totalFrames: 100 },
  };
}

class FakeClock implements VideoEnhancementRuntimeClock {
  callback: (() => void) | null = null;
  delayMs: number | null = null;
  cleared = false;

  now(): Date {
    return new Date(NOW);
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    this.callback = callback;
    this.delayMs = delayMs;
    return "deadline-token";
  }

  clearTimeout(): void {
    this.cleared = true;
  }

  fire(): void {
    this.callback?.();
  }
}

interface Harness {
  readonly runtime: VideoEnhancementRuntime;
  readonly queue: FakeQueue;
  readonly storage: FakeStorage;
  readonly scheduler: FakeScheduler;
  readonly service: FakeService;
  readonly media: FakeMedia;
  readonly publication: FakePublication;
  readonly clock: FakeClock;
}

function harness(ids: string[] = ["enhancement-child-1"]): Harness {
  const queue = new FakeQueue();
  const storage = new FakeStorage(queue);
  const scheduler = new FakeScheduler();
  const service = new FakeService();
  const media = new FakeMedia();
  const publication = new FakePublication();
  const clock = new FakeClock();
  const idQueue = [...ids];
  const runtime = new VideoEnhancementRuntime({
    queue,
    storage,
    scheduler,
    service,
    media,
    publication,
    clock,
    childIdFactory: () =>
      idQueue.shift() ?? `enhancement-child-${idQueue.length}`,
    requestIdFactory: (childJobId) =>
      `00000000-0000-4000-8000-${sha256(Buffer.from(childJobId)).slice(0, 12)}`,
  });
  return {
    runtime,
    queue,
    storage,
    scheduler,
    service,
    media,
    publication,
    clock,
  };
}

async function enqueueAndClaim(
  state: Harness,
  input: EnqueueVideoEnhancementInput = enqueueInput(),
): Promise<StoredVideoEnhancementJob> {
  const result = await state.runtime.enqueue(input);
  if (!result.ok) throw new Error(result.error.message);
  return state.queue.claim(result.job.childJobId);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("VideoEnhancementRuntime enqueue", () => {
  it("rejects missing, incomplete, and non-video source outputs", async () => {
    const state = harness(["one", "two", "three"]);
    state.storage.output = null;
    expect(await state.runtime.enqueue(enqueueInput())).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });

    state.storage.output = generationOutput({ jobState: "running" });
    expect(await state.runtime.enqueue(enqueueInput())).toMatchObject({
      ok: false,
      error: { code: "ineligible_source" },
    });

    state.storage.output = generationOutput({
      pillar: "image",
      mediaType: "image/png",
    });
    expect(await state.runtime.enqueue(enqueueInput())).toMatchObject({
      ok: false,
      error: { code: "ineligible_source" },
    });
    expect(state.queue.jobs.size).toBe(0);
  });

  it("persists immutable source facts under a child identity distinct from the parent", async () => {
    const state = harness();
    const source = state.storage.output as VideoGenerationOutputSnapshot;
    const result = await state.runtime.enqueue(enqueueInput());
    expect(result).toMatchObject({
      ok: true,
      created: true,
      job: {
        childJobId: "enhancement-child-1",
        parentJobId: "parent-video-1",
        sourceOutputId: "source-output-1",
        state: "queued",
      },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.job.request.source).toEqual({
      path: SOURCE_PATH,
      sha256: SOURCE_HASH,
      sizeBytes: SOURCE_BYTES.length,
      durationSeconds: 2,
      width: 640,
      height: 360,
      frameRate: { numerator: 24, denominator: 1 },
    });
    (source.workflow as Record<string, unknown>).modelId =
      "mutated-after-enqueue";
    expect(result.job.sourceOutput.workflow.modelId).toBe("qwen-video");
    expect(result.job.childJobId).not.toBe(result.job.parentJobId);
  });

  it("deduplicates only with an explicit idempotency key and otherwise isolates children", async () => {
    const state = harness(["child-a", "child-b", "child-c"]);
    const first = await state.runtime.enqueue(
      enqueueInput({ idempotencyKey: "same-click" }),
    );
    const duplicate = await state.runtime.enqueue(
      enqueueInput({ idempotencyKey: "same-click" }),
    );
    const independent = await state.runtime.enqueue(enqueueInput());
    expect(first).toMatchObject({ ok: true, created: true });
    expect(duplicate).toMatchObject({
      ok: true,
      created: false,
      job: { childJobId: "child-a" },
    });
    expect(independent).toMatchObject({
      ok: true,
      created: true,
      job: { childJobId: "child-c" },
    });
    expect(state.queue.jobs.size).toBe(2);
  });

  it("records explicit retry lineage only from a retryable terminal child", async () => {
    const state = harness(["failed-child", "retry-child"]);
    const first = await state.runtime.enqueue(enqueueInput());
    if (!first.ok) throw new Error(first.error.message);
    state.queue.claim(first.job.childJobId);
    await state.queue.finishEnhancement({
      childJobId: first.job.childJobId,
      expectedStates: ["running"],
      state: "failed",
      error: runtimeIssue("backend_unavailable"),
      finishedAt: NOW.toISOString(),
    });
    const retry = await state.runtime.enqueue(
      enqueueInput({ retryOfChildJobId: first.job.childJobId }),
    );
    expect(retry).toMatchObject({
      ok: true,
      job: {
        childJobId: "retry-child",
        attempt: 2,
        retryOfChildJobId: "failed-child",
      },
    });
  });
});

describe("VideoEnhancementRuntime execution", () => {
  it("persists ordered progress and commits output, lineage, and outbox atomically", async () => {
    const state = harness();
    const job = await enqueueAndClaim(state);
    const outcome = await state.runtime.runClaimed(job.childJobId);
    expect(outcome).toMatchObject({
      ok: true,
      state: "succeeded",
      childJobId: job.childJobId,
      output: {
        outputId: `${job.childJobId}:output`,
        contentHash: OUTPUT_HASH,
      },
    });
    expect(state.queue.progressWrites.map((event) => event.percent)).toEqual([
      25, 75,
    ]);
    expect(state.scheduler.jobs.has(job.childJobId)).toBe(true);
    expect(state.media.verifyCalls).toBe(2);
    expect(state.publication.published).toEqual([job.childJobId]);
    const prepared = state.publication.validatedInputs[0]!;
    expect(prepared.stagedPath).not.toBe(STAGED_PATH);
    expect(prepared.stagedPath).toBe(
      METADATA_STAGED_PATH.replace("staged-enhancement", job.childJobId),
    );
    expect(prepared.preProvenanceContainerSha256).toBe(PRE_PROVENANCE_HASH);
    expect(prepared.publishedContainerSha256).toBe(OUTPUT_HASH);
    expect(state.storage.completions).toHaveLength(1);
    const completion = state.storage.completions[0]!;
    expect(completion).toMatchObject({
      childJobId: job.childJobId,
      expectedState: "running",
      provenanceRecordId: prepared.provenanceRecordId,
      output: {
        outputId: `${job.childJobId}:output`,
        preProvenanceContainerSha256: PRE_PROVENANCE_HASH,
        publishedContainerSha256: OUTPUT_HASH,
      },
      enhancement: {
        childJobId: job.childJobId,
        sourceGenerationId: "parent-video-1",
        sourceOutputId: "source-output-1",
        sourceContentHash: SOURCE_HASH,
        outputContentHash: OUTPUT_HASH,
        provenanceRecordId: prepared.provenanceRecordId,
        preProvenanceContainerSha256: PRE_PROVENANCE_HASH,
        publishedContainerSha256: OUTPUT_HASH,
        outcome: "succeeded",
      },
      outbox: {
        eventType: "video.enhancement.completed",
        aggregateId: job.childJobId,
        threadId: "thread-1",
        payload: {
          provenanceRecordId: prepared.provenanceRecordId,
          preProvenanceContainerSha256: PRE_PROVENANCE_HASH,
          publishedContainerSha256: OUTPUT_HASH,
        },
      },
    });
    expect(completion.embeddedWorkflow).toEqual(prepared.embeddedWorkflow);
    expect(completion.durableProvenance).toEqual(prepared.durableProvenance);
    expect(completion.output.workflow).toEqual(prepared.embeddedWorkflow);
    expect(completion.output.durableProvenance).toEqual(
      prepared.durableProvenance,
    );
    expect(completion.enhancement.embeddedWorkflow).toEqual(
      prepared.embeddedWorkflow,
    );
    expect(completion.enhancement.durableProvenance).toEqual(
      prepared.durableProvenance,
    );
    expect(state.media.sourceBytes).toEqual(SOURCE_BYTES);
    expect(state.clock.cleared).toBe(true);
  });

  it("does not report success until the one atomic completion call resolves", async () => {
    const state = harness();
    const gate = deferred<void>();
    state.storage.completionGate = gate.promise;
    const job = await enqueueAndClaim(state);
    let settled = false;
    const running = state.runtime.runClaimed(job.childJobId).then((value) => {
      settled = true;
      return value;
    });
    await vi.waitFor(() => expect(state.publication.published).toHaveLength(1));
    expect(settled).toBe(false);
    expect(state.queue.jobs.get(job.childJobId)?.state).toBe("running");
    gate.resolve();
    await expect(running).resolves.toMatchObject({
      ok: true,
      state: "succeeded",
    });
  });

  it("keeps committed success authoritative when the post-commit readback is unavailable", async () => {
    const state = harness();
    state.storage.nullReadbackAfterCommit = true;
    const job = await enqueueAndClaim(state);

    await expect(
      state.runtime.runClaimed(job.childJobId),
    ).resolves.toMatchObject({
      ok: true,
      state: "succeeded",
      output: { outputId: `${job.childJobId}:output` },
    });
    expect(state.queue.jobs.get(job.childJobId)?.state).toBe("succeeded");
    expect(state.publication.quarantined).toHaveLength(0);
  });

  it("lets a durable cancellation beat a late success and quarantines the output", async () => {
    const state = harness();
    const job = await enqueueAndClaim(state);
    state.storage.beforeComplete = async () => {
      await state.queue.requestEnhancementCancellation({
        childJobId: job.childJobId,
        requestedAt: NOW.toISOString(),
      });
    };
    const outcome = await state.runtime.runClaimed(job.childJobId);
    expect(outcome).toMatchObject({ ok: false, state: "cancelled" });
    expect(state.publication.quarantined).toHaveLength(1);
    expect(state.queue.jobs.get(job.childJobId)?.state).toBe("cancelled");
  });

  it("cancels only the selected active child and retains both scheduler signals", async () => {
    const state = harness(["child-a", "child-b"]);
    const gateA = deferred<VideoEnhancementResult>();
    const gateB = deferred<VideoEnhancementResult>();
    state.service.hook = async (request, context) => {
      return context.childJobId === "child-a"
        ? gateA.promise
        : gateB.promise.then(() => stagedSuccess(request, context.childJobId));
    };
    const first = await enqueueAndClaim(state);
    const second = await enqueueAndClaim(state);
    const firstRun = state.runtime.runClaimed(first.childJobId);
    const secondRun = state.runtime.runClaimed(second.childJobId);
    await vi.waitFor(() => expect(state.service.calls).toHaveLength(2));
    expect(state.runtime.activeCount()).toBe(2);
    const firstSignal = state.runtime.activeSignal(first.childJobId);
    const secondSignal = state.runtime.activeSignal(second.childJobId);
    const cancelling = state.runtime.cancel(first.childJobId);
    await vi.waitFor(() => expect(firstSignal?.aborted).toBe(true));
    expect(secondSignal?.aborted).toBe(false);
    gateA.resolve({
      ok: false,
      requestId: first.request.requestId,
      parentJobId: first.parentJobId,
      childJobId: first.childJobId,
      error: coreIssue("cancelled"),
    });
    await expect(cancelling).resolves.toMatchObject({
      ok: false,
      state: "cancelled",
    });
    await expect(firstRun).resolves.toMatchObject({
      ok: false,
      state: "cancelled",
    });
    gateB.resolve(stagedSuccess(second.request, second.childJobId));
    await expect(secondRun).resolves.toMatchObject({
      ok: true,
      state: "succeeded",
    });
  });

  it("waits for and persists unconfirmed native termination before cancellation returns", async () => {
    const state = harness();
    const gate = deferred<VideoEnhancementResult>();
    state.service.hook = async () => gate.promise;
    const job = await enqueueAndClaim(state);
    const running = state.runtime.runClaimed(job.childJobId);
    await vi.waitFor(() => expect(state.service.calls).toHaveLength(1));

    const cancelling = state.runtime.cancel(job.childJobId);
    await vi.waitFor(() =>
      expect(state.runtime.activeSignal(job.childJobId)?.aborted).toBe(true),
    );
    gate.resolve({
      ok: false,
      requestId: job.request.requestId,
      parentJobId: job.parentJobId,
      childJobId: job.childJobId,
      error: {
        code: "cancelled",
        message: "The process termination could not be confirmed.",
        retryable: true,
        stage: "upscale",
        diagnostics: "guarded runner lost the process handle",
        terminationConfirmed: false,
      },
    });

    const expected = {
      ok: false,
      state: "cancelled",
      error: {
        code: "cancelled",
        stage: "upscale",
        diagnostics: "guarded runner lost the process handle",
        terminationConfirmed: false,
      },
    } as const;
    await expect(cancelling).resolves.toMatchObject(expected);
    await expect(running).resolves.toMatchObject(expected);
    expect(state.queue.jobs.get(job.childJobId)?.error).toMatchObject(
      expected.error,
    );
  });

  it("marks active work interrupted on shutdown without cancelling queued children", async () => {
    const state = harness(["active-child", "queued-child"]);
    const gate = deferred<VideoEnhancementResult>();
    state.service.hook = async () => gate.promise;
    const active = await enqueueAndClaim(state);
    const queued = await state.runtime.enqueue(enqueueInput());
    if (!queued.ok) throw new Error(queued.error.message);
    const running = state.runtime.runClaimed(active.childJobId);
    await vi.waitFor(() => expect(state.service.calls).toHaveLength(1));
    const signal = state.runtime.activeSignal(active.childJobId);

    let shutdownSettled = false;
    const shutdown = state.runtime.shutdown().then(() => {
      shutdownSettled = true;
    });

    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    expect(shutdownSettled).toBe(false);
    expect(state.queue.jobs.get(active.childJobId)).toMatchObject({
      state: "interrupted",
      error: { code: "interrupted", retryable: true },
    });
    expect(state.queue.jobs.get(queued.job.childJobId)?.state).toBe("queued");
    gate.resolve(stagedSuccess(active.request, active.childJobId));
    await expect(shutdown).resolves.toBeUndefined();
    await expect(running).resolves.toMatchObject({
      ok: false,
      state: "interrupted",
    });
    await expect(state.runtime.shutdown()).resolves.toBeUndefined();
  });

  it("times out an unresponsive service and ignores its late staged success", async () => {
    const state = harness();
    const gate = deferred<VideoEnhancementResult>();
    state.service.hook = async () => gate.promise;
    const job = await enqueueAndClaim(state);
    const running = state.runtime.runClaimed(job.childJobId);
    await vi.waitFor(() => expect(state.service.calls).toHaveLength(1));
    expect(state.clock.delayMs).toBe(60_000);
    state.clock.fire();
    gate.resolve(stagedSuccess(job.request, job.childJobId));
    await expect(running).resolves.toMatchObject({
      ok: false,
      state: "timed_out",
      error: { code: "process_timeout", retryable: true },
    });
    expect(
      state.scheduler.jobs.get(job.childJobId)?.controller.signal.aborted,
    ).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.publication.published).toHaveLength(0);
    expect(state.storage.completions).toHaveLength(0);
    expect(state.queue.jobs.get(job.childJobId)?.state).toBe("timed_out");
  });

  it("fails closed when durable progress persistence fails", async () => {
    const state = harness();
    state.queue.throwProgress = true;
    const job = await enqueueAndClaim(state);
    const outcome = await state.runtime.runClaimed(job.childJobId);
    expect(outcome).toMatchObject({
      ok: false,
      state: "failed",
      error: { code: "internal_error", retryable: true },
    });
    expect(state.publication.published).toHaveLength(0);
    expect(state.storage.completions).toHaveLength(0);
  });

  it("rejects changed source bytes before invoking the backend", async () => {
    const state = harness();
    const job = await enqueueAndClaim(state);
    state.media.sourceBytes[0] = state.media.sourceBytes[0] === 1 ? 2 : 1;
    const outcome = await state.runtime.runClaimed(job.childJobId);
    expect(outcome).toMatchObject({
      ok: false,
      state: "failed",
      error: { code: "source_changed", retryable: false },
    });
    expect(state.service.calls).toHaveLength(0);
  });

  it("withholds and quarantines an output if publication mutates the original", async () => {
    const state = harness();
    const job = await enqueueAndClaim(state);
    state.publication.onPublish = () => {
      state.media.sourceBytes[0] = 0xff;
    };
    const outcome = await state.runtime.runClaimed(job.childJobId);
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "source_changed" },
    });
    expect(state.publication.quarantined).toHaveLength(1);
    expect(state.storage.completions).toHaveLength(0);
  });

  it("maps media lifecycle failures and never publishes unvalidated media", async () => {
    const state = harness();
    state.media.validateError = new VideoEnhancementRuntimePortError(
      "provenance_failed",
      "workflow embedding failed",
      true,
      "provenance",
    );
    const job = await enqueueAndClaim(state);
    const outcome = await state.runtime.runClaimed(job.childJobId);
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "provenance_failed", retryable: true },
    });
    expect(state.publication.published).toHaveLength(0);
    expect(state.storage.completions).toHaveLength(0);
  });

  it("rejects a prepared result that reuses the backend staged path", async () => {
    const state = harness();
    state.media.preparedOverrides = { stagedPath: STAGED_PATH };
    const job = await enqueueAndClaim(state);
    const outcome = await state.runtime.runClaimed(job.childJobId);
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "output_invalid" },
    });
    expect(state.publication.published).toHaveLength(0);
    expect(state.storage.completions).toHaveLength(0);
  });

  it("rejects a publication path that aliases the source", async () => {
    const state = harness();
    state.publication.override = { path: SOURCE_PATH };
    const job = await enqueueAndClaim(state);
    const outcome = await state.runtime.runClaimed(job.childJobId);
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "publish_failed" },
    });
    expect(state.storage.completions).toHaveLength(0);
  });

  it("keeps interrupted work retryable without invoking the service", async () => {
    const state = harness();
    const queued = await state.runtime.enqueue(enqueueInput());
    if (!queued.ok) throw new Error(queued.error.message);
    state.queue.interrupt(queued.job.childJobId);
    await expect(
      state.runtime.runClaimed(queued.job.childJobId),
    ).resolves.toMatchObject({
      ok: false,
      state: "interrupted",
      error: { code: "interrupted", retryable: true },
    });
    await expect(
      state.runtime.recoverInterrupted(queued.job.childJobId),
    ).resolves.toMatchObject({ ok: false, state: "interrupted" });
    expect(state.service.calls).toHaveLength(0);
  });

  it("returns a retryable typed failure when GPU admission fails", async () => {
    const state = harness();
    state.scheduler.rejectAdmission = true;
    const job = await enqueueAndClaim(state);
    await expect(
      state.runtime.runClaimed(job.childJobId),
    ).resolves.toMatchObject({
      ok: false,
      state: "failed",
      error: { code: "backend_unavailable", retryable: true },
    });
    expect(state.service.calls).toHaveLength(0);
  });
});
