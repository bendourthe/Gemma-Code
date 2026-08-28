import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { VideoEnhancementStagedSuccess } from "../../core/video/VideoEnhancement";
import type { VideoWorkflowMetadata } from "../../core/video/WorkflowMetadata";
import {
  VideoEnhancementMediaLifecycle,
  VideoEnhancementMediaLifecycleError,
  type VideoFfmpegExecutionPort,
  type VideoFfprobeExecutionPort,
} from "../sidecar/src/video/VideoEnhancementMediaLifecycle";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
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
  modelId: "qwen-image-to-video",
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

interface Fixture {
  readonly directory: string;
  readonly sourcePath: string;
  readonly stagedPath: string;
  readonly metadataPath: string;
  readonly finalPath: string;
  readonly sourceBytes: Buffer;
  readonly stagedBytes: Buffer;
  readonly staged: VideoEnhancementStagedSuccess;
}

async function fixture(name = "default"): Promise<Fixture> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), `nexus-media-lifecycle-${name}-`),
  );
  temporaryDirectories.push(directory);
  const sourcePath = path.join(directory, "source.mp4");
  const stagedPath = path.join(directory, "enhanced.partial.mp4");
  const metadataPath = path.join(directory, "enhanced.metadata.mp4");
  const finalPath = path.join(directory, "enhanced.mp4");
  const sourceBytes = Buffer.from("source-video-bytes-that-must-not-change");
  const stagedBytes = Buffer.from("enhanced-video-bytes-before-provenance");
  await fs.writeFile(sourcePath, sourceBytes);
  await fs.writeFile(stagedPath, stagedBytes);
  const sourceSha256 = sha256(sourceBytes);
  return {
    directory,
    sourcePath,
    stagedPath,
    metadataPath,
    finalPath,
    sourceBytes,
    stagedBytes,
    staged: {
      ok: true,
      outcome: "staged",
      requestId: "request-1",
      parentJobId: "parent-1",
      childJobId: "child-1",
      source: {
        path: sourcePath,
        sha256: sourceSha256,
        sizeBytes: sourceBytes.byteLength,
        durationSeconds: 4,
        width: 640,
        height: 360,
        frameRate: { numerator: 24, denominator: 1 },
      },
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
            normalizedArguments: { device: 0, scale: 2 },
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
      progress: { percent: 100, processedFrames: 96, totalFrames: 96 },
    },
  };
}

interface FakeToolOptions {
  readonly invalidOutput?:
    | "missing_video"
    | "zero_duration"
    | "wrong_dimensions"
    | "wrong_fps"
    | "duration_drift";
  readonly mutateStagedDuringEmbed?: boolean;
  readonly omitEmbeddedComment?: boolean;
}

