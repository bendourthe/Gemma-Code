import * as vscode from "vscode";
import type { ConversationManager } from "../chat/ConversationManager.js";
import type { ContextCompactor } from "../chat/ContextCompactor.js";
import type { PlanMode } from "../chat/PlanMode.js";
import type { PromptBuilder } from "../chat/PromptBuilder.js";
import type { PromptContext } from "../chat/PromptBuilder.types.js";
import type { CommandRouter } from "../commands/CommandRouter.js";
import type { BuiltinCommandName } from "../commands/CommandRouter.js";
import {
  parseMemoryLintArgs,
  runMemoryLint,
  type MemoryLintResult,
} from "../commands/memoryLintCommand.js";
import type { ChatHistoryStore } from "../storage/ChatHistoryStore.js";
import type { MemoryStore } from "../storage/MemoryStore.js";
import type { ToolOutputCache } from "../storage/ToolOutputCache.js";
import type { OperationLog } from "../observability/OperationLog.js";
import type { McpManager } from "../mcp/McpManager.js";
import type { DynamicToolMetadata } from "../tools/ToolCatalog.js";
import type { SubAgentManager } from "../agents/SubAgentManager.js";
import type { SubAgentConfig } from "../agents/types.js";
import type { AgentLoop } from "../tools/AgentLoop.js";
import type { GemmaRuntime } from "../runtime/GemmaRuntime.js";
import type { GemmaCodeSettings } from "../config/settings.js";
import { renderMarkdown } from "../utils/MarkdownRenderer.js";
import { formatForUser } from "../utils/errors.js";
import type { ExtensionToWebviewMessage } from "./messages.js";

/**
 * Bag of dependencies the slash-command handlers need. The owning panel
 * supplies these via getters so the handlers see live values (mcpTools and
 * settings are mutated after construction by the panel).
 */
export interface ChatCommandContext {
  readonly manager: ConversationManager;
  readonly planMode: PlanMode;
  readonly promptBuilder: PromptBuilder;
  readonly compactor: ContextCompactor;
  readonly commandRouter: CommandRouter;
  readonly runtime: GemmaRuntime;
  readonly subAgentManager: SubAgentManager;
  readonly agentLoop: AgentLoop;
  getStore(): ChatHistoryStore | null;
  getMemoryStore(): MemoryStore | null;
  getToolOutputCache(): ToolOutputCache | null;
  getOperationLog(): OperationLog | null;
  getMcpManager(): McpManager | null;
  getMcpTools(): DynamicToolMetadata[];
  setMcpTools(tools: DynamicToolMetadata[]): void;
  getSettings(): GemmaCodeSettings;
  buildPromptContext(memoryContext?: string): PromptContext;
  postMessage(msg: ExtensionToWebviewMessage): void;
  postHistory(): void;
  postTokenCount(): void;
  postMemoryStatus(): void;
  postMcpStatus(): void;
}

/**
 * Slash-command dispatch extracted from GemmaCodePanel. Each command method
 * is self-contained: it reads from the context, mutates conversation state,
 * and posts results back via the supplied callbacks. New commands plug in by
 * adding a case to {@link dispatch}; the {@link CommandRouter} already gates
 * unknown names so handlers can assume the input is well-formed.
 */
export class ChatCommandHandlers {
  constructor(private readonly _ctx: ChatCommandContext) {}

  async dispatch(name: BuiltinCommandName, args: string): Promise<void> {
    switch (name) {
      case "help":
        return this._handleHelp();
      case "clear":
        return this._handleClear();
      case "history":
        return this._handleHistory();
      case "plan":
        return this._handlePlan();
      case "compact":
        return this._handleCompact();
      case "model":
        return this._handleModel(args);
      case "memory":
        return this._handleMemory(args);
      case "mcp":
        return this._handleMcp(args);
      case "verify":
        return this._handleVerify();
      case "research":
        return this._handleResearch(args);
      case "cache":
        return this._handleCache(args);
      case "operation-log":
        return this._handleOperationLog(args);
    }
  }

  private _post(msg: ExtensionToWebviewMessage): void {
    this._ctx.postMessage(msg);
  }

  private _emitMarkdown(text: string): void {
    const ctx = this._ctx;
    const msg = ctx.manager.addAssistantMessage(text);
    this._post({
      type: "messageComplete",
      messageId: msg.id,
      renderedHtml: renderMarkdown(msg.content),
    });
    ctx.postHistory();
  }

