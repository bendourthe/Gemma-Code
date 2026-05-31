import { describe, it, expect } from "vitest";
import {
  SAMPLER_PRESETS,
  parseThinkingMode,
  resolvePresetForBudget,
} from "../../../modules/coding/config/SamplerPresets.js";

describe("SamplerPresets", () => {
  it("nothink uses the concise default sampler values", () => {
    expect(SAMPLER_PRESETS.nothink.options.temperature).toBe(0.7);
    expect(SAMPLER_PRESETS.nothink.options.top_p).toBe(0.95);
    expect(SAMPLER_PRESETS.nothink.options.top_k).toBe(64);
    expect(SAMPLER_PRESETS.nothink.reasoning).toBe(false);
  });

  it("think uses Qwen/jola tuned values with reasoning enabled", () => {
    const think = SAMPLER_PRESETS.think;
    expect(think.options.temperature).toBe(0.6);
    expect(think.options.top_p).toBe(0.95);
    expect(think.options.top_k).toBe(20);
    expect(think.reasoning).toBe(true);
  });

  it("think-max has the extended output budget", () => {
    expect(SAMPLER_PRESETS["think-max"].maxTokens).toBe(32768);
  });

  describe("resolvePresetForBudget", () => {
    it("returns think-max unchanged when context budget >= 64K", () => {
      const preset = resolvePresetForBudget("think-max", 128_000);
      expect(preset.mode).toBe("think-max");
    });

    it("downgrades think-max to think below 64K", () => {
      const preset = resolvePresetForBudget("think-max", 32_000);
      expect(preset.mode).toBe("think");
    });

    it("does not downgrade other modes", () => {
      expect(resolvePresetForBudget("think", 8_000).mode).toBe("think");
      expect(resolvePresetForBudget("nothink", 8_000).mode).toBe("nothink");
    });
  });

  describe("parseThinkingMode", () => {
    it("accepts the three canonical names", () => {
      expect(parseThinkingMode("nothink")).toBe("nothink");
      expect(parseThinkingMode("think")).toBe("think");
      expect(parseThinkingMode("think-max")).toBe("think-max");
    });

    it("is case-insensitive", () => {
      expect(parseThinkingMode("THINK")).toBe("think");
      expect(parseThinkingMode("Think-Max")).toBe("think-max");
    });

    it("returns null on unrecognised input", () => {
      expect(parseThinkingMode("ultra")).toBeNull();
      expect(parseThinkingMode("")).toBeNull();
    });
  });
});
