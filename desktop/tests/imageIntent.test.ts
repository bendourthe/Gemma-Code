/**
 * v1.15.0 Phase 5 (Issue 5) -- image-generation intent inference.
 */

import { describe, it, expect } from "vitest";

import { inferImageIntent } from "../src/modules/image/intent";

describe("inferImageIntent", () => {
  it("no image -> txt2img with the typed prompt", () => {
    const i = inferImageIntent({ text: "a fox in snow", attachments: [] });
    expect(i.mode).toBe("txt2img");
    expect(i.prompt).toBe("a fox in snow");
    expect(i.sourceImage).toBeUndefined();
  });

  it("image + plain text -> img2img carrying the source", () => {
    const i = inferImageIntent({
      text: "make it night",
      attachments: ["data:image/png;base64,AAA"],
    });
    expect(i.mode).toBe("img2img");
    expect(i.sourceImage).toBe("data:image/png;base64,AAA");
  });

  it("image-only (no text) -> img2img with a non-empty default prompt", () => {
    const i = inferImageIntent({ text: "", attachments: ["data:img"] });
    expect(i.mode).toBe("img2img");
    expect(i.prompt.length).toBeGreaterThan(0);
  });

  it("image + mask -> inpaint carrying the mask", () => {
    const i = inferImageIntent({ text: "replace the sky", attachments: ["data:img"], mask: "data:mask" });
    expect(i.mode).toBe("inpaint");
    expect(i.mask).toBe("data:mask");
  });

  it("image + 'extend to the left' -> outpaint left", () => {
    const i = inferImageIntent({ text: "extend to the left", attachments: ["data:img"] });
    expect(i.mode).toBe("outpaint");
    expect(i.direction).toBe("left");
    expect(i.pixels).toBeGreaterThan(0);
  });

  it("outpaint with no named direction defaults to right", () => {
    const i = inferImageIntent({ text: "expand this image", attachments: ["data:img"] });
    expect(i.mode).toBe("outpaint");
    expect(i.direction).toBe("right");
  });

  it("empty attachments + lastOutputRef -> img2img on that path", () => {
    const i = inferImageIntent({
      text: "make it snow",
      attachments: [],
      lastOutputRef: "/tmp/fox.png",
    });
    expect(i.mode).toBe("img2img");
    expect(i.sourceImage).toBe("/tmp/fox.png");
  });

  it("Make that puppy black with last output is img2img, not txt2img", () => {
    const i = inferImageIntent({
      text: "Make that puppy black",
      attachments: [],
      lastOutputRef: "data:image/png;base64,AAA",
    });
    expect(i.mode).toBe("img2img");
    expect(i.sourceImage).toBe("data:image/png;base64,AAA");
    expect(i.prompt).toBe("Make that puppy black");
  });

  it("user attachment wins over lastOutputRef", () => {
    const i = inferImageIntent({
      text: "make it night",
      attachments: ["data:image/png;base64,AAA"],
      lastOutputRef: "/tmp/fox.png",
    });
    expect(i.mode).toBe("img2img");
    expect(i.sourceImage).toBe("data:image/png;base64,AAA");
  });
});