  private _handleHelp(): void {
    const descriptors = this._ctx.commandRouter.getAllDescriptors();
    const lines = descriptors.map(
      (d) =>
        `**/${d.name}**${d.argumentHint ? ` ${d.argumentHint}` : ""} — ${d.description}`,
    );
    const helpText = "## Available Commands\n\n" + lines.join("\n");
    this._emitMarkdown(helpText);
  }

  private _handleClear(): void {
    this._ctx.manager.clearHistory();
    this._ctx.planMode.resetPlan();
    this._ctx.postHistory();
    this._ctx.postTokenCount();
  }

  private _handleHistory(): void {
    const store = this._ctx.getStore();
    if (!store) {
      this._emitMarkdown(
        "_Chat history persistence requires better-sqlite3 to be installed._",
      );
      return;
    }
    const sessions = store.listSessions(50);
    this._post({ type: "sessionList", sessions });
  }

  private _handlePlan(): void {
    const ctx = this._ctx;
    const nowActive = ctx.planMode.toggle();
    const prompt = ctx.promptBuilder.build(ctx.buildPromptContext());
    ctx.manager.rebuildSystemPrompt(prompt);
    this._post({ type: "planModeToggled", active: nowActive });
    this._emitMarkdown(
      nowActive
        ? "_Plan mode enabled. I will produce a numbered plan before taking any action._"
        : "_Plan mode disabled. Resuming normal mode._",
    );
  }

  private async _handleCompact(): Promise<void> {
    const ctx = this._ctx;
    const postWithRender = (msg: ExtensionToWebviewMessage): void => {
      if (msg.type === "messageComplete" && !msg.renderedHtml) {
        const history = ctx.manager.getHistory();
        const found = history.find((m) => m.id === msg.messageId);
        this._post({
          ...msg,
          renderedHtml: found ? renderMarkdown(found.content) : "",
        });
        return;
      }
      this._post(msg);
    };
    await ctx.compactor.compact(postWithRender, true);
    ctx.postTokenCount();
    ctx.postHistory();
  }

  private async _handleModel(args: string): Promise<void> {
    const ctx = this._ctx;
    const client = ctx.runtime.getOllamaClient();
    const models = await client.listModels().catch(() => []);

    if (models.length === 0) {
      this._post({
        type: "error",
        text: "Could not reach Ollama to list models. Make sure `ollama serve` is running.",
      });
      return;
    }

    const selected = await vscode.window.showQuickPick(
      models.map((m) => m.name),
      { placeHolder: args || "Select a model" },
    );

    if (selected) {
      await vscode.workspace
        .getConfiguration("gemma-code")
        .update("modelName", selected, vscode.ConfigurationTarget.Global);
      this._emitMarkdown(`_Switched to model: **${selected}**_`);
    }
  }

  private async _handleMemory(args: string): Promise<void> {
    const ctx = this._ctx;
    const memoryStore = ctx.getMemoryStore();
    if (!memoryStore) {
      this._emitMarkdown(
        "_Memory system is disabled. Enable it in settings: `gemma-code.memoryEnabled`._",
      );
      return;
    }

    const [subcommand, ...rest] = args ? args.split(" ") : ["status"];
    const subArgs = rest.join(" ").trim();

    switch (subcommand) {
      case "search": {
        if (!subArgs) {
          this._emitMarkdown("Usage: `/memory search <query>`");
          return;
        }
        const results = memoryStore.searchKeyword(subArgs, 10);
        const text =
          results.length > 0
            ? "## Memory Search Results\n\n" +
              results
                .map((r, i) => `${i + 1}. **[${r.entry.type}]** ${r.entry.content}`)
                .join("\n")
            : "_No memories found matching your query._";
        this._emitMarkdown(text);
        return;
      }

      case "save": {
        if (!subArgs) {
          this._emitMarkdown("Usage: `/memory save <content>`");
          return;
        }
        await memoryStore.save(subArgs, "fact", ctx.manager.sessionId ?? undefined);
        this._emitMarkdown("_Memory saved._");
        ctx.postMemoryStatus();
        return;
      }

      case "clear": {
        memoryStore.clear();
        this._emitMarkdown("_All memories cleared._");
        ctx.postMemoryStatus();
        return;
      }

      case "lint": {
        const workspaceRoot =
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
        if (!workspaceRoot) {
          this._emitMarkdown("_/memory lint requires an open workspace._");
          return;
        }
        const settings = ctx.getSettings();
        const lintArgs = parseMemoryLintArgs(subArgs);
        let result: MemoryLintResult;
        try {
          result = await runMemoryLint(lintArgs, {
            memoryStore,
            workspaceRoot,
            secretPathDenyExtra: settings.secretPathDenyExtra,
            embeddingEnabled: settings.embeddingModel !== "",
          });
        } catch (err) {
          this._emitMarkdown(`_Memory lint failed: ${formatForUser(err)}_`);
          return;
        }
        this._emitMarkdown(result.message);
        return;
      }

      case "status":
      default: {
        const stats = memoryStore.getStats();
        const lines = [
          "## Memory Status",
          "",
          `- **Total entries:** ${stats.totalEntries}`,
          `- **With embeddings:** ${stats.embeddingCount}`,
          ...Object.entries(stats.byType).map(
            ([type, count]) => `- **${type}:** ${count}`,
          ),
        ];
        if (stats.oldestEntryAt) {
          lines.push(
            `- **Oldest:** ${new Date(stats.oldestEntryAt).toLocaleDateString()}`,
          );
        }
        if (stats.newestEntryAt) {
          lines.push(
            `- **Newest:** ${new Date(stats.newestEntryAt).toLocaleDateString()}`,
          );
        }
        this._emitMarkdown(lines.join("\n"));
        return;
      }
    }
  }

