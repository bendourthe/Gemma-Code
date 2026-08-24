import { describe, expect, it } from "vitest";

import type { ModelSpec } from "../../../../core/registry/catalog.js";
import { filterTuningBaseModels } from "../../../../core/tuning/baseModels.js";

function spec(partial: Partial<ModelSpec> & Pick<ModelSpec, "id" | "type">): ModelSpec {
  return {
    family: "x",
    name: partial.id,
    tag: "latest",
    displayName: partial.displayName ?? partial.id,
    ...partial,
  } as ModelSpec;
}

describe("filterTuningBaseModels", () => {
  it("keeps coding-eligible LLMs that fit the host tier", () => {
    const models = filterTuningBaseModels(
      [
        spec({ id: "tiny", type: "llm", codingEligible: true, requiredVramGB: 4 }),
        spec({ id: "huge", type: "llm", hideBelowVramGB: 32 }),
        spec({ id: "sam", type: "image", codingEligible: false }),
        spec({ id: "draft", type: "llm", codingEligible: false }),
        spec({ id: "paint", type: "llm", diffusion: true }),
        spec({ id: "vlm", type: "llm", vision: true, codingEligible: true }),
      ],
      { hostVramGB: 16 },
    );
    expect(models.map((m) => m.id)).toEqual(["tiny", "vlm"]);
    expect(models.find((m) => m.id === "vlm")?.vision).toBe(true);
  });
});
