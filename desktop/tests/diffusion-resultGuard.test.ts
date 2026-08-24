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

  it("accepts a video path and rejects a missing one", () => {
    expect(requireUsableVideoPath({ mp4Path: "/tmp/out.mp4" }, "", () => undefined)).toBe(
      "/tmp/out.mp4",
    );
    expect(() => requireUsableVideoPath({ ok: true }, "", () => undefined)).toThrow(
      VIDEO_RUNTIME_NOT_READY,
    );
  });
});