  private async _handleMcp(args: string): Promise<void> {
    const ctx = this._ctx;
    const settings = ctx.getSettings();
    const mcpManager = ctx.getMcpManager();
    if (!settings.mcpEnabled || !mcpManager) {
      this._emitMarkdown(
        "_MCP support is disabled. Enable it in settings: `gemma-code.mcpEnabled`._",
      );
      return;
    }

    const [subcommand] = args.split(" ", 1);
    const subArgs = args.slice((subcommand?.length ?? 0) + 1).trim();

    switch (subcommand) {
      case "connect": {
        if (!subArgs) {
          this._emitMarkdown("Usage: `/mcp connect <server-name>`");
          return;
        }
        try {
          await mcpManager.connectServer(subArgs);
          ctx.setMcpTools(mcpManager.getAllToolMetadata());
          const prompt = ctx.promptBuilder.build(ctx.buildPromptContext());
          ctx.manager.rebuildSystemPrompt(prompt);
          this._emitMarkdown(`_Connected to MCP server "${subArgs}"._`);
        } catch (err) {
          this._emitMarkdown(
            `_Failed to connect to "${subArgs}": ${formatForUser(err)}_`,
          );
        }
        ctx.postMcpStatus();
        return;
      }
      case "disconnect": {
        if (!subArgs) {
          this._emitMarkdown("Usage: `/mcp disconnect <server-name>`");
          return;
        }
        await mcpManager.disconnectServer(subArgs);
        ctx.setMcpTools(mcpManager.getAllToolMetadata());
        const prompt = ctx.promptBuilder.build(ctx.buildPromptContext());
        ctx.manager.rebuildSystemPrompt(prompt);
        this._emitMarkdown(`_Disconnected from MCP server "${subArgs}"._`);
        ctx.postMcpStatus();
        return;
      }
      case "status":
      default: {
        const states = mcpManager.getServerStates();
        const lines = [
          "## MCP Status",
          "",
          `- **Enabled:** yes`,
          `- **Connected servers:** ${states.filter((s) => s.status === "connected").length}`,
          `- **MCP tools:** ${ctx.getMcpTools().length}`,
        ];
        if (states.length > 0) {
          lines.push("", "### Servers", "");
          for (const state of states) {
            const toolCount = state.tools.length;
            const statusIcon =
              state.status === "connected"
                ? "+"
                : state.status === "error"
                  ? "x"
                  : "-";
            lines.push(
              `- [${statusIcon}] **${state.config.name}** (${state.status}) -- ${toolCount} tools${state.error ? ` -- error: ${state.error}` : ""}`,
            );
          }
        }
        this._emitMarkdown(lines.join("\n"));
        return;
      }
    }
  }

