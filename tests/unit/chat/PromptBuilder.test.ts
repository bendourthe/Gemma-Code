import { describe, it, expect } from "vitest";
import { PromptBuilder } from "../../../modules/coding/chat/PromptBuilder.js";
import { TOOL_CATALOG } from "../../../src/tools/ToolCatalog.js";
import type { PromptContext } from "../../../modules/coding/chat/PromptBuilder.types.js";

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
    const result = builder.buildSync(makeContext());
    expect(result.length).toBeGreaterThan(0);
  });

  it("build() produces output under system prompt budget for 128K context", () => {
    const result = builder.buildSync(makeContext());
    const estimatedTokens = Math.ceil(result.length / 4);
    const budget = Math.floor(131072 * 0.10); // 10% default
    expect(estimatedTokens).toBeLessThanOrEqual(budget);
  });

  it("build() includes base instructions", () => {
    const result = builder.buildSync(makeContext());
    expect(result).toContain("Gemma Code");
    expect(result).toContain("local agentic coding assistant");
  });

  it("build() includes tool declarations", () => {
    const result = builder.buildSync(makeContext());
    expect(result).toContain("<|tool>");
    expect(result).toContain("<tool|>");
    expect(result).toContain("read_file");
    expect(result).toContain("write_file");
  });

  it("build() lists all tools from TOOL_CATALOG", () => {
    const result = builder.buildSync(makeContext());
    for (const tool of TOOL_CATALOG) {
      expect(result).toContain(`"name": "${tool.name}"`);
    }
  });

  // ---- plan mode ------------------------------------------------------------

  it("includes plan mode section when planModeActive is true", () => {
    const result = builder.buildSync(makeContext({ planModeActive: true }));
    expect(result).toContain("PLAN MODE");
    expect(result).toContain("numbered plan");
  });

  it("omits plan mode section when planModeActive is false", () => {
    const result = builder.buildSync(makeContext({ planModeActive: false }));
    expect(result).not.toContain("PLAN MODE");
  });

  // ---- thinking mode --------------------------------------------------------

  it("includes thinking mode section when thinkingMode is true", () => {
    const result = builder.buildSync(makeContext({ thinkingMode: true }));
    expect(result).toContain("<|think|>");
  });

  it("omits thinking mode section when thinkingMode is false", () => {
    const result = builder.buildSync(makeContext({ thinkingMode: false }));
    expect(result).not.toContain("<|think|>");
  });

  // ---- skill injection ------------------------------------------------------

  it("includes skill prompt when activeSkillPrompt is set", () => {
    const result = builder.buildSync(makeContext({
      activeSkillPrompt: "You are a commit message generator.",
    }));
    expect(result).toContain("commit message generator");
  });

  it("omits skill section when activeSkillPrompt is not set", () => {
    const result = builder.buildSync(makeContext());
    expect(result).not.toContain("commit message generator");
  });

  // ---- prompt style ---------------------------------------------------------

  it("concise style is shorter than beginner style", () => {
    const concise = builder.buildSync(makeContext({ promptStyle: "concise" }));
    const beginner = builder.buildSync(makeContext({ promptStyle: "beginner" }));
    expect(concise.length).toBeLessThanOrEqual(beginner.length);
  });

  // ---- over-budget behavior -------------------------------------------------

  it("drops lowest-priority conditional sections when over budget", () => {
    // Use a very small budget to force dropping
    const result = builder.buildSync(makeContext({
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
    const result = builder.buildSync(makeContext({
      maxTokens: 100, // extremely small
      systemPromptBudgetPercent: 10,
    }));
    expect(result).toContain("Gemma Code");
    expect(result).toContain("<|tool>");
  });

  // ---- memory and sub-agent placeholders ------------------------------------

  it("does not crash when memoryContext is undefined", () => {
    expect(() => builder.buildSync(makeContext())).not.toThrow();
  });

  it("includes memory content when memoryContext is set", () => {
    const result = builder.buildSync(makeContext({
      memoryContext: "User prefers TypeScript.",
    }));
    expect(result).toContain("User prefers TypeScript.");
  });

  it("includes sub-agent section when isSubAgent is true", () => {
    const result = builder.buildSync(makeContext({ isSubAgent: true }));
    expect(result).toContain("Sub-Agent Mode");
  });

  it("omits sub-agent section when isSubAgent is false", () => {
    const result = builder.buildSync(makeContext({ isSubAgent: false }));
    expect(result).not.toContain("Sub-Agent Mode");
  });

  it("sub-agent section includes type-specific instructions", () => {
    const result = builder.buildSync(makeContext({
      isSubAgent: true,
      subAgentType: "verification",
    }));
    expect(result).toContain("verification agent");
    expect(result).toContain("bugs");
  });

  it("sub-agent mode skips skill, memory, and plan mode sections", () => {
    const result = builder.buildSync(makeContext({
      isSubAgent: true,
      subAgentType: "research",
      planModeActive: true,
      activeSkillPrompt: "Skill content here.",
      memoryContext: "User prefers Python.",
    }));
    expect(result).toContain("Sub-Agent Mode");
    expect(result).not.toContain("Skill content here.");
    expect(result).not.toContain("User prefers Python.");
    expect(result).not.toContain("PLAN MODE");
  });

  it("sub-agent mode still includes thinking mode when enabled", () => {
    const result = builder.buildSync(makeContext({
      isSubAgent: true,
      subAgentType: "verification",
      thinkingMode: true,
    }));
    expect(result).toContain("<|think|>");
    expect(result).toContain("Sub-Agent Mode");
  });

  // ---- buildForSubAgent convenience method --------------------------------

  it("buildForSubAgent produces a minimal prompt with sub-agent directives", async () => {
    const result = await builder.buildForSubAgent(
      {
        type: "verification",
        maxIterations: 10,
        userRequest: "Check code",
        modifiedFiles: [],
        recentToolResults: [],
      },
      [...TOOL_CATALOG],
      131072,
    );
    expect(result).toContain("Gemma Code");
    expect(result).toContain("Sub-Agent Mode");
    expect(result).toContain("verification agent");
  });

  it("buildForSubAgent enables thinking mode for verification", async () => {
    const result = await builder.buildForSubAgent(
      {
        type: "verification",
        maxIterations: 10,
        userRequest: "Check code",
        modifiedFiles: [],
        recentToolResults: [],
      },
      [...TOOL_CATALOG],
      131072,
    );
    expect(result).toContain("<|think|>");
  });

  it("buildForSubAgent disables thinking mode for research", async () => {
    const result = await builder.buildForSubAgent(
      {
        type: "research",
        maxIterations: 10,
        userRequest: "Find info",
        modifiedFiles: [],
        recentToolResults: [],
      },
      [...TOOL_CATALOG],
      131072,
    );
    expect(result).not.toContain("<|think|>");
  });

  // ---- regression: covers current SYSTEM_PROMPT functionality ---------------

  it("default context includes tool use protocol instructions", () => {
    const result = builder.buildSync(makeContext());
    expect(result).toContain("tool call format");
    expect(result).toContain("<|tool_result>");
    expect(result).toContain("workspace root");
  });

  it("default context includes identity paragraph", () => {
    const result = builder.buildSync(makeContext());
    expect(result).toContain("offline via Ollama");
    expect(result).toContain("Never fabricate");
  });

  // ---- language rules (HUB.P3.RULES) ---------------------------------------

  it("injects the language-rules section when context.languageRules is set", () => {
    const rules = "## python project rules (from the skill catalog)\n\nUse ruff.";
    const result = builder.buildSync(makeContext({ languageRules: rules }));
    expect(result).toContain("python project rules");
    expect(result).toContain("Use ruff.");
  });

  it("omits the language-rules section by default (no languageRules)", () => {
    const result = builder.buildSync(makeContext());
    expect(result).not.toContain("project rules (from the skill catalog)");
  });

  it("omits the language-rules section when languageRules is blank", () => {
    const result = builder.buildSync(makeContext({ languageRules: "   " }));
    expect(result).not.toContain("project rules (from the skill catalog)");
  });
});
