import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";
import { SessionListPanel } from "../../../src/panels/SessionListPanel.js";
import { ChatHistoryStore } from "../../../src/storage/ChatHistoryStore.js";
import { mockOf } from "../../helpers/factories.js";

function makeMockWebview() {
  const postMessage = vi.fn();
  let messageListener: ((msg: unknown) => void) | null = null;

  const webview = {
    options: {} as vscode.WebviewOptions,
    html: "",
    cspSource: "vscode-resource:",
    postMessage,
    onDidReceiveMessage: vi.fn((handler: (msg: unknown) => void) => {
      messageListener = handler;
      return { dispose: vi.fn() };
    }),
    asWebviewUri: vi.fn((uri: vscode.Uri) => uri),
  };

  function triggerMessage(msg: unknown) {
    messageListener?.(msg);
  }

  return { webview, postMessage, triggerMessage };
}

function makeMockWebviewView() {
  const { webview, postMessage, triggerMessage } = makeMockWebview();
  const view: Partial<vscode.WebviewView> = {
    webview: mockOf<vscode.Webview>(webview),
    onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    show: vi.fn(),
    visible: true,
    viewType: "nexus.coding.chatView",
    title: "Sessions",
  };
  return { view: view as vscode.WebviewView, postMessage, triggerMessage };
}

const extensionUri = mockOf<vscode.Uri>({ fsPath: "/workspace/ext", scheme: "file" });
const cancellationToken = mockOf<vscode.CancellationToken>({
  isCancellationRequested: false,
  onCancellationRequested: vi.fn(),
});
const resolveContext = {} as vscode.WebviewViewResolveContext;

describe("SessionListPanel", () => {
  let store: ChatHistoryStore;

  beforeEach(() => {
    store = new ChatHistoryStore(":memory:");
  });

  it("renders HTML with the Sessions header and new-session button on resolve", () => {
    const panel = new SessionListPanel(extensionUri, store, vi.fn(), vi.fn());
    const { view } = makeMockWebviewView();

    panel.resolveWebviewView(view, resolveContext, cancellationToken);

    expect(view.webview.html).toContain("Sessions");
    expect(view.webview.html).toContain("new-chat-btn");
    expect(view.webview.html).toContain("empty-state");
    // CSP must be present.
    expect(view.webview.html).toMatch(/Content-Security-Policy/);
  });

  it("posts the session list to the webview on a 'ready' message", () => {
    const panel = new SessionListPanel(extensionUri, store, vi.fn(), vi.fn());
    const { view, postMessage, triggerMessage } = makeMockWebviewView();

    const session = store.createSession("My first chat");
    panel.resolveWebviewView(view, resolveContext, cancellationToken);

    triggerMessage({ type: "ready" });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "sessions",
        sessions: expect.arrayContaining([
          expect.objectContaining({ id: session.id, title: "My first chat" }),
        ]),
      }),
    );
  });

  it("invokes the newChat callback when the new-chat message arrives", () => {
    const onNewChat = vi.fn();
    const panel = new SessionListPanel(extensionUri, store, onNewChat, vi.fn());
    const { view, triggerMessage } = makeMockWebviewView();

    panel.resolveWebviewView(view, resolveContext, cancellationToken);
    triggerMessage({ type: "newChat" });

    expect(onNewChat).toHaveBeenCalledOnce();
  });

  it("invokes the onOpenSession callback with the clicked sessionId", () => {
    const onOpenSession = vi.fn();
    const panel = new SessionListPanel(extensionUri, store, vi.fn(), onOpenSession);
    const { view, triggerMessage } = makeMockWebviewView();

    panel.resolveWebviewView(view, resolveContext, cancellationToken);
    triggerMessage({ type: "openSession", sessionId: "abc-123" });

    expect(onOpenSession).toHaveBeenCalledWith("abc-123");
  });

  it("ignores openSession messages without a sessionId", () => {
    const onOpenSession = vi.fn();
    const panel = new SessionListPanel(extensionUri, store, vi.fn(), onOpenSession);
    const { view, triggerMessage } = makeMockWebviewView();

    panel.resolveWebviewView(view, resolveContext, cancellationToken);
    triggerMessage({ type: "openSession" });

    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it("handles a null store gracefully (no posted messages)", () => {
    const panel = new SessionListPanel(extensionUri, null, vi.fn(), vi.fn());
    const { view, postMessage, triggerMessage } = makeMockWebviewView();

    panel.resolveWebviewView(view, resolveContext, cancellationToken);
    triggerMessage({ type: "ready" });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("renders session ids via DOM-builder API rather than innerHTML concat", () => {
    // Phase 3 (v0.6.0): the webview template no longer concatenates session
    // ids into innerHTML. Session items are built with document.createElement
    // and `item.dataset.id = s.id`, which the DOM API escapes automatically.
    // This is the regression bar the Phase 3 ESLint rule was designed to keep.
    const panel = new SessionListPanel(extensionUri, store, vi.fn(), vi.fn());
    const { view } = makeMockWebviewView();
    panel.resolveWebviewView(view, resolveContext, cancellationToken);

    const html = view.webview.html;
    // The DOM-builder path is in use.
    expect(html).toContain("document.createElement");
    expect(html).toMatch(/item\.dataset\.id\s*=\s*s\.id/);
    // The fragile innerHTML-concat pattern is absent.
    expect(html).not.toMatch(/innerHTML\s*=\s*[^=]+\+/);
  });

  it("refreshSessions() is a no-op before resolveWebviewView is called", () => {
    const panel = new SessionListPanel(extensionUri, store, vi.fn(), vi.fn());
    // Should not throw.
    expect(() => panel.refreshSessions()).not.toThrow();
  });
});