  private async _handleVerify(): Promise<void> {
    const ctx = this._ctx;
    const settings = ctx.getSettings();
    const config: SubAgentConfig = {
      type: "verification",
      maxIterations: settings.subAgentMaxIterations,
      userRequest:
        "Verify recent changes for correctness, check for bugs and run relevant tests.",
      modifiedFiles: [...ctx.agentLoop.getModifiedFiles()],
      recentToolResults: [...ctx.agentLoop.getRecentToolResults()],
    };
    const result = await ctx.subAgentManager.run(config, (msg) => this._post(msg));
    const reportText = `## Verification Report\n\n${result.output || "_No issues found._"}`;
    this._emitMarkdown(reportText);
  }

  private async _handleResearch(args: string): Promise<void> {
    const ctx = this._ctx;
    if (!args) {
      this._emitMarkdown("Usage: `/research <query>`");
      return;
    }
    const settings = ctx.getSettings();
    const config: SubAgentConfig = {
      type: "research",
      maxIterations: settings.subAgentMaxIterations,
      userRequest: args,
      modifiedFiles: [...ctx.agentLoop.getModifiedFiles()],
      recentToolResults: [...ctx.agentLoop.getRecentToolResults()],
    };
    const result = await ctx.subAgentManager.run(config, (msg) => this._post(msg));
    const researchText = `## Research Results\n\n${result.output || "_No results._"}`;
    this._emitMarkdown(researchText);
  }

  private async _handleCache(args: string): Promise<void> {
    const ctx = this._ctx;
    const cache = ctx.getToolOutputCache();
    if (!cache) {
      this._emitMarkdown(
        "_Tool-output cache is disabled (no workspace open or initialization failed)._",
      );
      return;
    }

    const [subcommand] = args ? args.split(" ", 1) : ["status"];

    switch (subcommand) {
      case "clear": {
        const removed = cache.clear();
        this._emitMarkdown(
          `_Cleared ${removed} entr${removed === 1 ? "y" : "ies"} from the tool-output cache._`,
        );
        return;
      }
      case "prune": {
        const removed = cache.prune();
        this._emitMarkdown(
          removed > 0
            ? `_Pruned ${removed} oldest entr${removed === 1 ? "y" : "ies"} from the tool-output cache._`
            : "_Cache is below capacity; no entries pruned._",
        );
        return;
      }
      case "reembed": {
        const result = await cache.reembedHeuristic();
        this._emitMarkdown(
          result.scanned === 0
            ? "_No heuristic-tagged rows to re-embed._"
            : `_Re-embedded ${result.reembedded} of ${result.scanned} heuristic row${result.scanned === 1 ? "" : "s"} via Ollama._`,
        );
        return;
      }
      case "status":
      default: {
        const stats = cache.stats();
        const lru = cache.lruStats();
        const lines = [
          "## Tool-Output Cache",
          "",
          `- **Entries:** ${stats.entries}`,
          `- **In-process LRU:** ${lru.entries} entries / ${(lru.bytes / 1024).toFixed(1)} KB (hits: ${lru.hits}, misses: ${lru.misses})`,
        ];
        if (stats.topByHits.length > 0) {
          lines.push("", "### Top by hits", "");
          for (const row of stats.topByHits) {
            lines.push(`- \`${row.absolutePath}\` -- ${row.hits} hits`);
          }
        }
        this._emitMarkdown(lines.join("\n"));
        return;
      }
    }
  }

  private _handleOperationLog(args: string): void {
    const ctx = this._ctx;
    const log = ctx.getOperationLog();
    if (!log) {
      this._emitMarkdown("_Operation log is unavailable (no workspace open)._");
      return;
    }

    const [subcommand] = args ? args.split(" ", 1) : ["status"];

    switch (subcommand) {
      case "clear": {
        log.clear();
        this._emitMarkdown("_Operation log cleared._");
        return;
      }
      case "status":
      default: {
        const status = log.status();
        const lines = [
          "## Operation Log",
          "",
          `- **Enabled:** ${status.enabled ? "yes" : "no"}`,
          `- **File:** ${status.filePath ?? "_(not initialized)_"}`,
          `- **Size:** ${(status.fileSizeBytes / 1024).toFixed(1)} KB`,
        ];
        if (status.lastLines.length > 0) {
          lines.push("", "### Last entries", "");
          for (const line of status.lastLines) {
            lines.push(`- \`${line}\``);
          }
        }
        if (!status.enabled) {
          lines.push(
            "",
            "_Set `gemma-code.operationLog.enabled` to true in settings to start writing._",
          );
        }
        this._emitMarkdown(lines.join("\n"));
        return;
      }
    }
  }
}
