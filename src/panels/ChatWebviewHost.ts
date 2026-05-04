import * as vscode from "vscode";
import { randomUUID } from "crypto";
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from "./messages.js";
import { getWebviewHtml } from "./webview/index.js";

export type WebviewMessageHandler = (message: WebviewToExtensionMessage) => void | Promise<void>;

/**
 * Owns the VS Code webview surface(s) for the chat panel: the sidebar
 * `WebviewView` and an optional editor-area `WebviewPanel`. Encapsulates the
 * postMessage routing rules, the HTML/CSP scaffolding, and the focus tracking
 * that decides which surface receives streaming traffic.
 *
 * Streaming-family messages (`token`, `messageComplete`) are routed to the
 * focused surface to avoid duplicate rendering when both surfaces are
 * attached. Everything else is broadcast so both surfaces stay in sync.
 */
export class ChatWebviewHost {
  private _view: vscode.WebviewView | undefined;
  private _editorPanel: vscode.WebviewPanel | undefined;
  private _editorPanelActive = true;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _onMessage: WebviewMessageHandler,
    private readonly _getModelName: () => string,
    /**
     * Called after the editor panel becomes visible from a previously hidden
     * state. The chat surface uses this to re-post history because the
     * webview's JS state is discarded when `retainContextWhenHidden: false`.
     */
    private readonly _onEditorPanelRehydrate: () => void,
  ) {}

  /** Attach the sidebar `WebviewView` (called from `resolveWebviewView`). */
  attachView(view: vscode.WebviewView): void {
    this._view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };
    const nonce = randomUUID().replace(/-/g, "");
    const cspSource = view.webview.cspSource;
    view.webview.html = getWebviewHtml(nonce, cspSource, this._getModelName());

    view.webview.onDidReceiveMessage((raw: unknown) => {
      void this._onMessage(raw as WebviewToExtensionMessage);
    });
  }

  /** Attach an editor-area `WebviewPanel` (e.g. opened via the "Open Chat" command). */
  attachEditorPanel(panel: vscode.WebviewPanel): void {
    const nonce = randomUUID().replace(/-/g, "");
    const cspSource = panel.webview.cspSource;
    panel.webview.html = getWebviewHtml(nonce, cspSource, this._getModelName());

    panel.webview.onDidReceiveMessage((raw: unknown) => {
      void this._onMessage(raw as WebviewToExtensionMessage);
    });

    this._editorPanel = panel;
    this._editorPanelActive = panel.active;

    panel.onDidChangeViewState((ev) => {
      const wasHidden = !this._editorPanelActive;
      this._editorPanelActive = ev.webviewPanel.active;
      if (ev.webviewPanel.visible && wasHidden) {
        this._onEditorPanelRehydrate();
      }
    });

    panel.onDidDispose(() => {
      if (this._editorPanel === panel) {
        this._editorPanel = undefined;
        this._editorPanelActive = false;
      }
    });
  }

  /**
   * Post a message to the attached webview(s). Streaming-family messages go
   * to the focused surface only; everything else is broadcast.
   */
  postMessage(msg: ExtensionToWebviewMessage): void {
    if (this._isStreamingMessage(msg)) {
      this._postToFocused(msg);
      return;
    }
    void this._editorPanel?.webview.postMessage(msg);
    void this._view?.webview.postMessage(msg);
  }

  private _postToFocused(msg: ExtensionToWebviewMessage): void {
    const hasEditor = this._editorPanel !== undefined;
    const hasView = this._view !== undefined;
    if (!hasEditor) {
      void this._view?.webview.postMessage(msg);
      return;
    }
    if (!hasView) {
      void this._editorPanel?.webview.postMessage(msg);
      return;
    }
    if (this._editorPanelActive) {
      void this._editorPanel?.webview.postMessage(msg);
    } else {
      void this._view?.webview.postMessage(msg);
    }
  }

  /**
   * Streaming-family types: token deltas and the completion marker. All other
   * events (history, status, errors, tool I/O, config updates) are
   * low-frequency or critical and must reach every attached surface.
   */
  private _isStreamingMessage(msg: ExtensionToWebviewMessage): boolean {
    return msg.type === "token" || msg.type === "messageComplete";
  }
}
