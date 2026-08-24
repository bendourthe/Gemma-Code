import { describe, expect, it, vi } from "vitest";

import { createBrowserMicRecorder } from "../src/shared/chat/micRecorder";

class FakeMediaRecorder {
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(_stream: MediaStream) {}

  start(): void {
    this.ondataavailable?.({ data: new Blob(["x"], { type: "audio/webm" }) });
  }

  stop(): void {
    this.onstop?.();
  }
}

describe("createBrowserMicRecorder", () => {
  it("returns empty when stop is called before start", async () => {
    const rec = createBrowserMicRecorder({
      getUserMedia: async () => ({ getTracks: () => [] }) as unknown as MediaStream,
      MediaRecorderImpl: FakeMediaRecorder as unknown as typeof MediaRecorder,
    });
    expect(await rec.stop()).toBe("");
  });

  it("captures a data URL and stops tracks", async () => {
    const stopTrack = vi.fn();
    const rec = createBrowserMicRecorder({
      getUserMedia: async () =>
        ({ getTracks: () => [{ stop: stopTrack }] }) as unknown as MediaStream,
      MediaRecorderImpl: FakeMediaRecorder as unknown as typeof MediaRecorder,
    });
    await rec.start();
    const url = await rec.stop();
    expect(url.startsWith("data:")).toBe(true);
    expect(stopTrack).toHaveBeenCalled();
  });
});
