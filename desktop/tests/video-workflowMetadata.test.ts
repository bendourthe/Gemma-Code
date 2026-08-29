import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  createVideoEnhancementDurableProvenance,
  createVideoEnhancementEmbeddedProvenance,
  embedWorkflow,
  extractCommentRaw,
  extractWorkflow,
  serializeVideoWorkflowMetadata,
  type VideoEnhancementEmbeddedProvenance,
  type VideoWorkflowMetadata,
} from "../../core/video/WorkflowMetadata";

type SpawnFn = typeof import("node:child_process").spawn;

interface SpawnCall {
  command: string;
  args: readonly string[];
}

interface FakeProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
}

function fakeSpawn(
  responses: Array<{ stdout?: string; stderr?: string; code?: number }>,
  log: SpawnCall[],
): SpawnFn {
  const queue = [...responses];
  return ((command: string, args: readonly string[]) => {
    log.push({ command, args });
    const emitter = new EventEmitter() as FakeProcess;
    emitter.stdout = new EventEmitter();
    emitter.stderr = new EventEmitter();
    const next = queue.shift() ?? { code: 0 };
    queueMicrotask(() => {
      if (next.stdout) {
        emitter.stdout.emit("data", Buffer.from(next.stdout));
      }
      if (next.stderr) {
        emitter.stderr.emit("data", Buffer.from(next.stderr));
      }
      emitter.emit("close", next.code ?? 0);
    });
    return emitter as unknown as ReturnType<SpawnFn>;
  }) as SpawnFn;
}

const SAMPLE_WORKFLOW: VideoWorkflowMetadata = {
  tool: "nexus",
  version: "1.0.0",
  kind: "video",
  mode: "text2video",
  modelId: "ltx-video",
  prompt: "a fox",
  width: 854,
  height: 480,
  durationSeconds: 4,
  fps: 24,
  frameCount: 96,
  steps: 30,
  cfgScale: 3.5,
  sampler: "euler_a",
  seed: 17,
  timestamp: "2026-05-17T00:00:00Z",
};

const SAMPLE_ENHANCEMENT: VideoEnhancementEmbeddedProvenance = {
  schemaVersion: 1,
  nexusRelease: "v2.3.0",
  provenanceRecordId: "provenance-1",
  parentJobId: "parent-1",
  requestId: "request-1",
  childJobId: "child-1",
  mode: "upscale",
  upscalePreset: "animation-upscale-2x",
  interpolationPreset: null,
  presetRouting: "explicit",
  source: {
    generationId: "generation-1",
    outputId: "output-1",
    sha256: "a".repeat(64),
    sizeBytes: 100,
    durationSeconds: 4,
    width: 640,
    height: 360,
    frameRate: { numerator: 24, denominator: 1 },
  },
  output: {
    preProvenanceContainerSha256: "b".repeat(64),
    sizeBytes: 200,
    durationSeconds: 4,
    width: 1280,
    height: 720,
    frameRate: { numerator: 24, denominator: 1 },
    frameCount: 96,
  },
  backend: {
    id: "video2x",
    compatibilityId: "video2x-cli-6.4.0",
    version: "6.4.0",
    executableSha256: "c".repeat(64),
    provenance: "user-supplied-unverified",
    configurationSource: "setting",
  },
  execution: {
    platform: { os: "win32", architecture: "x64", avx2: "available" },
    selectedDevice: { id: 0, type: "discrete_gpu", name: "Test GPU" },
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
    subtitlePreservation: "preserved",
  },
  startedAt: "2026-08-28T00:00:00.000Z",
  completedAt: "2026-08-28T00:00:01.000Z",
  durationMs: 1_000,
  outcome: "completed",
};

