import { describe, expect, it } from "vitest";

import {
  inpaintPromptFor,
  parseReplaceIntent,
  usesSegment,
} from "../../../../core/image/replaceIntent.js";

describe("parseReplaceIntent", () => {
  it("parses replace / remove / recolor phrases", () => {
    expect(parseReplaceIntent("replace the car with a truck")).toEqual({
      action: "replace",
      object: "car",
      replacement: "truck",
      ambiguous: false,
      scope: "object",
    });
    expect(parseReplaceIntent("remove the watermark")).toMatchObject({
      action: "remove",
      object: "watermark",
      scope: "object",
    });
    expect(parseReplaceIntent("recolor the sky to orange")?.action).toBe("recolor");
    expect(parseReplaceIntent("replace the sky with sunset")).toMatchObject({
      action: "replace",
      object: "sky",
      replacement: "sunset",
      scope: "object",
    });
  });

  it("parses make-that-color as a whole-image restyle", () => {
    const intent = parseReplaceIntent("Make that puppy black");
    expect(intent).toEqual({
      action: "recolor",
      object: "puppy",
      replacement: "black",
      ambiguous: false,
      scope: "image",
    });
    expect(usesSegment(intent!)).toBe(false);
    expect(usesSegment(parseReplaceIntent("replace the sky with sunset")!)).toBe(true);
  });

  it("flags ambiguous object phrases", () => {
    expect(parseReplaceIntent("replace the cars with trucks")?.ambiguous).toBe(true);
    expect(parseReplaceIntent("just make it brighter")).toBeNull();
  });
});

describe("inpaintPromptFor", () => {
  it("turns a parsed intent into an inpaint prompt", () => {
    const intent = parseReplaceIntent("replace the car with a truck");
    expect(intent).not.toBeNull();
    expect(inpaintPromptFor(intent!)).toBe("Replace the car with truck");
    expect(inpaintPromptFor(parseReplaceIntent("remove the watermark")!)).toMatch(/Remove the watermark/);
    expect(inpaintPromptFor(parseReplaceIntent("recolor the sky to orange")!)).toMatch(/orange/);
  });
});
