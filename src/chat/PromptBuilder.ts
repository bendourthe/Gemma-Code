import type { PromptContext, PromptSection } from "./PromptBuilder.types.js";
import type { SubAgentConfig } from "../agents/types.js";
import type { DynamicToolMetadata, ToolMetadata } from "../tools/ToolCatalog.js";
import type { ScoringContext } from "./RelevanceScorer.js";
import { getSubAgentInstructions } from "../agents/SubAgentPrompts.js";
import { serializeToolDefinitions, serializeToolSummary } from "../tools/Gemma4ToolFormat.js";
import { calculateBudget } from "../config/PromptBudget.js";
import { PLAN_MODE_SYSTEM_ADDENDUM } from "../modes/PlanMode.js";

/** Rough token estimation matching the heuristic used elsewhere in the codebase. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Dynamic system prompt builder that assembles sections conditionally
 * within a token budget. Sections are packed greedily by priority
 * (lower number = higher priority).
 *
 * Always-include sections are packed first regardless of budget.
 * Conditional sections are packed in priority order; over-budget
 * sections are dropped starting from the lowest priority.
 */
export class PromptBuilder {
  /**
   * Assemble the system prompt from the given runtime context.
   * When a relevanceScorer is provided, conditional sections are ranked by
   * relevance score instead of static priority. Returns a Promise.
   */
  async build(context: PromptContext): Promise<string> {
    if (!context.relevanceScorer) {
      return this._buildCore(context);
    }

    const budget = calculateBudget(context.maxTokens, {
      systemPromptPercent: context.systemPromptBudgetPercent,
    });

    const sections = this._collectSections(context);
    const always = sections.filter((s) => s.alwaysInclude);
    const conditional = sections.filter((s) => !s.alwaysInclude);

    // Score all conditional sections.
    const scoringContext: ScoringContext = {
      currentQuery: context.currentQuery,
      currentTimestamp: Date.now(),
      recentUserMessage: context.recentUserMessage,
    };

    const scored = await Promise.all(
      conditional.map(async (section) => ({
        section,
        score: await context.relevanceScorer!.scoreSection(section, scoringContext),
      })),
    );

    // Sort by score descending (highest relevance first).
    scored.sort((a, b) => b.score - a.score);

    // Pack always-include unconditionally, then scored sections greedily.
    const included: PromptSection[] = [...always];
    let usedTokens = always.reduce((sum, s) => sum + s.estimatedTokens, 0);

    for (const { section } of scored) {
      if (usedTokens + section.estimatedTokens <= budget.systemPromptBudget) {
        included.push(section);
        usedTokens += section.estimatedTokens;
      }
    }

    // Sort included sections by priority for deterministic output order.
    included.sort((a, b) => a.priority - b.priority);
    return included.map((s) => s.content).join("\n\n");
  }

  /**
   * Synchronous build for contexts where async is not available (e.g.
   * constructors). Does not support relevance scoring. Uses static
   * priority ordering.
   */
  buildSync(context: PromptContext): string {
    return this._buildCore(context);
  }

  /**
   * Build a minimal system prompt for a sub-agent. Assembles a PromptContext
   * with sub-agent defaults and calls build().
   */
  async buildForSubAgent(
    config: SubAgentConfig,
    enabledTools: readonly (ToolMetadata | DynamicToolMetadata)[],
    maxTokens: number = 131072,
  ): Promise<string> {
    const context: PromptContext = {
      modelName: "",
      maxTokens,
      planModeActive: false,
      thinkingMode: config.type === "verification" || config.type === "planning",
      enabledTools,
      isSubAgent: true,
      subAgentType: config.type,
      promptStyle: "concise",
    };
    return this.build(context);
  }

