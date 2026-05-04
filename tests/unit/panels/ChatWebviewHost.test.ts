import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";
import { mockOf } from "../../helpers/factories.js";

vi.mock("vscode", () => ({}));

vi.mock("../../../src/panels/webview/index.js", () => ({
  getWebviewHtml: (nonce: string, csp: string, name: string) =>
    `<html data-nonce="${nonce}" data-csp="${csp}" data-model="${name}"></html>`,
}));

const { ChatWebviewHost } = await import("../../../src/panels/ChatWebviewHost.js");

interface FakeWebview {
  options: vscode.WebviewOptions;
  html: string;
  cspSource: string;
  postMessage: ReturnType<typeof vi.fn>;
  onDidReceiveMessage: ReturnType<typeof vi.fn>;
  trigger: (raw: unknown) => void;
}

function makeFakeWebview(): FakeWebview {
  let listener: ((raw: unknown) => void) | null = null;
  const onDidReceiveMessage = vi.fn((handler: (raw: unknown) => void) => {
    listener = handler;
    return { dispose: vi.fn() };
  });
  return {
    options: {} as vscode.WebviewOptions,
    html: "",
    cspSource: "vscode-resource:",
    postMessage: vi.fn(),
    onDidReceiveMessage,
    trigger: (raw: unknown) => listener?.(raw),
  };
}

function makeFakeView(): {
  view: vscode.WebviewView;
  webview: FakeWebview;
} {
  const webview = makeFakeWebview();
  const view = mockOf<vscode.WebviewView>({
    webview: webview as unknown as vscode.Webview,
  });
  return { view, webview };
}

interface FakeEditorPanel {
  panel: vscode.WebviewPanel;
  webview: FakeWebview;
  triggerViewState: (active: boolean, visible: boolean) => void;
  triggerDispose: () => void;
}

function makeFakeEditorPanel(initialActive: boolean = true): FakeEditorPanel {
  const webview = makeFakeWebview();
  let viewStateHandler:
    | ((ev: vscode.WebviewPanelOnDidChangeViewStateEvent) => void)
    | null = null;
  let disposeHandler: (() => void) | null = null;

  const panel = mockOf<vscode.WebviewPanel>({
    webview: webview as unknown as vscode.Webview,
    active: initialActive,
    visible: initialActive,
    onDidChangeViewState: vi.fn((handler) => {
      viewStateHandler = handler;
      return { dispose: vi.fn() };
    }) as never,
    onDidDispose: vi.fn((handler: () => void) => {
      disposeHandler = handler;
      return { dispose: vi.fn() };
    }) as never,
  });

  return {
    panel,
    webview,
    triggerViewState(active: boolean, visible: boolean) {
      const ev = mockOf<vscode.WebviewPanelOnDidChangeViewStateEvent>({
        webviewPanel: mockOf<vscode.WebviewPanel>({ active, visible }),
      });
      viewStateHandler?.(ev);
    },
    triggerDispose() {
      disposeHandler?.();
    },
  };
}

describe("ChatWebviewHost", () => {
  let onMessage: ReturnType<typeof vi.fn>;
  let onRehydrate: ReturnType<typeof vi.fn>;
  let extensionUri: vscode.Uri;

  beforeEach(() => {
    onMessage = vi.fn();
    onRehydrate = vi.fn();
    extensionUri = mockOf<vscode.Uri>({ fsPath: "/ext", toString: () => "/ext" });
  });

  it("attachView writes scoped HTML, options, and forwards onDidReceiveMessage", () => {
    const { view, webview } = makeFakeView();
    const host = new ChatWebviewHost(extensionUri, onMessage, () => "gemma4:e4b", onRehydrate);
    host.attachView(view);

    expect(webview.html).toContain("data-model=\"gemma4:e4b\"");
    expect(webview.options.enableScripts).toBe(true);

    webview.trigger({ type: "ready" });
    expect(onMessage).toHaveBeenCalledWith({ type: "ready" });
  });

  it("postMessage broadcasts non-streaming messages to both surfaces", () => {
    const { view, webview: viewWebview } = makeFakeView();
    const editor = makeFakeEditorPanel(true);
    const host = new ChatWebviewHost(extensionUri, onMessage, () => "x", onRehydrate);

    host.attachView(view);
    host.attachEditorPanel(editor.panel);

    host.postMessage({ type: "status", state: "idle" });

    expect(viewWebview.postMessage).toHaveBeenCalledTimes(1);
    expect(editor.webview.postMessage).toHaveBeenCalledTimes(1);
  });

  it("streaming messages route to the focused editor panel only", () => {
    const { view, webview: viewWebview } = makeFakeView();
    const editor = makeFakeEditorPanel(true);
    const host = new ChatWebviewHost(extensionUri, onMessage, () => "x", onRehydrate);

    host.attachView(view);
    host.attachEditorPanel(editor.panel);

    host.postMessage({ type: "token", value: "hi" });

    expect(editor.webview.postMessage).toHaveBeenCalledTimes(1);
    expect(viewWebview.postMessage).not.toHaveBeenCalled();
  });

  it("streaming messages route to the sidebar when the editor panel loses focus", () => {
    const { view, webview: viewWebview } = makeFakeView();
    const editor = makeFakeEditorPanel(true);
    const host = new ChatWebviewHost(extensionUri, onMessage, () => "x", onRehydrate);

    host.attachView(view);
    host.attachEditorPanel(editor.panel);

    editor.triggerViewState(false, true);
    host.postMessage({ type: "messageComplete", messageId: "m1", renderedHtml: "" });

    expect(viewWebview.postMessage).toHaveBeenCalledTimes(1);
    expect(editor.webview.postMessage).not.toHaveBeenCalled();
  });

  it("re-show after hidden triggers the rehydrate callback", () => {
    const { view } = makeFakeView();
    const editor = makeFakeEditorPanel(true);
    const host = new ChatWebviewHost(extensionUri, onMessage, () => "x", onRehydrate);

    host.attachView(view);
    host.attachEditorPanel(editor.panel);

    editor.triggerViewState(false, false);
    editor.triggerViewState(true, true);

    expect(onRehydrate).toHaveBeenCalledTimes(1);
  });

  it("dispose detaches the editor panel state", () => {
    const { view } = makeFakeView();
    const editor = makeFakeEditorPanel(true);
    const host = new ChatWebviewHost(extensionUri, onMessage, () => "x", onRehydrate);

    host.attachView(view);
    host.attachEditorPanel(editor.panel);

    editor.triggerDispose();

    host.postMessage({ type: "token", value: "x" });
    expect(editor.webview.postMessage).not.toHaveBeenCalled();
  });

  it("posts to whichever surface is the only attached one", () => {
    const editor = makeFakeEditorPanel(true);
    const host = new ChatWebviewHost(extensionUri, onMessage, () => "x", onRehydrate);
    host.attachEditorPanel(editor.panel);

    host.postMessage({ type: "token", value: "hi" });

    expect(editor.webview.postMessage).toHaveBeenCalledTimes(1);
  });
});
