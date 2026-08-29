import { afterEach, describe, expect, it, vi } from "vitest";

import {
  VideoEnhancementClientError,
  InMemoryVideoEnhancementClient,
  createIpcVideoEnhancementClient,
} from "../src/modules/video/videoEnhancementClient";
import { VideoEnhancementEnqueueRequest } from "../sidecar/src/protocol";

vi.mock("../src/lib/ipc", () => {
  const ipc = { call: vi.fn() };
  return { ipc };
});

import { ipc } from "../src/lib/ipc";

const callMock = ipc.call as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.clearAllMocks();
});

describe("createIpcVideoEnhancementClient", () => {
  it("loads the capability through the enhancement method", async () => {
    callMock.mockResolvedValueOnce({
      ok: true,
      value: { capability: { status: "ready", reason: null } },
    });

    const capability = await createIpcVideoEnhancementClient().capability();

    expect(capability.status).toBe("ready");
    expect(callMock).toHaveBeenCalledWith("video.enhancement.capability", {});
  });

  it("forwards only semantic preset fields when enqueuing", async () => {
    callMock.mockResolvedValueOnce({
      ok: true,
      value: {
        ok: true,
        created: true,
        job: { childJobId: "enhancement-1", state: "queued" },
      },
    });
    const client = createIpcVideoEnhancementClient();

    const result = await client.enqueue({
      parentJobId: "video-parent",
      sourceOutputId: "video-output",
      mode: "upscale_interpolate",
      upscalePreset: "general-upscale-4x",
      interpolationPreset: "smooth-2x",
      priority: "interactive",
    });

    expect(result.created).toBe(true);
    expect(result.job.childJobId).toBe("enhancement-1");
    expect(callMock).toHaveBeenCalledWith("video.enhancement.enqueue", {
      parentJobId: "video-parent",
      sourceOutputId: "video-output",
      mode: "upscale_interpolate",
      upscalePreset: "general-upscale-4x",
      interpolationPreset: "smooth-2x",
      priority: "interactive",
    });
    expect(
      VideoEnhancementEnqueueRequest.parse({
        parentJobId: "video-parent",
        sourceOutputId: "video-output",
        mode: "upscale_interpolate",
        upscalePreset: "general-upscale-4x",
        interpolationPreset: "smooth-2x",
        priority: "interactive",
      }),
    ).toMatchObject({ mode: "upscale_interpolate" });
  });

  it("preserves typed runtime failures from a rejected enqueue", async () => {
    const detail = {
      code: "backend_unavailable" as const,
      message: "The optional backend is not configured.",
      retryable: true,
      stage: "preflight" as const,
      diagnostics: null,
      terminationConfirmed: null,
    };
    callMock.mockResolvedValueOnce({
      ok: true,
      value: { ok: false, error: detail },
    });

    const error = await createIpcVideoEnhancementClient()
      .enqueue({
        parentJobId: "video-parent",
        sourceOutputId: "video-output",
        mode: "interpolate",
        interpolationPreset: "smooth-2x",
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(VideoEnhancementClientError);
    expect((error as VideoEnhancementClientError).detail).toEqual(detail);
  });

  it("lists and cancels by authoritative job identity", async () => {
    callMock
      .mockResolvedValueOnce({
        ok: true,
        value: { jobs: [{ childJobId: "enhancement-1", state: "running" }] },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { job: { childJobId: "enhancement-1", state: "cancelled" } },
      });
    const client = createIpcVideoEnhancementClient();

    const jobs = await client.list("video-parent");
    const cancelled = await client.cancel("enhancement-1");

    expect(jobs[0]?.state).toBe("running");
    expect(cancelled?.state).toBe("cancelled");
    expect(callMock).toHaveBeenNthCalledWith(1, "video.enhancement.list", {
      parentJobId: "video-parent",
    });
    expect(callMock).toHaveBeenNthCalledWith(2, "video.enhancement.cancel", {
      childJobId: "enhancement-1",
    });
  });

  it("turns transport envelopes into retryable client errors", async () => {
    callMock.mockResolvedValueOnce({ ok: false, message: "ipc-unavailable" });

    const error = await createIpcVideoEnhancementClient()
      .list("video-parent")
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(VideoEnhancementClientError);
    expect((error as VideoEnhancementClientError).message).toBe("ipc-unavailable");
    expect((error as VideoEnhancementClientError).detail).toBeNull();
  });
});

describe("InMemoryVideoEnhancementClient", () => {
  it("records semantic enqueue fields and lists only the matching parent", async () => {
    const client = new InMemoryVideoEnhancementClient();
    const first = await client.enqueue({
      parentJobId: "parent-a",
      sourceOutputId: "output-a",
      mode: "upscale",
      upscalePreset: "animation-upscale-2x",
      priority: "interactive",
    });
    await client.enqueue({
      parentJobId: "parent-b",
      sourceOutputId: "output-b",
      mode: "interpolate",
      interpolationPreset: "smooth-2x",
    });

    expect(first.created).toBe(true);
    expect(await client.list("parent-a")).toEqual([first.job]);
    expect((await client.list("parent-b"))[0]?.request.mode).toBe("interpolate");

    const combined = await client.enqueue({
      parentJobId: "parent-a",
      sourceOutputId: "output-a",
      mode: "upscale_interpolate",
      upscalePreset: "general-upscale-4x",
      interpolationPreset: "smooth-2x",
    });
    expect(combined.job.request).toMatchObject({
      mode: "upscale_interpolate",
      upscalePreset: "general-upscale-4x",
      interpolationPreset: "smooth-2x",
    });
    expect((await client.list("parent-a")).map((job) => job.childJobId)).toEqual(
      [combined.job.childJobId, first.job.childJobId],
    );

    const cancelled = await client.cancel(first.job.childJobId);
    expect(cancelled?.state).toBe("cancelled");
    expect(await client.cancel("missing")).toBeNull();
  });
});
