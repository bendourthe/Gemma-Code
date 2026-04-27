import * as path from "path";
import * as vscode from "vscode";
import { randomUUID } from "crypto";
import { ConversationManager } from "../chat/ConversationManager.js";
import type { Message } from "../chat/types.js";
import { StreamingPipeline } from "../chat/StreamingPipeline.js";
import { ContextCompactor } from "../chat/ContextCompactor.js";
import { AgentLoop } from "../tools/AgentLoop.js";
import { SubAgentManager } from "../agents/SubAgentManager.js";
import type { SubAgentConfig } from "../agents/types.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import { ConfirmationGate } from "../tools/ConfirmationGate.js";
import {
  ReadFileTool,
  WriteFileTool,
  CreateFileTool,
  DeleteFileTool,
  EditFileTool,
  ListDirectoryTool,
  GrepCodebaseTool,
} from "../tools/handlers/filesystem.js";
import { RunTerminalTool } from "../tools/handlers/terminal.js";
import { WebSearchTool, FetchPageTool } from "../tools/handlers/webSearch.js";
import { createOllamaClient } from "../llm/OllamaClient.js";
import { getSettings, type GemmaCodeSettings } from "../config/settings.js";
import { TOOL_CATALOG, toDynamicMetadata } from "../tools/ToolCatalog.js";
import type { DynamicToolMetadata } from "../tools/ToolCatalog.js";
import type { OllamaToolDefinition } from "../llm/types.js";
import { computeToolActivation } from "../tools/ToolActivationRules.js";
import { McpManager } from "../mcp/McpManager.js";
import { McpServer } from "../mcp/McpServer.js";
import { PromptBuilder } from "../chat/PromptBuilder.js";
import type { PromptContext } from "../chat/PromptBuilder.types.js";
import { SkillLoader } from "../skills/SkillLoader.js";
import { CommandRouter } from "../commands/CommandRouter.js";
import { PlanMode, detectPlan } from "../chat/PlanMode.js";
import { ChatHistoryStore } from "../storage/ChatHistoryStore.js";
import { MemoryStore } from "../storage/MemoryStore.js";
import { MemorySubsystem } from "../storage/MemorySubsystem.js";
import { ToolOutputCache } from "../storage/ToolOutputCache.js";
import { WebResponseCache } from "../tools/handlers/webCache.js";
import { OperationLog } from "../observability/OperationLog.js";
import { calculateBudget } from "../config/PromptBudget.js";
import type { WorkingMemory } from "../storage/WorkingMemory.js";
import { EpisodicMemory } from "../storage/EpisodicMemory.js";
import { GraphMemory } from "../storage/GraphMemory.js";
import { MemoryConsolidator } from "../storage/MemoryConsolidator.js";
import { UnifiedMemoryRetriever } from "../storage/UnifiedMemoryRetriever.js";
import {
  parseMemoryLintArgs,
  runMemoryLint,
  type MemoryLintResult,
} from "../commands/memoryLintCommand.js";
import type { HardwareTierConfig } from "../config/HardwareTier.types.js";
import { getTierConfig } from "../config/HardwareTier.js";
import { BudgetMiddleware, createSessionBudget } from "../tools/BudgetMiddleware.js";
import { GitSafetyNet } from "../guardrails/GitSafetyNet.js";
import { LoopDetector } from "../guardrails/LoopDetector.js";
import { Orchestrator } from "../orchestration/Orchestrator.js";
import { renderMarkdown } from "../utils/MarkdownRenderer.js";
import { getLogger } from "../utils/logger.js";
import { formatForUser } from "../utils/errors.js";
import type { GemmaRuntime } from "../runtime/GemmaRuntime.js";
import type { EditMode } from "../tools/types.js";
import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
} from "./messages.js";
import { getWebviewHtml } from "./webview/index.js";

export const VIEW_ID = "gemma-code.chatView";

