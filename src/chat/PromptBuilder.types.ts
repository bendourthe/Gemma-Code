import type { ToolMetadata } from "../tools/ToolCatalog.js";

export type PromptStyle = "concise" | "detailed" | "beginner";

/** Runtime context passed to PromptBuilder.build() to control section assembly. */
export interface PromptContext {
  readonly modelName: string;
  readonly maxTokens: number;
  readonly planModeActive: boolean;
  readonly thinkingMode: boolean;
  readonly activeSkillPrompt?: string;
  readonly enabledTools: readonly ToolMetadata[];
  readonly isSubAgent?: boolean;
  readonly promptStyle: PromptStyle;
  readonly workspacePath?: string;
  readonly memoryContext?: string;
  readonly systemPromptBudgetPercent?: number;
}

/** A candidate section for inclusion in the system prompt. */
export interface PromptSection {
  readonly id: string;
  readonly content: string;
  /** Lower number = higher priority. Sections are packed in ascending order. */
  readonly priority: number;
  /** When true, the section is always included regardless of budget. */
  readonly alwaysInclude: boolean;
  /** Estimated token count (chars / 4). */
  readonly estimatedTokens: number;
}
