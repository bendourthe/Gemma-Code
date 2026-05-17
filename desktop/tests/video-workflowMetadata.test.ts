import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  embedWorkflow,
  extractCommentRaw,
  extractWorkflow,
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

describe("video WorkflowMetadata", () => {
  it("embedWorkflow runs ffmpeg with -metadata comment=<sorted-json>", async () => {
    const log: SpawnCall[] = [];
    const spawnFn = fakeSpawn([{ code: 0 }], log);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-video-test-"));
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
    const spawnFn = fakeSpawn(
      [{ code: 1, stderr: "ffmpeg: bad input" }],
      log,
    );
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
});
