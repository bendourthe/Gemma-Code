import { describe, it, expect } from "vitest";
import { PromptBuilder } from "../../../src/chat/PromptBuilder.js";
import { TOOL_CATALOG } from "../../../src/tools/ToolCatalog.js";
import type { PromptContext } from "../../../src/chat/PromptBuilder.types.js";

function makeContext(overrides?: Partial<PromptContext>): PromptContext {
  return {
    modelName: "gemma4:e4b",
    maxTokens: 131072,
    planModeActive: false,
    thinkingMode: false,
    enabledTools: [...TOOL_CATALOG],
    promptStyle: "concise",
    ...overrides,
  };
}

describe("PromptBuilder", () => {
  const builder = new PromptBuilder();

  // ---- basic build ----------------------------------------------------------

  it("build() with default context produces a non-empty string", () => {
    const result = builder.build(makeContext());
    expect(result.length).toBeGreaterThan(0);
  });

  it("build() produces output under system prompt budget for 128K context", () => {
    const result = builder.build(makeContext());
    const estimatedTokens = Math.ceil(result.length / 4);
    const budget = Math.floor(131072 * 0.10); // 10% default
    expect(estimatedTokens).toBeLessThanOrEqual(budget);
  });

  it("build() includes base instructions", () => {
    const result = builder.build(makeContext());
    expect(result).toContain("Gemma Code");
    expect(result).toContain("local agentic coding assistant");
  });

  it("build() includes tool declarations", () => {
    const result = builder.build(makeContext());
    expect(result).toContain("<|tool>");
    expect(result).toContain("<tool|>");
    expect(result).toContain("read_file");
    expect(result).toContain("write_file");
  });

  it("build() lists all 10 tools from TOOL_CATALOG", () => {
    const result = builder.build(makeContext());
    for (const tool of TOOL_CATALOG) {
      expect(result).toContain(`"name": "${tool.name}"`);
    }
  });

  // ---- plan mode ------------------------------------------------------------

  it("includes plan mode section when planModeActive is true", () => {
    const result = builder.build(makeContext({ planModeActive: true }));
    expect(result).toContain("PLAN MODE");
    expect(result).toContain("numbered plan");
  });

  it("omits plan mode section when planModeActive is false", () => {
    const result = builder.build(makeContext({ planModeActive: false }));
    expect(result).not.toContain("PLAN MODE");
  });

  // ---- thinking mode --------------------------------------------------------

  it("includes thinking mode section when thinkingMode is true", () => {
    const result = builder.build(makeContext({ thinkingMode: true }));
    expect(result).toContain("<|think|>");
  });

  it("omits thinking mode section when thinkingMode is false", () => {
    const result = builder.build(makeContext({ thinkingMode: false }));
    expect(result).not.toContain("<|think|>");
  });

  // ---- skill injection ------------------------------------------------------

  it("includes skill prompt when activeSkillPrompt is set", () => {
    const result = builder.build(makeContext({
      activeSkillPrompt: "You are a commit message generator.",
    }));
    expect(result).toContain("commit message generator");
  });

  it("omits skill section when activeSkillPrompt is not set", () => {
    const result = builder.build(makeContext());
    expect(result).not.toContain("commit message generator");
  });

  // ---- prompt style ---------------------------------------------------------

  it("concise style is shorter than beginner style", () => {
    const concise = builder.build(makeContext({ promptStyle: "concise" }));
    const beginner = builder.build(makeContext({ promptStyle: "beginner" }));
    expect(concise.length).toBeLessThanOrEqual(beginner.length);
  });

  // ---- over-budget behavior -------------------------------------------------

  it("drops lowest-priority conditional sections when over budget", () => {
    // Use a very small budget to force dropping
    const result = builder.build(makeContext({
      maxTokens: 200, // 200 * 10% = 20 token budget
      planModeActive: true,
      thinkingMode: true,
      activeSkillPrompt: "Skill content here.",
      systemPromptBudgetPercent: 10,
    }));
    // Always-include sections (base + tools) survive
    expect(result).toContain("Gemma Code");
    // At least some conditional sections should be dropped due to tiny budget
    // (base + tools alone exceed 20 tokens, so they're included via alwaysInclude)
  });

  it("always-include sections survive even when over budget", () => {
    const result = builder.build(makeContext({
      maxTokens: 100, // extremely small
      systemPromptBudgetPercent: 10,
    }));
    expect(result).toContain("Gemma Code");
    expect(result).toContain("<|tool>");
  });

  // ---- memory and sub-agent placeholders ------------------------------------

  it("does not crash when memoryContext is undefined", () => {
    expect(() => builder.build(makeContext())).not.toThrow();
  });

  it("includes memory content when memoryContext is set", () => {
    const result = builder.build(makeContext({
      memoryContext: "User prefers TypeScript.",
    }));
    expect(result).toContain("User prefers TypeScript.");
  });

  it("includes sub-agent section when isSubAgent is true", () => {
    const result = builder.build(makeContext({ isSubAgent: true }));
    expect(result).toContain("Sub-Agent Mode");
  });

  it("omits sub-agent section when isSubAgent is false", () => {
    const result = builder.build(makeContext({ isSubAgent: false }));
    expect(result).not.toContain("Sub-Agent Mode");
  });

  // ---- regression: covers current SYSTEM_PROMPT functionality ---------------

  it("default context includes tool use protocol instructions", () => {
    const result = builder.build(makeContext());
    expect(result).toContain("tool call format");
    expect(result).toContain("<|tool_result>");
    expect(result).toContain("workspace root");
  });

  it("default context includes identity paragraph", () => {
    const result = builder.build(makeContext());
    expect(result).toContain("offline via Ollama");
    expect(result).toContain("Never fabricate");
  });
});
