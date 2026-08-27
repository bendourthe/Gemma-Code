import { describe, expect, it } from "vitest";

import { createUsablePng } from "../../core/image/WorkflowMetadata";
import {
  IMAGE_RUNTIME_NOT_READY,
  VIDEO_RUNTIME_NOT_READY,
  requireUsableImagePng,
  requireUsableVideoPath,
} from "../sidecar/src/diffusion/resultGuard";

const ONE_BY_ONE =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

describe("diffusion result guard", () => {
  it("accepts a usable PNG and rejects empty or 1x1 completes", () => {
    const logs: string[] = [];
    const png = createUsablePng().toString("base64");
    expect(requireUsableImagePng({ ok: true, pngBase64: png }, "", (l) => logs.push(l))).toBe(
      png,
    );
    expect(() => requireUsableImagePng({}, "", () => undefined)).toThrow(IMAGE_RUNTIME_NOT_READY);
    expect(() =>
      requireUsableImagePng({ pngBase64: ONE_BY_ONE }, "backend boom", (l) => logs.push(l)),
    ).toThrow(IMAGE_RUNTIME_NOT_READY);
    expect(logs.some((l) => l.includes("backend boom"))).toBe(true);
  });

  it("surfaces ok:false messages instead of claiming a successful generate", () => {
    expect(() =>
      requireUsableImagePng(
        { ok: false, error: "runtime-not-ready", message: "image runtime is not ready: GPU not available" },
        "",
        () => undefined,
      ),
    ).toThrow(/GPU not available/);
  });

  it("passes the three v2.2.9 typed image reasons through distinctly", () => {
    const typed = [
      "image runtime is not ready: no CUDA torch in the diffusion Python environment (torch is missing or a CPU-only build); app telemetry can still show NVIDIA VRAM because Ollama can use the GPU while this environment stays CPU-only",
      "image runtime is not ready: weights for model sdxl-turbo not found at C:\\Users\\op\\.nexus\\models\\weights\\sdxl-turbo",
      "image runtime is not ready: GPU not available (CUDA torch is installed but no usable CUDA device was detected)",
    ];
    for (const message of typed) {
      let thrown: Error | undefined;
      try {
        requireUsableImagePng(
          { ok: false, error: "runtime-not-ready", message },
          "",
          () => undefined,
        );
      } catch (error) {
        thrown = error as Error;
      }
      expect(thrown?.message).toBe(message);
      expect(thrown?.message).not.toBe(IMAGE_RUNTIME_NOT_READY);
    }
  });

  it("passes the three v2.2.9 typed video reasons through distinctly", () => {
    const typed = [
      "video runtime is not ready: no CUDA torch in the diffusion Python environment (torch is missing or a CPU-only build); app telemetry can still show NVIDIA VRAM because Ollama can use the GPU while this environment stays CPU-only",
      "video runtime is not ready: weights for model ltx-video not found at C:\\Users\\op\\.nexus\\models\\weights\\ltx-video",
      "video runtime is not ready: GPU not available (CUDA torch is installed but no usable CUDA device was detected)",
    ];
    for (const message of typed) {
      let thrown: Error | undefined;
      try {
        requireUsableVideoPath(
          { ok: false, error: "runtime-not-ready", message },
          "",
          () => undefined,
        );
      } catch (error) {
        thrown = error as Error;
      }
      expect(thrown?.message).toBe(message);
      expect(thrown?.message).not.toBe(VIDEO_RUNTIME_NOT_READY);
    }
  });

  it("accepts a video path and rejects a missing one", () => {
    expect(requireUsableVideoPath({ mp4Path: "/tmp/out.mp4" }, "", () => undefined)).toBe(
      "/tmp/out.mp4",
    );
    expect(() => requireUsableVideoPath({ ok: true }, "", () => undefined)).toThrow(
      VIDEO_RUNTIME_NOT_READY,
    );
  });
});