  /** Shared synchronous core logic for assembling sections by static priority. */
  private _buildCore(context: PromptContext): string {
    const budget = calculateBudget(context.maxTokens, {
      systemPromptPercent: context.systemPromptBudgetPercent,
    });

    const sections = this._collectSections(context);

    // Separate always-include from conditional
    const always = sections.filter((s) => s.alwaysInclude);
    const conditional = sections
      .filter((s) => !s.alwaysInclude)
      .sort((a, b) => a.priority - b.priority);

    // Pack always-include sections unconditionally
    const included: PromptSection[] = [...always];
    let usedTokens = always.reduce((sum, s) => sum + s.estimatedTokens, 0);

    // Pack conditional sections greedily by ascending priority
    for (const section of conditional) {
      if (usedTokens + section.estimatedTokens <= budget.systemPromptBudget) {
        included.push(section);
        usedTokens += section.estimatedTokens;
      }
    }

    // Sort included sections by priority for deterministic output order
    included.sort((a, b) => a.priority - b.priority);

    return included.map((s) => s.content).join("\n\n");
  }

  private _collectSections(context: PromptContext): PromptSection[] {
    const sections: PromptSection[] = [];

    const base = this._buildBaseInstructions(context);
    if (base) sections.push(base);

    const tools = this._buildToolDeclarations(context);
    if (tools) sections.push(tools);

    if (context.isSubAgent) {
      // Sub-agents get only: base + tools + sub-agent directive + thinking (if enabled)
      const thinking = this._buildThinkingModeSection(context);
      if (thinking) sections.push(thinking);

      const subAgent = this._buildSubAgentSection(context);
      if (subAgent) sections.push(subAgent);
    } else {
      const plan = this._buildPlanModeSection(context);
      if (plan) sections.push(plan);

      const thinking = this._buildThinkingModeSection(context);
      if (thinking) sections.push(thinking);

      const skill = this._buildSkillSection(context);
      if (skill) sections.push(skill);

      const memory = this._buildMemorySection(context);
      if (memory) sections.push(memory);

      const subAgent = this._buildSubAgentSection(context);
      if (subAgent) sections.push(subAgent);
    }

    return sections;
  }

  /** Identity paragraph and general instructions. Always included. */
  private _buildBaseInstructions(context: PromptContext): PromptSection {
    let content: string;

    switch (context.promptStyle) {
      case "beginner":
        content =
          "You are Gemma Code, a local agentic coding assistant running entirely offline via Ollama. " +
          "You help developers understand, write, edit, and debug code across multiple files. " +
          "Explain your reasoning in detail, define technical terms when first used, and walk through " +
          "solutions step-by-step. Prefer clear, correct solutions over clever ones. " +
          "Never fabricate file contents or API responses -- always acknowledge uncertainty.\n\n" +
          "## Tool Use\n\n" +
          "You have access to tools declared with <|tool> blocks. Call a tool using the native tool call format. " +
          "After tool execution, the result will be returned in a <|tool_result> block. " +
          "Process the result and either call another tool or give your final answer. Do not fabricate tool results.\n\n" +
          "All file paths are relative to the workspace root.";
        break;
      case "detailed":
        content =
          "You are Gemma Code, a local agentic coding assistant running entirely offline via Ollama. " +
          "You help developers understand, write, edit, and debug code across multiple files. " +
          "Reason step-by-step, explain your thinking thoroughly, and prefer clear, correct solutions over clever ones. " +
          "When making changes, explain the rationale and any trade-offs considered. " +
          "Never fabricate file contents or API responses -- always acknowledge uncertainty.\n\n" +
          "## Tool Use\n\n" +
          "You have access to tools declared with <|tool> blocks. Call a tool using the native tool call format. " +
          "After tool execution, the result will be returned in a <|tool_result> block. " +
          "Process the result and either call another tool or give your final answer. Do not fabricate tool results.\n\n" +
          "All file paths are relative to the workspace root.";
        break;
      default: // "concise"
        content =
          "You are Gemma Code, a local agentic coding assistant running entirely offline via Ollama. " +
          "You help developers understand, write, edit, and debug code across multiple files. " +
          "Reason step-by-step, explain your thinking, and prefer clear, correct solutions over clever ones. " +
          "Never fabricate file contents or API responses -- always acknowledge uncertainty.\n\n" +
          "## Tool Use\n\n" +
          "You have access to tools declared with <|tool> blocks. Call a tool using the native tool call format. " +
          "After tool execution, the result will be returned in a <|tool_result> block. " +
          "Process the result and either call another tool or give your final answer. Do not fabricate tool results.\n\n" +
          "All file paths are relative to the workspace root.";
    }

    if (context.tierName) {
      content += `\n\nRunning on ${context.tierName} tier (${context.tierVramMb ?? 0} MB VRAM) with model ${context.tierModelName ?? "auto"}.`;
    }

    return {
      id: "base",
      content,
      priority: 0,
      alwaysInclude: true,
      estimatedTokens: estimateTokens(content),
    };
  }

