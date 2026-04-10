import type { OllamaClient, OllamaOptions, OllamaToolDefinition } from "../ollama/types.js";
import type { MemoryStore } from "../storage/MemoryStore.js";
import type { PostMessageFn } from "../chat/StreamingPipeline.js";
import type { SubAgentConfig, SubAgentResult, SubAgentType } from "./types.js";
import { buildSubAgentContextMessage } from "./SubAgentPrompts.js";
import { PromptBuilder } from "../chat/PromptBuilder.js";
import { ConversationManager } from "../chat/ConversationManager.js";
import { AgentLoop } from "../tools/AgentLoop.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import { ConfirmationGate } from "../tools/ConfirmationGate.js";
import { computeToolActivation } from "../tools/ToolActivationRules.js";
import { TOOL_CATALOG, toDynamicMetadata } from "../tools/ToolCatalog.js";
import type { DynamicToolMetadata } from "../tools/ToolCatalog.js";
import {
  ReadFileTool,
  ListDirectoryTool,
  GrepCodebaseTool,
} from "../tools/handlers/filesystem.js";
import { RunTerminalTool } from "../tools/handlers/terminal.js";
import { WebSearchTool, FetchPageTool } from "../tools/handlers/webSearch.js";

/** Tools available to each sub-agent type. */
const TOOLS_BY_TYPE: Record<SubAgentType, readonly string[]> = {
  verification: ["read_file", "grep_codebase", "list_directory", "run_terminal"],
  research: ["read_file", "grep_codebase", "list_directory", "web_search", "fetch_page"],
  planning: ["read_file", "grep_codebase", "list_directory"],
};

/**
 * Creates and runs isolated sub-agents with scoped tools and ephemeral conversations.
 * Each sub-agent gets its own ConversationManager and AgentLoop; the conversation
 * is discarded after the run completes.
 */
export class SubAgentManager {
  private readonly _promptBuilder: PromptBuilder;

  constructor(
    private readonly _client: OllamaClient,
    promptBuilder: PromptBuilder,
    private readonly _memoryStore: MemoryStore | null,
    private readonly _ollamaOptions: OllamaOptions,
    private readonly _modelName: string,
  ) {
    this._promptBuilder = promptBuilder;
  }

  async run(config: SubAgentConfig, postMessage: PostMessageFn): Promise<SubAgentResult> {
    postMessage({
      type: "subAgentStatus",
      agentType: config.type,
      state: "running",
    });

    try {
      // Build a scoped tool registry with only the allowed tools.
      const registry = this._buildScopedRegistry(config.type);

      // Get enabled tool metadata for prompt building.
      const allowedNames = new Set(TOOLS_BY_TYPE[config.type]);
      const allToolMeta = TOOL_CATALOG.map(toDynamicMetadata);
      const scopedToolMeta = allToolMeta.filter((t) => allowedNames.has(t.name));

      // Apply activation rules as a safety layer.
      const { disabledTools } = computeToolActivation(scopedToolMeta, {
        ollamaReachable: true,
        networkAvailable: true,
        readOnlySession: false,
        subAgentType: config.type === "planning" ? null : config.type as "verification" | "research",
        totalToolCount: scopedToolMeta.length,
      });

      const enabledToolMeta = scopedToolMeta.filter((t) => !disabledTools.has(t.name));
      for (const tool of scopedToolMeta) {
        registry.setEnabled(tool.name, !disabledTools.has(tool.name));
      }

      // Build the sub-agent system prompt (minimal: base + tools + sub-agent directive).
      const systemPrompt = this._promptBuilder.buildForSubAgent(
        config,
        enabledToolMeta,
        this._ollamaOptions.num_ctx,
      );

      // Create an isolated ConversationManager (no persistence store).
      const manager = new ConversationManager(systemPrompt);

      // Inject the context as the first user message.
      const contextMessage = buildSubAgentContextMessage(config);
      manager.addUserMessage(contextMessage);

      // Build Ollama tool definitions from enabled tools.
      const ollamaTools = this._buildOllamaTools(enabledToolMeta);

      // Create and run an isolated AgentLoop.
      let toolCallCount = 0;
      let hadError = false;
      let errorText = "";
      const trackingPostMessage: PostMessageFn = (msg) => {
        if (msg.type === "toolUse") {
          toolCallCount++;
        }
        if (msg.type === "error") {
          hadError = true;
          errorText = (msg as { type: "error"; text: string }).text;
        }
        // Forward status-relevant messages but suppress token streaming.
        if (msg.type === "toolUse" || msg.type === "toolResult" || msg.type === "error") {
          postMessage(msg);
        }
      };

      const agentLoop = new AgentLoop(
        this._client,
        manager,
        registry,
        this._modelName,
        config.maxIterations,
        undefined, // no compactor
        this._ollamaOptions,
        ollamaTools,
      );

      await agentLoop.run(trackingPostMessage);

      // Extract the final assistant message as the sub-agent's output.
      const history = manager.getHistory();
      const lastAssistant = [...history]
        .reverse()
        .find((m) => m.role === "assistant");
      const output = lastAssistant?.content ?? "";

      // Count iterations from history (each assistant message is one iteration).
      const iterationsUsed = history.filter((m) => m.role === "assistant").length;

      const success = !hadError && output.length > 0;

      postMessage({
        type: "subAgentStatus",
        agentType: config.type,
        state: success ? "complete" : "error",
        summary: success ? output.slice(0, 200) : (errorText || "No output from sub-agent"),
      });

      // Clean up the isolated manager.
      manager.dispose();

      return {
        type: config.type,
        success,
        output,
        toolCallCount,
        iterationsUsed,
        error: hadError ? errorText : undefined,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      postMessage({
        type: "subAgentStatus",
        agentType: config.type,
        state: "error",
        summary: errorMessage.slice(0, 200),
      });

      return {
        type: config.type,
        success: false,
        output: "",
        toolCallCount: 0,
        iterationsUsed: 0,
        error: errorMessage,
      };
    }
  }

  /**
   * Build a fresh ToolRegistry with only the tools allowed for the given sub-agent type.
   * Read-only tools are instantiated without a ConfirmationGate.
   * For verification's run_terminal, a no-op gate with "never" mode is used.
   */
  private _buildScopedRegistry(type: SubAgentType): ToolRegistry {
    const registry = new ToolRegistry();
    const allowed = new Set(TOOLS_BY_TYPE[type]);

    if (allowed.has("read_file")) {
      registry.register("read_file", new ReadFileTool());
    }
    if (allowed.has("list_directory")) {
      registry.register("list_directory", new ListDirectoryTool());
    }
    if (allowed.has("grep_codebase")) {
      registry.register("grep_codebase", new GrepCodebaseTool());
    }
    if (allowed.has("run_terminal")) {
      // No-op gate that will never be called (mode is "never").
      const noOpGate = new ConfirmationGate(() => {});
      registry.register("run_terminal", new RunTerminalTool(noOpGate, "never"));
    }
    if (allowed.has("web_search")) {
      registry.register("web_search", new WebSearchTool());
    }
    if (allowed.has("fetch_page")) {
      registry.register("fetch_page", new FetchPageTool());
    }

    return registry;
  }

  private _buildOllamaTools(tools: readonly DynamicToolMetadata[]): OllamaToolDefinition[] {
    return tools.map((tool) => {
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
