import { describe, expect, it } from "vitest";

import {
  EMPTY_VIDEO_CLIP,
  formatVideoFailure,
  persistableAssistant,
} from "../src/modules/video/videoFailClosed";

describe("videoFailClosed", () => {
  it("never persists empty assistant content without a mediaRef", () => {
    expect(persistableAssistant({ content: "" })).toEqual({ content: EMPTY_VIDEO_CLIP });
    expect(persistableAssistant({ content: "", mediaRef: "/tmp/clip.mp4" })).toEqual({
      content: "",
      mediaRef: "/tmp/clip.mp4",
    });
  });

  it("quotes Settings > Models when weights are missing", () => {
    expect(formatVideoFailure("SANA-Video 2B 720p weights are not installed")).toMatch(
      /Settings > Models/,
    );
    expect(formatVideoFailure("timeout")).toBe("Generation failed: timeout");
  });
});
