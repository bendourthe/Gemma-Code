import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { VideoEnhancementStagedSuccess } from "../../core/video/VideoEnhancement";
import type { VideoWorkflowMetadata } from "../../core/video/WorkflowMetadata";
import { VideoEnhancementMediaAdapter } from "../sidecar/src/video/VideoEnhancementMediaAdapter";
import {
  VideoEnhancementMediaLifecycle,
  type VideoFfmpegExecutionPort,
  type VideoFfprobeExecutionPort,
} from "../sidecar/src/video/VideoEnhancementMediaLifecycle";
import {
  VideoEnhancementRuntimePortError,
  type StoredVideoEnhancementJob,
  type VideoEnhancementRuntimeIssue,
} from "../sidecar/src/video/VideoEnhancementRuntime";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

const SOURCE_WORKFLOW: VideoWorkflowMetadata = {
  tool: "nexus",
  version: "2.3.0",
  kind: "video",
  mode: "text2video",
  modelId: "qwen-video",
  prompt: "a fox",
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
};

interface TestEnvironment {
  readonly directory: string;
  readonly sourcePath: string;
  readonly sourceBytes: Buffer;
  readonly sourceHash: string;
  readonly lifecycle: VideoEnhancementMediaLifecycle;
  readonly adapter: VideoEnhancementMediaAdapter;
}

interface TestChild {
  readonly job: StoredVideoEnhancementJob;
  readonly staged: VideoEnhancementStagedSuccess;
  readonly stagedBytes: Buffer;
}

async function createEnvironment(
  options: { ffmpegExitCode?: number } = {},
): Promise<TestEnvironment> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "nexus-media-adapter-"),
  );
  temporaryDirectories.push(directory);
  const sourcePath = path.join(directory, "source.mp4");
  const sourceBytes = Buffer.from("immutable-source-video-bytes");
  const sourceHash = sha256(sourceBytes);
  await fs.writeFile(sourcePath, sourceBytes);
  const comments = new Map<string, string>();
  const ffprobe: VideoFfprobeExecutionPort = {
    async run(args) {
      const target = args.at(-1)!;
      const stat = await fs.stat(target);
      const isSource = path.normalize(target) === path.normalize(sourcePath);
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
              width: isSource ? 640 : 1280,
              height: isSource ? 360 : 720,
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
    async run(args) {
      const input = args[args.indexOf("-i") + 1]!;
      const output = args.at(-1)!;
      const metadata = args[args.indexOf("-metadata") + 1]!;
      await fs.copyFile(input, output, fs.constants.COPYFILE_EXCL);
      await fs.appendFile(output, Buffer.from("-provenance"));
      comments.set(output, metadata.slice("comment=".length));
      return {
        exitCode: options.ffmpegExitCode ?? 0,
        stdout: "",
        stderr: options.ffmpegExitCode ? "embedding failed" : "",
      };
    },
  };
  const lifecycle = new VideoEnhancementMediaLifecycle(ffprobe, ffmpeg);
  return {
    directory,
    sourcePath,
    sourceBytes,
    sourceHash,
    lifecycle,
    adapter: new VideoEnhancementMediaAdapter(lifecycle),
  };
}

