import { describe, it, expect } from "vitest";
import { isVisionCapableModel } from "../../../modules/coding/config/ModelCapabilities.js";
import { loadCatalog } from "../../../core/registry/catalog.js";
import {
  GEMMA4_GGUF_OLLAMA_BASE,
  GEMMA4_GGUF_DEFAULT_QUANT,
} from "../../../modules/coding/config/Gemma4GgufQuants.js";

describe("isVisionCapableModel", () => {
  it("recognizes the Gemma 4 GGUF ollama reference as vision-capable", () => {
    expect(
      isVisionCapableModel(`${GEMMA4_GGUF_OLLAMA_BASE}:${GEMMA4_GGUF_DEFAULT_QUANT}`),
    ).toBe(true);
  });

  it("recognizes Gemma 4 family / catalog-id tags", () => {
    expect(isVisionCapableModel("gemma4:e4b")).toBe(true);
    expect(isVisionCapableModel("gemma-4-12b-it-gguf")).toBe(true);
    expect(isVisionCapableModel("gemma_4")).toBe(true);
  });

  it("treats text-only models as non-vision", () => {
    expect(isVisionCapableModel("gemma3:27b")).toBe(false);
    expect(isVisionCapableModel("qwen2.5-coder:7b")).toBe(false);
    expect(isVisionCapableModel("llama3.1:8b")).toBe(false);
    expect(isVisionCapableModel("deepseek-coder-v2:16b")).toBe(false);
  });

  it("returns false for empty / undefined / null", () => {
    expect(isVisionCapableModel("")).toBe(false);
    expect(isVisionCapableModel(undefined)).toBe(false);
    expect(isVisionCapableModel(null)).toBe(false);
  });

  // Guard: the runtime name-matcher must agree with the authoritative catalog
  // `multimodal: true` flag so the two sources cannot drift apart.
  it("agrees with every catalog entry flagged multimodal", async () => {
    const catalog = await loadCatalog();
    const multimodalSpecs = catalog.models.filter((m) => m.multimodal === true);
    expect(multimodalSpecs.length).toBeGreaterThan(0);
    for (const spec of multimodalSpecs) {
      const ref = (spec.source.url ?? "").replace(/^ollama:\/\//, "") || spec.id;
      expect(isVisionCapableModel(ref)).toBe(true);
      expect(isVisionCapableModel(spec.id)).toBe(true);
    }
  });
});
