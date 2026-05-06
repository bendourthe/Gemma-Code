import * as vscode from "vscode";
import type { ConversationManager } from "../chat/ConversationManager.js";
import type { PlanMode } from "../chat/PlanMode.js";
import type { PromptBuilder } from "../chat/PromptBuilder.js";
import type { McpManager } from "../mcp/McpManager.js";
import type { McpServer } from "../mcp/McpServer.js";
import type { ChatController } from "./ChatController.js";
import { ChatWebviewHost } from "./ChatWebviewHost.js";
import type { ChatMessageRouter } from "./ChatMessageRouter.js";
import type { ChatStatusReporter } from "./ChatStatusReporter.js";
import type { ToolActivationContext } from "./ToolActivationContext.js";
import { bootstrapChatPanel } from "./ChatPanelBootstrap.js";
import type { ChatHistoryStore } from "../storage/ChatHistoryStore.js";
import type { MemorySubsystem } from "../storage/MemorySubsystem.js";
import type { ToolOutputCache } from "../storage/ToolOutputCache.js";
import type { WebResponseCache } from "../tools/handlers/webCache.js";
import type { OperationLog } from "../observability/OperationLog.js";
import { getSettings, type GemmaCodeSettings } from "../config/settings.js";
import type { DynamicToolMetadata } from "../tools/ToolCatalog.js";
import type { HardwareTierConfig } from "../config/HardwareTier.types.js";
import { BudgetMiddleware, createSessionBudget } from "../tools/BudgetMiddleware.js";
import type { AgentLoop } from "../tools/AgentLoop.js";
import type { ToolRegistry } from "../tools/ToolRegistry.js";
import type { GemmaRuntime } from "../runtime/GemmaRuntime.js";
import type { EditMode } from "../tools/types.js";
import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
} from "./messages.js";

export const VIEW_ID = "gemma-code.chatView";

/**
 * Composition root for the chat panel. After v0.7.0 Phase 0 sub-task 0.4 the
 * panel only owns:
 *   1. The VS Code lifecycle hooks (resolveWebviewView, attachToWebviewPanel,
 *      dispose, settings-change subscription).
 *   2. The cached settings + lazy output channel surface.
 *   3. The mutable late-binding state (mcpTools, edit mode, ollama
 *      reachability, hardware tier) exposed to the bootstrap via
 *      {@link ChatPanelHooks}.
 *
 * Construction graph (memory -> compactor -> sub-agent manager -> orchestrator
 * -> agent loop -> pipeline) lives in {@link ./ChatPanelBootstrap.js}; flow
 * lives in {@link ChatController}; status pushes live in
 * {@link ChatStatusReporter}; webview message dispatch lives in
 * {@link ChatMessageRouter}; tool-activation + prompt-context assembly live
 * in {@link ToolActivationContext}; init helpers live in
 * {@link ./ChatPanelInit.js}; tool registry construction lives in
 * {@link ../tools/ToolRegistryBuilder.js}.
 *
 * See ADR-0011 for the OllamaClient injection pattern.
 */
export class GemmaCodePanel implements vscode.WebviewViewProvider {
  private readonly _host: ChatWebviewHost;
  private readonly _manager: ConversationManager;
  private readonly _controller: ChatController;
  private readonly _statusReporter: ChatStatusReporter;
  private readonly _messageRouter: ChatMessageRouter;
  private readonly _toolActivation: ToolActivationContext;
  private readonly _planMode: PlanMode;
  private readonly _promptBuilder: PromptBuilder;
  private readonly _store: ChatHistoryStore | null;
  private readonly _memorySubsystem: MemorySubsystem;
  private readonly _toolOutputCache: ToolOutputCache | null;
  private readonly _webResponseCache: WebResponseCache | null;
  private readonly _operationLog: OperationLog | null;
  private readonly _agentLoop: AgentLoop;
  private readonly _registry: ToolRegistry;
  private readonly _mcpManager: McpManager | null;
  private readonly _mcpServer: McpServer | null;
  private readonly _skillLoaderStop: () => void;

  private _currentEditMode: EditMode;
  private _ollamaReachable = true;
  private _mcpTools: DynamicToolMetadata[] = [];
  private _tierConfig?: HardwareTierConfig;
  // Cached settings: invalidated by the configuration-change subscription so
  // we avoid hitting `vscode.workspace.getConfiguration("gemma-code")` on
  // every prompt build, message handler, or tool activation rebuild.
  private _settingsCache: GemmaCodeSettings | null = null;
  private _settingsChangeDisposable: vscode.Disposable | null = null;
  private _outputChannel: vscode.OutputChannel | null = null;

