import { describe, expect, it } from "vitest";
import { applyImageRecall } from "../src/shared/studio/RecallActions";

const current = {
  prompt: "old",
  negativePrompt: "n",
  modelId: "m",
  width: 512,
  height: 512,
  steps: 8,
  cfgScale: 2,
  sampler: "euler",
  seed: 1,
};

describe("applyImageRecall", () => {
  it("Use Prompt only copies prompt", () => {
    const next = applyImageRecall(current, { prompt: "fox", seed: 99 }, "prompt");
    expect(next.prompt).toBe("fox");
    expect(next.seed).toBe(1);
  });

  it("Use Seed only copies seed", () => {
    const next = applyImageRecall(current, { prompt: "fox", seed: 99 }, "seed");
    expect(next.prompt).toBe("old");
    expect(next.seed).toBe(99);
  });

  it("Use All copies parameters", () => {
    const next = applyImageRecall(
      current,
      { prompt: "fox", seed: 7, sampler: "ddim", steps: 20, modelId: "sana" },
      "all",
    );
    expect(next).toMatchObject({ prompt: "fox", seed: 7, sampler: "ddim", steps: 20, modelId: "sana" });
  });

  it("Remix copies all but randomizes seed", () => {
    const next = applyImageRecall(current, { prompt: "fox", seed: 7 }, "remix");
    expect(next.prompt).toBe("fox");
    expect(next.seed).not.toBe(7);
  });
});
