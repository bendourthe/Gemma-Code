import { describe, it, expect } from "vitest";
import { calculateBudget } from "../../../src/config/PromptBudget.js";

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
    const budget = calculateBudget(131072, { systemPromptPercent: 15 });
    expect(budget.systemPromptBudget).toBe(Math.floor(131072 * 0.15));
    // Other allocations remain at default percentages
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
});
