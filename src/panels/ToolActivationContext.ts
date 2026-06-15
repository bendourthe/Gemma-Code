import * as vscode from "vscode";
import type { PlanMode } from "../../modules/coding/chat/PlanMode.js";
import type { PromptContext } from "../../modules/coding/chat/PromptBuilder.types.js";
import type { GemmaCodeSettings } from "../../modules/coding/config/settings.js";
import type { HardwareTierConfig } from "../../modules/coding/config/HardwareTier.types.js";
import type { OllamaToolDefinition } from "../../modules/coding/llm/types.js";
import type { WorkingMemory } from "../storage/WorkingMemory.js";
import type { UnifiedMemoryRetriever } from "../storage/UnifiedMemoryRetriever.js";
import {
  TOOL_CATALOG,
  toDynamicMetadata,
  type DynamicToolMetadata,
} from "../tools/ToolCatalog.js";
import { computeToolActivation } from "../tools/ToolActivationRules.js";
import type { ToolRegistry } from "../tools/ToolRegistry.js";

export interface ToolActivationContextDeps {
  readonly planMode: PlanMode;
  getSettings(): GemmaCodeSettings;
  getRegistry(): ToolRegistry | null;
  getMcpTools(): DynamicToolMetadata[];
  getOllamaReachable(): boolean;
  getTierConfig(): HardwareTierConfig | undefined;
  getWorkingMemory(): WorkingMemory | null;
  getUnifiedRetriever(): UnifiedMemoryRetriever | null;
  /**
   * v1.5.0 Phase 7 (HUB.P3.RULES): optional resolver for the workspace's
   * Nexus-Hub language rules (via LanguageRuleBuilder over the active devai-hub
   * bundle). Returns undefined when the feature is off or no rules apply, in
   * which case PromptBuilder injects no language-rules section.
   */
  getLanguageRules?(): string | undefined;
}

/**
 * Owns the prompt-context assembly and tool-activation computation extracted
 * from {@link NexusCodingPanel} as part of v0.7.0 Phase 0 sub-task 0.4. The
 * panel and the controller share this helper so prompt rebuilds, tool
 * filtering, and OllamaToolDefinition packaging stay consistent.
 */
export class ToolActivationContext {
  constructor(private readonly _deps: ToolActivationContextDeps) {}

  buildPromptContext(memoryContext?: string): PromptContext {
    const deps = this._deps;
    const settings = deps.getSettings();
    const tier = deps.getTierConfig();
    const activation = this._computeActivation();
    return {
      modelName: settings.modelName,
      maxTokens: tier?.contextWindow ?? settings.maxTokens,
      planModeActive: deps.planMode.active,
      thinkingMode: settings.thinkingMode,
      enabledTools: activation.enabledMeta,
      promptStyle: settings.promptStyle,
      workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      systemPromptBudgetPercent: settings.systemPromptBudgetPercent,
      memoryContext,
      workingMemory: deps.getWorkingMemory() ?? undefined,
      unifiedRetriever: deps.getUnifiedRetriever() ?? undefined,
      tierName: tier?.name,
      tierVramMb: tier?.vramRange.max,
      tierModelName: tier?.recommendedModels[0]?.modelName,
      // v1.4.0 Phase 8 (gap 3.5.P3.I): tell the agent when codegraph navigation
      // was trimmed by the tool-count cap so it falls back to grep.
      toolCapNotice: activation.trimmedCodegraph
        ? "The `codegraph_*` navigation tools were trimmed this turn to stay within the tool-count budget. Use `grep_codebase` / `read_file` for symbol lookup and navigation until they return next turn."
        : undefined,
      // v1.5.0 Phase 7 (HUB.P3.RULES): inject the workspace's Hub language rules
      // when the host wired a resolver (opt-in; undefined -> no section).
      languageRules: deps.getLanguageRules?.(),
    };
  }

  getEnabledToolMetadata(): DynamicToolMetadata[] {
    return this._computeActivation().enabledMeta;
  }

  /**
   * v1.4.0 Phase 8 (gap 3.5.P3.I): single computeToolActivation pass that both
   * applies the enable/disable state to the registry and reports whether the
   * tool-count cap trimmed the codegraph tools (for the prompt notice).
   */
  private _computeActivation(): {
    enabledMeta: DynamicToolMetadata[];
    trimmedCodegraph: boolean;
  } {
    const deps = this._deps;
    const builtinTools = TOOL_CATALOG.map(toDynamicMetadata);
    const allTools = [...builtinTools, ...deps.getMcpTools()];

    const registry = deps.getRegistry();
    if (!registry) return { enabledMeta: builtinTools, trimmedCodegraph: false };

    const { disabledTools, trimmedCodegraph } = computeToolActivation(allTools, {
      ollamaReachable: deps.getOllamaReachable(),
      networkAvailable: true,
      readOnlySession: false,
      totalToolCount: allTools.length,
    });

    for (const tool of allTools) {
      registry.setEnabled(tool.name, !disabledTools.has(tool.name));
    }

    return {
      enabledMeta: registry.getEnabledToolMetadata(allTools),
      trimmedCodegraph,
    };
  }

  buildOllamaTools(): OllamaToolDefinition[] {
    const enabled = this.getEnabledToolMetadata();
    return enabled.map((tool) => {
      const properties: Record<string, { type: string; description: string }> = {};
      const required: string[] = [];
      for (const [key, param] of Object.entries(tool.parameters)) {
        properties[key] = { type: param.type, description: param.description };
        if (param.required) {
          required.push(key);
        }
      }
      return {
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: "object",
            properties,
            ...(required.length > 0 ? { required } : {}),
          },
        },
      };
    });
  }
}