export class GemmaCodePanel implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _editorPanel?: vscode.WebviewPanel;
  // Tracks whether the editor panel currently has focus. Streaming messages
  // route to only the focused surface to avoid double-posting when both the
  // sidebar and an editor panel are attached. History events still broadcast
  // so both stay in sync. Initially true because opening the editor panel is
  // the normal flow; flipped on onDidChangeViewState.
  private _editorPanelActive = true;
  // Per-message rendered Markdown cache. Populated lazily on `_postHistory`
  // and evicted for ids that are no longer in the current history. Prevents
  // re-rendering every assistant message on every post (replace, delete,
  // session load, or scroll-induced rehydrate).
  private readonly _renderedHtmlCache = new Map<string, string>();
  private readonly _manager: ConversationManager;
  private readonly _pipeline: StreamingPipeline;
  private readonly _confirmationGate: ConfirmationGate;
  private readonly _agentLoop: AgentLoop;
  private readonly _skillLoader: SkillLoader;
  private readonly _commandRouter: CommandRouter;
  private readonly _planMode: PlanMode;
  private readonly _promptBuilder: PromptBuilder;
  private readonly _store: ChatHistoryStore | null;
  private readonly _memorySubsystem: MemorySubsystem;
  private readonly _memoryStore: MemoryStore | null;
  private readonly _toolOutputCache: ToolOutputCache | null;
  private readonly _webResponseCache: WebResponseCache | null;
  private readonly _operationLog: OperationLog | null;
  private readonly _compactor: ContextCompactor;
  private readonly _workingMemory: WorkingMemory | null;
  private readonly _episodicMemory: EpisodicMemory | null;
  private readonly _graphMemory: GraphMemory | null;
  private readonly _unifiedRetriever: UnifiedMemoryRetriever | null;
  private readonly _memoryConsolidator: MemoryConsolidator | null;

  private _registry!: ToolRegistry;
  private _currentEditMode: EditMode;
  private _ollamaReachable = true;
  private _mcpTools: DynamicToolMetadata[] = [];
  private _mcpManager: McpManager | null = null;
  private _tierConfig?: HardwareTierConfig;
  private _mcpServer: McpServer | null = null;
  private readonly _gitSafetyNet: GitSafetyNet | null;
  private readonly _subAgentManager: SubAgentManager;
  private readonly _orchestrator: Orchestrator;
  // Cached settings: invalidated by the configuration-change subscription so
  // we avoid hitting `vscode.workspace.getConfiguration("gemma-code")` on
  // every prompt build, message handler, or tool activation rebuild.
  private _settingsCache: GemmaCodeSettings | null = null;
  private _settingsChangeDisposable: vscode.Disposable | null = null;
  private _outputChannel: vscode.OutputChannel | null = null;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _runtime: GemmaRuntime,
    private readonly _globalStorageUri?: vscode.Uri,
    private readonly _workspaceState?: vscode.Memento,
  ) {
    const settings = this._getSettings();
    this._currentEditMode = settings.editMode;
    // Invalidate the cache when the user edits any gemma-code setting.
    this._settingsChangeDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("gemma-code")) {
        this._settingsCache = null;
        if (
          event.affectsConfiguration("gemma-code.memoryCorroborationThreshold")
        ) {
          const threshold = this._getSettings().memoryCorroborationThreshold;
          this._memoryConsolidator?.setCorroborationThreshold(threshold);
          this._unifiedRetriever?.setCorroborationThreshold(threshold);
        }
        if (event.affectsConfiguration("gemma-code.operationLog.enabled")) {
          this._operationLog?.setEnabled(this._getSettings().operationLogEnabled);
        }
      }
    });

    // Initialise persistent chat history store.
    this._store = this._initStore();

    // Phase 4 (v0.5.0): persistent tool-output cache backing diff-based reads.
    this._toolOutputCache = this._initToolOutputCache(settings);

    // Phase 9 (v0.5.0): API-response cache fronting `web_search`.
    this._webResponseCache = this._initWebResponseCache();

    // Phase 9 (v0.5.0): opt-in append-only operation log. Initialized
    // unconditionally; `setEnabled(...)` controls whether writes happen.
    this._operationLog = this._initOperationLog(settings);

    // Initialize 4-layer memory system through the MemorySubsystem factory.
    const memory = this._buildMemorySubsystem(settings, this._toolOutputCache);
    this._memorySubsystem = memory;
    this._memoryStore = memory.memoryStore;
    this._workingMemory = memory.workingMemory;
    this._episodicMemory = memory.episodicMemory;
    this._graphMemory = memory.graphMemory;
    this._unifiedRetriever = memory.unifiedRetriever;
    this._memoryConsolidator = memory.memoryConsolidator;

    // PlanMode must be initialised before PromptBuilder uses it.
    this._planMode = new PlanMode();

    // Build the initial system prompt via PromptBuilder.
    this._promptBuilder = new PromptBuilder();
    const initialPrompt = this._promptBuilder.buildSync(this._buildPromptContext());
    this._manager = new ConversationManager(initialPrompt, this._store ?? undefined);

    const client = createOllamaClient(settings.ollamaUrl);

    // postMessage is not available until resolveWebviewView; use a late-binding closure.
    const postRaw = (msg: ExtensionToWebviewMessage): void => {
      this._postToWebview(msg);
    };

    // Intercept messageComplete to inject server-side rendered HTML.
    const postMessage = (msg: ExtensionToWebviewMessage): void => {
      if (msg.type === "messageComplete" && !msg.renderedHtml) {
        const history = this._manager.getHistory();
        const found = history.find((m) => m.id === msg.messageId);
        postRaw({
          ...msg,
          renderedHtml: found ? renderMarkdown(found.content) : "",
        });
        return;
      }
      postRaw(msg);
    };

    this._confirmationGate = new ConfirmationGate(postMessage);

    this._registry = this._buildToolRegistry(
      settings.editMode,
      settings.toolConfirmationMode,
      settings.secretPathDenyExtra,
      settings.permissionOverrides,
    );

    const ollamaOptions = {
      num_ctx: settings.maxTokens,
      temperature: settings.temperature,
      top_p: settings.topP,
      top_k: settings.topK,
    };

    const ollamaTools = this._buildOllamaTools();

    this._compactor = new ContextCompactor(
      this._manager,
      client,
      settings.modelName,
      settings.maxTokens,
      ollamaOptions,
      settings.memoryEnabled && this._memoryStore
        ? async (messages) => {
            try {
              await this._memoryStore!.extractAndSave(
                messages,
                this._manager.sessionId ?? undefined,
              );
              this._memoryStore!.prune(settings.memoryMaxEntries);
            } catch (err) {
              getLogger().warn("[MemoryStore] Pre-compaction extraction failed:", err);
            }
          }
        : undefined,
      0.8,
      undefined,
      this._runtime.tracer,
      () => this._runtime.settings,
    );

    // Wire the consolidator into the post-compaction hook.
    if (this._memoryConsolidator) {
      this._compactor.setPostCompactionHook(async (sessionId) => {
        await this._memoryConsolidator!.consolidate(sessionId);
      });
    }

    this._subAgentManager = new SubAgentManager(
      client,
      this._promptBuilder,
      this._memoryStore,
      ollamaOptions,
      settings.modelName,
      this._runtime.tracer,
    );

    // Git safety net: auto-checkpoint/rollback for agent file modifications.
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this._gitSafetyNet = workspacePath ? new GitSafetyNet(workspacePath) : null;

    // Bootstrap with the user's tier override (if any) or the balanced default.
    // extension.ts updates this asynchronously via updateTierConfig once GPU
    // detection completes, so the values used here are only the initial seed.
    const initialTier = getTierConfig(settings.gpuTierOverride ?? 2);

    // Plan-and-Execute orchestrator for complex multi-step requests.
    this._orchestrator = new Orchestrator({
      client,
      modelName: settings.modelName,
      ollamaOptions,
      subAgentManager: this._subAgentManager,
      hardwareTier: initialTier,
      memoryStore: this._memoryStore,
      postMessage: postRaw,
    });

    this._agentLoop = new AgentLoop(
      client,
      this._manager,
      this._registry,
      settings.modelName,
      initialTier.maxAgentIterations,
      this._compactor,
      ollamaOptions,
      ollamaTools,
      {
        subAgentManager: this._subAgentManager,
        verificationThreshold: settings.verificationThreshold,
        verificationEnabled: settings.verificationEnabled,
        workingMemory: this._workingMemory ?? undefined,
        episodicMemory: this._episodicMemory ?? undefined,
        sessionId: this._manager.sessionId ?? undefined,
        gitSafetyNet: this._gitSafetyNet ?? undefined,
        loopDetector: new LoopDetector(),
        maxTokens: settings.maxTokens,
        tracer: this._runtime.tracer,
        operationLog: this._operationLog ?? undefined,
      },
    );

    this._pipeline = new StreamingPipeline(
      client,
      this._manager,
      settings.modelName,
      (pm) => this._agentLoop.run(pm),
      ollamaOptions,
      ollamaTools
    );

    // Skills — built-in catalog lives next to the source tree.
    const extensionFsPath = this._extensionUri.fsPath ?? "";
    const catalogDir = path.join(extensionFsPath, "src", "skills", "catalog");
    this._skillLoader = new SkillLoader(catalogDir);
    this._skillLoader.load();
    this._skillLoader.watch();

    // Command router wired to the live skill list.
    this._commandRouter = new CommandRouter(() =>
      this._skillLoader.listSkills().map((s) => ({
        name: s.name,
        description: s.description,
        argumentHint: s.argumentHint || undefined,
      }))
    );

    // MCP support — initialize lazily based on settings.
    if (settings.mcpEnabled) {
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      this._mcpManager = new McpManager(this._registry, workspacePath, this._workspaceState);
      void this._mcpManager.initialize().then(async () => {
        this._mcpTools = this._mcpManager?.getAllToolMetadata() ?? [];
        const prompt = this._promptBuilder.build(this._buildPromptContext());
        this._manager.rebuildSystemPrompt(prompt);
      }).catch((err) => {
        getLogger().warn("[McpManager] Initialization failed:", err);
      });
    }

    if (settings.mcpServerMode === "stdio") {
      this._mcpServer = new McpServer(
        this._registry,
        TOOL_CATALOG,
        settings.mcpExposedTools,
      );
      void this._mcpServer.start().catch((err) => {
        getLogger().warn("[McpServer] Failed to start:", err);
      });
    }

  }

  private _initStore(): ChatHistoryStore | null {
    if (!this._globalStorageUri) return null;
    try {
      const dbPath = path.join(this._globalStorageUri.fsPath, "chat-history.db");
      return new ChatHistoryStore(dbPath);
    } catch {
      // If the store can't be initialised (e.g. native module missing), continue
      // without persistence rather than crashing the extension.
      return null;
    }
  }

  private _initToolOutputCache(settings: GemmaCodeSettings): ToolOutputCache | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    try {
      const cache = new ToolOutputCache({
        extraSecretPatterns: settings.secretPathDenyExtra,
      });
      cache.open(folders[0]!.uri.fsPath);
      return cache;
    } catch (err) {
      getLogger().debug(
        `[GemmaCodePanel] ToolOutputCache init failed:`,
        formatForUser(err),
      );
      return null;
    }
  }

  private _initWebResponseCache(): WebResponseCache | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    try {
      const cache = new WebResponseCache();
      cache.open(folders[0]!.uri.fsPath);
      return cache;
    } catch (err) {
      getLogger().debug(
        `[GemmaCodePanel] WebResponseCache init failed:`,
        formatForUser(err),
      );
      return null;
    }
  }

  private _initOperationLog(settings: GemmaCodeSettings): OperationLog | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    try {
      const log = new OperationLog({
        extraSecretPatterns: settings.secretPathDenyExtra,
      });
      log.open(folders[0]!.uri.fsPath);
      log.setEnabled(settings.operationLogEnabled);
      return log;
    } catch (err) {
      getLogger().debug(
        `[GemmaCodePanel] OperationLog init failed:`,
        formatForUser(err),
      );
      return null;
    }
  }

  /**
   * Update the hardware tier configuration after async GPU detection completes.
   * Rebuilds the system prompt with tier info and configures budget middleware.
   */
  updateTierConfig(tierConfig: HardwareTierConfig): void {
    this._tierConfig = tierConfig;
    const prompt = this._promptBuilder.build(this._buildPromptContext());
    this._manager.rebuildSystemPrompt(prompt);

    const budget = createSessionBudget(tierConfig.id, tierConfig.contextWindow);
    this._agentLoop.setBudgetMiddleware(new BudgetMiddleware(budget));
  }

  private _buildToolRegistry(
    editMode: EditMode,
    _confirmationMode: "always" | "ask" | "never",
    secretPathDenyExtra: readonly string[] = [],
    permissionOverrides?: Record<string, number>,
  ): ToolRegistry {
    const registry = new ToolRegistry();
    const gate = this._confirmationGate;

    registry.register(
      "read_file",
      new ReadFileTool(gate, secretPathDenyExtra, this._toolOutputCache),
    );
    registry.register("write_file", new WriteFileTool(gate, editMode));
    registry.register("create_file", new CreateFileTool(gate, editMode));
    registry.register("delete_file", new DeleteFileTool());
    registry.register("edit_file", new EditFileTool(gate, editMode));
    registry.register("list_directory", new ListDirectoryTool(gate, secretPathDenyExtra));
    registry.register("grep_codebase", new GrepCodebaseTool(gate, secretPathDenyExtra));
    registry.register("run_terminal", new RunTerminalTool());
    registry.register("web_search", new WebSearchTool(this._webResponseCache));
    registry.register("fetch_page", new FetchPageTool());

    // Centralized permission enforcement via PermissionTiers.
    // Pass editMode so duplicate confirmations are suppressed for write/edit/create
    // (which fire their own diff-bearing prompt in ask/plan mode).
    registry.setConfirmationGate(gate, permissionOverrides, editMode);

    return registry;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    const nonce = randomUUID().replace(/-/g, "");
    const cspSource = webviewView.webview.cspSource;
    const settings = this._getSettings();

    webviewView.webview.html = getWebviewHtml(nonce, cspSource, settings.modelName);

    webviewView.webview.onDidReceiveMessage((raw: unknown) => {
      void this._handleMessage(raw as WebviewToExtensionMessage);
    });
  }

  private async _handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        this._postHistory();
        this._postToWebview({
          type: "planModeToggled",
          active: this._planMode.active,
        });
        this._postToWebview({
          type: "editModeChanged",
          mode: this._currentEditMode,
        });
        this._postTokenCount();
        this._postMemoryStatus();
        this._postMcpStatus();
        this._postThinkingModeStatus();
        break;

      case "requestCommandList":
        this._postToWebview({
          type: "commandList",
          commands: this._commandRouter.getAllDescriptors(),
        });
        break;

      case "sendMessage":
        await this._handleSendMessage(message.text);
        break;

      case "clearChat":
        this._manager.clearHistory();
        this._planMode.resetPlan();
        this._postHistory();
        this._postTokenCount();
        break;

      case "cancelStream":
        this._pipeline.cancel();
        this._agentLoop.cancel();
        break;

      case "confirmationResponse":
        this._confirmationGate.resolve(message.id, message.approved);
        break;

      case "approveStep":
        await this._handleApproveStep(message.step);
        break;

      case "loadSession":
        this._handleLoadSession(message.sessionId);
        break;

      case "setEditMode":
        await this._handleSetEditMode(message.mode);
        break;

      case "rollbackRequest": {
        const checkpoint = this._agentLoop.getLastCheckpoint();
        if (checkpoint && this._gitSafetyNet) {
          const success = await this._gitSafetyNet.rollback(checkpoint);
          this._postToWebview({
            type: "error",
            text: success
              ? `Rolled back to checkpoint ${checkpoint.headSha.slice(0, 7)}.`
              : "Rollback failed. Check git status manually.",
          });
        }
        break;
      }
    }
  }

  private async _handleSendMessage(text: string): Promise<void> {
    const postMessage = (msg: ExtensionToWebviewMessage): void =>
      this._postToWebview(msg);

    // Intercept messageComplete for server-side rendering.
    const postWithRender = (msg: ExtensionToWebviewMessage): void => {
      if (msg.type === "messageComplete" && !msg.renderedHtml) {
        const history = this._manager.getHistory();
        const found = history.find((m) => m.id === msg.messageId);
        postMessage({
          ...msg,
          renderedHtml: found ? renderMarkdown(found.content) : "",
        });
        this._postTokenCount();
        return;
      }
      postMessage(msg);
    };

    // Check for slash commands before sending to agent loop.
    const command = this._commandRouter.route(text);

    if (command !== null) {
      if (command.type === "builtin") {
        await this._handleBuiltinCommand(command.name, command.args);
        return;
      }

      // Skill command: substitute $ARGUMENTS and prepend to the next message.
      const skill = this._skillLoader.getSkill(command.name);
      if (!skill) {
        postMessage({ type: "error", text: `Skill "${command.name}" could not be loaded.` });
        return;
      }

      const expandedPrompt = skill.prompt.replace(/\$ARGUMENTS/g, command.args);
      const combinedText = `${expandedPrompt}\n\n${command.args}`.trim();

      await this._injectMemoryContext(command.args || combinedText);
      await this._pipeline.send(combinedText, postWithRender);
      this._checkForPlan();
      return;
    }

    // Orchestrator path: plan mode + complex request = DAG orchestration.
    if (this._planMode.active && this._orchestrator.shouldUseOrchestrator(text)) {
      await this._handleOrchestratorRequest(text, postWithRender);
      return;
    }

    // Normal message.
    await this._injectMemoryContext(text);
    await this._pipeline.send(text, postWithRender);
    this._checkForPlan();
  }

  private async _handleOrchestratorRequest(
    text: string,
    postWithRender: (msg: ExtensionToWebviewMessage) => void,
  ): Promise<void> {
    const postMessage = (msg: ExtensionToWebviewMessage): void =>
      this._postToWebview(msg);

    postMessage({ type: "status", state: "thinking" });

    try {
      const workspacePath =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
      const codebaseContext = `Workspace: ${workspacePath}`;

      const result = await this._orchestrator.execute(text, codebaseContext);

      const summaryMsg = this._manager.addAssistantMessage(result.summary);
      postWithRender({
        type: "messageComplete",
        messageId: summaryMsg.id,
        renderedHtml: renderMarkdown(result.summary),
      });
      this._postHistory();
      this._postTokenCount();
    } catch (err) {
      const errorText =
        err instanceof Error ? err.message : "Orchestrator failed";
      postMessage({ type: "error", text: errorText });
    } finally {
      postMessage({ type: "status", state: "idle" });
    }
  }

  private async _handleBuiltinCommand(name: string, args: string): Promise<void> {
    const postMessage = (msg: ExtensionToWebviewMessage): void =>
      this._postToWebview(msg);

    switch (name) {
      case "help": {
        const descriptors = this._commandRouter.getAllDescriptors();
        const lines = descriptors.map(
          (d) =>
            `**/${d.name}**${d.argumentHint ? ` ${d.argumentHint}` : ""} — ${d.description}`
        );
        const helpText = "## Available Commands\n\n" + lines.join("\n");
        const msg = this._manager.addAssistantMessage(helpText);
        postMessage({
          type: "messageComplete",
          messageId: msg.id,
          renderedHtml: renderMarkdown(helpText),
        });
        this._postHistory();
        break;
      }

      case "clear":
        this._manager.clearHistory();
        this._planMode.resetPlan();
        this._postHistory();
        this._postTokenCount();
        break;

      case "history": {
        if (!this._store) {
          const msg = this._manager.addAssistantMessage(
            "_Chat history persistence requires better-sqlite3 to be installed._"
          );
          postMessage({
            type: "messageComplete",
            messageId: msg.id,
            renderedHtml: renderMarkdown(msg.content),
          });
          this._postHistory();
          break;
        }
        const sessions = this._store.listSessions(50);
        postMessage({ type: "sessionList", sessions });
        break;
      }

      case "plan": {
        const nowActive = this._planMode.toggle();
        // Rebuild the system prompt to include or exclude the plan mode section.
        const prompt = this._promptBuilder.build(this._buildPromptContext());
        this._manager.rebuildSystemPrompt(prompt);
        postMessage({ type: "planModeToggled", active: nowActive });
        const planMsg = this._manager.addAssistantMessage(
          nowActive
            ? "_Plan mode enabled. I will produce a numbered plan before taking any action._"
            : "_Plan mode disabled. Resuming normal mode._"
        );
        postMessage({
          type: "messageComplete",
          messageId: planMsg.id,
          renderedHtml: renderMarkdown(planMsg.content),
        });
        this._postHistory();
        break;
      }

      case "compact": {
        const postWithRender = (msg: ExtensionToWebviewMessage): void => {
          if (msg.type === "messageComplete" && !msg.renderedHtml) {
            const history = this._manager.getHistory();
            const found = history.find((m) => m.id === msg.messageId);
            postMessage({
              ...msg,
              renderedHtml: found ? renderMarkdown(found.content) : "",
            });
            return;
          }
          postMessage(msg);
        };
        await this._compactor.compact(postWithRender, true);
        this._postTokenCount();
        this._postHistory();
        break;
      }

      case "model": {
        const settings = this._getSettings();
        const client = createOllamaClient(settings.ollamaUrl);
        const models = await client.listModels().catch(() => []);

        if (models.length === 0) {
          postMessage({
            type: "error",
            text: "Could not reach Ollama to list models. Make sure `ollama serve` is running.",
          });
          return;
        }

        const selected = await vscode.window.showQuickPick(
          models.map((m) => m.name),
          { placeHolder: args || "Select a model" }
        );

        if (selected) {
          await vscode.workspace
            .getConfiguration("gemma-code")
            .update("modelName", selected, vscode.ConfigurationTarget.Global);
          const switchMsg = this._manager.addAssistantMessage(
            `_Switched to model: **${selected}**_`
          );
          postMessage({
            type: "messageComplete",
            messageId: switchMsg.id,
            renderedHtml: renderMarkdown(switchMsg.content),
          });
          this._postHistory();
        }
        break;
      }

      case "memory": {
        if (!this._memoryStore) {
          const disabledMsg = this._manager.addAssistantMessage(
            "_Memory system is disabled. Enable it in settings: `gemma-code.memoryEnabled`._",
          );
          postMessage({
            type: "messageComplete",
            messageId: disabledMsg.id,
            renderedHtml: renderMarkdown(disabledMsg.content),
          });
          this._postHistory();
          break;
        }

        const [subcommand, ...rest] = args ? args.split(" ") : ["status"];
        const subArgs = rest.join(" ").trim();

        switch (subcommand) {
          case "search": {
            if (!subArgs) {
              const usageMsg = this._manager.addAssistantMessage("Usage: `/memory search <query>`");
              postMessage({
                type: "messageComplete",
                messageId: usageMsg.id,
                renderedHtml: renderMarkdown(usageMsg.content),
              });
              this._postHistory();
              break;
            }
            const results = this._memoryStore.searchKeyword(subArgs, 10);
            const text =
              results.length > 0
                ? "## Memory Search Results\n\n" +
                  results
                    .map((r, i) => `${i + 1}. **[${r.entry.type}]** ${r.entry.content}`)
                    .join("\n")
                : "_No memories found matching your query._";
            const searchMsg = this._manager.addAssistantMessage(text);
            postMessage({
              type: "messageComplete",
              messageId: searchMsg.id,
              renderedHtml: renderMarkdown(text),
            });
            this._postHistory();
            break;
          }

          case "save": {
            if (!subArgs) {
              const usageMsg = this._manager.addAssistantMessage("Usage: `/memory save <content>`");
              postMessage({
                type: "messageComplete",
                messageId: usageMsg.id,
                renderedHtml: renderMarkdown(usageMsg.content),
              });
              this._postHistory();
              break;
            }
            await this._memoryStore.save(subArgs, "fact", this._manager.sessionId ?? undefined);
            const saveMsg = this._manager.addAssistantMessage("_Memory saved._");
            postMessage({
              type: "messageComplete",
              messageId: saveMsg.id,
              renderedHtml: renderMarkdown(saveMsg.content),
            });
            this._postHistory();
            this._postMemoryStatus();
            break;
          }

          case "clear": {
            this._memoryStore.clear();
            const clearMsg = this._manager.addAssistantMessage("_All memories cleared._");
            postMessage({
              type: "messageComplete",
              messageId: clearMsg.id,
              renderedHtml: renderMarkdown(clearMsg.content),
            });
            this._postHistory();
            this._postMemoryStatus();
            break;
          }

          case "lint": {
            const workspaceRoot =
              vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
            if (!workspaceRoot) {
              const noWsMsg = this._manager.addAssistantMessage(
                "_/memory lint requires an open workspace._",
              );
              postMessage({
                type: "messageComplete",
                messageId: noWsMsg.id,
                renderedHtml: renderMarkdown(noWsMsg.content),
              });
              this._postHistory();
              break;
            }
            const settings = this._getSettings();
            const lintArgs = parseMemoryLintArgs(subArgs);
            let result: MemoryLintResult;
            try {
              result = await runMemoryLint(lintArgs, {
                memoryStore: this._memoryStore,
                workspaceRoot,
                secretPathDenyExtra: settings.secretPathDenyExtra,
                embeddingEnabled: settings.embeddingModel !== "",
              });
            } catch (err) {
              const errMsg = this._manager.addAssistantMessage(
                `_Memory lint failed: ${formatForUser(err)}_`,
              );
              postMessage({
                type: "messageComplete",
                messageId: errMsg.id,
                renderedHtml: renderMarkdown(errMsg.content),
              });
              this._postHistory();
              break;
            }
            const lintMsg = this._manager.addAssistantMessage(result.message);
            postMessage({
              type: "messageComplete",
              messageId: lintMsg.id,
              renderedHtml: renderMarkdown(lintMsg.content),
            });
            this._postHistory();
            break;
          }

          case "status":
          default: {
            const stats = this._memoryStore.getStats();
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
            const statusText = lines.join("\n");
            const statusMsg = this._manager.addAssistantMessage(statusText);
            postMessage({
              type: "messageComplete",
              messageId: statusMsg.id,
              renderedHtml: renderMarkdown(statusText),
            });
            this._postHistory();
            break;
          }
        }
        break;
      }

      case "mcp": {
        const mcpSettings = this._getSettings();
        if (!mcpSettings.mcpEnabled || !this._mcpManager) {
          const disabledMsg = this._manager.addAssistantMessage(
            "_MCP support is disabled. Enable it in settings: `gemma-code.mcpEnabled`._",
          );
          postMessage({
            type: "messageComplete",
            messageId: disabledMsg.id,
            renderedHtml: renderMarkdown(disabledMsg.content),
          });
          this._postHistory();
          break;
        }

        const [subcommand] = args.split(" ", 1);
        const subArgs = args.slice((subcommand?.length ?? 0) + 1).trim();

        switch (subcommand) {
          case "connect": {
            if (!subArgs) {
              const usageMsg = this._manager.addAssistantMessage("Usage: `/mcp connect <server-name>`");
              postMessage({ type: "messageComplete", messageId: usageMsg.id, renderedHtml: renderMarkdown(usageMsg.content) });
              this._postHistory();
              break;
            }
            try {
              await this._mcpManager.connectServer(subArgs);
              this._mcpTools = this._mcpManager.getAllToolMetadata();
              const prompt = this._promptBuilder.build(this._buildPromptContext());
              this._manager.rebuildSystemPrompt(prompt);
              const msg = this._manager.addAssistantMessage(`_Connected to MCP server "${subArgs}"._`);
              postMessage({ type: "messageComplete", messageId: msg.id, renderedHtml: renderMarkdown(msg.content) });
            } catch (err) {
              const errMsg = formatForUser(err);
              const msg = this._manager.addAssistantMessage(`_Failed to connect to "${subArgs}": ${errMsg}_`);
              postMessage({ type: "messageComplete", messageId: msg.id, renderedHtml: renderMarkdown(msg.content) });
            }
            this._postHistory();
            this._postMcpStatus();
            break;
          }
          case "disconnect": {
            if (!subArgs) {
              const usageMsg = this._manager.addAssistantMessage("Usage: `/mcp disconnect <server-name>`");
              postMessage({ type: "messageComplete", messageId: usageMsg.id, renderedHtml: renderMarkdown(usageMsg.content) });
              this._postHistory();
              break;
            }
            await this._mcpManager.disconnectServer(subArgs);
            this._mcpTools = this._mcpManager.getAllToolMetadata();
            const prompt = this._promptBuilder.build(this._buildPromptContext());
            this._manager.rebuildSystemPrompt(prompt);
            const dcMsg = this._manager.addAssistantMessage(`_Disconnected from MCP server "${subArgs}"._`);
            postMessage({ type: "messageComplete", messageId: dcMsg.id, renderedHtml: renderMarkdown(dcMsg.content) });
            this._postHistory();
            this._postMcpStatus();
            break;
          }
          case "status":
          default: {
            const states = this._mcpManager.getServerStates();
            const lines = [
              "## MCP Status",
              "",
              `- **Enabled:** yes`,
              `- **Connected servers:** ${states.filter((s) => s.status === "connected").length}`,
              `- **MCP tools:** ${this._mcpTools.length}`,
            ];
            if (states.length > 0) {
              lines.push("", "### Servers", "");
              for (const state of states) {
                const toolCount = state.tools.length;
                const statusIcon = state.status === "connected" ? "+" : state.status === "error" ? "x" : "-";
                lines.push(`- [${statusIcon}] **${state.config.name}** (${state.status}) -- ${toolCount} tools${state.error ? ` -- error: ${state.error}` : ""}`);
              }
            }
            const statusText = lines.join("\n");
            const msg = this._manager.addAssistantMessage(statusText);
            postMessage({ type: "messageComplete", messageId: msg.id, renderedHtml: renderMarkdown(statusText) });
            this._postHistory();
            break;
          }
        }
        break;
      }

      case "verify": {
        const verifySettings = this._getSettings();
        const config: SubAgentConfig = {
          type: "verification",
          maxIterations: verifySettings.subAgentMaxIterations,
          userRequest: "Verify recent changes for correctness, check for bugs and run relevant tests.",
          modifiedFiles: [...this._agentLoop.getModifiedFiles()],
          recentToolResults: [...this._agentLoop.getRecentToolResults()],
        };
        const result = await this._subAgentManager.run(config, postMessage);
        const reportText = `## Verification Report\n\n${result.output || "_No issues found._"}`;
        const reportMsg = this._manager.addAssistantMessage(reportText);
        postMessage({
          type: "messageComplete",
          messageId: reportMsg.id,
          renderedHtml: renderMarkdown(reportText),
        });
        this._postHistory();
        break;
      }

      case "cache": {
        if (!this._toolOutputCache) {
          const disabledMsg = this._manager.addAssistantMessage(
            "_Tool-output cache is disabled (no workspace open or initialization failed)._",
          );
          postMessage({
            type: "messageComplete",
            messageId: disabledMsg.id,
            renderedHtml: renderMarkdown(disabledMsg.content),
          });
          this._postHistory();
          break;
        }

        const [subcommand] = args ? args.split(" ", 1) : ["status"];

        switch (subcommand) {
          case "clear": {
            const removed = this._toolOutputCache.clear();
            const text = `_Cleared ${removed} entr${removed === 1 ? "y" : "ies"} from the tool-output cache._`;
            const msg = this._manager.addAssistantMessage(text);
            postMessage({
              type: "messageComplete",
              messageId: msg.id,
              renderedHtml: renderMarkdown(text),
            });
            this._postHistory();
            break;
          }
          case "prune": {
            const removed = this._toolOutputCache.prune();
            const text =
              removed > 0
                ? `_Pruned ${removed} oldest entr${removed === 1 ? "y" : "ies"} from the tool-output cache._`
                : "_Cache is below capacity; no entries pruned._";
            const msg = this._manager.addAssistantMessage(text);
            postMessage({
              type: "messageComplete",
              messageId: msg.id,
              renderedHtml: renderMarkdown(text),
            });
            this._postHistory();
            break;
          }
          case "reembed": {
            const result = await this._toolOutputCache.reembedHeuristic();
            const text =
              result.scanned === 0
                ? "_No heuristic-tagged rows to re-embed._"
                : `_Re-embedded ${result.reembedded} of ${result.scanned} heuristic row${result.scanned === 1 ? "" : "s"} via Ollama._`;
            const msg = this._manager.addAssistantMessage(text);
            postMessage({
              type: "messageComplete",
              messageId: msg.id,
              renderedHtml: renderMarkdown(text),
            });
            this._postHistory();
            break;
          }
          case "status":
          default: {
            const stats = this._toolOutputCache.stats();
            const lru = this._toolOutputCache.lruStats();
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
            const text = lines.join("\n");
            const msg = this._manager.addAssistantMessage(text);
            postMessage({
              type: "messageComplete",
              messageId: msg.id,
              renderedHtml: renderMarkdown(text),
            });
            this._postHistory();
            break;
          }
        }
        break;
      }

      case "operation-log": {
        if (!this._operationLog) {
          const disabledMsg = this._manager.addAssistantMessage(
            "_Operation log is unavailable (no workspace open)._",
          );
          postMessage({
            type: "messageComplete",
            messageId: disabledMsg.id,
            renderedHtml: renderMarkdown(disabledMsg.content),
          });
          this._postHistory();
          break;
        }

        const [opSubcommand] = args ? args.split(" ", 1) : ["status"];
        switch (opSubcommand) {
          case "clear": {
            this._operationLog.clear();
            const text = "_Operation log cleared._";
            const msg = this._manager.addAssistantMessage(text);
            postMessage({
              type: "messageComplete",
              messageId: msg.id,
              renderedHtml: renderMarkdown(text),
            });
            this._postHistory();
            break;
          }
          case "status":
          default: {
            const status = this._operationLog.status();
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
            const text = lines.join("\n");
            const msg = this._manager.addAssistantMessage(text);
            postMessage({
              type: "messageComplete",
              messageId: msg.id,
              renderedHtml: renderMarkdown(text),
            });
            this._postHistory();
            break;
          }
        }
        break;
      }

      case "research": {
        if (!args) {
          const usageMsg = this._manager.addAssistantMessage("Usage: `/research <query>`");
          postMessage({
            type: "messageComplete",
            messageId: usageMsg.id,
            renderedHtml: renderMarkdown(usageMsg.content),
          });
          this._postHistory();
          break;
        }
        const researchSettings = this._getSettings();
        const config: SubAgentConfig = {
          type: "research",
          maxIterations: researchSettings.subAgentMaxIterations,
          userRequest: args,
          modifiedFiles: [...this._agentLoop.getModifiedFiles()],
          recentToolResults: [...this._agentLoop.getRecentToolResults()],
        };
        const result = await this._subAgentManager.run(config, postMessage);
        const researchText = `## Research Results\n\n${result.output || "_No results._"}`;
        const researchMsg = this._manager.addAssistantMessage(researchText);
        postMessage({
          type: "messageComplete",
          messageId: researchMsg.id,
          renderedHtml: renderMarkdown(researchText),
        });
        this._postHistory();
        break;
      }
    }
  }

  private _handleLoadSession(sessionId: string): void {
    const loaded = this._manager.loadSession(sessionId);
    if (loaded) {
      this._planMode.resetPlan();
      this._postToWebview({ type: "planModeToggled", active: false });
      this._postHistory();
      this._postTokenCount();
    }
  }

  private async _handleSetEditMode(mode: EditMode): Promise<void> {
    this._currentEditMode = mode;
    vscode.workspace
      .getConfiguration("gemma-code")
      .update("editMode", mode, vscode.ConfigurationTarget.Global)
      .then(undefined, (err: unknown) => {
        // Surface config-save failures to the output channel so they are not
        // swallowed silently (review finding #100).
        const message = formatForUser(err);
        this._getOutputChannel().appendLine(
          `[config] Failed to save editMode='${mode}' to global settings: ${message}`,
        );
      });
    this._postToWebview({ type: "editModeChanged", mode });

    // Toggle plan mode based on the selected edit mode.
    const shouldPlan = mode === "plan";
    if (shouldPlan !== this._planMode.active) {
      this._planMode.toggle();
      const prompt = this._promptBuilder.build(this._buildPromptContext());
      this._manager.rebuildSystemPrompt(prompt);
      this._postToWebview({
        type: "planModeToggled",
        active: shouldPlan,
      });
    }
  }

  private _checkForPlan(): void {
    if (!this._planMode.active) return;

    const history = this._manager.getHistory();
    const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return;

    const steps = detectPlan(lastAssistant.content);
    if (steps && steps.length >= 2) {
      this._planMode.setPlan(steps);
      this._postToWebview({ type: "planReady", steps });
    }
  }

  private async _handleApproveStep(stepIndex: number): Promise<void> {
    const postMessage = (msg: ExtensionToWebviewMessage): void =>
      this._postToWebview(msg);
    const { currentPlan } = this._planMode.state;
    const step = currentPlan[stepIndex];
    if (!step) return;

    this._planMode.approveStep(stepIndex);

    // Send a follow-up user message to tell the model to execute the approved step.
    const instruction = `Please proceed with step ${stepIndex + 1}: ${step.description}`;
    const postWithRender = (msg: ExtensionToWebviewMessage): void => {
      if (msg.type === "messageComplete" && !msg.renderedHtml) {
        const history = this._manager.getHistory();
        const found = history.find((m) => m.id === msg.messageId);
        postMessage({
          ...msg,
          renderedHtml: found ? renderMarkdown(found.content) : "",
        });
        return;
      }
      postMessage(msg);
    };
    await this._pipeline.send(instruction, postWithRender);
    this._planMode.markStepDone(stepIndex);
    this._checkForPlan();
  }

  private _postHistory(): void {
    const visible = this._manager.getHistory().filter((m) => m.role !== "system");

    // Populate the cache lazily -- each assistant message's Markdown is
    // rendered exactly once per session, even across repeated history posts.
    const liveIds = new Set<string>();
    const renderedHtmlMap: Record<string, string> = {};
    const messages: Message[] = [];

    for (const msg of visible) {
      liveIds.add(msg.id);
      if (msg.role === "assistant") {
        let html = this._renderedHtmlCache.get(msg.id);
        if (html === undefined) {
          html = renderMarkdown(msg.content);
          this._renderedHtmlCache.set(msg.id, html);
        }
        renderedHtmlMap[msg.id] = html;
        // Assistant payload: keep metadata only; the HTML map is authoritative
        // for the webview. Drops roughly half the payload on typical sessions.
        messages.push({
          id: msg.id,
          role: msg.role,
          content: "",
          timestamp: msg.timestamp,
        });
      } else {
        messages.push(msg);
      }
    }

    // Evict cache entries whose messages no longer exist (handles trim,
    // replaceMessages, clearHistory, loadSession).
    if (this._renderedHtmlCache.size > liveIds.size) {
      for (const id of this._renderedHtmlCache.keys()) {
        if (!liveIds.has(id)) this._renderedHtmlCache.delete(id);
      }
    }

    this._postToWebview({
      type: "history",
      messages,
      renderedHtmlMap,
    });
  }

  private _postTokenCount(): void {
    const settings = this._getSettings();
    const count = this._compactor.estimateTokens();
    this._postToWebview({
      type: "tokenCount",
      count,
      limit: settings.maxTokens,
    });
  }

  private _postMemoryStatus(): void {
    const settings = this._getSettings();
    const entryCount = this._memoryStore?.getStats().totalEntries ?? 0;
    this._postToWebview({
      type: "memoryStatus",
      enabled: settings.memoryEnabled && this._memoryStore !== null,
      entryCount,
    });
  }

  private _postMcpStatus(): void {
    const settings = this._getSettings();
    if (!settings.mcpEnabled || !this._mcpManager) {
      this._postToWebview({
        type: "mcpStatus",
        enabled: false,
        connectedServerCount: 0,
        totalToolCount: 0,
      });
      return;
    }
    const states = this._mcpManager.getServerStates();
    const connectedCount = states.filter((s) => s.status === "connected").length;
    this._postToWebview({
      type: "mcpStatus",
      enabled: true,
      connectedServerCount: connectedCount,
      totalToolCount: this._mcpTools.length,
    });
  }

  /**
   * Return cached settings or refresh from VS Code configuration.
   * Invalidated by `workspace.onDidChangeConfiguration` (registered in the
   * constructor) so the cache stays in sync with the user's edits.
   */
  private _getSettings(): GemmaCodeSettings {
    if (!this._settingsCache) {
      this._settingsCache = getSettings();
    }
    return this._settingsCache;
  }

  private _getOutputChannel(): vscode.OutputChannel {
    if (!this._outputChannel) {
      this._outputChannel = vscode.window.createOutputChannel("Gemma Code");
    }
    return this._outputChannel;
  }

  private _postThinkingModeStatus(): void {
    const settings = this._getSettings();
    this._postToWebview({
      type: "thinkingModeStatus",
      active: settings.thinkingMode,
    });
  }

  private _buildPromptContext(memoryContext?: string): PromptContext {
    const settings = this._getSettings();
    return {
      modelName: settings.modelName,
      maxTokens: this._tierConfig?.contextWindow ?? settings.maxTokens,
      planModeActive: this._planMode.active,
      thinkingMode: settings.thinkingMode,
      enabledTools: this._getEnabledToolMetadata(),
      promptStyle: settings.promptStyle,
      workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      systemPromptBudgetPercent: settings.systemPromptBudgetPercent,
      memoryContext,
      workingMemory: this._workingMemory ?? undefined,
      unifiedRetriever: this._unifiedRetriever ?? undefined,
      tierName: this._tierConfig?.name,
      tierVramMb: this._tierConfig?.vramRange.max,
      tierModelName: this._tierConfig?.recommendedModels[0]?.modelName,
    };
  }

  /**
   * Compute which tools should be enabled based on the current runtime context
   * (Ollama reachability, network, session mode) and return the filtered catalog.
   */
  private _getEnabledToolMetadata(): DynamicToolMetadata[] {
    const builtinTools = TOOL_CATALOG.map(toDynamicMetadata);
    const allTools = [...builtinTools, ...this._mcpTools];

    // During construction, _registry is not yet assigned. Return full catalog.
    if (!this._registry) return builtinTools;

    const { disabledTools } = computeToolActivation(allTools, {
      ollamaReachable: this._ollamaReachable,
      networkAvailable: true,
      readOnlySession: false,
      totalToolCount: allTools.length,
    });

    for (const tool of allTools) {
      this._registry.setEnabled(tool.name, !disabledTools.has(tool.name));
    }

    return this._registry.getEnabledToolMetadata(allTools);
  }

  /** Build OllamaToolDefinition[] from the currently enabled tools. */
  private _buildOllamaTools(): OllamaToolDefinition[] {
    const enabled = this._getEnabledToolMetadata();
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

  /** Update Ollama reachability state and rebuild the system prompt accordingly. */
  async setOllamaReachable(reachable: boolean): Promise<void> {
    if (this._ollamaReachable === reachable) return;
    this._ollamaReachable = reachable;
    const prompt = this._promptBuilder.build(this._buildPromptContext());
    this._manager.rebuildSystemPrompt(prompt);
  }

  /**
   * Query the memory store for relevant memories and rebuild the system prompt
   * with the memory context injected. Non-fatal on error.
   */
  private async _injectMemoryContext(queryText: string): Promise<void> {
    if (!this._memoryStore && !this._unifiedRetriever) return;
    try {
      const budget = calculateBudget(this._getSettings().maxTokens);

      // Use unified retriever when available (Phase 3), fall back to MemoryStore.
      let memoryContext: string;
      if (this._unifiedRetriever) {
        memoryContext = await this._unifiedRetriever.retrieveForPrompt(
          queryText,
          budget.memoryBudget,
        );
      } else {
        memoryContext = await this._memoryStore!.retrieve(queryText, budget.memoryBudget);
      }

      if (memoryContext) {
        const prompt = this._promptBuilder.build(this._buildPromptContext(memoryContext));
        this._manager.rebuildSystemPrompt(prompt);
      }
    } catch {
      // Memory query failure is non-fatal; proceed without memory context.
    }
  }

  private _buildMemorySubsystem(
    settings: ReturnType<typeof getSettings>,
    toolOutputCache: ToolOutputCache | null,
  ): MemorySubsystem {
    if (!settings.memoryEnabled || !this._globalStorageUri) {
      return MemorySubsystem.disabled();
    }
    const dbPath = path.join(this._globalStorageUri.fsPath, "memory.db");
    return new MemorySubsystem({
      dbPath,
      ollamaUrl: settings.ollamaUrl,
      embeddingModel: settings.embeddingModel ?? null,
      requestTimeout: settings.requestTimeout,
      toolOutputCache,
      corroborationThreshold: settings.memoryCorroborationThreshold,
    });
  }

  /**
   * Post a message to every attached webview (sidebar + editor panel).
   * History, status, and other broadcast events use this path so every
   * surface stays in sync.
   */
  private _postToWebview(msg: unknown): void {
    // Route high-frequency streaming traffic to only the focused surface.
    // A single stream of 500 tokens with both panels attached posted 1000
    // messages before this split; now it posts 500.
    if (this._isStreamingMessage(msg)) {
      this._postToFocusedWebview(msg);
      return;
    }
    void this._editorPanel?.webview.postMessage(msg);
    void this._view?.webview.postMessage(msg);
  }

  /** Post to whichever surface currently has focus. Used for streaming. */
  private _postToFocusedWebview(msg: unknown): void {
    const hasEditor = this._editorPanel !== undefined;
    const hasView = this._view !== undefined;
    // If only one is attached, behavior matches the pre-split broadcast.
    if (!hasEditor) {
      void this._view?.webview.postMessage(msg);
      return;
    }
    if (!hasView) {
      void this._editorPanel?.webview.postMessage(msg);
      return;
    }
    // Both attached: pick the focused one.
    if (this._editorPanelActive) {
      void this._editorPanel?.webview.postMessage(msg);
    } else {
      void this._view?.webview.postMessage(msg);
    }
  }

  private _isStreamingMessage(msg: unknown): boolean {
    if (typeof msg !== "object" || msg === null) return false;
    const type = (msg as { type?: unknown }).type;
    // Streaming-family types: token deltas and the completion marker. All
    // other events (history, status, errors, tool I/O, config updates) are
    // low-frequency or critical and must reach every attached surface.
    return type === "token" || type === "messageComplete";
  }

  /** Post a status update to the webview (visible even before the first message). */
  postStatus(state: "idle" | "streaming" | "thinking"): void {
    this._postToWebview({ type: "status", state });
  }

  /** Clear the chat and start a fresh session (callable from commands). */
  clearChat(): void {
    this._manager.clearHistory();
    this._planMode.resetPlan();
    this._resetSessionScopedToolState();
    this._postHistory();
    this._postTokenCount();
  }

  /**
   * Reset tool-level state that should not leak across sessions (e.g. the
   * per-session rate-limit window in WebSearchTool).
   */
  private _resetSessionScopedToolState(): void {
    const webSearch = this._registry.get("web_search") as unknown as
      | { resetSession?: () => void }
      | undefined;
    if (webSearch && typeof webSearch.resetSession === "function") {
      webSearch.resetSession();
    }
  }

  /** Post an error banner to the webview. */
  postError(message: string): void {
    this._postToWebview({ type: "error", text: message });
  }

  /** Attach this panel's logic to an editor-area WebviewPanel. */
  attachToWebviewPanel(panel: vscode.WebviewPanel): void {
    const nonce = randomUUID().replace(/-/g, "");
    const cspSource = panel.webview.cspSource;
    const settings = this._getSettings();

    panel.webview.html = getWebviewHtml(nonce, cspSource, settings.modelName);

    panel.webview.onDidReceiveMessage((raw: unknown) => {
      void this._handleMessage(raw as WebviewToExtensionMessage);
    });

    // Store a reference so postMessage calls work on the editor panel.
    this._editorPanel = panel;
    this._editorPanelActive = panel.active;

    // Track focus for streaming routing (4.4) and rehydrate on re-show so a
    // hidden panel with retainContextWhenHidden: false (4.19) paints fresh.
    panel.onDidChangeViewState((ev) => {
      const wasHidden = !this._editorPanelActive;
      this._editorPanelActive = ev.webviewPanel.active;
      if (ev.webviewPanel.visible && wasHidden) {
        // Re-show after being hidden: the webview's JS state was discarded,
        // so repaint from the cached rendered HTML.
        this._postHistory();
      }
    });

    panel.onDidDispose(() => {
      if (this._editorPanel === panel) {
        this._editorPanel = undefined;
        this._editorPanelActive = false;
      }
    });
  }

  /** Get the underlying ChatHistoryStore (for session list panel). */
  getStore(): import("../storage/ChatHistoryStore.js").ChatHistoryStore | null {
    return this._store;
  }

  /**
   * Phase 9 (v0.5.0): expose the persistent tool-output cache so the trace
   * dashboard can render cache-hit and top-cached-files panels.
   */
  getToolOutputCache(): ToolOutputCache | null {
    return this._toolOutputCache;
  }

  /**
   * Phase 9 (v0.5.0): expose the API-response cache so the trace dashboard
   * can render the web-cache hit/miss panel.
   */
  getWebResponseCache(): WebResponseCache | null {
    return this._webResponseCache;
  }

  /** Load a saved session by ID. */
  loadSession(sessionId: string): void {
    if (!this._store) return;
    const session = this._store.getSession(sessionId);
    if (!session) return;
    this._manager.clearHistory();
    for (const msg of session.messages) {
      if (msg.role === "user") {
        this._manager.addUserMessage(msg.content);
      } else if (msg.role === "assistant") {
        this._manager.addAssistantMessage(msg.content);
      }
    }
    this._postHistory();
    this._postTokenCount();
  }

  dispose(): void {
    this._manager.dispose();
    this._skillLoader.stopWatching();
    this._store?.close();
    // MemoryStore, EpisodicMemory, and GraphMemory now share one Database
    // owned by MemorySubsystem. One close() is sufficient; the per-layer
    // close() methods are no-ops on injected connections.
    this._memorySubsystem.close();
    this._toolOutputCache?.close();
    this._webResponseCache?.close();
    this._operationLog?.close();
    this._mcpManager?.dispose();
    void this._mcpServer?.stop();
    this._settingsChangeDisposable?.dispose();
    this._settingsChangeDisposable = null;
    this._outputChannel?.dispose();
    this._outputChannel = null;
  }
}