function fakeTools(
  testFixture: Fixture,
  options: FakeToolOptions = {},
): {
  readonly ffprobe: VideoFfprobeExecutionPort;
  readonly ffmpeg: VideoFfmpegExecutionPort;
  readonly probeArgs: readonly (readonly string[])[];
  readonly ffmpegArgs: readonly (readonly string[])[];
  readonly comments: ReadonlyMap<string, string>;
} {
  const comments = new Map<string, string>();
  const probeArgs: Array<readonly string[]> = [];
  const ffmpegArgs: Array<readonly string[]> = [];
  const ffprobe: VideoFfprobeExecutionPort = {
    async run(args) {
      probeArgs.push([...args]);
      const target = args.at(-1)!;
      const stat = await fs.stat(target);
      const isSource =
        path.normalize(target) === path.normalize(testFixture.sourcePath);
      const isOutput = !isSource;
      const invalid = isOutput ? options.invalidOutput : undefined;
      const streams =
        invalid === "missing_video"
          ? [{ index: 1, codec_type: "audio" }]
          : [
              {
                index: 0,
                codec_type: "video",
                width:
                  invalid === "wrong_dimensions" ? 1279 : isSource ? 640 : 1280,
                height: isSource ? 360 : 720,
                avg_frame_rate: invalid === "wrong_fps" ? "30/1" : "24000/1000",
                r_frame_rate: "24/1",
                nb_frames: "96",
              },
              { index: 1, codec_type: "audio" },
            ];
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          format: {
            size: String(stat.size),
            duration:
              invalid === "zero_duration"
                ? "0"
                : invalid === "duration_drift"
                  ? "4.5001"
                  : "4.0",
            tags: comments.has(target)
              ? { comment: comments.get(target) }
              : undefined,
          },
          streams,
        }),
      };
    },
  };
  const ffmpeg: VideoFfmpegExecutionPort = {
    async run(args) {
      ffmpegArgs.push([...args]);
      const inputIndex = args.indexOf("-i") + 1;
      const metadataIndex = args.indexOf("-metadata") + 1;
      const input = args[inputIndex]!;
      const output = args.at(-1)!;
      const comment = args[metadataIndex]!.slice("comment=".length);
      await fs.copyFile(input, output, fs.constants.COPYFILE_EXCL);
      await fs.appendFile(output, Buffer.from("-embedded-metadata"));
      if (options.mutateStagedDuringEmbed) {
        await fs.appendFile(input, Buffer.from("-unexpected-mutation"));
      }
      if (!options.omitEmbeddedComment) comments.set(output, comment);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
  return { ffprobe, ffmpeg, probeArgs, ffmpegArgs, comments };
}

function prepareInput(testFixture: Fixture, suffix = "1") {
  return {
    sourceGenerationId: "generation-1",
    sourceOutputId: "output-1",
    provenanceRecordId: `provenance-${suffix}`,
    nexusRelease: "v2.3.0",
    presetRouting: "explicit" as const,
    sourceWorkflow: SOURCE_WORKFLOW,
    staged: testFixture.staged,
    metadataStagedPath:
      suffix === "1"
        ? testFixture.metadataPath
        : path.join(testFixture.directory, `enhanced-${suffix}.metadata.mp4`),
    finalPath: testFixture.finalPath,
  };
}

describe("VideoEnhancementMediaLifecycle", () => {
  it("verifies canonical source media and detects changed bytes", async () => {
    const testFixture = await fixture("verify-source");
    const tools = fakeTools(testFixture);
    const lifecycle = new VideoEnhancementMediaLifecycle(
      tools.ffprobe,
      tools.ffmpeg,
    );

    await expect(
      lifecycle.verifySource(testFixture.staged.source),
    ).resolves.toEqual(testFixture.staged.source);
    await fs.appendFile(testFixture.sourcePath, Buffer.from("-changed"));
    await expect(
      lifecycle.verifySource(testFixture.staged.source),
    ).rejects.toMatchObject({
      code: "source_changed",
      stage: "validate",
    });
  });

  it("validates, embeds strict provenance, preserves inputs, and atomically promotes", async () => {
    const testFixture = await fixture();
    const tools = fakeTools(testFixture);
    const lifecycle = new VideoEnhancementMediaLifecycle(
      tools.ffprobe,
      tools.ffmpeg,
    );

    const prepared = await lifecycle.prepare(prepareInput(testFixture));

    expect(prepared.preProvenanceContainerSha256).toBe(
      sha256(testFixture.stagedBytes),
    );
    expect(prepared.embeddedProvenance.source).toMatchObject({
      generationId: "generation-1",
      outputId: "output-1",
      sha256: sha256(testFixture.sourceBytes),
    });
    expect(prepared.embeddedProvenance.backend.version).toBe("6.4.0");
    expect(prepared.embeddedProvenance.execution.selectedDevice.name).toBe(
      "Test GPU",
    );
    expect(prepared.embeddedProvenance.stages[0]!.backend.model).toBe(
      "realesr-animevideov3",
    );
    expect(prepared.embeddedProvenance).not.toHaveProperty(
      "publishedContainerSha256",
    );
    expect(prepared.durableProvenance.publishedContainerSha256).toBe(
      prepared.publishedContainerSha256,
    );
    const serialized = tools.comments.get(testFixture.metadataPath)!;
    expect(serialized).not.toContain("publishedContainerSha256");
    expect(JSON.parse(serialized).enhancement.provenanceRecordId).toBe(
      "provenance-1",
    );
    expect(await fs.readFile(testFixture.sourcePath)).toEqual(
      testFixture.sourceBytes,
    );
    expect(await fs.readFile(testFixture.stagedPath)).toEqual(
      testFixture.stagedBytes,
    );
    expect(tools.probeArgs).toHaveLength(3);
    expect(tools.ffmpegArgs[0]).toContain("-n");
    expect(tools.ffmpegArgs[0]).not.toContain("-y");

    const promoted = await lifecycle.promote(prepared);

    expect(promoted).toMatchObject({
      finalPath: testFixture.finalPath,
      publishedContainerSha256: prepared.publishedContainerSha256,
      stagedCopyRetained: false,
    });
    expect(await fs.readFile(testFixture.sourcePath)).toEqual(
      testFixture.sourceBytes,
    );
    expect(await fs.readFile(testFixture.finalPath)).toEqual(
      Buffer.concat([
        testFixture.stagedBytes,
        Buffer.from("-embedded-metadata"),
      ]),
    );
    await expect(fs.stat(testFixture.metadataPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each([
    "missing_video",
    "zero_duration",
    "wrong_dimensions",
    "wrong_fps",
    "duration_drift",
  ] as const)("returns output_invalid for %s", async (invalidOutput) => {
    const testFixture = await fixture(invalidOutput);
    const tools = fakeTools(testFixture, { invalidOutput });
    const lifecycle = new VideoEnhancementMediaLifecycle(
      tools.ffprobe,
      tools.ffmpeg,
    );

    await expect(
      lifecycle.prepare(prepareInput(testFixture)),
    ).rejects.toMatchObject({
      name: "VideoEnhancementMediaLifecycleError",
      code: "output_invalid",
      stage: "validate",
    });
    expect(tools.ffmpegArgs).toHaveLength(0);
    expect(await fs.readFile(testFixture.sourcePath)).toEqual(
      testFixture.sourceBytes,
    );
  });

  it("fails closed without overwriting a destination created after preparation", async () => {
    const testFixture = await fixture("conflict");
    const tools = fakeTools(testFixture);
    const lifecycle = new VideoEnhancementMediaLifecycle(
      tools.ffprobe,
      tools.ffmpeg,
    );
    const prepared = await lifecycle.prepare(prepareInput(testFixture));
    const occupant = Buffer.from("unrelated-existing-output");
    await fs.writeFile(testFixture.finalPath, occupant);

    await expect(lifecycle.promote(prepared)).rejects.toMatchObject({
      name: "VideoEnhancementMediaLifecycleError",
      code: "output_conflict",
      stage: "publish",
    });
    expect(await fs.readFile(testFixture.finalPath)).toEqual(occupant);
    expect(await fs.readFile(testFixture.metadataPath)).toEqual(
      Buffer.concat([
        testFixture.stagedBytes,
        Buffer.from("-embedded-metadata"),
      ]),
    );
  });

  it("removes its exact final link when post-link hash verification fails", async () => {
    const testFixture = await fixture("post-link-hash");
    const tools = fakeTools(testFixture);
    const lifecycle = new VideoEnhancementMediaLifecycle(
      tools.ffprobe,
      tools.ffmpeg,
    );
    const prepared = await lifecycle.prepare(prepareInput(testFixture));
    const link = fs.link.bind(fs);
    vi.spyOn(fs, "link").mockImplementation(async (source, destination) => {
      await link(source, destination);
      const bytes = await fs.readFile(destination);
      bytes[0] = bytes[0] === 0xff ? 0 : bytes[0]! + 1;
      await fs.writeFile(destination, bytes);
    });

    await expect(lifecycle.promote(prepared)).rejects.toMatchObject({
      code: "publish_failed",
      stage: "publish",
    });
    await expect(fs.lstat(testFixture.finalPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("preserves an unrelated path replacement after post-link identity failure", async () => {
    const testFixture = await fixture("post-link-replacement");
    const tools = fakeTools(testFixture);
    const lifecycle = new VideoEnhancementMediaLifecycle(
      tools.ffprobe,
      tools.ffmpeg,
    );
    const prepared = await lifecycle.prepare(prepareInput(testFixture));
    const occupant = Buffer.from("unrelated-replacement");
    const link = fs.link.bind(fs);
    vi.spyOn(fs, "link").mockImplementation(async (source, destination) => {
      await link(source, destination);
      await fs.unlink(destination);
      await fs.writeFile(destination, occupant);
    });

    await expect(lifecycle.promote(prepared)).rejects.toMatchObject({
      code: "publish_failed",
      stage: "publish",
    });
    expect(await fs.readFile(testFixture.finalPath)).toEqual(occupant);
  });

  it("removes its exact final link when the source changes after linking", async () => {
    const testFixture = await fixture("post-link-source");
    const tools = fakeTools(testFixture);
    const lifecycle = new VideoEnhancementMediaLifecycle(
      tools.ffprobe,
      tools.ffmpeg,
    );
    const prepared = await lifecycle.prepare(prepareInput(testFixture));
    const link = fs.link.bind(fs);
    vi.spyOn(fs, "link").mockImplementation(async (source, destination) => {
      await link(source, destination);
      const bytes = Buffer.from(testFixture.sourceBytes);
      bytes[0] = bytes[0] === 0xff ? 0 : bytes[0]! + 1;
      await fs.writeFile(testFixture.sourcePath, bytes);
    });

    await expect(lifecycle.promote(prepared)).rejects.toMatchObject({
      code: "source_changed",
      stage: "publish",
    });
    await expect(fs.lstat(testFixture.finalPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("removes its exact final link when cancellation arrives after linking", async () => {
    const testFixture = await fixture("post-link-cancel");
    const tools = fakeTools(testFixture);
    const lifecycle = new VideoEnhancementMediaLifecycle(
      tools.ffprobe,
      tools.ffmpeg,
    );
    const prepared = await lifecycle.prepare(prepareInput(testFixture));
    const controller = new AbortController();
    const link = fs.link.bind(fs);
    vi.spyOn(fs, "link").mockImplementation(async (source, destination) => {
      await link(source, destination);
      controller.abort();
    });

    await expect(
      lifecycle.promote(prepared, controller.signal),
    ).rejects.toMatchObject({
      code: "cancelled",
      stage: "publish",
    });
    await expect(fs.lstat(testFixture.finalPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each([
    ["staged identity changes", { mutateStagedDuringEmbed: true }],
    ["embedded comment is absent", { omitEmbeddedComment: true }],
  ] as const)("returns provenance_failed when %s", async (_label, options) => {
    const testFixture = await fixture("provenance-failure");
    const tools = fakeTools(testFixture, options);
    const lifecycle = new VideoEnhancementMediaLifecycle(
      tools.ffprobe,
      tools.ffmpeg,
    );

    await expect(
      lifecycle.prepare(prepareInput(testFixture)),
    ).rejects.toMatchObject({
      name: "VideoEnhancementMediaLifecycleError",
      code: "provenance_failed",
      stage: "provenance",
    });
    await expect(fs.stat(testFixture.finalPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await fs.readFile(testFixture.sourcePath)).toEqual(
      testFixture.sourceBytes,
    );
  });

  it("allows exactly one of two concurrent no-overwrite promotions", async () => {
    const testFixture = await fixture("concurrent");
    const tools = fakeTools(testFixture);
    const lifecycle = new VideoEnhancementMediaLifecycle(
      tools.ffprobe,
      tools.ffmpeg,
    );
    const [first, second] = await Promise.all([
      lifecycle.prepare(prepareInput(testFixture, "1")),
      lifecycle.prepare(prepareInput(testFixture, "2")),
    ]);

    const results = await Promise.allSettled([
      lifecycle.promote(first),
      lifecycle.promote(second),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toBeInstanceOf(
      VideoEnhancementMediaLifecycleError,
    );
    expect(rejected?.reason).toMatchObject({ code: "output_conflict" });
    expect(await fs.readFile(testFixture.sourcePath)).toEqual(
      testFixture.sourceBytes,
    );
  });

  it("returns cancellation before invoking either media tool", async () => {
    const testFixture = await fixture("cancelled");
    const tools = fakeTools(testFixture);
    const lifecycle = new VideoEnhancementMediaLifecycle(
      tools.ffprobe,
      tools.ffmpeg,
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      lifecycle.prepare({
        ...prepareInput(testFixture),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(tools.probeArgs).toHaveLength(0);
    expect(tools.ffmpegArgs).toHaveLength(0);
  });
});

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
