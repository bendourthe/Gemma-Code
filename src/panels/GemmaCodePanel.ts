import * as path from "path";
import * as vscode from "vscode";
import { ConversationManager } from "../chat/ConversationManager.js";
import type { Message } from "../chat/types.js";
import { StreamingPipeline } from "../chat/StreamingPipeline.js";
import { ContextCompactor } from "../chat/ContextCompactor.js";
import { AgentLoop } from "../tools/AgentLoop.js";
import { SubAgentManager } from "../agents/SubAgentManager.js";
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
import { ChatController } from "./ChatController.js";
import { ChatWebviewHost } from "./ChatWebviewHost.js";
import { PlanMode } from "../chat/PlanMode.js";
import { ChatHistoryStore } from "../storage/ChatHistoryStore.js";
import { MemoryStore } from "../storage/MemoryStore.js";
import { MemorySubsystem } from "../storage/MemorySubsystem.js";
import { ToolOutputCache } from "../storage/ToolOutputCache.js";
import { WebResponseCache } from "../tools/handlers/webCache.js";
import { OperationLog } from "../observability/OperationLog.js";
import type { WorkingMemory } from "../storage/WorkingMemory.js";
import { EpisodicMemory } from "../storage/EpisodicMemory.js";
import { GraphMemory } from "../storage/GraphMemory.js";
import { MemoryConsolidator } from "../storage/MemoryConsolidator.js";
import { UnifiedMemoryRetriever } from "../storage/UnifiedMemoryRetriever.js";
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

export const VIEW_ID = "gemma-code.chatView";

export class GemmaCodePanel implements vscode.WebviewViewProvider {
  private readonly _host: ChatWebviewHost;
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
  private _controller!: ChatController;
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

    // Webview host: owns sidebar view + optional editor-area panel, the
    // postMessage routing rules, and CSP/HTML scaffolding. The panel-side
    // wiring (this class) only deals with chat domain logic; surface lifecycle
    // lives in ChatWebviewHost.
    this._host = new ChatWebviewHost(
      this._extensionUri,
      (msg) => this._handleMessage(msg),
      () => this._getSettings().modelName,
      () => this._postHistory(),
    );

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

    // The vendor-neutral LLM port -- built once and threaded into every
    // consumer (chat streaming, sub-agents, the embedding port wired into
    // MemorySubsystem).
    const client = this._runtime.getOllamaClient();

    // Initialize 4-layer memory system through the MemorySubsystem factory.
    const memory = this._buildMemorySubsystem(settings, client, this._toolOutputCache);
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

    // Conversation controller: owns the agent-loop wiring, slash-command
    // dispatch, plan-mode follow-ups, and orchestrator path. Reads
    // dependencies via getter callbacks so it sees live state (mcpTools grow
    // after async MCP init; settings cache invalidates on config change).
    this._controller = new ChatController({
      manager: this._manager,
      planMode: this._planMode,
      promptBuilder: this._promptBuilder,
      compactor: this._compactor,
      commandRouter: this._commandRouter,
      runtime: this._runtime,
      subAgentManager: this._subAgentManager,
      agentLoop: this._agentLoop,
      pipeline: this._pipeline,
      orchestrator: this._orchestrator,
      skillLoader: this._skillLoader,
      getStore: () => this._store,
      getMemoryStore: () => this._memoryStore,
      getToolOutputCache: () => this._toolOutputCache,
      getOperationLog: () => this._operationLog,
      getMcpManager: () => this._mcpManager,
      getMcpTools: () => this._mcpTools,
      setMcpTools: (tools) => {
        this._mcpTools = tools;
      },
      getUnifiedRetriever: () => this._unifiedRetriever,
      getSettings: () => this._getSettings(),
      buildPromptContext: (memoryContext) => this._buildPromptContext(memoryContext),
      postMessage: (msg) => this._postToWebview(msg),
      postHistory: () => this._postHistory(),
      postTokenCount: () => this._postTokenCount(),
      postMemoryStatus: () => this._postMemoryStatus(),
      postMcpStatus: () => this._postMcpStatus(),
    });

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
    _token: vscode.CancellationToken,
  ): void {
    this._host.attachView(webviewView);
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
        await this._controller.submitUserMessage(message.text);
        break;

      case "clearChat":
        this._manager.clearHistory();
        this._planMode.resetPlan();
        this._postHistory();
        this._postTokenCount();
        break;

      case "cancelStream":
        this._controller.cancelInFlight();
        break;

      case "confirmationResponse":
        this._confirmationGate.resolve(message.id, message.approved);
        break;

      case "approveStep":
        await this._controller.approveStep(message.step);
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


  private _buildMemorySubsystem(
    settings: ReturnType<typeof getSettings>,
    llmClient: import("../llm/types.js").LLMClient,
    toolOutputCache: ToolOutputCache | null,
  ): MemorySubsystem {
    if (!settings.memoryEnabled || !this._globalStorageUri) {
      return MemorySubsystem.disabled();
    }
    const dbPath = path.join(this._globalStorageUri.fsPath, "memory.db");
    return new MemorySubsystem({
      dbPath,
      llmClient,
      embeddingModel: settings.embeddingModel ?? null,
      toolOutputCache,
      corroborationThreshold: settings.memoryCorroborationThreshold,
    });
  }

  /**
   * Forward a message to the attached webview surface(s). Routing and
   * broadcast/streaming-focus rules live in {@link ChatWebviewHost}.
   */
  private _postToWebview(msg: ExtensionToWebviewMessage): void {
    this._host.postMessage(msg);
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
    this._host.attachEditorPanel(panel);
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
