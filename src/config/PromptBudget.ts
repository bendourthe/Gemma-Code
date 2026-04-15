import type { HardwareTierConfig } from "./HardwareTier.types.js";

export interface BudgetAllocation {
  /** Tokens available for the system prompt (base instructions + tool declarations). */
  readonly systemPromptBudget: number;
  /** Tokens reserved for memory injection (Phase 3). */
  readonly memoryBudget: number;
  /** Tokens reserved for skill injection when a skill is active. */
  readonly skillBudget: number;
  /** Tokens available for conversation history. */
  readonly conversationBudget: number;
  /** Tokens reserved for the model's response generation. */
  readonly responseReserve: number;
}

export interface BudgetOverrides {
  systemPromptPercent?: number;
  memoryPercent?: number;
  skillPercent?: number;
  conversationPercent?: number;
  responsePercent?: number;
}

/**
 * Calculate token budget allocations from the total context window size.
 *
 * Default percentages (128K context = E4B):
 *   system 10%, memory 3%, skill 2%, conversation 65%, response 20%
 *
 * For 256K context (26B/31B), the same ratios scale proportionally.
 * If percentages sum to >100, they are scaled proportionally to fit.
 */
export function calculateBudget(
  maxTokens: number,
  overrides?: BudgetOverrides,
): BudgetAllocation {
  let systemPercent = overrides?.systemPromptPercent ?? 10;
  let memoryPercent = overrides?.memoryPercent ?? 3;
  let skillPercent = overrides?.skillPercent ?? 2;
  let conversationPercent = overrides?.conversationPercent ?? 65;
  let responsePercent = overrides?.responsePercent ?? 20;

  const total = systemPercent + memoryPercent + skillPercent + conversationPercent + responsePercent;
  if (total > 100) {
    console.warn(
      `[PromptBudget] Budget percentages sum to ${total}% (>100%). Scaling proportionally.`,
    );
    const scale = 100 / total;
    systemPercent *= scale;
    memoryPercent *= scale;
    skillPercent *= scale;
    conversationPercent *= scale;
    responsePercent *= scale;
  }

  return {
    systemPromptBudget: Math.floor(maxTokens * systemPercent / 100),
    memoryBudget: Math.floor(maxTokens * memoryPercent / 100),
    skillBudget: Math.floor(maxTokens * skillPercent / 100),
    conversationBudget: Math.floor(maxTokens * conversationPercent / 100),
    responseReserve: Math.floor(maxTokens * responsePercent / 100),
  };
}

/**
 * Calculate budget allocations using a hardware tier configuration.
 * Convenience wrapper that passes tier-specific overrides to calculateBudget.
 */
export function calculateTierBudget(tierConfig: HardwareTierConfig): BudgetAllocation {
  return calculateBudget(tierConfig.contextWindow, tierConfig.budgetOverrides);
}
