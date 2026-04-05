import * as vscode from "vscode";
import { randomUUID } from "crypto";
import { ConversationManager } from "../chat/ConversationManager.js";
import { StreamingPipeline } from "../chat/StreamingPipeline.js";
import { createOllamaClient } from "../ollama/client.js";
import { getSettings } from "../config/settings.js";
import type { WebviewToExtensionMessage } from "./messages.js";
import { getWebviewHtml } from "./webview/index.js";

export const VIEW_ID = "gemma-code.chatView";

export class GemmaCodePanel implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private readonly _manager: ConversationManager;
  private readonly _pipeline: StreamingPipeline;

  constructor(private readonly _extensionUri: vscode.Uri) {
    this._manager = new ConversationManager();
    const settings = getSettings();
    const client = createOllamaClient(settings.ollamaUrl);
    this._pipeline = new StreamingPipeline(client, this._manager, settings.modelName);
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
