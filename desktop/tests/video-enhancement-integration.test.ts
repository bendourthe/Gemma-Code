import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  VideoEnhancementProgress,
  VideoEnhancementRequest,
  VideoEnhancementResult,
  VideoEnhancementStagedSuccess,
} from "../../core/video/VideoEnhancement";
import type { VideoWorkflowMetadata } from "../../core/video/WorkflowMetadata";
import {
  closeStudioRuntime,
  createStudioRuntime,
  type StudioRuntime,
} from "../sidecar/src/generations/studioRuntime";
import { VideoEnhancementMediaAdapter } from "../sidecar/src/video/VideoEnhancementMediaAdapter";
import {
  VideoEnhancementMediaLifecycle,
  type VideoFfmpegExecutionPort,
  type VideoFfprobeExecutionPort,
} from "../sidecar/src/video/VideoEnhancementMediaLifecycle";
import { VideoEnhancementPersistenceAdapter } from "../sidecar/src/video/VideoEnhancementPersistenceAdapter";
import {
  VideoEnhancementRuntime,
  type EnqueueVideoEnhancementInput,
  type StoredVideoEnhancementJob,
  type VideoEnhancementAtomicCompletionInput,
  type VideoEnhancementRuntimeClock,
  type VideoEnhancementServicePort,
} from "../sidecar/src/video/VideoEnhancementRuntime";

const SOURCE_WORKFLOW: VideoWorkflowMetadata = Object.freeze({
  tool: "nexus",
  version: "2.3.0",
  kind: "video",
  mode: "text2video",
  modelId: "qwen-video",
  prompt: "a fox under northern lights",
  width: 640,
  height: 360,
  durationSeconds: 4,
  fps: 24,
  frameCount: 96,
  steps: 30,
  cfgScale: 3.5,
  sampler: "euler",
  seed: 17,
  timestamp: "2026-08-28T00:00:00.000Z",
});

type BackendMode = "success" | "blocked" | "invalid-output";

interface IntegrationHarness {
  readonly directory: string;
  readonly dbPath: string;
  readonly sourcePath: string;
  readonly sourceBytes: Buffer;
  readonly parentJobId: string;
  readonly sourceOutputId: string;
  readonly studio: StudioRuntime;
  readonly persistence: VideoEnhancementPersistenceAdapter;
  readonly atomicCompletions: VideoEnhancementAtomicCompletionInput[];
  readonly media: VideoEnhancementMediaAdapter;
  readonly backend: IntegrationBackend;
  readonly clock: ManualClock;
  readonly runtime: VideoEnhancementRuntime;
  closed: boolean;
}

const harnesses: IntegrationHarness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.runtime.shutdown();
    await harness.media.shutdown();
    if (!harness.closed) await closeStudioRuntime(harness.studio);
    await fs.rm(harness.directory, { recursive: true, force: true });
  }
});

class IntegrationBackend implements VideoEnhancementServicePort {
  readonly modes = new Map<string, BackendMode>();
  readonly calls: string[] = [];
  readonly invalidOutputs = new Set<string>();
  active = 0;
  maxActive = 0;

  constructor(private readonly directory: string) {}

  async run(
    input: unknown,
    context: Parameters<VideoEnhancementServicePort["run"]>[1],
  ): Promise<VideoEnhancementResult> {
    const request = input as VideoEnhancementRequest;
    this.calls.push(context.childJobId);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      if (this.modes.get(context.childJobId) === "blocked") {
        await waitForAbort(context.signal);
        return failure(request, context.childJobId, "cancelled");
      }

      context.onProgress?.(progress(request, context.childJobId, 20));
      context.onProgress?.(progress(request, context.childJobId, 80));
      const stagedPath = path.join(
        this.directory,
        `${context.childJobId}.backend.mp4`,
      );
      await fs.writeFile(
        stagedPath,
        Buffer.from(`enhanced-video-bytes:${context.childJobId}`),
      );
      if (this.modes.get(context.childJobId) === "invalid-output") {
        this.invalidOutputs.add(path.resolve(stagedPath));
      }
      return stagedSuccess(request, context.childJobId, stagedPath);
    } finally {
      this.active -= 1;
    }
  }
}

