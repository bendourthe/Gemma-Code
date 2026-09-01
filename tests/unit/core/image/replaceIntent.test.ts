import { describe, expect, it } from "vitest";

import {
  inpaintPromptFor,
  parseReplaceIntent,
  restylePromptFor,
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

describe("restylePromptFor", () => {
  it("asks to keep composition and change fur color", () => {
    const intent = parseReplaceIntent("Make the puppy black");
    expect(intent?.scope).toBe("image");
    expect(restylePromptFor(intent!)).toMatch(/Keep the same composition/);
    expect(restylePromptFor(intent!)).toMatch(/fur and color to black/);
    expect(usesSegment(intent!)).toBe(false);
  });
});

/**
 * v2.4.4 Phase 3 (T012) -- restyle identity.
 *
 * Field screenshot 3 showed "Make the puppy black" returning the tan puppy
 * unchanged, across two cycles. The two contributors covered here are the
 * parser refusing a trailing period (which dropped the request to a plain
 * txt2img of the original prompt) and a restyle send that could resolve to
 * anything other than img2img with real source bytes.
 */
describe("restyle identity (v2.4.4 Phase 3)", () => {
  it("parses the restyle even with trailing sentence punctuation", () => {
    for (const text of [
      "Make the puppy black",
      "Make the puppy black.",
      "Make the puppy black!",
      "Make the puppy black. ",
    ]) {
      const intent = parseReplaceIntent(text);
      expect(intent, text).not.toBeNull();
      expect(intent!.scope).toBe("image");
      expect(intent!.object).toBe("puppy");
      expect(intent!.replacement).toBe("black");
      // A whole-image restyle must never reach SAM2.
      expect(usesSegment(intent!)).toBe(false);
    }
  });

  it("keeps the identity prompt so the model edits rather than reinvents", () => {
    const prompt = restylePromptFor(parseReplaceIntent("Make the puppy black.")!);
    expect(prompt).toMatch(/Keep the same composition/);
    expect(prompt).toMatch(/Do not generate a different puppy/);
  });
});
