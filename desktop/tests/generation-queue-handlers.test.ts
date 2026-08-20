import { describe, expect, it } from "vitest";
import { dispatch, createHandlerContext } from "../sidecar/src/handlers";
import { CodingSessionManager } from "../sidecar/src/coding/sessionManager";
import { createStudioRuntime } from "../sidecar/src/generations/studioRuntime";
import {
  createMinimalPng,
  embedWorkflow,
} from "../../core/image/WorkflowMetadata";
import { IPC_METHODS, METHOD_SCHEMAS } from "../sidecar/src/protocol";

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
});
