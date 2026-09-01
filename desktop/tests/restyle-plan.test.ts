/**
 * v2.4.4 Phase 3 (T012) -- the restyle send plan.
 *
 * The reprint in field screenshot 3 was only diagnosable by eye because the
 * mode, prompt, strength, and source were each decided at a different point
 * in a long submit handler. `planRestyleRequest` is that decision as data, so
 * "this quietly became a txt2img" is now a test failure.
 */

import { describe, expect, it } from "vitest";
import {
  MISSING_RESTYLE_SOURCE_TEXT,
  RESTYLE_IMG2IMG_STRENGTH,
  planRestyleRequest,
} from "../src/modules/image/followUpSource";
import { parseReplaceIntent, restylePromptFor } from "../../core/image/replaceIntent";

const PROMPT = restylePromptFor(parseReplaceIntent("Make the puppy black.")!);
const SOURCE = "data:image/png;base64,iVBORw0KGgo=";

describe("planRestyleRequest", () => {
  it("always resolves to img2img carrying the identity prompt and the source", () => {
    const plan = planRestyleRequest({ restylePrompt: PROMPT, sourceImage: SOURCE });
    expect(plan).not.toBeNull();
    expect(plan!.mode).toBe("img2img");
    expect(plan!.sourceImage).toBe(SOURCE);
    // The identity prompt, not the user's original "a puppy" prompt.
    expect(plan!.prompt).toBe(PROMPT);
    expect(plan!.prompt).toMatch(/Keep the same composition/);
  });

  it("applies a denoise strong enough to actually change the fur", () => {
    const plan = planRestyleRequest({ restylePrompt: PROMPT, sourceImage: SOURCE });
    expect(plan!.strength).toBe(RESTYLE_IMG2IMG_STRENGTH);
    // 0.7 shipped in v2.4.3 and still returned a picture that read identical.
    expect(RESTYLE_IMG2IMG_STRENGTH).toBeGreaterThan(0.7);
    expect(RESTYLE_IMG2IMG_STRENGTH).toBeLessThan(1);
  });

  it("fails closed instead of falling back to a fresh generation", () => {
    // No source bytes: the correct outcome is a written sentence, never a
    // txt2img that prints a brand-new puppy and looks like success.
    expect(planRestyleRequest({ restylePrompt: PROMPT, sourceImage: null })).toBeNull();
    expect(planRestyleRequest({ restylePrompt: PROMPT, sourceImage: "   " })).toBeNull();
    expect(planRestyleRequest({ restylePrompt: "  ", sourceImage: SOURCE })).toBeNull();
    expect(MISSING_RESTYLE_SOURCE_TEXT).toMatch(/Generate or attach an image first/);
  });
});
