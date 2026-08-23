import { describe, expect, it } from "vitest";
import { dispatch, createHandlerContext } from "../sidecar/src/handlers";
import { CodingSessionManager } from "../sidecar/src/coding/sessionManager";
import { createStudioRuntime } from "../sidecar/src/generations/studioRuntime";
import {
  createMinimalPng,
  embedWorkflow,
} from "../../core/image/WorkflowMetadata";
import { IPC_METHODS, METHOD_SCHEMAS } from "../sidecar/src/protocol";
import { InMemoryDiffusionRuntime } from "../sidecar/src/diffusion/runtimeClient";

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

async function drainTerminalEvent(ctx: ReturnType<typeof makeCtx>, jobId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const reply = (await dispatch("diffusion.job.drainEvents", { jobId }, ctx)) as {
      events: { kind: string; jobId: string; message?: string; outputPath?: string }[];
    };
    const terminal = reply.events.find((event) => event.kind === "complete" || event.kind === "error");
    if (terminal) return terminal;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`No terminal diffusion event for ${jobId}`);
}

describe("generation queue IPC", () => {
  it("registers queue methods as implemented", () => {
    for (const method of [
      "generation.queue.list",
      "generation.queue.enqueue",
      "generation.queue.cancel",
      "generation.queue.reorder",
      "generation.queue.pendingCount",
    ] as const) {
      expect(IPC_METHODS).toContain(method);
      expect(METHOD_SCHEMAS[method].implemented).toBe(true);
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
      jobs: { id: string; priority: string }[];
    };
    expect(listed.jobs.some((j) => j.id === reply.jobId && j.priority === "interactive")).toBe(
      true,
    );
  });

  it("emits an error event when txt2img completes without image bytes", async () => {
    const runtime = new InMemoryDiffusionRuntime();
    runtime.setResponse("txt2img", {});
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
      message: expect.stringMatching(/without image bytes/),
    });
  });

  it("emits a playable video completion when workflow metadata is absent", async () => {
    const runtime = new InMemoryDiffusionRuntime();
    runtime.setResponse("diffusion.video.text2video", { mp4Path: "C:\\nexus\\outputs\\clip.mp4" });
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
});
