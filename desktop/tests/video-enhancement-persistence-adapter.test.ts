import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GenerationDatabase,
  GenerationIndex,
  GenerationQueue,
} from "../../core/generations";
import {
  createVideoEnhancementDurableProvenance,
  createVideoEnhancementEmbeddedProvenance,
  type VideoWorkflowMetadata,
} from "../../core/video/WorkflowMetadata";
import { VideoEnhancementPersistenceAdapter } from "../sidecar/src/video/VideoEnhancementPersistenceAdapter";
import type {
  PublishedVideoEnhancementOutput,
  StoredVideoEnhancementJob,
  VideoEnhancementAtomicCompletionInput,
  VideoEnhancementQueueEnqueueInput,
  VideoGenerationOutputSnapshot,
} from "../sidecar/src/video/VideoEnhancementRuntime";

const databases: GenerationDatabase[] = [];
const temporaryDirectories: string[] = [];

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

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

interface Harness {
  readonly directory: string;
  readonly dbPath: string;
  readonly database: GenerationDatabase;
  readonly queue: GenerationQueue;
  readonly index: GenerationIndex;
  readonly adapter: VideoEnhancementPersistenceAdapter;
}

interface ParentFixture extends Harness {
  readonly parentJobId: string;
  readonly sourceOutputId: string;
  readonly sourcePath: string;
  readonly snapshot: VideoGenerationOutputSnapshot;
}

async function harness(label: string): Promise<Harness> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), `nexus-enhancement-persistence-${label}-`),
  );
  temporaryDirectories.push(directory);
  const dbPath = path.join(directory, "studio.db");
  const database = new GenerationDatabase({ dbPath });
  databases.push(database);
  const queue = new GenerationQueue({ database });
  const index = new GenerationIndex({ database });
  return {
    directory,
    dbPath,
    database,
    queue,
    index,
    adapter: new VideoEnhancementPersistenceAdapter(queue, index),
  };
}

async function completedParent(label: string): Promise<ParentFixture> {
  const base = await harness(label);
  const parentJobId = `parent-${label}`;
  const sourceOutputId = `source-output-${label}`;
  const sourcePath = path.join(base.directory, "source.mp4");
  await fs.writeFile(sourcePath, Buffer.from(`source-video-bytes:${label}`));
  base.queue.enqueue({
    id: parentJobId,
    pillar: "video",
    jobType: "text2video",
    parameters: { prompt: "source" },
    threadId: `thread-${label}`,
  });
  base.queue.markRunning(parentJobId);
  await base.queue.completeGenerationOutput({
    jobId: parentJobId,
    output: {
      id: sourceOutputId,
      outputPath: sourcePath,
      workflow: SOURCE_WORKFLOW as unknown as Record<string, unknown>,
    },
  });
  const snapshot = await base.adapter.getGenerationOutput(
    parentJobId,
    sourceOutputId,
  );
  if (!snapshot) throw new Error("valid parent fixture was rejected");
  return { ...base, parentJobId, sourceOutputId, sourcePath, snapshot };
}

function enqueueInput(
  fixture: ParentFixture,
  childJobId: string,
  options: {
    readonly idempotencyKey?: string | null;
    readonly createdAt?: string;
    readonly priority?: "interactive" | "batch";
    readonly estimatedVramGB?: number;
    readonly attempt?: number;
    readonly retryOfChildJobId?: string | null;
  } = {},
): VideoEnhancementQueueEnqueueInput {
  const createdAt = options.createdAt ?? "2026-08-28T12:00:00.000Z";
  return Object.freeze({
    childJobId,
    parentJobId: fixture.parentJobId,
    sourceOutputId: fixture.sourceOutputId,
    backendId: "video2x",
    priority: options.priority ?? "interactive",
    estimatedVramGB: options.estimatedVramGB ?? 8,
    request: {
      requestId: randomUUID(),
      parentJobId: fixture.parentJobId,
      source: {
        path: fixture.snapshot.path,
        sha256: fixture.snapshot.contentHash,
        sizeBytes: fixture.snapshot.sizeBytes,
        durationSeconds: fixture.snapshot.durationSeconds,
        width: fixture.snapshot.width,
        height: fixture.snapshot.height,
        frameRate: fixture.snapshot.frameRate,
      },
      mode: "upscale" as const,
      upscalePreset: "animation-upscale-2x" as const,
      requestedAt: createdAt,
      timeoutMs: 60_000,
    },
    sourceOutput: fixture.snapshot,
    idempotencyKey: options.idempotencyKey ?? null,
    attempt: options.attempt ?? 1,
    retryOfChildJobId: options.retryOfChildJobId ?? null,
    createdAt,
  });
}

