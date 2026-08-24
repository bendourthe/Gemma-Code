import { afterEach, describe, expect, it, vi } from "vitest";

import {
  InMemoryVideoClient,
  createIpcVideoClient,
} from "../src/modules/video/videoClient";

vi.mock("../src/lib/ipc", () => {
  const ipc = {
    call: vi.fn(),
  };
  return { ipc };
});

import { ipc } from "../src/lib/ipc";

afterEach(() => {
  vi.clearAllMocks();
});

describe("InMemoryVideoClient", () => {
  it("returns an accepted job for text2video", async () => {
    const client = new InMemoryVideoClient();
    const accepted = await client.text2video({
      modelId: "ltx-video",
      prompt: "fox",
      width: 854,
      height: 480,
      durationSeconds: 4,
      fps: 24,
      steps: 30,
      cfgScale: 3.5,
      sampler: "euler_a",
      seed: 7,
    });
    expect(accepted.jobId).toMatch(/^mem-video-/);
    expect(accepted.mode).toBe("text2video");
    expect(accepted.frameCount).toBe(96);
  });

  it("returns an accepted job for image2video", async () => {
    const client = new InMemoryVideoClient();
    const accepted = await client.image2video({
      modelId: "svd",
      prompt: "fox",
      width: 854,
      height: 480,
      durationSeconds: 4,
      fps: 24,
      steps: 30,
      cfgScale: 3.5,
      sampler: "euler_a",
      seed: 7,
      sourceImage: "data:image/png;base64,AAAA",
    });
    expect(accepted.mode).toBe("image2video");
    expect(client.lastRequest?.mode).toBe("image2video");
  });

  it("scriptEvents queues events that drainEvents returns once", async () => {
    const client = new InMemoryVideoClient();
    client.scriptEvents("j1", [
      { kind: "progress", jobId: "j1", step: 1, totalSteps: 4 },
      { kind: "complete", jobId: "j1", mp4Path: "/tmp/x.mp4" },
    ]);
    const first = await client.drainEvents("j1");
    expect(first).toHaveLength(2);
    const second = await client.drainEvents("j1");
    expect(second).toHaveLength(0);
  });

  it("extractWorkflow records the input and returns the stub result", async () => {
    const client = new InMemoryVideoClient();
    client.extractResult = { mode: "text2video", prompt: "fox" };
    const result = await client.extractWorkflow("/tmp/x.mp4");
    expect(client.lastExtractInput).toBe("/tmp/x.mp4");
    expect(result).toEqual({ mode: "text2video", prompt: "fox" });
  });
});

describe("createIpcVideoClient", () => {
  it("text2video unwraps a successful IPC reply", async () => {
    (ipc.call as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      value: { jobId: "j", mode: "text2video" },
    });
    const client = createIpcVideoClient();
    const result = await client.text2video({
      modelId: "ltx-video",
      prompt: "x",
      width: 854,
      height: 480,
      durationSeconds: 4,
      fps: 24,
      steps: 30,
      cfgScale: 3.5,
      sampler: "euler_a",
      seed: 0,
    });
    expect(result.jobId).toBe("j");
  });

  it("text2video throws when the IPC reply is an error envelope", async () => {
    (ipc.call as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      message: "kaboom",
    });
    const client = createIpcVideoClient();
    await expect(
      client.text2video({
        modelId: "ltx-video",
        prompt: "x",
        width: 854,
        height: 480,
        durationSeconds: 4,
        fps: 24,
        steps: 30,
        cfgScale: 3.5,
        sampler: "euler_a",
        seed: 0,
      }),
    ).rejects.toThrow(/kaboom/);
  });

  it("image2video forwards request to diffusion.video.image2video", async () => {
    (ipc.call as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      value: { jobId: "j2", mode: "image2video" },
    });
    const client = createIpcVideoClient();
    await client.image2video({
      modelId: "svd",
      prompt: "x",
      width: 854,
      height: 480,
      durationSeconds: 4,
      fps: 24,
      steps: 30,
      cfgScale: 3.5,
      sampler: "euler_a",
      seed: 0,
      sourceImage: "data:image/png;base64,AAAA",
    });
    expect((ipc.call as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(
      "diffusion.video.image2video",
    );
  });

  it("audio2video forwards request to diffusion.video.audio2video", async () => {
    (ipc.call as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      value: { jobId: "j3", mode: "audio2video" },
    });
    const client = createIpcVideoClient();
    await client.audio2video({
      modelId: "longcat-video-avatar-1.5",
      prompt: "talk",
      width: 854,
      height: 480,
      durationSeconds: 4,
      fps: 24,
      steps: 30,
      cfgScale: 3.5,
      sampler: "euler_a",
      seed: 0,
      sourceImage: "data:image/png;base64,AAAA",
      sourceAudio: "data:audio/wav;base64,BBBB",
      confirmLocalAvatar: true,
    });
    expect((ipc.call as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(
      "diffusion.video.audio2video",
    );
  });

  it("drainEvents returns the events array from a successful reply", async () => {
    (ipc.call as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      value: { events: [{ kind: "progress", jobId: "j", step: 1 }] },
    });
    const client = createIpcVideoClient();
    const events = await client.drainEvents("j");
    expect(events).toHaveLength(1);
  });

  it("extractWorkflow returns the workflow payload", async () => {
    (ipc.call as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      value: { workflow: { mode: "text2video" } },
    });
    const client = createIpcVideoClient();
    const result = await client.extractWorkflow("/tmp/x.mp4");
    expect(result).toEqual({ mode: "text2video" });
  });
});
