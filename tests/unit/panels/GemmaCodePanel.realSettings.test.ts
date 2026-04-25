/**
 * Companion to GemmaCodePanel.test.ts that exercises the panel with the
 * REAL [src/config/settings.ts] module instead of the mocked one. This
 * catches drift between the settings schema and the panel's consumption
 * (the main test file mocks getSettings for speed; this file validates
 * the integration path).
 *
 * Everything else (the "vscode" module) uses the global setup.ts stubs,
 * so this test exercises end-to-end: vscode.getConfiguration -> real
 * getSettings -> GemmaCodePanel._getSettings cache -> webview HTML.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";
import { mockGetConfiguration } from "../../setup.js";
import { mockOf } from "../../helpers/factories.js";

const { GemmaCodePanel, VIEW_ID } = await import("../../../src/panels/GemmaCodePanel.js");
const { GemmaRuntime } = await import("../../../src/runtime/GemmaRuntime.js");

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
    viewType: VIEW_ID,
    title: "Chat",
    description: undefined,
    badge: undefined,
  };
  return { view, postMessage, triggerMessage };
}

function makeExtensionUri() {
  return mockOf<vscode.Uri>({ fsPath: "/ext", toString: () => "/ext" });
}

/**
 * Configure the mock vscode.workspace.getConfiguration to return the given
 * value for the named key. All other keys resolve to their declared default.
 */
function setConfigValue<T>(targetKey: string, value: T): void {
  mockGetConfiguration.mockImplementation(() => ({
    get: vi.fn(<U>(key: string, defaultValue?: U): U | undefined => {
      if (key === targetKey) return value as unknown as U;
      return defaultValue;
    }),
  }));
}

describe("GemmaCodePanel with real settings module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the webview HTML using a custom modelName read via real getSettings", () => {
    setConfigValue("modelName", "custom-model:13b");

    const panel = new GemmaCodePanel(makeExtensionUri(), new GemmaRuntime());
    const { view } = makeMockWebviewView();
    panel.resolveWebviewView(
      view as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken,
    );

    expect(view.webview!.html).toContain("custom-model:13b");
  });

  it("falls back to the declared default when the custom key is absent", () => {
    // No overrides: every get() returns its declared default.
    mockGetConfiguration.mockImplementation(() => ({
      get: vi.fn(<U>(_key: string, defaultValue?: U): U | undefined => defaultValue),
    }));

    const panel = new GemmaCodePanel(makeExtensionUri(), new GemmaRuntime());
    const { view } = makeMockWebviewView();
    panel.resolveWebviewView(
      view as vscode.WebviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken,
    );

    // The default modelName in settings.ts is "gemma4:e4b".
    expect(view.webview!.html).toContain("gemma4:e4b");
  });

  it("reads getConfiguration with the gemma-code section", () => {
    setConfigValue("modelName", "probe-model");

    new GemmaCodePanel(makeExtensionUri(), new GemmaRuntime());

    expect(mockGetConfiguration).toHaveBeenCalledWith("gemma-code");
  });
});
