/**
 * v1.15.0 Phase 7 (Issue 6) -- activation resilience.
 *
 * Regression guard for the reported failure: clicking the Nexus icon reported
 * `command 'nexus.coding.newChat' not found` and the Chat / Memory / Traces
 * views loaded forever, because `activate()` threw (the engine graph eagerly
 * loads the `better-sqlite3` native module) BEFORE those commands and webview
 * providers were registered.
 *
 * These tests force the engine branch to throw and assert the extension still
 * exposes every declared command id and view id.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";

vi.mock("../../modules/coding/llm/OllamaClient.js", () => ({
  createOllamaClient: vi.fn(() => ({
    checkHealth: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([]),
    streamChat: vi.fn(),
  })),
}));

vi.mock("../../modules/coding/config/settings.js", () => ({
  getSettings: vi.fn(() => ({
    ollamaUrl: "http://localhost:11434",
    modelName: "gemma4:e4b",
    maxTokens: 8192,
    temperature: 0.2,
    requestTimeout: 60000,
    memoryEnabled: false,
    mcpEnabled: false,
    mcpServerMode: "off",
    verificationEnabled: false,
    autoDetectGpu: false,
    gpuTierOverride: null,
  })),
  onSettingsChange: vi.fn(() => ({ dispose: vi.fn() })),
}));

// Force the in-process engine branch to fail the way a broken native module
// (Electron ABI mismatch) does in the field.
vi.mock("../../src/activation/extensionOnly.js", () => ({
  activateExtensionOnly: vi.fn(() => {
    throw new Error("better_sqlite3.node: NODE_MODULE_VERSION mismatch");
  }),
  stopOllamaPoller: vi.fn(),
}));

const { activate } = await import("../../src/extension.js");
const { DECLARED_COMMAND_IDS, DECLARED_VIEW_IDS } = await import(
  "../../src/activation/safeMode.js"
);

function makeContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    extensionUri: {} as vscode.Uri,
    extensionPath: "",
    globalState: {} as vscode.Memento & { setKeysForSync: () => void },
    workspaceState: {} as vscode.Memento,
    secrets: {} as vscode.SecretStorage,
    storageUri: undefined,
    storagePath: undefined,
    globalStorageUri: { fsPath: "/tmp/nexus-test-storage" } as vscode.Uri,
    globalStoragePath: "/tmp/nexus-test-storage",
    logUri: { fsPath: "/tmp/nexus-test-log" } as vscode.Uri,
    logPath: "/tmp/nexus-test-log",
    extensionMode: 1,
    environmentVariableCollection: {} as vscode.GlobalEnvironmentVariableCollection,
    asAbsolutePath: vi.fn((p: string) => p),
    extension: {} as vscode.Extension<unknown>,
    languageModelAccessInformation: {} as vscode.LanguageModelAccessInformation,
  };
}

function registeredCommandIds(): string[] {
  return (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
    (call: unknown[]) => call[0] as string,
  );
}

function registeredViewIds(): string[] {
  return (
    vscode.window.registerWebviewViewProvider as ReturnType<typeof vi.fn>
  ).mock.calls.map((call: unknown[]) => call[0] as string);
}

describe("activation resilience (Issue 6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not throw out of activate() when the engine branch fails", () => {
    expect(() => activate(makeContext())).not.toThrow();
  });

  it("still registers nexus.coding.newChat when the engine branch fails", async () => {
    activate(makeContext());
    await Promise.resolve();
    await Promise.resolve();
    expect(registeredCommandIds()).toContain("nexus.coding.newChat");
  });

  it("still registers every declared command id", async () => {
    activate(makeContext());
    await Promise.resolve();
    await Promise.resolve();
    const ids = registeredCommandIds();
    for (const id of DECLARED_COMMAND_IDS) {
      expect(ids).toContain(id);
    }
  });

  it("still registers a provider for all three sidebar views (no forever-loading)", async () => {
    activate(makeContext());
    await Promise.resolve();
    await Promise.resolve();
    const views = registeredViewIds();
    for (const id of DECLARED_VIEW_IDS) {
      expect(views).toContain(id);
    }
  });

  it("keeps the extension's declared surface and safe-mode lists in sync", () => {
    // The safety net is only complete if it knows about every declared id.
    expect(DECLARED_COMMAND_IDS).toContain("nexus.coding.newChat");
    expect(DECLARED_VIEW_IDS).toEqual([
      "nexus.coding.chatView",
      "nexus.coding.memoryPanel",
      "nexus.coding.traceDashboard",
    ]);
  });
});