async function createChild(
  environment: TestEnvironment,
  suffix: string,
): Promise<TestChild> {
  const childJobId = `child-${suffix}`;
  const requestId = `request-${suffix}`;
  const stagedPath = path.join(
    environment.directory,
    `${childJobId}.partial.mp4`,
  );
  const stagedBytes = Buffer.from(`enhanced-video-${suffix}`);
  await fs.writeFile(stagedPath, stagedBytes);
  const source = {
    path: environment.sourcePath,
    sha256: environment.sourceHash,
    sizeBytes: environment.sourceBytes.byteLength,
    durationSeconds: 4,
    width: 640,
    height: 360,
    frameRate: { numerator: 24, denominator: 1 },
  } as const;
  const staged: VideoEnhancementStagedSuccess = {
    ok: true,
    outcome: "staged",
    requestId,
    parentJobId: "generation-1",
    childJobId,
    source,
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
        startedAt: "2026-08-28T00:00:00.100Z",
        completedAt: "2026-08-28T00:00:00.900Z",
        durationMs: 800,
        exitCode: 0,
        outcome: "staged",
      },
    ],
    execution: {
      platform: { os: "win32", architecture: "x64", avx2: "available" },
      selectedDevice: {
        id: 0,
        type: "discrete_gpu",
        name: "Test GPU",
      },
    },
    startedAt: "2026-08-28T00:00:00.000Z",
    completedAt: "2026-08-28T00:00:01.000Z",
    durationMs: 1_000,
    warnings: [],
    progress: { percent: 100 },
  };
  const job: StoredVideoEnhancementJob = {
    childJobId,
    parentJobId: "generation-1",
    sourceOutputId: "source-output-1",
    backendId: "video2x",
    state: "running",
    priority: "interactive",
    estimatedVramGB: 8,
    request: {
      requestId,
      parentJobId: "generation-1",
      source,
      requestedAt: "2026-08-28T00:00:00.000Z",
      timeoutMs: 60_000,
      mode: "upscale",
      upscalePreset: "animation-upscale-2x",
    },
    sourceOutput: {
      outputId: "source-output-1",
      generationId: "generation-1",
      jobState: "done",
      pillar: "video",
      mediaType: "video/mp4",
      path: environment.sourcePath,
      contentHash: environment.sourceHash,
      sizeBytes: environment.sourceBytes.byteLength,
      durationSeconds: 4,
      width: 640,
      height: 360,
      frameRate: { numerator: 24, denominator: 1 },
      workflow: SOURCE_WORKFLOW,
      threadId: "thread-1",
    },
    idempotencyKey: null,
    attempt: 1,
    retryOfChildJobId: null,
    cancelRequested: false,
    progress: null,
    error: null,
    output: null,
    createdAt: "2026-08-28T00:00:00.000Z",
    startedAt: "2026-08-28T00:00:00.000Z",
    finishedAt: null,
  };
  return { job, staged, stagedBytes };
}

const QUARANTINE_REASON: VideoEnhancementRuntimeIssue = {
  code: "publish_failed",
  message: "Durable commit was rejected.",
  retryable: true,
  stage: "provenance",
  diagnostics: null,
  terminationConfirmed: null,
};

