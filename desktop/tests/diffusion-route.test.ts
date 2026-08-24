import { describe, expect, it } from "vitest";

import {
  foldRequestModelId,
  requireSourceImageBytes,
  resolveImageMethod,
  resolveVideoMethod,
} from "../sidecar/src/diffusion/route";

describe("diffusion route", () => {
  it("routes SANA catalog ids onto the SANA python methods", () => {
    expect(resolveImageMethod("txt2img", "sana-1.6b-1024")).toBe("sana.txt2img");
    expect(resolveImageMethod("img2img", "sana-1.6b-2k")).toBe("sana.img2img");
    expect(resolveImageMethod("txt2img", "sana-1.6b-int4")).toBe("sana_int4.txt2img");
    expect(resolveImageMethod("txt2img", "sana-sprint-1024")).toBe("sana_sprint.txt2img");
  });

  it("keeps SDXL-shaped ids on the generic txt2img method", () => {
    expect(resolveImageMethod("txt2img", "sdxl-turbo")).toBe("txt2img");
    expect(resolveImageMethod("inpaint", "sana-1.6b-1024")).toBe("inpaint");
  });

  it("refuses INT4 img2img before enqueue", () => {
    expect(() => resolveImageMethod("img2img", "sana-1.6b-int4")).toThrow(
      /INT4 SANA/,
    );
  });

  it("routes SANA-Video onto the sana video methods", () => {
    expect(resolveVideoMethod("text2video", "sana-video-2b-720p")).toBe(
      "diffusion.video.sana.text2video",
    );
    expect(resolveVideoMethod("text2video", "ltx-video")).toBe(
      "diffusion.video.text2video",
    );
  });

  it("rejects img2img without source bytes", () => {
    expect(() => requireSourceImageBytes("img2img", { prompt: "fox" })).toThrow(
      /source image bytes/,
    );
    expect(() =>
      requireSourceImageBytes("img2img", { sourceImage: "data:image/png;base64,AAA" }),
    ).not.toThrow();
  });

  it("folds request model ids through the alias table", () => {
    const folded = foldRequestModelId({ modelId: "gemma-4-12b-it-gguf" });
    expect(folded.modelId).toBe("gemma4:12b");
  });
});
