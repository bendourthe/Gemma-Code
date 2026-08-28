import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dispatch, createHandlerContext } from "../sidecar/src/handlers";
import { CodingSessionManager } from "../sidecar/src/coding/sessionManager";
import {
  closeStudioRuntime,
  createStudioRuntime,
} from "../sidecar/src/generations/studioRuntime";
import {
  createMinimalPng,
  createUsablePng,
  embedWorkflow,
} from "../../core/image/WorkflowMetadata";
import { IPC_METHODS, METHOD_SCHEMAS } from "../sidecar/src/protocol";
import {
  InMemoryDiffusionRuntime,
  type DiffusionEvent,
  type DiffusionRuntimeClient,
} from "../sidecar/src/diffusion/runtimeClient";
import { contentHash } from "../../core/generations/contentHash";

class DeferredDiffusionRuntime implements DiffusionRuntimeClient {
  readonly calls: Array<{ method: string; params: Record<string, unknown> }> =
    [];
  readonly started: Promise<void>;
  private start!: () => void;
  private finish!: (value: unknown) => void;
  private readonly response: Promise<unknown>;

  constructor() {
    this.started = new Promise<void>((resolve) => {
      this.start = resolve;
    });
    this.response = new Promise<unknown>((resolve) => {
      this.finish = resolve;
    });
  }

  call<T = unknown>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    this.calls.push({ method, params });
    this.start();
    return this.response as Promise<T>;
  }

  complete(value: unknown): void {
    this.finish(value);
  }

  drainEvents(_jobId: string): readonly DiffusionEvent[] {
    return [];
  }

  async shutdown(): Promise<void> {}
}

function makeCtx() {
  return createHandlerContext(
    { pid: 1, platform: process.platform },
    new CodingSessionManager({
      now: () => new Date("2026-05-17T11:00:00Z"),
      idFactory: (() => {
        let i = 0;
        return () => `s-${++i}`;
      })(),
    }),
  );
}

async function drainTerminalEvent(
  ctx: ReturnType<typeof makeCtx>,
  jobId: string,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const reply = (await dispatch(
      "diffusion.job.drainEvents",
      { jobId },
      ctx,
    )) as {
      events: {
        kind: string;
        jobId: string;
        message?: string;
        outputPath?: string;
      }[];
    };
    const terminal = reply.events.find(
      (event) => event.kind === "complete" || event.kind === "error",
    );
    if (terminal) return terminal;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`No terminal diffusion event for ${jobId}`);
}

