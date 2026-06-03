import type { DynamicToolMetadata, ToolMetadata } from "../../../src/tools/ToolCatalog.js";
import type { SubAgentType } from "../agents/types.js";
import type { WorkingMemory } from "../../../src/storage/WorkingMemory.js";
import type { UnifiedMemoryRetriever } from "../../../src/storage/UnifiedMemoryRetriever.js";

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
  /**
   * v1.4.0 Phase 8 (gap 3.5.P3.I): set when the tool-count cap trimmed the
   * `codegraph_*` tools this turn. Rendered as a short system-prompt note so the
   * agent knows code-graph navigation is unavailable and falls back to grep,
   * rather than the tools silently disappearing from the catalog.
   */
  readonly toolCapNotice?: string;
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