  /** Tool declarations in Gemma 4 native `<|tool>` format. Always included. */
  private _buildToolDeclarations(context: PromptContext): PromptSection | null {
    if (context.enabledTools.length === 0) return null;

    const content = context.lazyToolLoading
      ? serializeToolSummary(context.enabledTools)
      : serializeToolDefinitions(context.enabledTools);
    return {
      id: "tools",
      content,
      priority: 1,
      alwaysInclude: true,
      estimatedTokens: estimateTokens(content),
    };
  }

  /** Plan mode instructions. Conditional on planModeActive. */
  private _buildPlanModeSection(context: PromptContext): PromptSection | null {
    if (!context.planModeActive) return null;

    return {
      id: "plan-mode",
      content: PLAN_MODE_SYSTEM_ADDENDUM,
      priority: 10,
      alwaysInclude: false,
      estimatedTokens: estimateTokens(PLAN_MODE_SYSTEM_ADDENDUM),
    };
  }

  /** Thinking mode activation. Conditional on thinkingMode. */
  private _buildThinkingModeSection(context: PromptContext): PromptSection | null {
    if (!context.thinkingMode) return null;

    const content =
      "<|think|>\n" +
      "Use internal reasoning before responding. Think through the problem carefully, " +
      "consider edge cases, and plan your approach before writing code or calling tools.";
    return {
      id: "thinking-mode",
      content,
      priority: 15,
      alwaysInclude: false,
      estimatedTokens: estimateTokens(content),
    };
  }

  /** Active skill prompt injection. Conditional and token-capped. */
  private _buildSkillSection(context: PromptContext): PromptSection | null {
    if (!context.activeSkillPrompt) return null;

    const budget = calculateBudget(context.maxTokens, {
      systemPromptPercent: context.systemPromptBudgetPercent,
    });

    let content = context.activeSkillPrompt;
    const maxChars = budget.skillBudget * 4; // reverse the token estimation
    if (content.length > maxChars) {
      content = content.slice(0, maxChars) + "\n[Skill prompt truncated to fit budget]";
    }

    return {
      id: "skill",
      content,
      priority: 20,
      alwaysInclude: false,
      estimatedTokens: estimateTokens(content),
    };
  }

  /** Memory context injection. Truncates to fit within the memory token budget. */
  private _buildMemorySection(context: PromptContext): PromptSection | null {
    if (!context.memoryContext) return null;

    const budget = calculateBudget(context.maxTokens, {
      systemPromptPercent: context.systemPromptBudgetPercent,
    });

    let content = context.memoryContext;
    const maxChars = budget.memoryBudget * 4;
    if (content.length > maxChars) {
      content = content.slice(0, maxChars) + "\n[Memory context truncated to fit budget]";
    }

    return {
      id: "memory",
      content,
      priority: 30,
      alwaysInclude: false,
      estimatedTokens: estimateTokens(content),
    };
  }

  /** Sub-agent instructions with type-specific directives. */
  private _buildSubAgentSection(context: PromptContext): PromptSection | null {
    if (!context.isSubAgent) return null;

    const instructions = getSubAgentInstructions(context.subAgentType ?? "research");
    let content = `## Sub-Agent Mode\n\n${instructions}`;

    if (context.subAgentContext) {
      content += `\n\n${context.subAgentContext}`;
    }

    return {
      id: "sub-agent",
      content,
      priority: 5,
      alwaysInclude: true,
      estimatedTokens: estimateTokens(content),
    };
  }
}
