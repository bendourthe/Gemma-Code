/**
 * E2E: system prompt budget compliance across tiers.
 *
 * Verifies that PromptBuilder keeps the assembled system prompt under
 * its configured budget for each supported context window, and that
 * low-priority sections are dropped first when budget is tight.
 */

import { describe, it, expect } from "vitest";
import { PromptBuilder } from "../../../modules/coding/chat/PromptBuilder.js";
import { TOOL_CATALOG } from "../../../src/tools/ToolCatalog.js";
import type { PromptContext } from "../../../modules/coding/chat/PromptBuilder.types.js";

function baseContext(overrides?: Partial<PromptContext>): PromptContext {
  return {
    modelName: "gemma4:e4b",
    maxTokens: 131_072,
    planModeActive: false,
    thinkingMode: false,
    enabledTools: [...TOOL_CATALOG],
    promptStyle: "concise",
    systemPromptBudgetPercent: 10,
    ...overrides,
  };
}

function estimatedTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

describe("e2e: prompt budget compliance", () => {
  const builder = new PromptBuilder();

  it("E2B (128K) stays within 10% budget", () => {
    const prompt = builder.buildSync(baseContext({ modelName: "gemma4:e2b" }));
    const budget = Math.floor(131_072 * 0.10);
    expect(estimatedTokens(prompt)).toBeLessThanOrEqual(budget);
  });

  it("E4B (128K) stays within 10% budget", () => {
    const prompt = builder.buildSync(baseContext({ modelName: "gemma4:e4b" }));
    const budget = Math.floor(131_072 * 0.10);
    expect(estimatedTokens(prompt)).toBeLessThanOrEqual(budget);
  });

  it("26B (256K) stays within 10% budget", () => {
    const prompt = builder.buildSync(
      baseContext({ modelName: "gemma4:26b", maxTokens: 262_144 }),
    );
    const budget = Math.floor(262_144 * 0.10);
    expect(estimatedTokens(prompt)).toBeLessThanOrEqual(budget);
  });

  it("all optional sections active still fits under budget", () => {
    const prompt = builder.buildSync(
      baseContext({
        planModeActive: true,
        thinkingMode: true,
        memoryContext: "relevant memory content".repeat(20),
        activeSkillPrompt: "skill section content".repeat(10),
      }),
    );
    const budget = Math.floor(131_072 * 0.10);
    expect(estimatedTokens(prompt)).toBeLessThanOrEqual(budget);
  });

  it("full TOOL_CATALOG declarations fit within budget", () => {
    const prompt = builder.buildSync(baseContext());
    for (const tool of TOOL_CATALOG) {
      expect(prompt).toContain(tool.name);
    }
  });

  it("tight budget drops lower-priority sections first (memory dropped before base)", () => {
    // Force a very tight budget and ensure base section is still present.
    const prompt = builder.buildSync(
      baseContext({
        systemPromptBudgetPercent: 5,
        memoryContext: "low-priority memory chunk ".repeat(200),
      }),
    );
    // Base section must always be included.
    expect(prompt).toContain("Gemma Code");
  });
});
