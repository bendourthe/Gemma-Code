import * as path from "path";
import * as vscode from "vscode";
import { randomUUID } from "crypto";
import { ConversationManager } from "../chat/ConversationManager.js";
import { StreamingPipeline } from "../chat/StreamingPipeline.js";
import { ContextCompactor } from "../chat/ContextCompactor.js";
import { AgentLoop } from "../tools/AgentLoop.js";
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
import { SkillLoader } from "../skills/SkillLoader.js";
import { CommandRouter } from "../commands/CommandRouter.js";
import { PlanMode, PLAN_MODE_SYSTEM_ADDENDUM, detectPlan } from "../modes/PlanMode.js";
import { ChatHistoryStore } from "../storage/ChatHistoryStore.js";
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
  private readonly _store: ChatHistoryStore | null;
  private readonly _compactor: ContextCompactor;

  private _currentEditMode: EditMode;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _globalStorageUri?: vscode.Uri
  ) {
    const settings = getSettings();
    this._currentEditMode = settings.editMode;

    // Initialise persistent chat history store.
    this._store = this._initStore();

    this._manager = new ConversationManager(this._store ?? undefined);

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

    const registry = this._buildToolRegistry(settings.editMode, settings.toolConfirmationMode);

    this._compactor = new ContextCompactor(
      this._manager,
      client,
      settings.modelName,
      settings.maxTokens
    );

    this._agentLoop = new AgentLoop(
      client,
      this._manager,
      registry,
      settings.modelName,
      settings.maxAgentIterations,
      this._compactor
    );

    this._pipeline = new StreamingPipeline(
      client,
      this._manager,
      settings.modelName,
      (pm) => this._agentLoop.run(pm)
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

    this._planMode = new PlanMode();
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

      await this._pipeline.send(combinedText, postWithRender);
      this._checkForPlan();
      return;
    }

    // Normal message.
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
        if (nowActive) {
          this._manager.addSystemMessage(PLAN_MODE_SYSTEM_ADDENDUM);
        } else {
          this._manager.addSystemMessage(
            "Plan mode is now OFF. Resume normal assistance without requiring a numbered plan."
          );
        }
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

  dispose(): void {
    this._manager.dispose();
    this._skillLoader.stopWatching();
    this._store?.close();
  }
}
