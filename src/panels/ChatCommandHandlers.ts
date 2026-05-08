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
import type { MemoryFiles } from "../storage/MemoryFiles.js";
import type { ToolOutputCache } from "../storage/ToolOutputCache.js";
import type { OperationLog } from "../observability/OperationLog.js";
import type { McpManager } from "../mcp/McpManager.js";
import type { DynamicToolMetadata } from "../tools/ToolCatalog.js";
import type { SubAgentManager } from "../agents/SubAgentManager.js";
import type { SubAgentConfig } from "../agents/types.js";
import type { AgentLoop } from "../tools/AgentLoop.js";
import type { GemmaRuntime } from "../runtime/GemmaRuntime.js";
import type { GemmaCodeSettings } from "../config/settings.js";
import type { CompressionState } from "../chat/state/CompressionState.js";
import {
  parseCompactArgs,
  computeContextBreakdown,
  renderContextBreakdown,
  computeCompactionStats,
  renderCompactionStats,
  planSweep,
  decompressBlockInConversation,
  recompressBlockInConversation,
} from "../commands/compactCommand.js";
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
  getMemoryFiles(): MemoryFiles | null;
  getToolOutputCache(): ToolOutputCache | null;
  getOperationLog(): OperationLog | null;
  getCompressionState(): CompressionState | null;
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
        return this._handleCompact(args);
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

  private async _handleCompact(args: string): Promise<void> {
    const ctx = this._ctx;
    const parsed = parseCompactArgs(args);

    if (parsed.verb === "legacy") {
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
      return;
    }

    const settings = ctx.getSettings();
    const state = ctx.getCompressionState();

    if (parsed.verb === "context") {
      const breakdown = computeContextBreakdown(ctx.manager.getHistory(), settings.maxTokens);
      this._emitMarkdown(renderContextBreakdown(breakdown));
      return;
    }

    if (parsed.verb === "stats") {
      if (!state) {
        this._emitMarkdown("Compression state is not available in this session.");
        return;
      }
      const stats = computeCompactionStats(state);
      this._emitMarkdown(renderCompactionStats(stats));
      return;
    }

    if (parsed.verb === "sweep") {
      const n = parsed.numericArg ?? settings.compactionToolResultsKeep;
      const plan = planSweep(ctx.manager.getHistory(), n);
      if (!plan) {
        this._emitMarkdown("No tool-result messages since the last user message; nothing to sweep.");
        return;
      }
      this._emitMarkdown(
        `Manual sweep planned over messages [${plan.fromIndex}..${plan.toIndex}] (${plan.count} messages). ` +
          "Auto-issued sweep is deferred to v0.7.0 Phase 4 (render protocol). " +
          "For now, ask the model to call `compress_range` covering this span.",
      );
      return;
    }

    if (parsed.verb === "decompress") {
      if (!state) {
        this._emitMarkdown("Compression state is not available in this session.");
        return;
      }
      if (!parsed.stringArg) {
        this._emitMarkdown("Usage: /compact decompress <blockId>");
        return;
      }
      const result = decompressBlockInConversation(ctx.manager, state, parsed.stringArg);
      if (!result.ok) {
        this._emitMarkdown(`Decompress failed: ${result.reason}.`);
      } else {
        this._emitMarkdown(`Decompressed block ${parsed.stringArg}: ${result.restored} message(s) restored.`);
        ctx.postHistory();
        ctx.postTokenCount();
      }
      return;
    }

    if (parsed.verb === "recompress") {
      if (!state) {
        this._emitMarkdown("Compression state is not available in this session.");
        return;
      }
      if (!parsed.stringArg) {
        this._emitMarkdown("Usage: /compact recompress <blockId>");
        return;
      }
      const result = recompressBlockInConversation(ctx.manager, state, parsed.stringArg);
      if (!result.ok) {
        this._emitMarkdown(`Recompress failed: ${result.reason}.`);
      } else {
        this._emitMarkdown(`Re-applied block ${parsed.stringArg}.`);
        ctx.postHistory();
        ctx.postTokenCount();
      }
      return;
    }

    if (parsed.verb === "manual") {
      if (!state) {
        this._emitMarkdown("Compression state is not available in this session.");
        return;
      }
      if (parsed.stringArg === "on") {
        state.setManualOnly(true);
        this._emitMarkdown("Compress tool: **manual-only mode ON**. The model will no longer auto-compress.");
      } else if (parsed.stringArg === "off") {
        state.setManualOnly(false);
        this._emitMarkdown("Compress tool: **manual-only mode OFF**. The model may auto-compress again.");
      } else {
        this._emitMarkdown("Usage: /compact manual on|off");
      }
      return;
    }

    this._emitMarkdown(
      `Unknown compact verb \`${parsed.stringArg ?? ""}\`. ` +
        "Verbs: context, stats, sweep [n], decompress <id>, recompress <id>, manual on|off.",
    );
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
    const [subcommand, ...rest] = args ? args.split(" ") : ["status"];
    const subArgs = rest.join(" ").trim();

    // v0.7.0 Phase 2: file-backed verbs (init / archive / edit) operate on
    // the on-disk memory architecture and do NOT require the SQL-backed
    // MemoryStore to be enabled.
    if (subcommand === "init") {
      return this._handleMemoryInit(subArgs);
    }
    if (subcommand === "archive") {
      return this._handleMemoryArchive();
    }
    if (subcommand === "edit") {
      return this._handleMemoryEdit(subArgs);
    }
    // v0.7.0 Phase 5: forget / export / import operate on the on-disk
    // memory architecture too; export pulls SQL rows when available.
    if (subcommand === "forget") {
      return this._handleMemoryForget(subArgs);
    }
    if (subcommand === "export") {
      return this._handleMemoryExport(subArgs);
    }
    if (subcommand === "import") {
      return this._handleMemoryImport(subArgs);
    }

    const memoryStore = ctx.getMemoryStore();
    if (!memoryStore) {
      this._emitMarkdown(
        "_Memory system is disabled. Enable it in settings: `gemma-code.memoryEnabled`._",
      );
      return;
    }

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

  /**
   * v0.7.0 Phase 2: scaffold the on-disk Instructions/Memory/Context files
   * for the active workspace. `--force` overwrites existing files (caller is
   * warned in the report).
   */
  private _handleMemoryInit(rawArgs: string): void {
    const memoryFiles = this._ctx.getMemoryFiles();
    if (!memoryFiles) {
      this._emitMarkdown(
        "_/memory init requires an open workspace. Open a folder and try again._",
      );
      return;
    }

    const { force } = parseInitArgs(rawArgs);
    let result;
    try {
      result = memoryFiles.init(force);
    } catch (err) {
      this._emitMarkdown(`_/memory init failed: ${formatForUser(err)}_`);
      return;
    }

    const lines: string[] = ["## Memory file initialisation", ""];
    lines.push(`- **Instructions.md** -- ${result.instructions}`);
    lines.push(`- **Memory.md** -- ${result.memory}`);
    lines.push(`- **Context.md** -- ${result.context}`);
    lines.push("");
    lines.push(`Files live under \`${memoryFiles.workspaceDir}\`.`);
    if (!force) {
      lines.push("");
      lines.push("_Use `/memory init --force` to overwrite existing files with scaffolds._");
    }
    this._emitMarkdown(lines.join("\n"));
  }

  /**
   * Snapshot the three memory files into Archive/<YYYY-MM-DD>/. Idempotent
   * for the day -- a second invocation overwrites the same dated snapshot.
   */
  private _handleMemoryArchive(): void {
    const memoryFiles = this._ctx.getMemoryFiles();
    if (!memoryFiles) {
      this._emitMarkdown(
        "_/memory archive requires an open workspace. Open a folder and try again._",
      );
      return;
    }
    let result;
    try {
      result = memoryFiles.archive();
    } catch (err) {
      this._emitMarkdown(`_/memory archive failed: ${formatForUser(err)}_`);
      return;
    }
    this._emitMarkdown(
      [
        "## Memory archive",
        "",
        `Snapshot written to \`${result.archivedPath}\` at ${result.archivedAt.toISOString()}.`,
      ].join("\n"),
    );
  }

  /**
   * v0.7.0 Phase 5 -- remove every line in Memory.md matching the user's
   * pattern. The optional `--include-sql` flag also deletes matching rows from
   * the SQL-backed MemoryStore (when enabled). The catastrophic-pattern guard
   * lives in {@link MemoryFiles.removeFromMemory}; we surface its error verbatim.
   */
  private async _handleMemoryForget(rawArgs: string): Promise<void> {
    const memoryFiles = this._ctx.getMemoryFiles();
    if (!memoryFiles) {
      this._emitMarkdown(
        "_/memory forget requires an open workspace. Open a folder and try again._",
      );
      return;
    }
    const parsed = parseForgetArgs(rawArgs);
    if (!parsed.pattern) {
      this._emitMarkdown(
        "Usage: `/memory forget <pattern> [--include-sql]`. Pattern must be anchored or specific (e.g. `^- prefer:`); raw `.*` is rejected.",
      );
      return;
    }

    let fileResult: { removedLines: number };
    try {
      fileResult = memoryFiles.removeFromMemory(parsed.pattern);
    } catch (err) {
      this._emitMarkdown(`_/memory forget failed: ${formatForUser(err)}_`);
      return;
    }

    let sqlNote = "";
    if (parsed.includeSql) {
      const memoryStore = this._ctx.getMemoryStore();
      if (!memoryStore) {
        sqlNote = "\n\n_SQL-backed memory is disabled; --include-sql skipped._";
      } else {
        const removed = forgetMatchingSqlRows(memoryStore, parsed.pattern);
        sqlNote = `\n\n_Also removed ${removed} matching SQL-backed memor${removed === 1 ? "y" : "ies"}._`;
        this._ctx.postMemoryStatus();
      }
    }

    this._emitMarkdown(
      `## Memory forget\n\nRemoved **${fileResult.removedLines}** line${fileResult.removedLines === 1 ? "" : "s"} from \`${memoryFiles.memoryPath}\`.${sqlNote}`,
    );
  }

  /**
   * v0.7.0 Phase 5 -- write a JSON dump of the three memory files plus the
   * SQL-backed memories (with provenance markers) to `<path>`. Path-guard
   * applies via {@link MemoryFiles.export}; absolute paths outside the
   * workspace go straight to the underlying writer (the user explicitly typed
   * the path) but the secret-path denylist still rejects credential-style
   * destinations.
   */
  private _handleMemoryExport(rawArgs: string): void {
    const memoryFiles = this._ctx.getMemoryFiles();
    if (!memoryFiles) {
      this._emitMarkdown(
        "_/memory export requires an open workspace. Open a folder and try again._",
      );
      return;
    }
    const target = rawArgs.trim();
    if (!target) {
      this._emitMarkdown("Usage: `/memory export <path>`");
      return;
    }
    const memoryStore = this._ctx.getMemoryStore();
    const sqlMemories = memoryStore
      ? memoryStore
          .listAll(1000)
          .map((entry) => ({ content: entry.content, type: entry.type }))
      : [];
    try {
      memoryFiles.export(target, { sqlMemories });
    } catch (err) {
      this._emitMarkdown(`_/memory export failed: ${formatForUser(err)}_`);
      return;
    }
    this._emitMarkdown(
      `## Memory export\n\nWrote ${sqlMemories.length} SQL-backed entr${sqlMemories.length === 1 ? "y" : "ies"} plus the three memory files to \`${target}\`.`,
    );
  }

  /**
   * v0.7.0 Phase 5 -- read a previously-exported JSON dump and merge or
   * replace the three memory files. SQL-backed memories from the export are
   * NOT silently re-imported (per S2 article guidance). The verb prints how
   * many SQL rows were skipped so the user can run a follow-up `/memory save`
   * if desired.
   */
  private _handleMemoryImport(rawArgs: string): void {
    const memoryFiles = this._ctx.getMemoryFiles();
    if (!memoryFiles) {
      this._emitMarkdown(
        "_/memory import requires an open workspace. Open a folder and try again._",
      );
      return;
    }
    const parsed = parseImportArgs(rawArgs);
    if (!parsed.path) {
      this._emitMarkdown("Usage: `/memory import <path> [--mode=merge|replace]`");
      return;
    }
    try {
      memoryFiles.import(parsed.path, parsed.mode);
    } catch (err) {
      this._emitMarkdown(`_/memory import failed: ${formatForUser(err)}_`);
      return;
    }
    this._emitMarkdown(
      `## Memory import\n\nApplied \`${parsed.path}\` to the three memory files (mode: **${parsed.mode}**).\n\n_SQL-backed memories from the export are not silently re-imported. Use \`/memory save\` to add them deliberately._`,
    );
  }

  /**
   * Open one of the three memory files in VS Code so the user can edit it
   * directly. Section defaults to `memory` (the most-edited file).
   */
  private async _handleMemoryEdit(section: string): Promise<void> {
    const memoryFiles = this._ctx.getMemoryFiles();
    if (!memoryFiles) {
      this._emitMarkdown(
        "_/memory edit requires an open workspace. Open a folder and try again._",
      );
      return;
    }
    const target = resolveMemorySection(memoryFiles, section);
    if (!target) {
      this._emitMarkdown(
        "Usage: `/memory edit [instructions|memory|context]`. Default section is `memory`.",
      );
      return;
    }
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
      this._emitMarkdown(`_/memory edit failed: ${formatForUser(err)}_`);
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

/**
 * Parse the argument string after `/memory init`. Currently the only flag is
 * `--force`, which signals an explicit overwrite of existing scaffolds.
 * Exported for unit-testability without instantiating the full panel.
 */
export function parseInitArgs(rawArgs: string): { force: boolean } {
  const tokens = rawArgs.split(/\s+/).filter(Boolean);
  return { force: tokens.includes("--force") };
}

/**
 * v0.7.0 Phase 5 -- parse `/memory forget <pattern> [--include-sql]`. The
 * pattern is the full remaining argument string after the flag is stripped.
 * Anchored or specific patterns are forwarded verbatim to
 * {@link MemoryFiles.removeFromMemory}, which rejects raw `.*`.
 */
export function parseForgetArgs(rawArgs: string): {
  pattern: string;
  includeSql: boolean;
} {
  const tokens = rawArgs.split(/\s+/).filter(Boolean);
  let includeSql = false;
  const remaining: string[] = [];
  for (const tok of tokens) {
    if (tok === "--include-sql") {
      includeSql = true;
    } else {
      remaining.push(tok);
    }
  }
  return { pattern: remaining.join(" "), includeSql };
}

/**
 * v0.7.0 Phase 5 -- parse `/memory import <path> [--mode=merge|replace]`.
 * Default mode is `merge`. Unrecognised modes fall back to merge with no
 * warning (the underlying writer treats anything that is not `replace` as a
 * merge anyway, but keeping the parser strict keeps the slash-command
 * surface explicit).
 */
export function parseImportArgs(rawArgs: string): {
  path: string;
  mode: "merge" | "replace";
} {
  const tokens = rawArgs.split(/\s+/).filter(Boolean);
  let mode: "merge" | "replace" = "merge";
  const remaining: string[] = [];
  for (const tok of tokens) {
    if (tok === "--mode=replace" || tok === "--replace") {
      mode = "replace";
    } else if (tok === "--mode=merge" || tok === "--merge") {
      mode = "merge";
    } else {
      remaining.push(tok);
    }
  }
  return { path: remaining.join(" "), mode };
}

/**
 * v0.7.0 Phase 5 -- delete every SQL-backed memory whose `content` matches
 * the supplied regex. Returns the number of rows removed. Exposed for
 * unit-testability without instantiating the full panel.
 */
export function forgetMatchingSqlRows(
  memoryStore: { listAll(limit?: number): readonly { id: string; content: string }[]; deleteById(id: string): boolean },
  pattern: string,
): number {
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of memoryStore.listAll(1000)) {
    if (re.test(entry.content)) {
      if (memoryStore.deleteById(entry.id)) removed++;
    }
  }
  return removed;
}

/**
 * Resolve a `/memory edit <section>` argument to an absolute file path.
 * Returns `null` for unknown sections so the caller can surface usage help.
 */
export function resolveMemorySection(
  memoryFiles: MemoryFiles,
  section: string,
): string | null {
  const normalized = section.trim().toLowerCase();
  const target = normalized || "memory";
  switch (target) {
    case "instructions":
      return memoryFiles.instructionsPath;
    case "memory":
      return memoryFiles.memoryPath;
    case "context":
      return memoryFiles.contextPath;
    default:
      return null;
  }
}
