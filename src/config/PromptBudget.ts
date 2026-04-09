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

/**
 * Calculate token budget allocations from the total context window size.
 *
 * Default percentages (128K context = E4B):
 *   system 10%, memory 3%, skill 2%, conversation 65%, response 20%
 *
 * For 256K context (26B/31B), the same ratios scale proportionally.
 */
export function calculateBudget(
  maxTokens: number,
  overrides?: { systemPromptPercent?: number },
): BudgetAllocation {
  const systemPercent = overrides?.systemPromptPercent ?? 10;
  return {
    systemPromptBudget: Math.floor(maxTokens * systemPercent / 100),
    memoryBudget: Math.floor(maxTokens * 0.03),
    skillBudget: Math.floor(maxTokens * 0.02),
    conversationBudget: Math.floor(maxTokens * 0.65),
    responseReserve: Math.floor(maxTokens * 0.20),
  };
}
