import { describe, it, expect, vi } from "vitest";
import { calculateBudget, calculateTierBudget } from "../../../src/config/PromptBudget.js";
import type { HardwareTierConfig } from "../../../src/config/HardwareTier.types.js";

describe("calculateBudget", () => {
  it("returns correct allocations for 128K context (131072 tokens)", () => {
    const budget = calculateBudget(131072);
    expect(budget.systemPromptBudget).toBe(Math.floor(131072 * 0.10));
    expect(budget.memoryBudget).toBe(Math.floor(131072 * 0.03));
    expect(budget.skillBudget).toBe(Math.floor(131072 * 0.02));
    expect(budget.conversationBudget).toBe(Math.floor(131072 * 0.65));
    expect(budget.responseReserve).toBe(Math.floor(131072 * 0.20));
  });

  it("returns proportional allocations for 32K context", () => {
    const budget = calculateBudget(32768);
    expect(budget.systemPromptBudget).toBe(Math.floor(32768 * 0.10));
    expect(budget.conversationBudget).toBe(Math.floor(32768 * 0.65));
  });

  it("respects custom systemPromptPercent override", () => {
    // 12 + 3 + 2 + 65 + 20 = 102 -> needs to stay <= 100 to avoid scaling
    // Use conversationPercent override to compensate
    const budget = calculateBudget(131072, { systemPromptPercent: 12, conversationPercent: 63 });
    expect(budget.systemPromptBudget).toBe(Math.floor(131072 * 0.12));
    // Other allocations remain at their specified/default percentages
    expect(budget.memoryBudget).toBe(Math.floor(131072 * 0.03));
  });

  it("all allocations are whole numbers", () => {
    const budget = calculateBudget(100000);
    expect(Number.isInteger(budget.systemPromptBudget)).toBe(true);
    expect(Number.isInteger(budget.memoryBudget)).toBe(true);
    expect(Number.isInteger(budget.skillBudget)).toBe(true);
    expect(Number.isInteger(budget.conversationBudget)).toBe(true);
    expect(Number.isInteger(budget.responseReserve)).toBe(true);
  });

  it("handles zero maxTokens without error", () => {
    const budget = calculateBudget(0);
    expect(budget.systemPromptBudget).toBe(0);
    expect(budget.conversationBudget).toBe(0);
  });

  it("respects custom memoryPercent override", () => {
    // 10 + 10 + 2 + 58 + 20 = 100 (compensate conversation to stay at 100%)
    const budget = calculateBudget(100000, { memoryPercent: 10, conversationPercent: 58 });
    expect(budget.memoryBudget).toBe(Math.floor(100000 * 0.10));
    // System prompt stays at default 10%
    expect(budget.systemPromptBudget).toBe(Math.floor(100000 * 0.10));
  });

  it("respects custom conversationPercent and responsePercent overrides", () => {
    const budget = calculateBudget(100000, {
      conversationPercent: 50,
      responsePercent: 30,
    });
    expect(budget.conversationBudget).toBe(Math.floor(100000 * 0.50));
    expect(budget.responseReserve).toBe(Math.floor(100000 * 0.30));
  });

  it("scales proportionally when percentages sum to >100", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 40 + 10 + 10 + 60 + 40 = 160%
    const budget = calculateBudget(100000, {
      systemPromptPercent: 40,
      memoryPercent: 10,
      skillPercent: 10,
      conversationPercent: 60,
      responsePercent: 40,
    });
    // After scaling by 100/160 = 0.625:
    // system: 40*0.625=25%, memory: 10*0.625=6.25%, conversation: 60*0.625=37.5%
    const totalAllocated =
      budget.systemPromptBudget +
      budget.memoryBudget +
      budget.skillBudget +
      budget.conversationBudget +
      budget.responseReserve;
    expect(totalAllocated).toBeLessThanOrEqual(100000);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe("calculateTierBudget", () => {
  it("returns correct budget for a tier config", () => {
    const mockTier: HardwareTierConfig = {
      id: 1,
      name: "constrained",
      vramRange: { min: 0, max: 10240 },
      recommendedModels: [],
      maxAgentIterations: 10,
      contextWindow: 32768,
      budgetOverrides: {
        systemPromptPercent: 8,
        memoryPercent: 2,
        conversationPercent: 68,
        responsePercent: 20,
      },
      compactionThreshold: 0.7,
    };

    const budget = calculateTierBudget(mockTier);
    expect(budget.systemPromptBudget).toBe(Math.floor(32768 * 0.08));
    expect(budget.memoryBudget).toBe(Math.floor(32768 * 0.02));
    expect(budget.skillBudget).toBe(Math.floor(32768 * 0.02)); // default skill %
    expect(budget.conversationBudget).toBe(Math.floor(32768 * 0.68));
    expect(budget.responseReserve).toBe(Math.floor(32768 * 0.20));
  });
});