describe("generation queue IPC", () => {
  it("resolves ffmpeg paths when the handler context is constructed", () => {
    const previousFfmpeg = process.env.NEXUS_FFMPEG_PATH;
    const previousFfprobe = process.env.NEXUS_FFPROBE_PATH;
    process.env.NEXUS_FFMPEG_PATH = "C:\\runtime\\ffmpeg.exe";
    process.env.NEXUS_FFPROBE_PATH = "C:\\runtime\\ffprobe.exe";
    try {
      expect(makeCtx().ffmpeg).toEqual({
        ffmpegPath: "C:\\runtime\\ffmpeg.exe",
        ffprobePath: "C:\\runtime\\ffprobe.exe",
      });
    } finally {
      if (previousFfmpeg === undefined) delete process.env.NEXUS_FFMPEG_PATH;
      else process.env.NEXUS_FFMPEG_PATH = previousFfmpeg;
      if (previousFfprobe === undefined) delete process.env.NEXUS_FFPROBE_PATH;
      else process.env.NEXUS_FFPROBE_PATH = previousFfprobe;
    }
  });

  it("registers queue methods as implemented", () => {
    for (const method of [
      "generation.queue.list",
      "generation.queue.enqueue",
      "generation.queue.cancel",
      "generation.queue.reorder",
      "generation.queue.pendingCount",
      "generation.scheduler.snapshot",
    ] as const) {
      expect(IPC_METHODS).toContain(method);
      expect(METHOD_SCHEMAS[method].implemented).toBe(true);
    }
  });

  it("returns the active Studio scheduler job", async () => {
    const ctx = makeCtx();
    ctx.studio = createStudioRuntime({ dbPath: ":memory:", vramGB: 24 });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handle = await ctx.studio.scheduler.enqueue({
      id: "active-image",
      moduleId: "image",
      jobType: "txt2img",
      modelId: "sana-1.6b-1024",
      estimatedVramGB: 3.2,
      priority: "foreground",
      run: async () => blocked,
    });
    for (
      let attempt = 0;
      attempt < 10 && ctx.studio.scheduler.snapshot().active === null;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const snapshot = (await dispatch(
      "generation.scheduler.snapshot",
      {},
      ctx,
    )) as {
      active: {
        id: string;
        moduleId: string;
        modelId?: string;
        estimatedVramGB: number;
      } | null;
    };
    expect(snapshot.active).toMatchObject({
      id: "active-image",
      moduleId: "image",
      modelId: "sana-1.6b-1024",
      estimatedVramGB: 3.2,
    });
    release();
    await handle.completion;
  });

  it("shares one database owner between the queue and output index", async () => {
    const studio = createStudioRuntime({ dbPath: ":memory:" });
    try {
      studio.queue.enqueue({
        id: "video-parent",
        pillar: "video",
        jobType: "text2video",
        parameters: { prompt: "source" },
      });
      studio.queue.markDone("video-parent");
      const output = studio.index.putOutput({
        id: "video-output",
        jobId: "video-parent",
        pillar: "video",
        outputPath: "C:\\nexus\\outputs\\source.mp4",
        contentHash: "a".repeat(64),
        workflow: { mode: "text2video" },
      });
      expect(studio.index.getOutput(output.id)).toMatchObject({
        jobId: "video-parent",
        contentHash: "a".repeat(64),
      });
    } finally {
      await closeStudioRuntime(studio, 0);
    }
  });

  it("enqueues a seed range and reports pending count", async () => {
    const ctx = makeCtx();
    ctx.studio = createStudioRuntime({ dbPath: ":memory:" });
    const result = (await dispatch(
      "generation.queue.enqueue",
      {
        id: "sweep",
        pillar: "image",
        jobType: "txt2img",
        parameters: { prompt: "fox", seed: 1 },
        batchSpec: { kind: "seed-range", start: 1, end: 2 },
      },
      ctx,
    )) as { jobs: { id: string }[] };
    expect(result.jobs.length).toBe(2);
    expect(result.jobs.map((j) => j.id)).toEqual(["sweep", "sweep:1"]);
  });

  it("extract falls back to the generation index when PNG has no chunk", async () => {
    const ctx = makeCtx();
    ctx.studio = createStudioRuntime({ dbPath: ":memory:" });
    const png = createMinimalPng();
    ctx.studio.index.put(png, "image", {
      tool: "nexus",
      version: "1.0.0",
      mode: "txt2img",
      prompt: "indexed fox",
      modelId: "sana-1.6b-1024",
      width: 1024,
      height: 1024,
      steps: 4,
      cfgScale: 1.5,
      sampler: "euler_a",
      seed: 1,
      timestamp: "2026-08-20T00:00:00Z",
    });
    const reply = (await dispatch(
      "diffusion.workflow.extract",
      { pngBase64: png.toString("base64") },
      ctx,
    )) as { workflow: { prompt: string } | null };
    expect(reply.workflow?.prompt).toBe("indexed fox");
  });

  it("extract reads embedded workflow including schemaVersion", async () => {
    const ctx = makeCtx();
    const embedded = embedWorkflow(createMinimalPng(), {
      tool: "nexus",
      version: "1.0.0",
      mode: "txt2img",
      prompt: "embedded",
      modelId: "sana-1.6b-1024",
      width: 1024,
      height: 1024,
      steps: 4,
      cfgScale: 1.5,
      sampler: "euler_a",
      seed: 3,
      timestamp: "2026-08-20T00:00:00Z",
      schemaVersion: 1,
    });
    const reply = (await dispatch(
      "diffusion.workflow.extract",
      { pngBase64: embedded.toString("base64") },
      ctx,
    )) as { workflow: { prompt: string; schemaVersion?: number } | null };
    expect(reply.workflow?.prompt).toBe("embedded");
    expect(reply.workflow?.schemaVersion).toBe(1);
  });

  it("interactive txt2img enqueues then returns a job id without blocking", async () => {
    const ctx = makeCtx();
    ctx.studio = createStudioRuntime({ dbPath: ":memory:" });
    const reply = (await dispatch(
      "diffusion.txt2img",
      {
        modelId: "sana-1.6b-1024",
        prompt: "fox",
        width: 512,
        height: 512,
        steps: 4,
        cfgScale: 1.5,
        sampler: "euler_a",
        seed: 1,
      },
      ctx,
    )) as { jobId: string; mode: string };
    expect(reply.jobId.length).toBeGreaterThan(0);
    expect(reply.mode).toBe("txt2img");
    const listed = (await dispatch("generation.queue.list", {}, ctx)) as {
      jobs: {
        id: string;
        priority: string;
        parentId: string | null;
        enhancement: unknown | null;
      }[];
    };
    expect(
      listed.jobs.some(
        (j) =>
          j.id === reply.jobId &&
          j.priority === "interactive" &&
          j.parentId === null &&
          j.enhancement === null,
      ),
    ).toBe(true);
  });

  it("emits an error event when txt2img completes without image bytes", async () => {
    const runtime = new InMemoryDiffusionRuntime();
    runtime.setResponse("sana.txt2img", {});
    const ctx = createHandlerContext(
      { pid: 1, platform: process.platform },
      new CodingSessionManager(),
      runtime,
    );
    ctx.studio = createStudioRuntime({ dbPath: ":memory:" });
    const reply = (await dispatch(
      "diffusion.txt2img",
      {
        modelId: "sana-1.6b-1024",
        prompt: "fox",
        width: 512,
        height: 512,
        steps: 4,
        cfgScale: 1.5,
        sampler: "euler_a",
        seed: 1,
      },
      ctx,
    )) as { jobId: string };
    await expect(drainTerminalEvent(ctx, reply.jobId)).resolves.toMatchObject({
      kind: "error",
      jobId: reply.jobId,
      message: expect.stringMatching(/runtime is not ready/),
    });
  });

  it("emits a playable video completion when workflow metadata is absent", async () => {
    const runtime = new InMemoryDiffusionRuntime();
    runtime.setResponse("diffusion.video.text2video", {
      mp4Path: "C:\\nexus\\outputs\\clip.mp4",
    });
    const ctx = createHandlerContext(
      { pid: 1, platform: process.platform },
      new CodingSessionManager(),
      runtime,
    );
    ctx.studio = createStudioRuntime({ dbPath: ":memory:" });
    const reply = (await dispatch(
      "diffusion.video.text2video",
      {
        modelId: "wan2.1-t2v-1.3b",
        prompt: "fox",
        width: 854,
        height: 480,
        durationSeconds: 4,
        fps: 24,
        steps: 30,
        cfgScale: 3.5,
        seed: 7,
      },
      ctx,
    )) as { jobId: string };
    await expect(drainTerminalEvent(ctx, reply.jobId)).resolves.toMatchObject({
      kind: "complete",
      jobId: reply.jobId,
      outputPath: "C:\\nexus\\outputs\\clip.mp4",
    });
  });

  it("stream-hashes and registers a workflow-bearing video output before completion", async () => {
    const root = mkdtempSync(join(tmpdir(), "nexus-video-source-"));
    try {
      const outputPath = join(root, "clip.mp4");
      const bytes = Buffer.from("deterministic-video-source");
      writeFileSync(outputPath, bytes);
      const runtime = new InMemoryDiffusionRuntime();
      runtime.setResponse("diffusion.video.text2video", {
        mp4Path: outputPath,
        workflow: { schemaVersion: 1, mode: "text2video" },
      });
      const ctx = createHandlerContext(
        { pid: 1, platform: process.platform },
        new CodingSessionManager(),
        runtime,
        {
          ffmpegPath: join(root, "missing-ffmpeg"),
          ffprobePath: join(root, "missing-ffprobe"),
        },
      );
      ctx.studio = createStudioRuntime({ dbPath: ":memory:" });
      const reply = (await dispatch(
        "diffusion.video.text2video",
        {
          modelId: "wan2.1-t2v-1.3b",
          prompt: "fox",
          width: 854,
          height: 480,
          durationSeconds: 4,
          fps: 24,
          steps: 30,
          cfgScale: 3.5,
          seed: 8,
        },
        ctx,
      )) as { jobId: string };
      const terminal = await drainTerminalEvent(ctx, reply.jobId);
      expect(terminal, JSON.stringify(terminal)).toMatchObject({
        kind: "complete",
        jobId: reply.jobId,
        outputPath,
        outputId: reply.jobId,
        outputHash: contentHash(bytes),
      });
      expect(ctx.studio.index.getOutput(reply.jobId)).toMatchObject({
        jobId: reply.jobId,
        outputPath,
        contentHash: contentHash(bytes),
      });
      const extracted = (await dispatch(
        "diffusion.video.workflow.extract",
        { mp4Path: outputPath },
        ctx,
      )) as { workflow: { mode?: string } | null };
      expect(extracted.workflow).toMatchObject({ mode: "text2video" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("isolates pump state between independent Studio runtimes", async () => {
    const blockedRuntime = new DeferredDiffusionRuntime();
    const blockedCtx = createHandlerContext(
      { pid: 1, platform: process.platform },
      new CodingSessionManager(),
      blockedRuntime,
    );
    blockedCtx.studio = createStudioRuntime({ dbPath: ":memory:" });

    const readyRuntime = new InMemoryDiffusionRuntime();
    readyRuntime.setResponse("sana.txt2img", {
      pngBase64: createUsablePng().toString("base64"),
    });
    const readyCtx = createHandlerContext(
      { pid: 2, platform: process.platform },
      new CodingSessionManager(),
      readyRuntime,
    );
    readyCtx.studio = createStudioRuntime({ dbPath: ":memory:" });

    const blocked = (await dispatch(
      "diffusion.txt2img",
      {
        modelId: "sana-1.6b-1024",
        prompt: "blocked",
        width: 512,
        height: 512,
        steps: 4,
        cfgScale: 1.5,
        sampler: "euler_a",
        seed: 10,
      },
      blockedCtx,
    )) as { jobId: string };
    await blockedRuntime.started;

    const ready = (await dispatch(
      "diffusion.txt2img",
      {
        modelId: "sana-1.6b-1024",
        prompt: "ready",
        width: 512,
        height: 512,
        steps: 4,
        cfgScale: 1.5,
        sampler: "euler_a",
        seed: 11,
      },
      readyCtx,
    )) as { jobId: string };
    await expect(
      drainTerminalEvent(readyCtx, ready.jobId),
    ).resolves.toMatchObject({
      kind: "complete",
      jobId: ready.jobId,
    });

    blockedRuntime.complete({
      pngBase64: createUsablePng().toString("base64"),
    });
    await expect(
      drainTerminalEvent(blockedCtx, blocked.jobId),
    ).resolves.toMatchObject({
      kind: "complete",
      jobId: blocked.jobId,
    });
  });

  it("does not publish a late completion after queue cancellation", async () => {
    const runtime = new DeferredDiffusionRuntime();
    const ctx = createHandlerContext(
      { pid: 1, platform: process.platform },
      new CodingSessionManager(),
      runtime,
    );
    ctx.studio = createStudioRuntime({ dbPath: ":memory:" });
    const accepted = (await dispatch(
      "diffusion.txt2img",
      {
        modelId: "sana-1.6b-1024",
        prompt: "cancel me",
        width: 512,
        height: 512,
        steps: 4,
        cfgScale: 1.5,
        sampler: "euler_a",
        seed: 12,
      },
      ctx,
    )) as { jobId: string };
    await runtime.started;

    await expect(
      dispatch("generation.queue.cancel", { id: accepted.jobId }, ctx),
    ).resolves.toMatchObject({
      job: { id: accepted.jobId, state: "failed", error: "cancelled" },
    });
    runtime.complete({ pngBase64: createUsablePng().toString("base64") });
    for (
      let attempt = 0;
      attempt < 20 && ctx.studio.activeHandles.has(accepted.jobId);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const drained = (await dispatch(
      "diffusion.job.drainEvents",
      { jobId: accepted.jobId },
      ctx,
    )) as { events: DiffusionEvent[] };
    expect(drained.events.some((event) => event.kind === "complete")).toBe(
      false,
    );
    expect(ctx.studio.queue.get(accepted.jobId)).toMatchObject({
      state: "failed",
      error: "cancelled",
    });
  });
});
