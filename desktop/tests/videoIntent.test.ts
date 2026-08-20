/**
 * v1.15.0 Phase 6 (Issue 5) -- video-generation intent inference.
 */

import { describe, it, expect } from "vitest";

import { inferVideoIntent } from "../src/modules/video/intent";

describe("inferVideoIntent", () => {
  it("no image -> text2video with the typed prompt", () => {
    const i = inferVideoIntent({ text: "a fox running", attachments: [] });
    expect(i.mode).toBe("text2video");
    expect(i.prompt).toBe("a fox running");
    expect(i.sourceImage).toBeUndefined();
  });

  it("an attached image -> image2video carrying the source", () => {
    const i = inferVideoIntent({ text: "pan slowly", attachments: ["data:image/png;base64,AAA"] });
    expect(i.mode).toBe("image2video");
    expect(i.sourceImage).toBe("data:image/png;base64,AAA");
  });

  it("image-only (no text) -> image2video with a non-empty default prompt", () => {
    const i = inferVideoIntent({ text: "", attachments: ["data:img"] });
    expect(i.mode).toBe("image2video");
    expect(i.prompt.length).toBeGreaterThan(0);
  });

  it("text-only with no text still yields a non-empty prompt", () => {
    const i = inferVideoIntent({ text: "   ", attachments: [] });
    expect(i.mode).toBe("text2video");
    expect(i.prompt.length).toBeGreaterThan(0);
  });

  it("uses the first attachment when several are provided", () => {
    const i = inferVideoIntent({ text: "go", attachments: ["data:a", "data:b"] });
    expect(i.sourceImage).toBe("data:a");
  });

  it("photo plus audio with avatar enabled routes to audio2video", () => {
    const i = inferVideoIntent({
      text: "speak",
      attachments: ["data:image/png;base64,AAA", "data:audio/wav;base64,BBB"],
      avatarEnabled: true,
    });
    expect(i.mode).toBe("audio2video");
    expect(i.sourceImage).toContain("image/png");
    expect(i.sourceAudio).toContain("audio/wav");
    expect(i.blockedReason).toBeUndefined();
  });

  it("audio without a photo is blocked in avatar mode", () => {
    const i = inferVideoIntent({
      text: "speak",
      attachments: ["data:audio/wav;base64,BBB"],
      avatarEnabled: true,
    });
    expect(i.mode).toBe("audio2video");
    expect(i.blockedReason).toMatch(/photo/);
  });

  it("ignores audio when avatar mode is off", () => {
    const i = inferVideoIntent({
      text: "a fox",
      attachments: ["data:audio/wav;base64,BBB"],
    });
    expect(i.mode).toBe("text2video");
  });
});
