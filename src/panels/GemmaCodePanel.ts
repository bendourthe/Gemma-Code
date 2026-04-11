import * as path from "path";
import * as vscode from "vscode";
import { randomUUID } from "crypto";
import { ConversationManager } from "../chat/ConversationManager.js";
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
import { createOllamaClient } from "../ollama/client.js";
import { getSettings } from "../config/settings.js";
import { TOOL_CATALOG, toDynamicMetadata } from "../tools/ToolCatalog.js";
import type { DynamicToolMetadata } from "../tools/ToolCatalog.js";
import type { OllamaToolDefinition } from "../ollama/types.js";
import { computeToolActivation } from "../tools/ToolActivationRules.js";
import { McpManager } from "../mcp/McpManager.js";
import { McpServer } from "../mcp/McpServer.js";
import { PromptBuilder } from "../chat/PromptBuilder.js";
import type { PromptContext } from "../chat/PromptBuilder.types.js";
import { SkillLoader } from "../skills/SkillLoader.js";
import { CommandRouter } from "../commands/CommandRouter.js";
import { PlanMode, detectPlan } from "../modes/PlanMode.js";
import { ChatHistoryStore } from "../storage/ChatHistoryStore.js";
import { MemoryStore } from "../storage/MemoryStore.js";
import { EmbeddingClient } from "../storage/EmbeddingClient.js";
import { calculateBudget } from "../config/PromptBudget.js";
import { renderMarkdown } from "../utils/MarkdownRenderer.js";
import type { EditMode } from "../tools/types.js";
import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
} from "./messages.js";
import { getWebviewHtml } from "./webview/index.js";

export const VIEW_ID = "gemma-code.chatView";