  constructor(
    extensionUri: vscode.Uri,
    runtime: GemmaRuntime,
    globalStorageUri?: vscode.Uri,
    workspaceState?: vscode.Memento,
  ) {
    const settings = this._getSettings();
    this._currentEditMode = settings.editMode;

    // Late-bound host so the bootstrap's postMessage closure can route through
    // the webview surface that ChatPanelHooks resolves at runtime.
    let host: ChatWebviewHost | null = null;
    const hostPostMessage = (msg: ExtensionToWebviewMessage): void => {
      host?.postMessage(msg);
    };

    const bootstrapped = bootstrapChatPanel({
      extensionUri,
      runtime,
      globalStorageUri,
      workspaceState,
      hostPostMessage,
      hooks: {
        getSettings: () => this._getSettings(),
        invalidateSettingsCache: () => {
          this._settingsCache = null;
        },
        getMcpTools: () => this._mcpTools,
        setMcpTools: (tools) => {
          this._mcpTools = tools;
        },
        getCurrentEditMode: () => this._currentEditMode,
        setCurrentEditMode: (mode) => {
          this._currentEditMode = mode;
        },
        getOllamaReachable: () => this._ollamaReachable,
        getTierConfig: () => this._tierConfig,
        getOutputChannel: () => this._getOutputChannel(),
        postRaw: hostPostMessage,
        handleWebviewMessage: (msg) => this._messageRouter.handle(msg),
      },
    });

    this._store = bootstrapped.store;
    this._toolOutputCache = bootstrapped.toolOutputCache;
    this._webResponseCache = bootstrapped.webResponseCache;
    this._operationLog = bootstrapped.operationLog;
    this._memorySubsystem = bootstrapped.memorySubsystem;
    this._planMode = bootstrapped.planMode;
    this._promptBuilder = bootstrapped.promptBuilder;
    this._toolActivation = bootstrapped.toolActivation;
    this._manager = bootstrapped.manager;
    this._registry = bootstrapped.registry;
    this._agentLoop = bootstrapped.agentLoop;
    this._statusReporter = bootstrapped.statusReporter;
    this._controller = bootstrapped.controller;
    this._messageRouter = bootstrapped.messageRouter;
    this._mcpManager = bootstrapped.mcpManager;
    this._mcpServer = bootstrapped.mcpServer;
    this._skillLoaderStop = () => bootstrapped.skillLoader.stopWatching();

    this._host = new ChatWebviewHost(
      extensionUri,
      (msg) => this._messageRouter.handle(msg),
      () => this._getSettings().modelName,
      () => this._statusReporter.postHistory(),
    );
    host = this._host;

    this._settingsChangeDisposable = vscode.workspace.onDidChangeConfiguration(
      (event) => this._handleConfigurationChange(event, bootstrapped),
    );
  }

  private _handleConfigurationChange(
    event: vscode.ConfigurationChangeEvent,
    bootstrapped: ReturnType<typeof bootstrapChatPanel>,
  ): void {
    if (!event.affectsConfiguration("gemma-code")) return;
    this._settingsCache = null;
    if (event.affectsConfiguration("gemma-code.memoryCorroborationThreshold")) {
      const threshold = this._getSettings().memoryCorroborationThreshold;
      bootstrapped.memoryConsolidator?.setCorroborationThreshold(threshold);
      bootstrapped.unifiedRetriever?.setCorroborationThreshold(threshold);
    }
    if (event.affectsConfiguration("gemma-code.operationLog.enabled")) {
      this._operationLog?.setEnabled(this._getSettings().operationLogEnabled);
    }
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._host.attachView(webviewView);
  }

  /**
   * Update the hardware tier configuration after async GPU detection completes.
   * Rebuilds the system prompt with tier info and configures budget middleware.
   */
  updateTierConfig(tierConfig: HardwareTierConfig): void {
    this._tierConfig = tierConfig;
    const prompt = this._promptBuilder.build(this._toolActivation.buildPromptContext());
    this._manager.rebuildSystemPrompt(prompt);
    const budget = createSessionBudget(tierConfig.id, tierConfig.contextWindow);
    this._agentLoop.setBudgetMiddleware(new BudgetMiddleware(budget));
  }

  /** Update Ollama reachability state and rebuild the system prompt accordingly. */
  async setOllamaReachable(reachable: boolean): Promise<void> {
    if (this._ollamaReachable === reachable) return;
    this._ollamaReachable = reachable;
    const prompt = this._promptBuilder.build(this._toolActivation.buildPromptContext());
    this._manager.rebuildSystemPrompt(prompt);
  }

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

  /** Post a status update to the webview (visible even before the first message). */
  postStatus(state: "idle" | "streaming" | "thinking"): void {
    this._host.postMessage({ type: "status", state });
  }

  /** Post an error banner to the webview. */
  postError(message: string): void {
    this._host.postMessage({ type: "error", text: message });
  }

  /** Clear the chat and start a fresh session (callable from commands). */
  clearChat(): void {
    this._manager.clearHistory();
    this._planMode.resetPlan();
    this._resetSessionScopedToolState();
    this._statusReporter.postHistory();
    this._statusReporter.postTokenCount();
  }

  private _resetSessionScopedToolState(): void {
    const webSearch = this._registry.get("web_search") as unknown as
      | { resetSession?: () => void }
      | undefined;
    if (webSearch && typeof webSearch.resetSession === "function") {
      webSearch.resetSession();
    }
  }

  /** Attach this panel's logic to an editor-area WebviewPanel. */
  attachToWebviewPanel(panel: vscode.WebviewPanel): void {
    this._host.attachEditorPanel(panel);
  }

  /** Get the underlying ChatHistoryStore (for session list panel). */
  getStore(): ChatHistoryStore | null {
    return this._store;
  }

  /** Expose the persistent tool-output cache for the trace dashboard. */
  getToolOutputCache(): ToolOutputCache | null {
    return this._toolOutputCache;
  }

  /** Expose the API-response cache for the trace dashboard. */
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
    this._statusReporter.postHistory();
    this._statusReporter.postTokenCount();
  }

  // Legacy webview-message hook retained for callers that simulate a message
  // bus directly (e.g. integration tests). Routes through the new dispatcher.
  private async _handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    await this._messageRouter.handle(message);
  }

  dispose(): void {
    this._manager.dispose();
    this._skillLoaderStop();
    this._store?.close();
    // MemoryStore, EpisodicMemory, and GraphMemory share a single Database
    // owned by MemorySubsystem. One close() is sufficient.
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