async function enqueue(
  fixture: ParentFixture,
  childJobId: string,
  options?: Parameters<typeof enqueueInput>[2],
): Promise<StoredVideoEnhancementJob> {
  const result = await fixture.adapter.enqueueEnhancement(
    enqueueInput(fixture, childJobId, options),
  );
  expect(result.created).toBe(true);
  return result.job;
}

describe("VideoEnhancementPersistenceAdapter", () => {
  it("only resolves a completed, indexed, regular MP4 video parent", async () => {
    const fixture = await completedParent("eligible");
    expect(fixture.snapshot).toMatchObject({
      generationId: fixture.parentJobId,
      outputId: fixture.sourceOutputId,
      jobState: "done",
      pillar: "video",
      mediaType: "video/mp4",
      sizeBytes: Buffer.byteLength("source-video-bytes:eligible"),
      durationSeconds: 4,
      width: 640,
      height: 360,
      frameRate: { numerator: 24, denominator: 1 },
      threadId: "thread-eligible",
    });

    fixture.queue.enqueue({
      id: "parent-running",
      pillar: "video",
      jobType: "text2video",
      parameters: {},
    });
    fixture.queue.markRunning("parent-running");
    await expect(
      fixture.adapter.getGenerationOutput("parent-running", "missing-output"),
    ).resolves.toBeNull();

    const imagePath = path.join(fixture.directory, "image-as-mp4.mp4");
    await fs.writeFile(imagePath, Buffer.from("image-output"));
    fixture.queue.enqueue({
      id: "image-parent",
      pillar: "image",
      jobType: "text2image",
      parameters: {},
    });
    fixture.queue.markRunning("image-parent");
    await fixture.queue.completeGenerationOutput({
      jobId: "image-parent",
      output: {
        id: "image-output",
        outputPath: imagePath,
        workflow: SOURCE_WORKFLOW as unknown as Record<string, unknown>,
      },
    });
    await expect(
      fixture.adapter.getGenerationOutput("image-parent", "image-output"),
    ).resolves.toBeNull();
  });

  it("rejects malformed workflow facts and changed or missing source files", async () => {
    const base = await harness("malformed");
    const malformedPath = path.join(base.directory, "malformed.mp4");
    await fs.writeFile(malformedPath, Buffer.from("malformed-workflow-video"));
    base.queue.enqueue({
      id: "malformed-parent",
      pillar: "video",
      jobType: "text2video",
      parameters: {},
    });
    base.queue.markRunning("malformed-parent");
    await base.queue.completeGenerationOutput({
      jobId: "malformed-parent",
      output: {
        id: "malformed-output",
        outputPath: malformedPath,
        workflow: {
          kind: "video",
          mode: "text2video",
          modelId: "qwen-video",
          prompt: "missing immutable media facts",
          durationSeconds: 4,
          fps: 24,
        },
      },
    });
    await expect(
      base.adapter.getGenerationOutput("malformed-parent", "malformed-output"),
    ).resolves.toBeNull();

    const fixture = await completedParent("removed");
    await fs.unlink(fixture.sourcePath);
    await expect(
      fixture.adapter.getGenerationOutput(
        fixture.parentJobId,
        fixture.sourceOutputId,
      ),
    ).resolves.toBeNull();
  });

  it("allows multiple children while deduplicating an explicit idempotency key", async () => {
    const fixture = await completedParent("idempotency");
    await enqueue(fixture, "child-one");
    await enqueue(fixture, "child-two", {
      createdAt: "2026-08-28T12:00:01.000Z",
    });
    const first = await fixture.adapter.enqueueEnhancement(
      enqueueInput(fixture, "child-idempotent-one", {
        idempotencyKey: "stable-key",
        createdAt: "2026-08-28T12:00:02.000Z",
      }),
    );
    const repeated = await fixture.adapter.enqueueEnhancement(
      enqueueInput(fixture, "child-idempotent-two", {
        idempotencyKey: "stable-key",
        createdAt: "2026-08-28T12:00:03.000Z",
      }),
    );

    expect(first.created).toBe(true);
    expect(repeated).toMatchObject({
      created: false,
      job: { childJobId: "child-idempotent-one", idempotencyKey: "stable-key" },
    });
    expect(
      await fixture.adapter.listEnhancementsForParent(fixture.parentJobId),
    ).toHaveLength(3);
    await expect(
      fixture.adapter.enqueueEnhancement(
        enqueueInput(fixture, "child-idempotent-conflict", {
          idempotencyKey: "stable-key",
          createdAt: "2026-08-28T12:00:04.000Z",
          estimatedVramGB: 12,
        }),
      ),
    ).rejects.toMatchObject({ code: "id_conflict" });
  });

  it("reconstructs immutable enqueue metadata and progress after a database reopen", async () => {
    const fixture = await completedParent("restart");
    const queued = await enqueue(fixture, "child-restart", {
      idempotencyKey: "restart-key",
      priority: "batch",
      estimatedVramGB: 10.5,
      createdAt: "2026-08-28T12:10:00.000Z",
    });
    expect(queued).toMatchObject({
      childJobId: "child-restart",
      backendId: "video2x",
      state: "queued",
      priority: "batch",
      estimatedVramGB: 10.5,
      idempotencyKey: "restart-key",
      attempt: 1,
      retryOfChildJobId: null,
      sourceOutput: fixture.snapshot,
      createdAt: "2026-08-28T12:10:00.000Z",
    });

    fixture.database.close();
    const reopenedDatabase = new GenerationDatabase({ dbPath: fixture.dbPath });
    databases.push(reopenedDatabase);
    const reopenedQueue = new GenerationQueue({ database: reopenedDatabase });
    const reopenedIndex = new GenerationIndex({ database: reopenedDatabase });
    const reopened = new VideoEnhancementPersistenceAdapter(
      reopenedQueue,
      reopenedIndex,
    );
    await expect(reopened.getEnhancement("child-restart")).resolves.toEqual(
      queued,
    );

    reopenedQueue.markRunning("child-restart");
    const progress = {
      requestId: queued.request.requestId,
      childJobId: queued.childJobId,
      stage: "upscale" as const,
      stageIndex: 1,
      stageCount: 1,
      processedFrames: 48,
      totalFrames: 96,
      percent: 50,
      message: "Upscaling frames.",
    };
    await expect(
      reopened.persistEnhancementProgress({
        childJobId: queued.childJobId,
        progress,
        updatedAt: "2026-08-28T12:10:01.000Z",
      }),
    ).resolves.toBe(true);
    await expect(
      reopened.getEnhancement("child-restart"),
    ).resolves.toMatchObject({
      state: "running",
      progress,
    });
  });

  it("maps timeout, cancellation, interruption, and ordinary failure durably", async () => {
    const fixture = await completedParent("terminal");
    const timeout = await enqueue(fixture, "child-timeout");
    fixture.queue.markRunning(timeout.childJobId);
    await expect(
      fixture.adapter.finishEnhancement({
        childJobId: timeout.childJobId,
        expectedStates: ["running"],
        state: "timed_out",
        error: {
          code: "process_timeout",
          message: "The process timed out.",
          retryable: true,
          stage: "upscale",
          diagnostics: "deadline",
          terminationConfirmed: false,
        },
        finishedAt: "2026-08-28T12:20:00.000Z",
      }),
    ).resolves.toMatchObject({
      state: "timed_out",
      error: {
        code: "process_timeout",
        retryable: true,
        stage: "upscale",
        diagnostics: "deadline",
        terminationConfirmed: false,
      },
    });

    const cancelled = await enqueue(fixture, "child-cancelled", {
      createdAt: "2026-08-28T12:20:01.000Z",
    });
    fixture.queue.markRunning(cancelled.childJobId);
    await expect(
      fixture.adapter.requestEnhancementCancellation({
        childJobId: cancelled.childJobId,
        requestedAt: "2026-08-28T12:20:02.000Z",
      }),
    ).resolves.toMatchObject({ state: "running", cancelRequested: true });
    await expect(
      fixture.adapter.finishEnhancement({
        childJobId: cancelled.childJobId,
        expectedStates: ["running"],
        state: "cancelled",
        error: {
          code: "cancelled",
          message: "Cancelled by the user.",
          retryable: true,
          stage: "preflight",
          diagnostics: null,
          terminationConfirmed: true,
        },
        finishedAt: "2026-08-28T12:20:03.000Z",
      }),
    ).resolves.toMatchObject({
      state: "cancelled",
      cancelRequested: true,
      error: {
        code: "cancelled",
        stage: "preflight",
        diagnostics: null,
        terminationConfirmed: true,
      },
    });

    const interrupted = await enqueue(fixture, "child-interrupted", {
      createdAt: "2026-08-28T12:20:04.000Z",
    });
    fixture.queue.markRunning(interrupted.childJobId);
    await expect(
      fixture.adapter.finishEnhancement({
        childJobId: interrupted.childJobId,
        expectedStates: ["running"],
        state: "interrupted",
        error: {
          code: "interrupted",
          message: "Application shutdown interrupted the process.",
          retryable: true,
          stage: "interpolate",
          diagnostics: "scheduler shutdown",
          terminationConfirmed: null,
        },
        finishedAt: "2026-08-28T12:20:05.000Z",
      }),
    ).resolves.toMatchObject({
      state: "interrupted",
      error: {
        code: "interrupted",
        retryable: true,
        stage: "interpolate",
        diagnostics: "scheduler shutdown",
        terminationConfirmed: null,
      },
    });

    const failed = await enqueue(fixture, "child-failed", {
      createdAt: "2026-08-28T12:20:06.000Z",
    });
    fixture.queue.markRunning(failed.childJobId);
    await expect(
      fixture.adapter.finishEnhancement({
        childJobId: failed.childJobId,
        expectedStates: ["running"],
        state: "failed",
        error: {
          code: "process_failed",
          message: "Backend exited non-zero.",
          retryable: false,
          stage: "upscale",
          diagnostics: "exit 1",
          terminationConfirmed: true,
        },
        finishedAt: "2026-08-28T12:20:07.000Z",
      }),
    ).resolves.toMatchObject({
      state: "failed",
      error: {
        code: "process_failed",
        retryable: false,
        stage: "upscale",
        diagnostics: "exit 1",
        terminationConfirmed: true,
      },
    });

    fixture.database.close();
    const reopenedDatabase = new GenerationDatabase({ dbPath: fixture.dbPath });
    databases.push(reopenedDatabase);
    const reopenedQueue = new GenerationQueue({ database: reopenedDatabase });
    const reopenedIndex = new GenerationIndex({ database: reopenedDatabase });
    const reopened = new VideoEnhancementPersistenceAdapter(
      reopenedQueue,
      reopenedIndex,
    );
    await expect(
      reopened.getEnhancement(timeout.childJobId),
    ).resolves.toMatchObject({
      state: "timed_out",
      error: {
        code: "process_timeout",
        message: "The process timed out.",
        retryable: true,
        stage: "upscale",
        diagnostics: "deadline",
        terminationConfirmed: false,
      },
    });
    await expect(
      reopened.getEnhancement(cancelled.childJobId),
    ).resolves.toMatchObject({
      state: "cancelled",
      error: {
        stage: "preflight",
        diagnostics: null,
        terminationConfirmed: true,
      },
    });
    await expect(
      reopened.getEnhancement(interrupted.childJobId),
    ).resolves.toMatchObject({
      state: "interrupted",
      error: {
        stage: "interpolate",
        diagnostics: "scheduler shutdown",
        terminationConfirmed: null,
      },
    });
    await expect(
      reopened.getEnhancement(failed.childJobId),
    ).resolves.toMatchObject({
      state: "failed",
      error: {
        stage: "upscale",
        diagnostics: "exit 1",
        terminationConfirmed: true,
      },
    });
    expect(reopenedQueue.get(failed.childJobId)?.error).toBe(
      "Backend exited non-zero.",
    );
  });

  it("enriches terminal evidence across reopen and makes cancellation win late work", async () => {
    const fixture = await completedParent("terminal-evidence");
    const interrupted = await enqueue(fixture, "child-evidence-interrupted");
    fixture.queue.markRunning(interrupted.childJobId);
    const firstInterrupted = await fixture.adapter.finishEnhancement({
      childJobId: interrupted.childJobId,
      expectedStates: ["running"],
      state: "interrupted",
      error: {
        code: "interrupted",
        message: "Shutdown interrupted the enhancement.",
        retryable: true,
        stage: "upscale",
        diagnostics: "termination pending",
        terminationConfirmed: false,
      },
      finishedAt: "2026-08-28T12:25:00.000Z",
    });
    expect(firstInterrupted).toMatchObject({
      state: "interrupted",
      error: {
        stage: "upscale",
        diagnostics: "termination pending",
        terminationConfirmed: false,
      },
    });
    const interruptedFinishedAt = firstInterrupted?.finishedAt;
    await expect(
      fixture.adapter.finishEnhancement({
        childJobId: interrupted.childJobId,
        expectedStates: ["interrupted"],
        state: "interrupted",
        error: {
          code: "interrupted",
          message: "Later observation must not replace the terminal cause.",
          retryable: false,
          stage: "validate",
          diagnostics: "process tree exited",
          terminationConfirmed: true,
        },
        finishedAt: "2026-08-28T12:25:01.000Z",
      }),
    ).resolves.toMatchObject({
      state: "interrupted",
      error: {
        message: "Shutdown interrupted the enhancement.",
        retryable: true,
        stage: "validate",
        diagnostics: "termination pending\nprocess tree exited",
        terminationConfirmed: true,
      },
      finishedAt: interruptedFinishedAt,
    });

    const cancelled = await enqueue(fixture, "child-evidence-cancelled", {
      createdAt: "2026-08-28T12:25:02.000Z",
    });
    fixture.queue.markRunning(cancelled.childJobId);
    await fixture.adapter.requestEnhancementCancellation({
      childJobId: cancelled.childJobId,
      requestedAt: "2026-08-28T12:25:03.000Z",
    });
    const firstCancelled = await fixture.adapter.finishEnhancement({
      childJobId: cancelled.childJobId,
      expectedStates: ["running"],
      state: "cancelled",
      error: {
        code: "cancelled",
        message: "Cancellation requested.",
        retryable: true,
        stage: "upscale",
        diagnostics: "termination pending",
        terminationConfirmed: false,
      },
      finishedAt: "2026-08-28T12:25:04.000Z",
    });
    expect(firstCancelled).toMatchObject({
      state: "cancelled",
      error: {
        stage: "upscale",
        diagnostics: "termination pending",
        terminationConfirmed: false,
      },
    });
    const cancelledFinishedAt = firstCancelled?.finishedAt;
    await expect(
      fixture.adapter.finishEnhancement({
        childJobId: cancelled.childJobId,
        expectedStates: ["running"],
        state: "cancelled",
        error: {
          code: "cancelled",
          message: "Later cancellation evidence.",
          retryable: false,
          stage: "validate",
          diagnostics: "process tree exited",
          terminationConfirmed: true,
        },
        finishedAt: "2026-08-28T12:25:05.000Z",
      }),
    ).resolves.toMatchObject({
      state: "cancelled",
      error: {
        message: "Cancellation requested.",
        retryable: true,
        stage: "validate",
        diagnostics: "termination pending\nprocess tree exited",
        terminationConfirmed: true,
      },
      finishedAt: cancelledFinishedAt,
    });
    const cancelledCompletion = await atomicCompletion(fixture, cancelled);
    const cancelledCompleteSpy = vi.spyOn(fixture.queue, "completeEnhancement");
    await expect(
      fixture.adapter.completeEnhancement(cancelledCompletion),
    ).resolves.toMatchObject({
      committed: false,
      job: { state: "cancelled" },
    });
    expect(cancelledCompleteSpy).not.toHaveBeenCalled();
    cancelledCompleteSpy.mockRestore();
    expect(
      fixture.index.getOutput(cancelledCompletion.output.outputId),
    ).toBeNull();

    const lateFailure = await enqueue(fixture, "child-cancel-late-failure", {
      createdAt: "2026-08-28T12:25:06.000Z",
    });
    fixture.queue.markRunning(lateFailure.childJobId);
    await fixture.adapter.requestEnhancementCancellation({
      childJobId: lateFailure.childJobId,
      requestedAt: "2026-08-28T12:25:07.000Z",
    });
    await expect(
      fixture.adapter.finishEnhancement({
        childJobId: lateFailure.childJobId,
        expectedStates: ["running"],
        state: "failed",
        error: {
          code: "process_failed",
          message: "Late backend failure.",
          retryable: false,
          stage: "validate",
          diagnostics: "backend exited after cancellation",
          terminationConfirmed: true,
        },
        finishedAt: "2026-08-28T12:25:08.000Z",
      }),
    ).resolves.toMatchObject({
      state: "cancelled",
      cancelRequested: true,
      error: {
        code: "cancelled",
        message: "cancelled",
        retryable: true,
        stage: "validate",
        diagnostics: "backend exited after cancellation",
        terminationConfirmed: true,
      },
    });
    const lateCompletion = await atomicCompletion(fixture, lateFailure);
    await expect(
      fixture.adapter.completeEnhancement(lateCompletion),
    ).resolves.toMatchObject({
      committed: false,
      job: { state: "cancelled" },
    });
    expect(fixture.index.getOutput(lateCompletion.output.outputId)).toBeNull();

    const progressRace = await enqueue(fixture, "child-cancel-progress-error", {
      createdAt: "2026-08-28T12:25:09.000Z",
    });
    fixture.queue.markRunning(progressRace.childJobId);
    await fixture.adapter.requestEnhancementCancellation({
      childJobId: progressRace.childJobId,
      requestedAt: "2026-08-28T12:25:10.000Z",
    });
    await expect(
      fixture.adapter.persistEnhancementProgress({
        childJobId: progressRace.childJobId,
        progress: {
          requestId: progressRace.request.requestId,
          childJobId: progressRace.childJobId,
          stage: "upscale",
          stageIndex: 1,
          stageCount: 1,
          percent: 50,
          message: "Late progress.",
        },
        updatedAt: "2026-08-28T12:25:11.000Z",
      }),
    ).resolves.toBe(false);
    await expect(
      fixture.adapter.finishEnhancement({
        childJobId: progressRace.childJobId,
        expectedStates: ["running"],
        state: "failed",
        error: {
          code: "internal_error",
          message: "Late progress persistence failed.",
          retryable: true,
          stage: "upscale",
          diagnostics: "progress rejected after cancellation",
          terminationConfirmed: false,
        },
        finishedAt: "2026-08-28T12:25:12.000Z",
      }),
    ).resolves.toMatchObject({
      state: "cancelled",
      error: {
        code: "cancelled",
        stage: "upscale",
        diagnostics: "progress rejected after cancellation",
        terminationConfirmed: false,
      },
    });

    const shutdown = await enqueue(fixture, "child-cancel-shutdown", {
      createdAt: "2026-08-28T12:25:13.000Z",
    });
    fixture.queue.markRunning(shutdown.childJobId);
    await fixture.adapter.requestEnhancementCancellation({
      childJobId: shutdown.childJobId,
      requestedAt: "2026-08-28T12:25:14.000Z",
    });
    await expect(
      fixture.adapter.finishEnhancement({
        childJobId: shutdown.childJobId,
        expectedStates: ["running"],
        state: "interrupted",
        error: {
          code: "interrupted",
          message: "Shutdown interrupted cancellation.",
          retryable: true,
          stage: "publish",
          diagnostics: "termination not confirmed",
          terminationConfirmed: false,
        },
        finishedAt: "2026-08-28T12:25:15.000Z",
      }),
    ).resolves.toMatchObject({
      state: "interrupted",
      cancelRequested: true,
      error: { code: "interrupted", terminationConfirmed: false },
    });

    fixture.database.close();
    const reopenedDatabase = new GenerationDatabase({ dbPath: fixture.dbPath });
    databases.push(reopenedDatabase);
    const reopenedQueue = new GenerationQueue({ database: reopenedDatabase });
    const reopenedIndex = new GenerationIndex({ database: reopenedDatabase });
    const reopened = new VideoEnhancementPersistenceAdapter(
      reopenedQueue,
      reopenedIndex,
    );
    await expect(
      reopened.getEnhancement(interrupted.childJobId),
    ).resolves.toMatchObject({
      state: "interrupted",
      error: {
        stage: "validate",
        diagnostics: "termination pending\nprocess tree exited",
        terminationConfirmed: true,
      },
      finishedAt: interruptedFinishedAt,
    });
    await expect(
      reopened.getEnhancement(cancelled.childJobId),
    ).resolves.toMatchObject({
      state: "cancelled",
      error: {
        stage: "validate",
        diagnostics: "termination pending\nprocess tree exited",
        terminationConfirmed: true,
      },
      finishedAt: cancelledFinishedAt,
    });
    await expect(
      reopened.getEnhancement(progressRace.childJobId),
    ).resolves.toMatchObject({
      state: "cancelled",
      error: {
        stage: "upscale",
        diagnostics: "progress rejected after cancellation",
        terminationConfirmed: false,
      },
    });
    await expect(
      reopened.getEnhancement(shutdown.childJobId),
    ).resolves.toMatchObject({
      state: "interrupted",
      cancelRequested: true,
      error: {
        stage: "publish",
        diagnostics: "termination not confirmed",
        terminationConfirmed: false,
      },
    });
  });

  it("commits exact enhancement output, provenance, and outbox in one queue call", async () => {
    const fixture = await completedParent("complete");
    const job = await enqueue(fixture, "child-complete", {
      idempotencyKey: "complete-key",
    });
    fixture.queue.markRunning(job.childJobId);
    const completion = await atomicCompletion(fixture, job);
    const completeSpy = vi.spyOn(fixture.queue, "completeEnhancement");

    const result = await fixture.adapter.completeEnhancement(completion);

    expect(completion.output.sizeBytes).not.toBe(
      completion.durableProvenance.output.sizeBytes,
    );

    expect(completeSpy).toHaveBeenCalledTimes(1);
    expect(completeSpy.mock.calls[0]?.[0]).toMatchObject({
      childJobId: completion.childJobId,
      output: {
        id: completion.output.outputId,
        outputPath: completion.output.path,
        contentHash: completion.output.contentHash,
      },
      provenanceRecordId: completion.provenanceRecordId,
      provenance: completion.enhancement,
      outbox: {
        id: completion.outbox.eventId,
        payload: completion.outbox.payload,
      },
    });
    expect(result).toMatchObject({
      committed: true,
      job: {
        state: "succeeded",
        output: completion.output,
      },
    });
    expect(fixture.index.getOutput(completion.output.outputId)).toMatchObject({
      id: completion.output.outputId,
      jobId: job.childJobId,
      contentHash: completion.output.contentHash,
      outputPath: completion.output.path,
    });
    expect(fixture.index.getEnhancementRun(job.childJobId)).toMatchObject({
      state: "completed",
      outputId: completion.output.outputId,
      provenanceRecordId: completion.provenanceRecordId,
      provenance: completion.enhancement,
    });
    expect(fixture.adapter.listPendingCompletions()).toEqual([
      expect.objectContaining({
        id: completion.outbox.eventId,
        jobId: job.childJobId,
        eventType: completion.outbox.eventType,
        payload: completion.outbox.payload,
      }),
    ]);

    await expect(
      fixture.adapter.getGenerationOutput(
        job.childJobId,
        completion.output.outputId,
      ),
    ).resolves.toMatchObject({
      generationId: job.childJobId,
      outputId: completion.output.outputId,
      sizeBytes: completion.output.sizeBytes,
      width: completion.output.width,
      height: completion.output.height,
      frameRate: completion.output.frameRate,
    });

    const enhancedSnapshot = await fixture.adapter.getGenerationOutput(
      job.childJobId,
      completion.output.outputId,
    );
    if (!enhancedSnapshot) {
      throw new Error("completed enhanced output could not be reconstructed");
    }
    expect(enhancedSnapshot.sizeBytes).toBe(completion.output.sizeBytes);
    expect(enhancedSnapshot.sizeBytes).not.toBe(
      completion.durableProvenance.output.sizeBytes,
    );
    const chainedFixture: ParentFixture = {
      ...fixture,
      parentJobId: job.childJobId,
      sourceOutputId: completion.output.outputId,
      sourcePath: completion.output.path,
      snapshot: enhancedSnapshot,
    };
    await expect(
      fixture.adapter.enqueueEnhancement(
        enqueueInput(chainedFixture, "child-complete-chained", {
          createdAt: "2026-08-28T12:31:00.000Z",
        }),
      ),
    ).resolves.toMatchObject({
      created: true,
      job: {
        parentJobId: job.childJobId,
        sourceOutputId: completion.output.outputId,
        sourceOutput: { sizeBytes: completion.output.sizeBytes },
      },
    });

    fixture.database.close();
    const reopenedDatabase = new GenerationDatabase({ dbPath: fixture.dbPath });
    databases.push(reopenedDatabase);
    const reopenedQueue = new GenerationQueue({ database: reopenedDatabase });
    const reopenedIndex = new GenerationIndex({ database: reopenedDatabase });
    const reopened = new VideoEnhancementPersistenceAdapter(
      reopenedQueue,
      reopenedIndex,
    );
    await expect(
      reopened.getEnhancement(job.childJobId),
    ).resolves.toMatchObject({
      state: "succeeded",
      output: {
        sizeBytes: completion.output.sizeBytes,
        durableProvenance: {
          output: {
            sizeBytes: completion.durableProvenance.output.sizeBytes,
          },
        },
      },
    });
    await expect(
      reopened.getGenerationOutput(job.childJobId, completion.output.outputId),
    ).resolves.toMatchObject({ sizeBytes: completion.output.sizeBytes });
  });
});