export class GemmaCodePanel implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private readonly _manager: ConversationManager;
  private readonly _pipeline: StreamingPipeline;
  private readonly _confirmationGate: ConfirmationGate;
  private readonly _agentLoop: AgentLoop;
  private readonly _skillLoader: SkillLoader;
  private readonly _commandRouter: CommandRouter;
  private readonly _planMode: PlanMode;
  private readonly _promptBuilder: PromptBuilder;
  private readonly _store: ChatHistoryStore | null;
  private readonly _memoryStore: MemoryStore | null;
  private readonly _compactor: ContextCompactor;

  private _registry!: ToolRegistry;
  private _currentEditMode: EditMode;
  private _ollamaReachable = true;
  private _mcpTools: DynamicToolMetadata[] = [];
  private _mcpManager: McpManager | null = null;
  private _mcpServer: McpServer | null = null;
  private readonly _subAgentManager: SubAgentManager;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _globalStorageUri?: vscode.Uri
  ) {
    const settings = getSettings();
    this._currentEditMode = settings.editMode;

    // Initialise persistent chat history store.
    this._store = this._initStore();
    this._memoryStore = this._initMemoryStore();

    // PlanMode must be initialised before PromptBuilder uses it.
    this._planMode = new PlanMode();

    // Build the initial system prompt via PromptBuilder.
    this._promptBuilder = new PromptBuilder();
    const initialPrompt = this._promptBuilder.build(this._buildPromptContext());
    this._manager = new ConversationManager(initialPrompt, this._store ?? undefined);

    const client = createOllamaClient(settings.ollamaUrl);

    // postMessage is not available until resolveWebviewView; use a late-binding closure.
    const postRaw = (msg: ExtensionToWebviewMessage): void => {
      void this._view?.webview.postMessage(msg);
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

    this._registry = this._buildToolRegistry(settings.editMode, settings.toolConfirmationMode);

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
              console.warn("[MemoryStore] Pre-compaction extraction failed:", err);
            }
          }
        : undefined,
    );

    this._subAgentManager = new SubAgentManager(
      client,
      this._promptBuilder,
      this._memoryStore,
      ollamaOptions,
      settings.modelName,
    );

    this._agentLoop = new AgentLoop(
      client,
      this._manager,
      this._registry,
      settings.modelName,
      settings.maxAgentIterations,
      this._compactor,
      ollamaOptions,
      ollamaTools,
      {
        subAgentManager: this._subAgentManager,
        verificationThreshold: settings.verificationThreshold,
        verificationEnabled: settings.verificationEnabled,
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
      this._mcpManager = new McpManager(this._registry, workspacePath);
      void this._mcpManager.initialize().then(() => {
        this._mcpTools = this._mcpManager?.getAllToolMetadata() ?? [];
        const prompt = this._promptBuilder.build(this._buildPromptContext());
        this._manager.rebuildSystemPrompt(prompt);
      }).catch((err) => {
        console.warn("[McpManager] Initialization failed:", err);
      });
    }

    if (settings.mcpServerMode === "stdio") {
      this._mcpServer = new McpServer(this._registry, TOOL_CATALOG);
      void this._mcpServer.start().catch((err) => {
        console.warn("[McpServer] Failed to start:", err);
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

  private _buildToolRegistry(
    editMode: EditMode,
    confirmationMode: "always" | "ask" | "never"
  ): ToolRegistry {
    const registry = new ToolRegistry();
    const gate = this._confirmationGate;

    registry.register("read_file", new ReadFileTool());
    registry.register("write_file", new WriteFileTool(gate, editMode));
    registry.register("create_file", new CreateFileTool(gate, editMode));
    registry.register("delete_file", new DeleteFileTool());
    registry.register("edit_file", new EditFileTool(gate, editMode));
    registry.register("list_directory", new ListDirectoryTool());
    registry.register("grep_codebase", new GrepCodebaseTool());
    registry.register("run_terminal", new RunTerminalTool(gate, confirmationMode));
    registry.register("web_search", new WebSearchTool());
    registry.register("fetch_page", new FetchPageTool());

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
    const settings = getSettings();

    webviewView.webview.html = getWebviewHtml(nonce, cspSource, settings.modelName);

    webviewView.webview.onDidReceiveMessage((raw: unknown) => {
      void this._handleMessage(raw as WebviewToExtensionMessage);
    });
  }

  private async _handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        this._postHistory();
        void this._view?.webview.postMessage({
          type: "planModeToggled",
          active: this._planMode.active,
        });
        void this._view?.webview.postMessage({
          type: "editModeChanged",
          mode: this._currentEditMode,
        });
        this._postTokenCount();
        this._postMemoryStatus();
        this._postMcpStatus();
        this._postThinkingModeStatus();
        break;

      case "requestCommandList":
        void this._view?.webview.postMessage({
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
        this._handleSetEditMode(message.mode);
        break;
    }
  }

  private async _handleSendMessage(text: string): Promise<void> {
    const postMessage = (msg: ExtensionToWebviewMessage) =>
      void this._view?.webview.postMessage(msg);

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

    // Normal message.
    await this._injectMemoryContext(text);
    await this._pipeline.send(text, postWithRender);
    this._checkForPlan();
  }

  private async _handleBuiltinCommand(name: string, args: string): Promise<void> {
    const postMessage = (msg: ExtensionToWebviewMessage) =>
      void this._view?.webview.postMessage(msg);

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
        const settings = getSettings();
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
        const mcpSettings = getSettings();
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
              const errMsg = err instanceof Error ? err.message : String(err);
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
        const verifySettings = getSettings();
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
        const researchSettings = getSettings();
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
      void this._view?.webview.postMessage({ type: "planModeToggled", active: false });
      this._postHistory();
      this._postTokenCount();
    }
  }

  private _handleSetEditMode(mode: EditMode): void {
    this._currentEditMode = mode;
    vscode.workspace
      .getConfiguration("gemma-code")
      .update("editMode", mode, vscode.ConfigurationTarget.Global)
      .then(undefined, () => { /* ignore save errors */ });
    void this._view?.webview.postMessage({ type: "editModeChanged", mode });
  }

  private _checkForPlan(): void {
    if (!this._planMode.active) return;

    const history = this._manager.getHistory();
    const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return;

    const steps = detectPlan(lastAssistant.content);
    if (steps && steps.length >= 2) {
      this._planMode.setPlan(steps);
      void this._view?.webview.postMessage({ type: "planReady", steps });
    }
  }

  private async _handleApproveStep(stepIndex: number): Promise<void> {
    const postMessage = (msg: ExtensionToWebviewMessage) =>
      void this._view?.webview.postMessage(msg);
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
    const renderedHtmlMap: Record<string, string> = {};
    for (const msg of visible) {
      if (msg.role === "assistant") {
        renderedHtmlMap[msg.id] = renderMarkdown(msg.content);
      }
    }
    void this._view?.webview.postMessage({
      type: "history",
      messages: visible,
      renderedHtmlMap,
    });
  }

  private _postTokenCount(): void {
    const settings = getSettings();
    const count = this._compactor.estimateTokens();
    void this._view?.webview.postMessage({
      type: "tokenCount",
      count,
      limit: settings.maxTokens,
    });
  }

  private _postMemoryStatus(): void {
    const settings = getSettings();
    const entryCount = this._memoryStore?.getStats().totalEntries ?? 0;
    void this._view?.webview.postMessage({
      type: "memoryStatus",
      enabled: settings.memoryEnabled && this._memoryStore !== null,
      entryCount,
    });
  }

  private _postMcpStatus(): void {
    const settings = getSettings();
    if (!settings.mcpEnabled || !this._mcpManager) {
      void this._view?.webview.postMessage({
        type: "mcpStatus",
        enabled: false,
        connectedServerCount: 0,
        totalToolCount: 0,
      });
      return;
    }
    const states = this._mcpManager.getServerStates();
    const connectedCount = states.filter((s) => s.status === "connected").length;
    void this._view?.webview.postMessage({
      type: "mcpStatus",
      enabled: true,
      connectedServerCount: connectedCount,
      totalToolCount: this._mcpTools.length,
    });
  }

  private _postThinkingModeStatus(): void {
    const settings = getSettings();
    void this._view?.webview.postMessage({
      type: "thinkingModeStatus",
      active: settings.thinkingMode,
    });
  }

  private _buildPromptContext(memoryContext?: string): PromptContext {
    const settings = getSettings();
    return {
      modelName: settings.modelName,
      maxTokens: settings.maxTokens,
      planModeActive: this._planMode.active,
      thinkingMode: settings.thinkingMode,
      enabledTools: this._getEnabledToolMetadata(),
      promptStyle: settings.promptStyle,
      workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      systemPromptBudgetPercent: settings.systemPromptBudgetPercent,
      memoryContext,
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
  setOllamaReachable(reachable: boolean): void {
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
    if (!this._memoryStore) return;
    try {
      const budget = calculateBudget(getSettings().maxTokens);
      const memoryContext = await this._memoryStore.retrieve(queryText, budget.memoryBudget);
      if (memoryContext) {
        const prompt = this._promptBuilder.build(this._buildPromptContext(memoryContext));
        this._manager.rebuildSystemPrompt(prompt);
      }
    } catch {
      // Memory query failure is non-fatal; proceed without memory context.
    }
  }

  private _initMemoryStore(): MemoryStore | null {
    if (!this._globalStorageUri) return null;
    const settings = getSettings();
    if (!settings.memoryEnabled) return null;
    try {
      const dbPath = path.join(this._globalStorageUri.fsPath, "memory.db");
      const embedder = settings.embeddingModel
        ? new EmbeddingClient(settings.ollamaUrl, settings.embeddingModel, settings.requestTimeout)
        : null;
      return new MemoryStore(dbPath, embedder);
    } catch {
      return null;
    }
  }

  /** Post a status update to the webview (visible even before the first message). */
  postStatus(state: "idle" | "streaming" | "thinking"): void {
    void this._view?.webview.postMessage({ type: "status", state });
  }

  /** Post an error banner to the webview. */
  postError(message: string): void {
    void this._view?.webview.postMessage({ type: "error", text: message });
  }

  dispose(): void {
    this._manager.dispose();
    this._skillLoader.stopWatching();
    this._store?.close();
    this._memoryStore?.close();
    this._mcpManager?.dispose();
    void this._mcpServer?.stop();
  }
}
