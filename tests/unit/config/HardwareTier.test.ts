import { describe, it, expect } from "vitest";
import {
  TIER_CONFIGS,
  classifyTier,
  getTierConfig,
} from "../../../modules/coding/config/HardwareTier.js";
import type { HardwareTierId } from "../../../modules/coding/config/HardwareTier.types.js";

describe("classifyTier", () => {
  it.each([
    [6144, 1],
    [8192, 1],
    [10239, 1],
    [10240, 2],
    [12288, 2],
    [16384, 2],
    [20479, 2],
    [20480, 3],
    [24576, 3],
    [49152, 3],
  ] as Array<[number, HardwareTierId]>)(
    "classifies %d MB VRAM as Tier %d",
    (vramMb, expectedTier) => {
      expect(classifyTier(vramMb)).toBe(expectedTier);
    },
  );

  it("classifies 0 MB VRAM as Tier 1", () => {
    expect(classifyTier(0)).toBe(1);
  });
});

describe("getTierConfig", () => {
  it("returns the correct config for each tier ID", () => {
    expect(getTierConfig(1).name).toBe("constrained");
    expect(getTierConfig(2).name).toBe("balanced");
    expect(getTierConfig(3).name).toBe("full");
  });

  it("throws on invalid tier ID", () => {
    expect(() => getTierConfig(99 as HardwareTierId)).toThrow("Invalid hardware tier ID");
  });
});

describe("TIER_CONFIGS", () => {
  it("all tiers have budget percentages summing to <= 100", () => {
    for (const tierId of [1, 2, 3] as HardwareTierId[]) {
      const config = TIER_CONFIGS[tierId];
      const sum =
        config.budgetOverrides.systemPromptPercent +
        config.budgetOverrides.memoryPercent +
        config.budgetOverrides.conversationPercent +
        config.budgetOverrides.responsePercent;
      expect(sum).toBeLessThanOrEqual(100);
    }
  });

  it("tier 1 has lower maxAgentIterations than tier 3", () => {
    expect(TIER_CONFIGS[1].maxAgentIterations).toBeLessThan(TIER_CONFIGS[3].maxAgentIterations);
  });

  it("tier 2 matches v0.2.0 defaults for backward compatibility", () => {
    const tier2 = TIER_CONFIGS[2];
    expect(tier2.contextWindow).toBe(131072);
    expect(tier2.maxAgentIterations).toBe(20);
    expect(tier2.compactionThreshold).toBe(0.8);
    expect(tier2.budgetOverrides.systemPromptPercent).toBe(10);
    expect(tier2.budgetOverrides.memoryPercent).toBe(3);
    expect(tier2.budgetOverrides.conversationPercent).toBe(65);
    expect(tier2.budgetOverrides.responsePercent).toBe(20);
  });

  it("each tier has at least one recommended model", () => {
    for (const tierId of [1, 2, 3] as HardwareTierId[]) {
      expect(TIER_CONFIGS[tierId].recommendedModels.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// `getRecommendedModel` was removed in v0.4.0 (Phase 3.19, dead-code sweep).