async function atomicCompletion(
  fixture: ParentFixture,
  job: StoredVideoEnhancementJob,
): Promise<VideoEnhancementAtomicCompletionInput> {
  const outputPath = path.join(fixture.directory, `${job.childJobId}.mp4`);
  const outputBytes = Buffer.from("published-enhanced-video-with-provenance");
  const preProvenanceBytes = Buffer.from("enhanced-video-before-provenance");
  await fs.writeFile(outputPath, outputBytes);
  const outputHash = sha256(outputBytes);
  const preProvenanceHash = sha256(preProvenanceBytes);
  const backend = Object.freeze({
    id: "video2x",
    compatibilityId: "video2x-cli-6.4.0",
    version: "6.4.0",
    executableSha256: "a".repeat(64),
    provenance: "user-supplied-unverified" as const,
    configurationSource: "setting" as const,
  });
  const execution = Object.freeze({
    platform: Object.freeze({
      os: "win32" as const,
      architecture: "x64" as const,
      avx2: "available" as const,
    }),
    selectedDevice: Object.freeze({
      id: 0,
      type: "discrete_gpu" as const,
      name: "Test GPU",
    }),
  });
  const stages = Object.freeze([
    Object.freeze({
      stageIndex: 1,
      parameters: Object.freeze({
        stage: "upscale" as const,
        presetId: "animation-upscale-2x" as const,
        contentClass: "animation" as const,
        scaleFactor: 2 as const,
      }),
      backend: Object.freeze({
        processor: "realesrgan",
        model: "realesr-animevideov3",
        normalizedArguments: Object.freeze({ device: 0, scale: 2 }),
      }),
      startedAt: "2026-08-28T12:30:00.100Z",
      completedAt: "2026-08-28T12:30:00.900Z",
      durationMs: 800,
      exitCode: 0,
      outcome: "staged" as const,
    }),
  ]);
  const provenanceRecordId = `provenance-${job.childJobId}`;
  const embedded = createVideoEnhancementEmbeddedProvenance({
    schemaVersion: 1,
    nexusRelease: "v2.3.0",
    provenanceRecordId,
    parentJobId: job.parentJobId,
    requestId: job.request.requestId,
    childJobId: job.childJobId,
    mode: "upscale",
    upscalePreset: "animation-upscale-2x",
    interpolationPreset: null,
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
      preProvenanceContainerSha256: preProvenanceHash,
      sizeBytes: preProvenanceBytes.byteLength,
      durationSeconds: job.sourceOutput.durationSeconds,
      width: job.sourceOutput.width * 2,
      height: job.sourceOutput.height * 2,
      frameRate: job.sourceOutput.frameRate,
      frameCount: 96,
    },
    backend,
    execution,
    stages,
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
    startedAt: "2026-08-28T12:30:00.000Z",
    completedAt: "2026-08-28T12:30:01.000Z",
    durationMs: 1_000,
    outcome: "completed",
  });
  const embeddedWorkflow = Object.freeze({
    ...(job.sourceOutput.workflow as VideoWorkflowMetadata),
    enhancement: embedded,
  });
  const durableProvenance = createVideoEnhancementDurableProvenance(
    embedded,
    outputHash,
  );
  const output: PublishedVideoEnhancementOutput = Object.freeze({
    outputId: `${job.childJobId}-output`,
    path: outputPath,
    contentHash: outputHash,
    sizeBytes: outputBytes.byteLength,
    durationSeconds: embedded.output.durationSeconds,
    width: embedded.output.width,
    height: embedded.output.height,
    frameRate: embedded.output.frameRate,
    workflow: embeddedWorkflow,
    provenanceRecordId,
    preProvenanceContainerSha256: preProvenanceHash,
    publishedContainerSha256: outputHash,
    embeddedWorkflow,
    durableProvenance,
  });
  const finishedAt = "2026-08-28T12:30:01.100Z";
  return Object.freeze({
    childJobId: job.childJobId,
    expectedState: "running",
    provenanceRecordId,
    embeddedWorkflow,
    durableProvenance,
    output,
    enhancement: Object.freeze({
      childJobId: job.childJobId,
      parentJobId: job.parentJobId,
      sourceGenerationId: job.sourceOutput.generationId,
      sourceOutputId: job.sourceOutputId,
      sourceContentHash: job.sourceOutput.contentHash,
      outputId: output.outputId,
      outputContentHash: output.contentHash,
      provenanceRecordId,
      preProvenanceContainerSha256: preProvenanceHash,
      publishedContainerSha256: outputHash,
      embeddedWorkflow,
      durableProvenance,
      request: job.request,
      backend,
      stages,
      execution,
      startedAt: embedded.startedAt,
      completedAt: embedded.completedAt,
      durationMs: embedded.durationMs,
      warnings: Object.freeze(["test warning"]),
      progress: Object.freeze({
        percent: 100,
        processedFrames: 96,
        totalFrames: 96,
      }),
      attempt: job.attempt,
      retryOfChildJobId: job.retryOfChildJobId,
      outcome: "succeeded",
    }),
    outbox: Object.freeze({
      eventId: `${job.childJobId}-completed`,
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
        provenanceRecordId,
        preProvenanceContainerSha256: preProvenanceHash,
        publishedContainerSha256: outputHash,
        attempt: job.attempt,
      }),
    }),
    finishedAt,
  });
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
