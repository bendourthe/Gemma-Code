import { describe, expect, it } from "vitest";

import {
  DEFAULT_VISUAL_TOKEN_BUDGET,
  modelAcceptsVision,
  nonVisionAttachmentGuidance,
  resolveVisualTokenBudget,
} from "../../../../core/chat/vision.js";

describe("modelAcceptsVision", () => {
  it("treats an LLM with image modality as vision when the flag is omitted", () => {
    expect(modelAcceptsVision({ type: "llm", modalities: ["text", "image"] })).toBe(true);
  });

  it("lets an explicit false win over image modality", () => {
    expect(
      modelAcceptsVision({ type: "llm", modalities: ["text", "image"], vision: false }),
    ).toBe(false);
  });

  it("does not treat diffusion or SAM2 image consumers as chat vision", () => {
    expect(modelAcceptsVision({ type: "image", modalities: ["image"] })).toBe(false);
    expect(modelAcceptsVision({ type: "image", modalities: ["image"], vision: true })).toBe(true);
  });

  it("is false without a model", () => {
    expect(modelAcceptsVision(undefined)).toBe(false);
  });
});

describe("resolveVisualTokenBudget", () => {
  it("fills omitted keys from the default budget", () => {
    expect(resolveVisualTokenBudget(undefined)).toEqual(DEFAULT_VISUAL_TOKEN_BUDGET);
    expect(resolveVisualTokenBudget({ visualTokenBudget: { maxImages: 3 } }).maxImages).toBe(3);
    expect(resolveVisualTokenBudget({ visualTokenBudget: { maxImages: 3 } }).maxPixels).toBe(
      DEFAULT_VISUAL_TOKEN_BUDGET.maxPixels,
    );
  });
});

describe("nonVisionAttachmentGuidance", () => {
  it("names an installed alternative when one exists", () => {
    expect(nonVisionAttachmentGuidance("Gemma 4 12B IT GGUF")).toMatch(/Gemma 4 12B IT GGUF/);
    expect(nonVisionAttachmentGuidance()).toMatch(/Install a vision-capable model/);
  });
});
