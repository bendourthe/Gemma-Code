import { describe, expect, it } from "vitest";

import { dispatch, createHandlerContext } from "../sidecar/src/handlers";
import { CodingSessionManager } from "../sidecar/src/coding/sessionManager";
import { InMemoryDiffusionRuntime } from "../sidecar/src/diffusion/runtimeClient";
import { createStudioRuntime } from "../sidecar/src/generations/studioRuntime";

function makeCtx() {
  const diffusion = new InMemoryDiffusionRuntime();
  const ctx = createHandlerContext(
    { pid: 1, platform: process.platform },
    new CodingSessionManager({
      now: () => new Date("2026-05-17T11:00:00Z"),
      idFactory: (() => {
        let i = 0;
        return () => `s-${++i}`;
      })(),
    }),
    diffusion,
  );
  return { ctx, diffusion };
}

describe("diffusion.segment", () => {
  it("returns the runtime envelope without a studio scheduler", async () => {
    const { ctx, diffusion } = makeCtx();
    diffusion.setResponse("segment", {
      ok: true,
      candidates: [{ id: "c0", maskPngBase64: "mask", score: 0.9, label: "car" }],
    });
    const reply = (await dispatch(
      "diffusion.segment",
      { sourceImage: "abc", phrase: "car" },
      ctx,
    )) as { ok: boolean; candidates: { label: string }[] };
    expect(reply.ok).toBe(true);
    expect(reply.candidates[0]?.label).toBe("car");
  });

  it("goes through GpuScheduler when studio runtime is present", async () => {
    const { ctx, diffusion } = makeCtx();
    ctx.studio = createStudioRuntime({ dbPath: ":memory:", vramGB: 24 });
    let ran = 0;
    const original = diffusion.call.bind(diffusion);
    diffusion.call = async (method, params) => {
      ran += 1;
      return original(method, params);
    };
    diffusion.setResponse("segment", {
      ok: true,
      candidates: [{ id: "c0", maskPngBase64: "mask", score: 0.9, label: "car" }],
    });
    const reply = (await dispatch(
      "diffusion.segment",
      { sourceImage: "abc", phrase: "car", stub: true },
      ctx,
    )) as { ok: boolean };
    expect(reply.ok).toBe(true);
    expect(ran).toBe(1);
  });
});
