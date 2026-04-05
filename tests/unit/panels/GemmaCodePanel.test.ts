import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Module mocks (must be defined before dynamic imports)
// ---------------------------------------------------------------------------

vi.mock("../../../src/ollama/client.js", () => ({
  createOllamaClient: vi.fn(() => ({
    checkHealth: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([]),
    streamChat: vi.fn(async function* () {
      yield { message: { role: "assistant", content: "hi" }, done: true };
    }),
  })),
}));

vi.mock("../../../src/config/settings.js", () => ({
  getSettings: vi.fn(() => ({
    ollamaUrl: "http://localhost:11434",
    modelName: "gemma3:27b",
    maxTokens: 8192,
    temperature: 0.2,
    requestTimeout: 60000,
  })),
  onSettingsChange: vi.fn(() => ({ dispose: vi.fn() })),
}));

// ---------------------------------------------------------------------------

const { GemmaCodePanel, VIEW_ID } = await import("../../../src/panels/GemmaCodePanel.js");

// ---------------------------------------------------------------------------
// Mock webview helpers
// ---------------------------------------------------------------------------

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
    webview: webview as unknown as vscode.Webview,
    onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    show: vi.fn(),
    visible: true,
    viewType: VIEW_ID,
    title: "Chat",
    description: undefined,
    badge: undefined,
  };
  return { view, postMessage, triggerMessage };
}

function makeExtensionUri() {
  return { fsPath: "/ext", toString: () => "/ext" } as unknown as vscode.Uri;
}

// ---------------------------------------------------------------------------

describe("GemmaCodePanel", () => {
  let panel: InstanceType<typeof GemmaCodePanel>;

  beforeEach(() => {
    vi.clearAllMocks();
    panel = new GemmaCodePanel(makeExtensionUri());
  });

  // ---- VIEW_ID constant ----------------------------------------------------

  it("exports the correct VIEW_ID", () => {
    expect(VIEW_ID).toBe("gemma-code.chatView");
  });

  // ---- resolveWebviewView --------------------------------------------------

  it("resolveWebviewView sets webview.html to a non-empty string", () => {
    const { view } = makeMockWebviewView();
    panel.resolveWebviewView(
      view as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken
    );
    expect(view.webview!.html.length).toBeGreaterThan(0);
    expect(view.webview!.html).toContain("<!DOCTYPE html>");
  });

  it("resolveWebviewView enables scripts on the webview", () => {
    const { view } = makeMockWebviewView();
    panel.resolveWebviewView(
      view as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken
    );
    expect((view.webview!.options as vscode.WebviewOptions).enableScripts).toBe(true);
  });

  it("resolveWebviewView registers an onDidReceiveMessage listener", () => {
    const { view } = makeMockWebviewView();
    panel.resolveWebviewView(
      view as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken
    );
    expect(view.webview!.onDidReceiveMessage).toHaveBeenCalledOnce();
  });

  // ---- ready message -------------------------------------------------------

  it("posts history to the webview when it sends a 'ready' message", async () => {
    const { view, postMessage, triggerMessage } = makeMockWebviewView();
    panel.resolveWebviewView(
      view as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken
    );

    // Give any async work a tick to settle
    triggerMessage({ type: "ready" });
    await new Promise((r) => setTimeout(r, 0));

    const historyCall = postMessage.mock.calls.find(
      (c) => c[0]?.type === "history"
    );
    expect(historyCall).toBeTruthy();
    // System messages are filtered out before posting history
    const messages = (historyCall?.[0] as { messages: unknown[] })?.messages ?? [];
    expect(messages.every((m: unknown) => (m as { role: string }).role !== "system")).toBe(true);
  });

  // ---- sendMessage ---------------------------------------------------------

  it("posts messageComplete after processing a sendMessage request", async () => {
    const { view, postMessage, triggerMessage } = makeMockWebviewView();
    panel.resolveWebviewView(
      view as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken
    );

    triggerMessage({ type: "sendMessage", text: "hello" });
    // Wait for async pipeline to complete
    await new Promise((r) => setTimeout(r, 20));

    const completeCall = postMessage.mock.calls.find(
      (c) => c[0]?.type === "messageComplete"
    );
    expect(completeCall).toBeTruthy();
  });

  // ---- clearChat -----------------------------------------------------------

  it("posts history after clearChat", async () => {
    const { view, postMessage, triggerMessage } = makeMockWebviewView();
    panel.resolveWebviewView(
      view as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken
    );

    triggerMessage({ type: "clearChat" });
    await new Promise((r) => setTimeout(r, 0));

    const historyCalls = postMessage.mock.calls.filter(
      (c) => c[0]?.type === "history"
    );
    expect(historyCalls.length).toBeGreaterThan(0);
  });

  // ---- cancelStream --------------------------------------------------------

  it("does not throw when cancelStream is received", () => {
    const { view, triggerMessage } = makeMockWebviewView();
    panel.resolveWebviewView(
      view as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken
    );

    expect(() => triggerMessage({ type: "cancelStream" })).not.toThrow();
  });

  // ---- dispose -------------------------------------------------------------

  it("dispose does not throw", () => {
    expect(() => panel.dispose()).not.toThrow();
  });
});
