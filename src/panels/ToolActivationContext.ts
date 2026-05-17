import * as vscode from "vscode";
import type { PlanMode } from "../chat/PlanMode.js";
import type { PromptContext } from "../chat/PromptBuilder.types.js";
import type { GemmaCodeSettings } from "../config/settings.js";
import type { HardwareTierConfig } from "../config/HardwareTier.types.js";
import type { OllamaToolDefinition } from "../llm/types.js";
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
    return {
      modelName: settings.modelName,
      maxTokens: tier?.contextWindow ?? settings.maxTokens,
      planModeActive: deps.planMode.active,
      thinkingMode: settings.thinkingMode,
      enabledTools: this.getEnabledToolMetadata(),
      promptStyle: settings.promptStyle,
      workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      systemPromptBudgetPercent: settings.systemPromptBudgetPercent,
      memoryContext,
      workingMemory: deps.getWorkingMemory() ?? undefined,
      unifiedRetriever: deps.getUnifiedRetriever() ?? undefined,
      tierName: tier?.name,
      tierVramMb: tier?.vramRange.max,
      tierModelName: tier?.recommendedModels[0]?.modelName,
    };
  }

  getEnabledToolMetadata(): DynamicToolMetadata[] {
    const deps = this._deps;
    const builtinTools = TOOL_CATALOG.map(toDynamicMetadata);
    const allTools = [...builtinTools, ...deps.getMcpTools()];

    const registry = deps.getRegistry();
    if (!registry) return builtinTools;

    const { disabledTools } = computeToolActivation(allTools, {
      ollamaReachable: deps.getOllamaReachable(),
      networkAvailable: true,
      readOnlySession: false,
      totalToolCount: allTools.length,
    });

    for (const tool of allTools) {
      registry.setEnabled(tool.name, !disabledTools.has(tool.name));
    }

    return registry.getEnabledToolMetadata(allTools);
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
