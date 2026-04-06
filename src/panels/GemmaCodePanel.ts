import * as path from "path";
import * as vscode from "vscode";
import { randomUUID } from "crypto";
import { ConversationManager } from "../chat/ConversationManager.js";
import { StreamingPipeline } from "../chat/StreamingPipeline.js";
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
import type { WebviewToExtensionMessage } from "./messages.js";
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

  constructor(private readonly _extensionUri: vscode.Uri) {
    this._manager = new ConversationManager();
    const settings = getSettings();
    const client = createOllamaClient(settings.ollamaUrl);

    // postMessage is not available until resolveWebviewView; use a late-binding closure.
    const postMessage = (msg: unknown): void => {
      void this._view?.webview.postMessage(msg);
    };

    this._confirmationGate = new ConfirmationGate(postMessage);

    const registry = this._buildToolRegistry(settings.toolConfirmationMode);

    this._agentLoop = new AgentLoop(
      client,
      this._manager,
      registry,
      settings.modelName,
      settings.maxAgentIterations
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

  private _buildToolRegistry(confirmationMode: "always" | "ask" | "never"): ToolRegistry {
    const registry = new ToolRegistry();
    const gate = this._confirmationGate;

    registry.register("read_file", new ReadFileTool());
    registry.register("write_file", new WriteFileTool());
    registry.register("create_file", new CreateFileTool());
    registry.register("delete_file", new DeleteFileTool());
    registry.register("edit_file", new EditFileTool(gate, confirmationMode));
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
        // Send plan mode state on init so badge reflects persisted state.
        void this._view?.webview.postMessage({
          type: "planModeToggled",
          active: this._planMode.active,
        });
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
    }
  }

  private async _handleSendMessage(text: string): Promise<void> {
    const postMessage = (msg: unknown) => void this._view?.webview.postMessage(msg);

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

      await this._pipeline.send(combinedText, (msg) => postMessage(msg));
      this._checkForPlan();
      return;
    }

    // Normal message.
    await this._pipeline.send(text, (msg) => postMessage(msg));
    this._checkForPlan();
  }

  private async _handleBuiltinCommand(
    name: string,
    args: string
  ): Promise<void> {
    const postMessage = (msg: unknown) => void this._view?.webview.postMessage(msg);

    switch (name) {
      case "help": {
        const descriptors = this._commandRouter.getAllDescriptors();
        const lines = descriptors.map(
          (d) =>
            `**/${d.name}**${d.argumentHint ? ` ${d.argumentHint}` : ""} — ${d.description}`
        );
        const helpText =
          "## Available Commands\n\n" + lines.join("\n");
        this._manager.addAssistantMessage(helpText);
        this._postHistory();
        break;
      }

      case "clear":
        this._manager.clearHistory();
        this._planMode.resetPlan();
        this._postHistory();
        break;

      case "history":
        this._manager.addAssistantMessage(
          "_Chat history persistence is coming in Phase 5. Stay tuned!_"
        );
        this._postHistory();
        break;

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
        this._manager.addAssistantMessage(
          nowActive
            ? "_Plan mode enabled. I will produce a numbered plan before taking any action._"
            : "_Plan mode disabled. Resuming normal mode._"
        );
        this._postHistory();
        break;
      }

      case "compact":
        this._manager.addAssistantMessage(
          "_Context compaction is coming in Phase 5. Stay tuned!_"
        );
        this._postHistory();
        break;

      case "model": {
        const settings = getSettings();
        const client = createOllamaClient(settings.ollamaUrl);
        const models = await client.listModels().catch(() => [] as string[]);

        if (models.length === 0) {
          postMessage({
            type: "error",
            text: "Could not reach Ollama to list models. Make sure `ollama serve` is running.",
          });
          return;
        }

        const selected = await vscode.window.showQuickPick(models, {
          placeHolder: args || "Select a model",
        });

        if (selected) {
          await vscode.workspace
            .getConfiguration("gemma-code")
            .update("modelName", selected, vscode.ConfigurationTarget.Global);
          this._manager.addAssistantMessage(`_Switched to model: **${selected}**_`);
          this._postHistory();
        }
        break;
      }
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
      void this._view?.webview.postMessage({ type: "planReady", steps });
    }
  }

  private async _handleApproveStep(stepIndex: number): Promise<void> {
    const postMessage = (msg: unknown) => void this._view?.webview.postMessage(msg);
    const { currentPlan } = this._planMode.state;
    const step = currentPlan[stepIndex];
    if (!step) return;

    this._planMode.approveStep(stepIndex);

    // Send a follow-up user message to tell the model to execute the approved step.
    const instruction = `Please proceed with step ${stepIndex + 1}: ${step.description}`;
    await this._pipeline.send(instruction, (msg) => postMessage(msg));
    this._planMode.markStepDone(stepIndex);
    this._checkForPlan();
  }

  private _postHistory(): void {
    const visible = this._manager.getHistory().filter((m) => m.role !== "system");
    void this._view?.webview.postMessage({ type: "history", messages: visible });
  }

  dispose(): void {
    this._manager.dispose();
    this._skillLoader.stopWatching();
  }
}
