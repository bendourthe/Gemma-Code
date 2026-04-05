import * as vscode from "vscode";
import { randomUUID } from "crypto";
import { ConversationManager } from "../chat/ConversationManager.js";
import { StreamingPipeline } from "../chat/StreamingPipeline.js";
import { AgentLoop } from "../tools/AgentLoop.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import { ConfirmationGate } from "../tools/ConfirmationGate.js";
import { ReadFileTool } from "../tools/handlers/filesystem.js";
import { WriteFileTool } from "../tools/handlers/filesystem.js";
import { CreateFileTool } from "../tools/handlers/filesystem.js";
import { DeleteFileTool } from "../tools/handlers/filesystem.js";
import { EditFileTool } from "../tools/handlers/filesystem.js";
import { ListDirectoryTool } from "../tools/handlers/filesystem.js";
import { GrepCodebaseTool } from "../tools/handlers/filesystem.js";
import { RunTerminalTool } from "../tools/handlers/terminal.js";
import { WebSearchTool, FetchPageTool } from "../tools/handlers/webSearch.js";
import { createOllamaClient } from "../ollama/client.js";
import { getSettings } from "../config/settings.js";
import type { WebviewToExtensionMessage } from "./messages.js";
import { getWebviewHtml } from "./webview/index.js";

export const VIEW_ID = "gemma-code.chatView";

export class GemmaCodePanel implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private readonly _manager: ConversationManager;
  private readonly _pipeline: StreamingPipeline;
  private readonly _confirmationGate: ConfirmationGate;
  private readonly _agentLoop: AgentLoop;

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
        break;

      case "sendMessage":
        await this._pipeline.send(message.text, (msg) => {
          void this._view?.webview.postMessage(msg);
        });
        break;

      case "clearChat":
        this._manager.clearHistory();
        this._postHistory();
        break;

      case "cancelStream":
        this._pipeline.cancel();
        this._agentLoop.cancel();
        break;

      case "confirmationResponse":
        this._confirmationGate.resolve(message.id, message.approved);
        break;
    }
  }

  private _postHistory(): void {
    const visible = this._manager.getHistory().filter((m) => m.role !== "system");
    void this._view?.webview.postMessage({ type: "history", messages: visible });
  }

  dispose(): void {
    this._manager.dispose();
  }
}
