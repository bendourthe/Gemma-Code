import { beforeEach, describe, expect, it } from "vitest";

import {
  buildVideoJobRequest,
  resetVideoJobIdFactory,
  setVideoJobIdFactory,
} from "../sidecar/src/diffusion/videoDispatcher";
import { InMemoryDiffusionRuntime } from "../sidecar/src/diffusion/runtimeClient";

describe("video dispatcher", () => {
  beforeEach(() => {
    resetVideoJobIdFactory();
  });

  it("issues a video job id and forwards the request payload to text2video", async () => {
    setVideoJobIdFactory(() => "video-fixed");
    const runtime = new InMemoryDiffusionRuntime();
    runtime.setResponse("diffusion.video.text2video", {
      ok: true,
      offloadStrategy: "model_cpu_offload",
      estimatedSeconds: 240,
      extra: { frameCount: 96 },
    });
    const result = await buildVideoJobRequest(
      "text2video",
      { modelId: "ltx-video", prompt: "fox", durationSeconds: 4, fps: 24 },
      runtime,
    );
    expect(result.jobId).toBe("video-fixed");
    expect(result.mode).toBe("text2video");
    expect(result.offloadStrategy).toBe("model_cpu_offload");
    expect(result.estimatedSeconds).toBe(240);
    expect(result.frameCount).toBe(96);
  });

  it("routes image2video requests to the image2video method", async () => {
    setVideoJobIdFactory(() => "video-i2v");
    const runtime = new InMemoryDiffusionRuntime();
    runtime.setResponse("diffusion.video.image2video", {
      ok: true,
      offloadStrategy: "sequential_cpu_offload",
    });
    const result = await buildVideoJobRequest(
      "image2video",
      { modelId: "svd", prompt: "fox" },
      runtime,
    );
    expect(result.jobId).toBe("video-i2v");
    expect(result.mode).toBe("image2video");
    expect(result.offloadStrategy).toBe("sequential_cpu_offload");
  });

  it("routes audio2video through the official gate", async () => {
    setVideoJobIdFactory(() => "video-a2v");
    const runtime = new InMemoryDiffusionRuntime();
    runtime.setResponse("diffusion.video.audio2video", { ok: true });
    const result = await buildVideoJobRequest(
      "audio2video",
      {
        modelId: "longcat-video-avatar-1.5",
        prompt: "talk",
        sourceImage: "data:image/png;base64,AAA",
        sourceAudio: "data:audio/wav;base64,BBB",
        confirmLocalAvatar: true,
        diffusionTier: "diffusion-pro",
        vramGB: 24,
      },
      runtime,
    );
    expect(result.jobId).toBe("video-a2v");
    expect(result.mode).toBe("audio2video");
    expect(result.provenance).toMatchObject({ local: true, neverLeftDevice: true });
  });

  it("refuses audio2video below diffusion-pro", async () => {
    const runtime = new InMemoryDiffusionRuntime();
    runtime.setResponse("diffusion.video.audio2video", { ok: true });
    await expect(
      buildVideoJobRequest(
        "audio2video",
        {
          modelId: "longcat-video-avatar-1.5",
          prompt: "talk",
          sourceImage: "data:image/png;base64,AAA",
          sourceAudio: "data:audio/wav;base64,BBB",
          confirmLocalAvatar: true,
          diffusionTier: "diffusion-mid",
          vramGB: 12,
        },
        runtime,
      ),
    ).rejects.toThrow(/avatar-tier/);
  });

  it("propagates frameCount from the top-level field when present", async () => {
    setVideoJobIdFactory(() => "video-top");
    const runtime = new InMemoryDiffusionRuntime();
    runtime.setResponse("diffusion.video.text2video", {
      ok: true,
      frameCount: 48,
    });
    const result = await buildVideoJobRequest(
      "text2video",
      { modelId: "ltx-video", prompt: "x" },
      runtime,
    );
    expect(result.frameCount).toBe(48);
  });

  it("rethrows runtime errors from the python side", async () => {
    const runtime = new InMemoryDiffusionRuntime();
    runtime.setError("diffusion.video.text2video", "python-down");
    await expect(
      buildVideoJobRequest("text2video", {}, runtime),
    ).rejects.toThrow(/python-down/);
  });

  it("resetVideoJobIdFactory restores the default counter factory", async () => {
    resetVideoJobIdFactory();
    const runtime = new InMemoryDiffusionRuntime();
    runtime.setResponse("diffusion.video.text2video", {});
    const first = await buildVideoJobRequest("text2video", {}, runtime);
    const second = await buildVideoJobRequest("text2video", {}, runtime);
    expect(first.jobId).toMatch(/^video-/);
    expect(second.jobId).toMatch(/^video-/);
    expect(first.jobId).not.toBe(second.jobId);
  });
});