describe("video WorkflowMetadata", () => {
  it("embedWorkflow runs ffmpeg with -metadata comment=<sorted-json>", async () => {
    const log: SpawnCall[] = [];
    const spawnFn = fakeSpawn([{ code: 0 }], log);
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "nexus-video-test-"),
    );
    try {
      const inputPath = path.join(tmpDir, "in.mp4");
      const tempPath = `${inputPath}.nexus-tmp.mp4`;
      await fs.writeFile(inputPath, Buffer.from("FAKEMP4-orig"));
      await fs.writeFile(tempPath, Buffer.from("FAKEMP4-new"));
      await embedWorkflow(inputPath, SAMPLE_WORKFLOW, {
        ffmpegPath: "/opt/ffmpeg",
        ffprobePath: "/opt/ffprobe",
        spawnFn,
      });
      expect(log).toHaveLength(1);
      expect(log[0]!.command).toBe("/opt/ffmpeg");
      const args = log[0]!.args;
      expect(args).toContain("-c");
      expect(args).toContain("copy");
      const metaIdx = args.indexOf("-metadata");
      expect(metaIdx).toBeGreaterThanOrEqual(0);
      const metaArg = args[metaIdx + 1]!;
      expect(metaArg.startsWith("comment=")).toBe(true);
      const json = metaArg.slice("comment=".length);
      const parsed = JSON.parse(json);
      expect(parsed.prompt).toBe("a fox");
      // After embed, the input has been renamed-from-temp; check contents.
      const after = await fs.readFile(inputPath, "utf8");
      expect(after).toBe("FAKEMP4-new");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("embedWorkflow surfaces ffmpeg failure as an Error", async () => {
    const log: SpawnCall[] = [];
    const spawnFn = fakeSpawn([{ code: 1, stderr: "ffmpeg: bad input" }], log);
    await expect(
      embedWorkflow("/tmp/x.mp4", SAMPLE_WORKFLOW, {
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        spawnFn,
      }),
    ).rejects.toThrow(/ffmpeg failed \(1\): ffmpeg: bad input/);
  });

  it("extractWorkflow returns the parsed workflow when ffprobe emits it", async () => {
    const log: SpawnCall[] = [];
    const probeOutput = JSON.stringify({
      format: {
        tags: { comment: JSON.stringify(SAMPLE_WORKFLOW) },
      },
    });
    const spawnFn = fakeSpawn([{ stdout: probeOutput, code: 0 }], log);
    const workflow = await extractWorkflow("/tmp/x.mp4", {
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      spawnFn,
    });
    expect(workflow).not.toBeNull();
    expect(workflow!.prompt).toBe("a fox");
    expect(workflow!.kind).toBe("video");
    expect(log[0]!.args).toContain("-show_format");
  });

  it("extractWorkflow returns null when the comment is not JSON", async () => {
    const probeOutput = JSON.stringify({
      format: { tags: { comment: "not json" } },
    });
    const spawnFn = fakeSpawn([{ stdout: probeOutput, code: 0 }], []);
    const workflow = await extractWorkflow("/tmp/x.mp4", {
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      spawnFn,
    });
    expect(workflow).toBeNull();
  });

  it("extractWorkflow returns null when no comment tag is present", async () => {
    const probeOutput = JSON.stringify({ format: { tags: {} } });
    const spawnFn = fakeSpawn([{ stdout: probeOutput, code: 0 }], []);
    const workflow = await extractWorkflow("/tmp/x.mp4", {
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      spawnFn,
    });
    expect(workflow).toBeNull();
  });

  it("extractWorkflow returns null when the workflow is wrong shape", async () => {
    const probeOutput = JSON.stringify({
      format: {
        tags: { comment: JSON.stringify({ kind: "image", prompt: "fox" }) },
      },
    });
    const spawnFn = fakeSpawn([{ stdout: probeOutput, code: 0 }], []);
    const workflow = await extractWorkflow("/tmp/x.mp4", {
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      spawnFn,
    });
    expect(workflow).toBeNull();
  });

  it("extractWorkflow surfaces ffprobe failure", async () => {
    const spawnFn = fakeSpawn(
      [{ code: 2, stderr: "ffprobe: cannot open" }],
      [],
    );
    await expect(
      extractWorkflow("/tmp/x.mp4", {
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        spawnFn,
      }),
    ).rejects.toThrow(/ffprobe failed/);
  });

  it("extractCommentRaw handles the COMMENT (uppercase) tag", async () => {
    const probeOutput = JSON.stringify({
      format: { tags: { COMMENT: "raw value" } },
    });
    const spawnFn = fakeSpawn([{ stdout: probeOutput, code: 0 }], []);
    const raw = await extractCommentRaw("/tmp/x.mp4", {
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      spawnFn,
    });
    expect(raw).toBe("raw value");
  });

  it("extractCommentRaw returns null when ffprobe output is not JSON", async () => {
    const spawnFn = fakeSpawn([{ stdout: "<not json>", code: 0 }], []);
    const raw = await extractCommentRaw("/tmp/x.mp4", {
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      spawnFn,
    });
    expect(raw).toBeNull();
  });

  it("round-trip: embed then extract preserves every field", async () => {
    const log: SpawnCall[] = [];
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-video-rt-"));
    try {
      const inputPath = path.join(tmpDir, "rt.mp4");
      const tempPath = `${inputPath}.nexus-tmp.mp4`;
      await fs.writeFile(inputPath, Buffer.from("FAKEMP4"));
      await fs.writeFile(tempPath, Buffer.from("FAKEMP4-after-embed"));
      let recordedJson: string | null = null;
      const spawnFn: SpawnFn = ((command: string, args: readonly string[]) => {
        log.push({ command, args });
        const emitter = new EventEmitter() as FakeProcess;
        emitter.stdout = new EventEmitter();
        emitter.stderr = new EventEmitter();
        queueMicrotask(() => {
          if (command.endsWith("ffmpeg") || command === "ffmpeg") {
            const metaIdx = args.indexOf("-metadata");
            recordedJson = args[metaIdx + 1]!.slice("comment=".length);
            emitter.emit("close", 0);
          } else {
            const probe = JSON.stringify({
              format: { tags: { comment: recordedJson ?? "" } },
            });
            emitter.stdout.emit("data", Buffer.from(probe));
            emitter.emit("close", 0);
          }
        });
        return emitter as unknown as ReturnType<SpawnFn>;
      }) as SpawnFn;
      const ctx = {
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        spawnFn,
      };
      await embedWorkflow(inputPath, SAMPLE_WORKFLOW, ctx);
      const extracted = await extractWorkflow(inputPath, ctx);
      expect(extracted).toEqual(SAMPLE_WORKFLOW);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("creates an exact deeply immutable embedded enhancement record", () => {
    const normalized = createVideoEnhancementEmbeddedProvenance({
      ...SAMPLE_ENHANCEMENT,
      source: { ...SAMPLE_ENHANCEMENT.source, sha256: "A".repeat(64) },
    });

    expect(normalized.source.sha256).toBe("a".repeat(64));
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.source)).toBe(true);
    expect(Object.isFrozen(normalized.stages)).toBe(true);
    expect(
      Object.isFrozen(normalized.stages[0]!.backend.normalizedArguments),
    ).toBe(true);
  });

  it("serializes and extracts the normalized immutable enhancement projection", async () => {
    const workflow = {
      ...SAMPLE_WORKFLOW,
      enhancement: {
        ...SAMPLE_ENHANCEMENT,
        source: { ...SAMPLE_ENHANCEMENT.source, sha256: "A".repeat(64) },
      },
    };
    const serialized = serializeVideoWorkflowMetadata(workflow);
    expect(JSON.parse(serialized).enhancement.source.sha256).toBe(
      "a".repeat(64),
    );
    const probeOutput = JSON.stringify({
      format: { tags: { comment: serialized } },
    });
    const spawnFn = fakeSpawn([{ stdout: probeOutput, code: 0 }], []);

    const extracted = await extractWorkflow("/tmp/x.mp4", {
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      spawnFn,
    });

    expect(extracted?.enhancement?.source.sha256).toBe("a".repeat(64));
    expect(Object.isFrozen(extracted)).toBe(true);
    expect(Object.isFrozen(extracted?.enhancement)).toBe(true);
  });

  it("rejects semantically contradictory preset and output facts", () => {
    expect(() =>
      createVideoEnhancementEmbeddedProvenance({
        ...SAMPLE_ENHANCEMENT,
        output: { ...SAMPLE_ENHANCEMENT.output, width: 2560 },
      }),
    ).toThrow(/Invalid video enhancement provenance/);
    expect(() =>
      createVideoEnhancementEmbeddedProvenance({
        ...SAMPLE_ENHANCEMENT,
        stages: [
          {
            ...SAMPLE_ENHANCEMENT.stages[0],
            parameters: {
              stage: "upscale",
              presetId: "animation-upscale-2x",
              contentClass: "general",
              scaleFactor: 2,
            },
          },
        ],
      }),
    ).toThrow(/Invalid video enhancement provenance/);
  });

  it("keeps the final container hash in the durable projection only", () => {
    const embedded =
      createVideoEnhancementEmbeddedProvenance(SAMPLE_ENHANCEMENT);
    const durable = createVideoEnhancementDurableProvenance(
      embedded,
      "D".repeat(64),
    );

    expect(embedded).not.toHaveProperty("publishedContainerSha256");
    expect(durable.publishedContainerSha256).toBe("d".repeat(64));
    expect(() =>
      serializeVideoWorkflowMetadata({
        ...SAMPLE_WORKFLOW,
        enhancement: durable,
      }),
    ).toThrow(/durable-index-only|Invalid video enhancement provenance/);
  });

  it("rejects extra fields and embedded final hashes during extraction", async () => {
    const malformed = {
      ...SAMPLE_ENHANCEMENT,
      publishedContainerSha256: "d".repeat(64),
    };
    const probeOutput = JSON.stringify({
      format: {
        tags: {
          comment: JSON.stringify({
            ...SAMPLE_WORKFLOW,
            enhancement: malformed,
          }),
        },
      },
    });
    const spawnFn = fakeSpawn([{ stdout: probeOutput, code: 0 }], []);

    await expect(
      extractWorkflow("/tmp/x.mp4", {
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        spawnFn,
      }),
    ).resolves.toBeNull();
  });

  it("rejects accessor-backed provenance without invoking the accessor", () => {
    let invoked = false;
    const source = { ...SAMPLE_ENHANCEMENT.source };
    Object.defineProperty(source, "sha256", {
      enumerable: true,
      get() {
        invoked = true;
        return "a".repeat(64);
      },
    });

    expect(() =>
      createVideoEnhancementEmbeddedProvenance({
        ...SAMPLE_ENHANCEMENT,
        source,
      }),
    ).toThrow(/Invalid video enhancement provenance/);
    expect(invoked).toBe(false);
  });
});
