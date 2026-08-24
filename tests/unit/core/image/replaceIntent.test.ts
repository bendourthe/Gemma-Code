import { describe, expect, it } from "vitest";

import { inpaintPromptFor, parseReplaceIntent } from "../../../../core/image/replaceIntent.js";

describe("parseReplaceIntent", () => {
  it("parses replace / remove / recolor phrases", () => {
    expect(parseReplaceIntent("replace the car with a truck")).toEqual({
      action: "replace",
      object: "car",
      replacement: "truck",
      ambiguous: false,
    });
    expect(parseReplaceIntent("remove the watermark")).toMatchObject({
      action: "remove",
      object: "watermark",
    });
    expect(parseReplaceIntent("recolor the sky to orange")?.action).toBe("recolor");
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