class ManualClock implements VideoEnhancementRuntimeClock {
  private readonly callbacks = new Map<number, () => void>();
  private sequence = 0;

  now(): Date {
    return new Date("2026-08-28T12:00:02.000Z");
  }

  setTimeout(callback: () => void): number {
    this.sequence += 1;
    this.callbacks.set(this.sequence, callback);
    return this.sequence;
  }

  clearTimeout(token: unknown): void {
    this.callbacks.delete(Number(token));
  }

  fireAll(): void {
    for (const callback of [...this.callbacks.values()]) callback();
  }
}

async function createHarness(label: string): Promise<IntegrationHarness> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), `nexus-video-enhancement-integration-${label}-`),
  );
  const dbPath = path.join(directory, "studio.db");
  const sourcePath = path.join(directory, "source.mp4");
  const sourceBytes = Buffer.from(`deterministic-source-video:${label}`);
  await fs.writeFile(sourcePath, sourceBytes);

  const studio = createStudioRuntime({ dbPath, vramGB: 16 });
  const persistence = new VideoEnhancementPersistenceAdapter(
    studio.queue,
    studio.index,
  );
  const backend = new IntegrationBackend(directory);
  const media = createMediaAdapter(sourcePath, backend.invalidOutputs);
  const clock = new ManualClock();
  const atomicCompletions: VideoEnhancementAtomicCompletionInput[] = [];
  const ids = [
    `enhancement-${label}-one`,
    `enhancement-${label}-two`,
    `enhancement-${label}-three`,
  ];
  let requestSequence = 0;
  const runtime = new VideoEnhancementRuntime({
    queue: persistence,
    storage: {
      getGenerationOutput: (parentJobId, outputId) =>
        persistence.getGenerationOutput(parentJobId, outputId),
      completeEnhancement: (input) => {
        atomicCompletions.push(input);
        return persistence.completeEnhancement(input);
      },
    },
    scheduler: studio.scheduler,
    service: backend,
    media,
    publication: media,
    clock,
    childIdFactory: () => ids.shift() ?? `enhancement-${label}-overflow`,
    requestIdFactory: () => {
      requestSequence += 1;
      return `00000000-0000-4000-8000-${String(requestSequence).padStart(12, "0")}`;
    },
    outputIdFactory: (childJobId) => `${childJobId}:output`,
    eventIdFactory: (childJobId) => `${childJobId}:completed`,
  });
  const harness: IntegrationHarness = {
    directory,
    dbPath,
    sourcePath,
    sourceBytes,
    parentJobId: `parent-${label}`,
    sourceOutputId: `source-output-${label}`,
    studio,
    persistence,
    atomicCompletions,
    media,
    backend,
    clock,
    runtime,
    closed: false,
  };
  harnesses.push(harness);
  return harness;
}

async function completeParent(harness: IntegrationHarness): Promise<void> {
  harness.studio.queue.enqueue({
    id: harness.parentJobId,
    pillar: "video",
    jobType: "text2video",
    parameters: { prompt: "source" },
    threadId: `thread-${harness.parentJobId}`,
  });
  harness.studio.queue.markRunning(harness.parentJobId);
  await harness.studio.queue.completeGenerationOutput({
    jobId: harness.parentJobId,
    output: {
      id: harness.sourceOutputId,
      outputPath: harness.sourcePath,
      workflow: SOURCE_WORKFLOW as unknown as Record<string, unknown>,
    },
  });
}

function enqueueInput(
  harness: IntegrationHarness,
): EnqueueVideoEnhancementInput {
  return {
    parentJobId: harness.parentJobId,
    sourceOutputId: harness.sourceOutputId,
    mode: "upscale",
    upscalePreset: "animation-upscale-2x",
    timeoutMs: 60_000,
    estimatedVramGB: 4,
  };
}

