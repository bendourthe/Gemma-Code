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

  /**
   * v0.8.0 Phase 0.3 (closes v0.7.0 10.O.1) -- tracks the last
   * queued-message-field visibility we broadcast so we don't re-emit the same
   * toggle on every status update. The webview is the source of truth for
   * what's rendered; we just translate streaming-state transitions into the
   * swap signal.
   */
  private _queuedFieldVisible = false;

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
   *
   * v0.8.0 Phase 0.3 (closes v0.7.0 10.O.1): a `status` transition is
   * accompanied by a `renderQueuedMessageField` toggle so the webview replaces
   * the input row with the queued-message field on stream start, and restores
   * it on idle/cancel. The toggle is broadcast on the same surfaces as the
   * status itself (i.e., everywhere) so both sidebar and editor-panel mirrors
   * stay in sync; the swap is idempotent.
   */
  postMessage(msg: ExtensionToWebviewMessage): void {
    if (this._isStreamingMessage(msg)) {
      this._postToFocused(msg);
      return;
    }
    void this._editorPanel?.webview.postMessage(msg);
    void this._view?.webview.postMessage(msg);

    if (msg.type === "status") {
      this._maybeToggleQueuedField(msg.state);
    }
  }

  /**
   * Translate a status state into a queued-message-field visibility toggle.
   * `streaming` shows the field (replacing the input row); `idle` hides it
   * (restoring the input row). `thinking` is treated as an active stream so
   * the user can queue follow-up messages while the agent is composing. The
   * toggle is broadcast only when the visible state actually changes.
   */
  private _maybeToggleQueuedField(
    state: "idle" | "thinking" | "streaming",
  ): void {
    const nextVisible = state === "streaming" || state === "thinking";
    if (nextVisible === this._queuedFieldVisible) return;
    this._queuedFieldVisible = nextVisible;
    const toggle: ExtensionToWebviewMessage = {
      type: "renderQueuedMessageField",
      visible: nextVisible,
    };
    void this._editorPanel?.webview.postMessage(toggle);
    void this._view?.webview.postMessage(toggle);
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