describe("VideoEnhancementMediaAdapter", () => {
  it("retains one child preparation and propagates exact provenance through publish", async () => {
    const environment = await createEnvironment();
    const child = await createChild(environment, "one");
    const signal = new AbortController().signal;

    await expect(
      environment.adapter.verifySource(child.staged.source, signal),
    ).resolves.toEqual(child.staged.source);
    const validated = await environment.adapter.validateAndWriteProvenance({
      job: child.job,
      staged: child.staged,
      signal,
    });

    expect(environment.adapter.retainedCount()).toBe(1);
    expect(validated.stagedPath).not.toBe(child.staged.stagedPath);
    expect(validated.stagedPath).not.toBe(environment.sourcePath);
    expect(path.dirname(validated.stagedPath)).toBe(environment.directory);
    expect(path.basename(validated.stagedPath)).toMatch(
      /^\.nexus-enhancement-[a-f0-9]{40}\.staged\.mp4$/,
    );
    expect(validated.provenanceRecordId).toMatch(
      /^nexus-video-enhancement-[a-f0-9]{40}$/,
    );
    expect(validated.durableProvenance).toMatchObject({
      nexusRelease: "v2.3.0",
      provenanceRecordId: validated.provenanceRecordId,
      parentJobId: child.job.parentJobId,
      requestId: child.job.request.requestId,
      childJobId: child.job.childJobId,
      presetRouting: "explicit",
      publishedContainerSha256: validated.contentHash,
    });
    expect(validated.embeddedWorkflow.enhancement).not.toHaveProperty(
      "publishedContainerSha256",
    );
    expect(validated.preProvenanceContainerSha256).toBe(
      sha256(child.stagedBytes),
    );
    expect(await fs.readFile(environment.sourcePath)).toEqual(
      environment.sourceBytes,
    );

    const published = await environment.adapter.publish({
      childJobId: child.job.childJobId,
      desiredOutputId: "enhanced-output-one",
      source: child.job.sourceOutput,
      validated,
      signal,
    });

    expect(environment.adapter.retainedCount()).toBe(0);
    expect(published).toMatchObject({
      outputId: "enhanced-output-one",
      contentHash: validated.contentHash,
      provenanceRecordId: validated.provenanceRecordId,
      preProvenanceContainerSha256: validated.preProvenanceContainerSha256,
      publishedContainerSha256: validated.publishedContainerSha256,
      durableProvenance: validated.durableProvenance,
      workflow: validated.embeddedWorkflow,
    });
    expect(path.dirname(published.path)).toBe(environment.directory);
    expect(path.basename(published.path)).toMatch(
      /^nexus-enhanced-[a-f0-9]{40}\.mp4$/,
    );
    expect(await fs.readFile(environment.sourcePath)).toEqual(
      environment.sourceBytes,
    );
    expect(await fs.readFile(child.staged.stagedPath)).toEqual(
      child.stagedBytes,
    );

    await expect(
      environment.adapter.publish({
        childJobId: child.job.childJobId,
        desiredOutputId: "enhanced-output-one",
        source: child.job.sourceOutput,
        validated,
        signal,
      }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    await expect(
      environment.adapter.finalize({
        childJobId: child.job.childJobId,
        output: { ...published, contentHash: "b".repeat(64) },
      }),
    ).rejects.toMatchObject({ code: "output_conflict" });
    await expect(
      environment.adapter.finalize({
        childJobId: child.job.childJobId,
        output: published,
      }),
    ).resolves.toBeUndefined();
    expect(environment.adapter.acknowledgePublished(child.job.childJobId)).toBe(
      false,
    );

    const successor = await createChild(environment, "after-finalize");
    const successorValidated =
      await environment.adapter.validateAndWriteProvenance({
        job: successor.job,
        staged: successor.staged,
        signal,
      });
    const successorPublished = await environment.adapter.publish({
      childJobId: successor.job.childJobId,
      desiredOutputId: published.outputId,
      source: successor.job.sourceOutput,
      validated: successorValidated,
      signal,
    });
    expect(successorPublished.outputId).toBe(published.outputId);
    await environment.adapter.discard({
      childJobId: successor.job.childJobId,
      reason: QUARANTINE_REASON,
    });
  });

  it("isolates children and rejects cross-child artifacts and output-ID collisions", async () => {
    const environment = await createEnvironment();
    const [first, second] = await Promise.all([
      createChild(environment, "first"),
      createChild(environment, "second"),
    ]);
    const signal = new AbortController().signal;
    const [firstValidated, secondValidated] = await Promise.all([
      environment.adapter.validateAndWriteProvenance({
        job: first.job,
        staged: first.staged,
        signal,
      }),
      environment.adapter.validateAndWriteProvenance({
        job: second.job,
        staged: second.staged,
        signal,
      }),
    ]);

    expect(firstValidated.stagedPath).not.toBe(secondValidated.stagedPath);
    await expect(
      environment.adapter.publish({
        childJobId: second.job.childJobId,
        desiredOutputId: "shared-output",
        source: second.job.sourceOutput,
        validated: firstValidated,
        signal,
      }),
    ).rejects.toMatchObject({ code: "output_conflict" });

    await environment.adapter.publish({
      childJobId: first.job.childJobId,
      desiredOutputId: "shared-output",
      source: first.job.sourceOutput,
      validated: firstValidated,
      signal,
    });
    await expect(
      environment.adapter.publish({
        childJobId: second.job.childJobId,
        desiredOutputId: "shared-output",
        source: second.job.sourceOutput,
        validated: secondValidated,
        signal,
      }),
    ).rejects.toMatchObject({ code: "output_conflict" });
    expect(environment.adapter.retainedCount()).toBe(1);
    await expect(
      environment.adapter.discard({
        childJobId: second.job.childJobId,
        reason: QUARANTINE_REASON,
      }),
    ).resolves.toBeUndefined();
    expect(environment.adapter.retainedCount()).toBe(0);
    await expect(fs.stat(secondValidated.stagedPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await fs.readFile(environment.sourcePath)).toEqual(
      environment.sourceBytes,
    );
    expect(await fs.readFile(second.staged.stagedPath)).toEqual(
      second.stagedBytes,
    );
  });

  it("moves a failed published output under hidden non-overwriting quarantine", async () => {
    const environment = await createEnvironment();
    const child = await createChild(environment, "quarantine");
    const signal = new AbortController().signal;
    const validated = await environment.adapter.validateAndWriteProvenance({
      job: child.job,
      staged: child.staged,
      signal,
    });
    const published = await environment.adapter.publish({
      childJobId: child.job.childJobId,
      desiredOutputId: "quarantine-output",
      source: child.job.sourceOutput,
      validated,
      signal,
    });
    const publishedBytes = await fs.readFile(published.path);
    const quarantineDirectory = path.join(
      environment.directory,
      ".nexus-quarantine",
    );
    await fs.mkdir(quarantineDirectory);
    const digest = createHash("sha256")
      .update(child.job.childJobId, "utf8")
      .update("\0", "utf8")
      .update(published.outputId, "utf8")
      .update("\0", "utf8")
      .update(published.contentHash, "utf8")
      .digest("hex")
      .slice(0, 40);
    const occupantPath = path.join(quarantineDirectory, `${digest}.mp4`);
    const occupant = Buffer.from("existing-quarantine-occupant");
    await fs.writeFile(occupantPath, occupant);

    await environment.adapter.discard({
      childJobId: child.job.childJobId,
      reason: QUARANTINE_REASON,
    });

    await expect(fs.stat(published.path)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await fs.readFile(occupantPath)).toEqual(occupant);
    const quarantinedFiles = (await fs.readdir(quarantineDirectory)).sort();
    expect(quarantinedFiles).toEqual([`${digest}-1.mp4`, `${digest}.mp4`]);
    expect(
      await fs.readFile(path.join(quarantineDirectory, `${digest}-1.mp4`)),
    ).toEqual(publishedBytes);
    expect(await fs.readFile(environment.sourcePath)).toEqual(
      environment.sourceBytes,
    );
  });

  it("shutdown removes only exact retained metadata artifacts", async () => {
    const environment = await createEnvironment();
    const child = await createChild(environment, "shutdown");
    const signal = new AbortController().signal;
    const validated = await environment.adapter.validateAndWriteProvenance({
      job: child.job,
      staged: child.staged,
      signal,
    });

    await expect(environment.adapter.shutdown()).resolves.toEqual({
      removedUnpublishedArtifacts: 1,
      retainedUnpublishedArtifacts: 0,
    });
    await expect(fs.stat(validated.stagedPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await fs.readFile(environment.sourcePath)).toEqual(
      environment.sourceBytes,
    );
    expect(await fs.readFile(child.staged.stagedPath)).toEqual(
      child.stagedBytes,
    );
    await expect(
      environment.adapter.validateAndWriteProvenance({
        job: child.job,
        staged: child.staged,
        signal,
      }),
    ).rejects.toBeInstanceOf(VideoEnhancementRuntimePortError);
  });

  it("hides an exact metadata artifact left by failed preparation", async () => {
    const environment = await createEnvironment({ ffmpegExitCode: 1 });
    const child = await createChild(environment, "failed-prepare");
    const signal = new AbortController().signal;

    await expect(
      environment.adapter.validateAndWriteProvenance({
        job: child.job,
        staged: child.staged,
        signal,
      }),
    ).rejects.toMatchObject({
      code: "provenance_failed",
      stage: "provenance",
    });

    const visibleStaged = (await fs.readdir(environment.directory)).filter(
      (entry) => /^\.nexus-enhancement-.*\.staged\.mp4$/.test(entry),
    );
    expect(visibleStaged).toEqual([]);
    const quarantined = await fs.readdir(
      path.join(environment.directory, ".nexus-quarantine"),
    );
    expect(quarantined).toHaveLength(1);
    expect(await fs.readFile(environment.sourcePath)).toEqual(
      environment.sourceBytes,
    );
    expect(await fs.readFile(child.staged.stagedPath)).toEqual(
      child.stagedBytes,
    );
  });
});

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