async function enqueue(
  harness: IntegrationHarness,
): Promise<StoredVideoEnhancementJob> {
  const result = await harness.runtime.enqueue(enqueueInput(harness));
  if (!result.ok) throw new Error(result.error.message);
  return result.job;
}

async function claim(
  harness: IntegrationHarness,
): Promise<StoredVideoEnhancementJob> {
  const claimed = harness.studio.queue.claimNext();
  if (!claimed) throw new Error("expected a queued enhancement child");
  const stored = await harness.persistence.getEnhancement(claimed.id);
  if (!stored)
    throw new Error("claimed enhancement could not be reconstructed");
  return stored;
}

function createMediaAdapter(
  sourcePath: string,
  invalidOutputs: ReadonlySet<string>,
): VideoEnhancementMediaAdapter {
  const comments = new Map<string, string>();
  const ffprobe: VideoFfprobeExecutionPort = {
    async run(args) {
      const target = path.resolve(args.at(-1)!);
      const stat = await fs.stat(target);
      const source = target === path.resolve(sourcePath);
      const invalid = invalidOutputs.has(target);
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          format: {
            size: String(stat.size),
            duration: "4.0",
            tags: comments.has(target)
              ? { comment: comments.get(target) }
              : undefined,
          },
          streams: [
            {
              index: 0,
              codec_type: "video",
              width: source ? 640 : invalid ? 1279 : 1280,
              height: source ? 360 : 720,
              avg_frame_rate: "24/1",
              r_frame_rate: "24/1",
              nb_frames: "96",
            },
            { index: 1, codec_type: "audio" },
          ],
        }),
      };
    },
  };
  const ffmpeg: VideoFfmpegExecutionPort = {
    async run(args, signal) {
      if (signal?.aborted) {
        return { exitCode: 1, stdout: "", stderr: "aborted" };
      }
      const input = args[args.indexOf("-i") + 1]!;
      const output = args.at(-1)!;
      const metadata = args[args.indexOf("-metadata") + 1]!;
      await fs.copyFile(input, output, fs.constants.COPYFILE_EXCL);
      await fs.appendFile(output, Buffer.from("|embedded-provenance|"));
      comments.set(path.resolve(output), metadata.slice("comment=".length));
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
  return new VideoEnhancementMediaAdapter(
    new VideoEnhancementMediaLifecycle(ffprobe, ffmpeg),
  );
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
  stagedPath: string,
): VideoEnhancementStagedSuccess {
  return {
    ok: true,
    outcome: "staged",
    requestId: request.requestId,
    parentJobId: request.parentJobId,
    childJobId,
    source: request.source,
    stagedPath,
    backend: {
      id: "video2x",
      compatibilityId: "video2x-cli-6.4.0",
      version: "6.4.0",
      executableSha256: "a".repeat(64),
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
          normalizedArguments: { scalingFactor: 2 },
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

function failure(
  request: VideoEnhancementRequest,
  childJobId: string,
  code: "cancelled",
): VideoEnhancementResult {
  return {
    ok: false,
    requestId: request.requestId,
    parentJobId: request.parentJobId,
    childJobId,
    error: {
      code,
      message: "The test backend was cancelled.",
      retryable: true,
      stage: "upscale",
      diagnostics: null,
      terminationConfirmed: true,
    },
  };
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("video enhancement Phase 3 integration", () => {
  it("requires a completed indexed parent even when a running parent has an output row", async () => {
    const harness = await createHarness("eligibility");
    await completeParent(harness);
    harness.studio.queue.markRunning(harness.parentJobId);

    await expect(
      harness.runtime.enqueue(enqueueInput(harness)),
    ).resolves.toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(harness.studio.queue.list()).toHaveLength(1);
  });

  it("serializes two isolated children and atomically exposes indexed provenance", async () => {
    const harness = await createHarness("success");
    await completeParent(harness);
    const first = await enqueue(harness);
    const second = await enqueue(harness);
    const firstClaimed = await claim(harness);
    const secondClaimed = await claim(harness);

    const [firstOutcome, secondOutcome] = await Promise.all([
      harness.runtime.runClaimed(firstClaimed.childJobId),
      harness.runtime.runClaimed(secondClaimed.childJobId),
    ]);

    expect(harness.atomicCompletions).toHaveLength(2);
    for (const completion of harness.atomicCompletions) {
      expect(completion.output.sizeBytes).toBeGreaterThan(
        completion.durableProvenance.output.sizeBytes,
      );
      expect(completion.output.contentHash).toBe(
        completion.durableProvenance.publishedContainerSha256,
      );
      expect(completion.output.workflow).toEqual(completion.embeddedWorkflow);
      expect(completion.enhancement.backend).toEqual(
        completion.durableProvenance.backend,
      );
      expect(completion.enhancement.stages).toEqual(
        completion.durableProvenance.stages,
      );
      expect(completion.enhancement.execution).toEqual(
        completion.durableProvenance.execution,
      );
    }

    expect(firstOutcome, JSON.stringify(firstOutcome)).toMatchObject({
      ok: true,
      state: "succeeded",
    });
    expect(secondOutcome, JSON.stringify(secondOutcome)).toMatchObject({
      ok: true,
      state: "succeeded",
    });
    expect(new Set(harness.backend.calls)).toEqual(
      new Set([first.childJobId, second.childJobId]),
    );
    expect(harness.backend.maxActive).toBe(1);

    const stored = await harness.persistence.listEnhancementsForParent(
      harness.parentJobId,
    );
    expect(stored).toHaveLength(2);
    expect(stored.map((job) => job.state)).toEqual(["succeeded", "succeeded"]);
    expect(stored.map((job) => job.progress?.percent)).toEqual([80, 80]);
    const outputs = stored.map((job) => job.output!);
    expect(new Set(outputs.map((output) => output.outputId)).size).toBe(2);
    expect(new Set(outputs.map((output) => output.path)).size).toBe(2);
    expect(outputs.every((output) => output.path !== harness.sourcePath)).toBe(
      true,
    );
    for (const output of outputs) {
      expect(harness.studio.index.getOutput(output.outputId)).toMatchObject({
        id: output.outputId,
        jobId: expect.any(String),
        contentHash: output.contentHash,
      });
      expect(
        harness.studio.index.listOutputsByHash(output.contentHash),
      ).toEqual([expect.objectContaining({ id: output.outputId })]);
      expect(output.workflow.enhancement).toMatchObject({
        childJobId: expect.any(String),
        parentJobId: harness.parentJobId,
        source: {
          outputId: harness.sourceOutputId,
          sha256: sha256(harness.sourceBytes),
        },
      });
      expect(output.durableProvenance).toMatchObject({
        publishedContainerSha256: output.contentHash,
      });
      expect(output.durableProvenance.output.preProvenanceContainerSha256).toBe(
        output.preProvenanceContainerSha256,
      );
    }
    expect(harness.persistence.listPendingCompletions()).toHaveLength(2);
    expect(await fs.readFile(harness.sourcePath)).toEqual(harness.sourceBytes);
  });

  it("fails closed on ffprobe validation without indexing an output", async () => {
    const harness = await createHarness("invalid");
    await completeParent(harness);
    const queued = await enqueue(harness);
    harness.backend.modes.set(queued.childJobId, "invalid-output");
    const claimed = await claim(harness);

    const outcome = await harness.runtime.runClaimed(claimed.childJobId);
    expect(outcome).toMatchObject({
      ok: false,
      state: "failed",
      error: {
        code: "output_invalid",
        stage: "validate",
        diagnostics: null,
      },
    });
    if (outcome.ok) throw new Error("invalid media unexpectedly succeeded");

    const stored = await harness.persistence.getEnhancement(queued.childJobId);
    expect(stored).toMatchObject({ state: "failed", output: null });
    expect(
      harness.studio.index.getOutput(`${queued.childJobId}:output`),
    ).toBeNull();
    expect(harness.persistence.listPendingCompletions()).toHaveLength(0);
    expect(await fs.readFile(harness.sourcePath)).toEqual(harness.sourceBytes);

    await closeStudioRuntime(harness.studio);
    harness.closed = true;
    const reopenedStudio = createStudioRuntime({
      dbPath: harness.dbPath,
      vramGB: 16,
    });
    const reopenedPersistence = new VideoEnhancementPersistenceAdapter(
      reopenedStudio.queue,
      reopenedStudio.index,
    );
    try {
      const reopened = await reopenedPersistence.getEnhancement(
        queued.childJobId,
      );
      expect(reopened?.error).toEqual(outcome.error);
      expect(reopened?.error).toMatchObject({
        code: "output_invalid",
        stage: "validate",
        diagnostics: null,
      });
    } finally {
      await closeStudioRuntime(reopenedStudio);
    }
  });

  it("cancels active native work and recovers a crashed running child as interrupted", async () => {
    const harness = await createHarness("recovery");
    await completeParent(harness);
    const cancellable = await enqueue(harness);
    harness.backend.modes.set(cancellable.childJobId, "blocked");
    const claimed = await claim(harness);
    const running = harness.runtime.runClaimed(claimed.childJobId);
    await vi.waitFor(() =>
      expect(harness.backend.calls).toContain(cancellable.childJobId),
    );

    await expect(
      harness.runtime.cancel(cancellable.childJobId),
    ).resolves.toMatchObject({ ok: false, state: "cancelled" });
    await expect(running).resolves.toMatchObject({
      ok: false,
      state: "cancelled",
    });
    expect(
      await harness.persistence.getEnhancement(cancellable.childJobId),
    ).toMatchObject({ state: "cancelled", error: { retryable: true } });

    const crashCandidate = await enqueue(harness);
    await claim(harness);
    await closeStudioRuntime(harness.studio);
    harness.closed = true;

    const reopenedStudio = createStudioRuntime({
      dbPath: harness.dbPath,
      vramGB: 16,
    });
    const reopenedPersistence = new VideoEnhancementPersistenceAdapter(
      reopenedStudio.queue,
      reopenedStudio.index,
    );
    const reopenedRuntime = new VideoEnhancementRuntime({
      queue: reopenedPersistence,
      storage: reopenedPersistence,
      scheduler: reopenedStudio.scheduler,
      service: harness.backend,
      media: harness.media,
      publication: harness.media,
    });
    try {
      expect(
        await reopenedPersistence.getEnhancement(crashCandidate.childJobId),
      ).toMatchObject({
        state: "interrupted",
        error: { code: "interrupted", retryable: true },
      });
      await expect(
        reopenedRuntime.recoverInterrupted(crashCandidate.childJobId),
      ).resolves.toMatchObject({
        ok: false,
        state: "interrupted",
        error: { retryable: true },
      });
      expect(harness.backend.calls).not.toContain(crashCandidate.childJobId);
    } finally {
      await reopenedRuntime.shutdown();
      await closeStudioRuntime(reopenedStudio);
    }
  });

  it("times out blocked native work without publishing a late output", async () => {
    const harness = await createHarness("timeout");
    await completeParent(harness);
    const queued = await enqueue(harness);
    harness.backend.modes.set(queued.childJobId, "blocked");
    const claimed = await claim(harness);
    const running = harness.runtime.runClaimed(claimed.childJobId);
    await vi.waitFor(() =>
      expect(harness.backend.calls).toContain(queued.childJobId),
    );

    harness.clock.fireAll();

    await expect(running).resolves.toMatchObject({
      ok: false,
      state: "timed_out",
      error: {
        code: "process_timeout",
        retryable: true,
        stage: "upscale",
      },
    });
    expect(
      await harness.persistence.getEnhancement(queued.childJobId),
    ).toMatchObject({
      state: "timed_out",
      output: null,
      error: { code: "process_timeout", retryable: true },
    });
    expect(harness.atomicCompletions).toHaveLength(0);
    expect(
      harness.studio.index.getOutput(`${queued.childJobId}:output`),
    ).toBeNull();
    expect(await fs.readFile(harness.sourcePath)).toEqual(harness.sourceBytes);
  });
});
