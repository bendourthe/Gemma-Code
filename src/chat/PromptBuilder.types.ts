import type { DynamicToolMetadata, ToolMetadata } from "../tools/ToolCatalog.js";
import type { SubAgentType } from "../agents/types.js";
import type { RelevanceScorer } from "./RelevanceScorer.js";
import type { WorkingMemory } from "../storage/WorkingMemory.js";
import type { UnifiedMemoryRetriever } from "../storage/UnifiedMemoryRetriever.js";

export type PromptStyle = "concise" | "detailed" | "beginner";

/** Runtime context passed to PromptBuilder.build() to control section assembly. */
export interface PromptContext {
  readonly modelName: string;
  readonly maxTokens: number;
  readonly planModeActive: boolean;
  readonly thinkingMode: boolean;
  readonly activeSkillPrompt?: string;
  readonly enabledTools: readonly (ToolMetadata | DynamicToolMetadata)[];
  readonly isSubAgent?: boolean;
  readonly subAgentType?: SubAgentType;
  readonly subAgentContext?: string;
  readonly promptStyle: PromptStyle;
  readonly workspacePath?: string;
  readonly memoryContext?: string;
  readonly workingMemory?: WorkingMemory;
  readonly unifiedRetriever?: UnifiedMemoryRetriever;
  readonly systemPromptBudgetPercent?: number;
  readonly tierName?: string;
  readonly tierVramMb?: number;
  readonly tierModelName?: string;
  readonly lazyToolLoading?: boolean;
  readonly currentQuery?: string;
  readonly recentUserMessage?: string;
  readonly relevanceScorer?: RelevanceScorer;
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
  /** Timestamp of when this section was last contextually relevant. */
  readonly lastRelevantAt?: number;
}
