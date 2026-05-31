import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";

// Mock the ollama client so the extension doesn't make real HTTP calls
vi.mock("../../modules/coding/llm/OllamaClient.js", () => ({
  createOllamaClient: vi.fn(() => ({
    checkHealth: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([]),
    streamChat: vi.fn().mockReturnValue(
      (async function* () {
        yield { message: { role: "assistant", content: "Hello" }, done: true };
      })()
    ),
  })),
}));

vi.mock("../../modules/coding/config/settings.js", () => ({
  getSettings: vi.fn(() => ({
    ollamaUrl: "http://localhost:11434",
    modelName: "gemma3:27b",
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

const { activate, deactivate } = await import("../../src/extension.js");

describe("activate()", () => {
  let context: vscode.ExtensionContext;

  beforeEach(() => {
    vi.clearAllMocks();

    context = {
      subscriptions: [],
      extensionUri: {} as vscode.Uri,
      extensionPath: "",
      globalState: {} as vscode.Memento & { setKeysForSync: () => void },
      workspaceState: {} as vscode.Memento,
      secrets: {} as vscode.SecretStorage,
      storageUri: undefined,
      storagePath: undefined,
      globalStorageUri: { fsPath: "/tmp/gemma-code-test-storage" } as vscode.Uri,
      globalStoragePath: "/tmp/gemma-code-test-storage",
      logUri: { fsPath: "/tmp/gemma-code-test-log" } as vscode.Uri,
      logPath: "/tmp/gemma-code-test-log",
      extensionMode: 1, // ExtensionMode.Production
      environmentVariableCollection: {} as vscode.GlobalEnvironmentVariableCollection,
      asAbsolutePath: vi.fn((p: string) => p),
      extension: {} as vscode.Extension<unknown>,
      languageModelAccessInformation: {} as vscode.LanguageModelAccessInformation,
    };
  });

  it("registers the nexus.coding.ping command in context.subscriptions", () => {
    activate(context);

    const registeredIds = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: unknown[]) => call[0]
    );

    expect(registeredIds).toContain("nexus.coding.ping");
  });

  it("registers every public command advertised in package.json", () => {
    activate(context);

    const registeredIds = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: unknown[]) => call[0] as string,
    );

    // These command ids are listed under contributes.commands in package.json
    // and must be registered during activate() or the palette entries break.
    for (const id of [
      "nexus.coding.ping",
      "nexus.coding.newChat",
      "nexus.coding.focusSidebar",
      "nexus.coding.openSession",
    ]) {
      expect(registeredIds).toContain(id);
    }
  });

  it("registers the legacy gemma-code.* command shims programmatically", () => {
    activate(context);

    const registeredIds = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: unknown[]) => call[0] as string,
    );

    // v1.1.0 Phase 2 rebrand: legacy IDs stay registered (not in the manifest)
    // so previously-bound user keybindings continue to fire the new handler.
    for (const legacyId of [
      "gemma-code.ping",
      "gemma-code.newChat",
      "gemma-code.focusSidebar",
      "gemma-code.openSession",
      "gemma-code.detectGpu",
      "gemma-code.hooks.editPlanModeHook",
    ]) {
      expect(registeredIds).toContain(legacyId);
    }
  });

  it("registers the chat and trace dashboard webview view providers", () => {
    activate(context);

    const providerIds = (vscode.window.registerWebviewViewProvider as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: unknown[]) => call[0] as string,
    );

    expect(providerIds).toContain("nexus.coding.chatView");
    expect(providerIds).toContain("nexus.coding.traceDashboard");
  });

  it("stores multiple disposables in context.subscriptions", () => {
    activate(context);

    // At minimum: ping command, webview providers (2), newChat, focusSidebar,
    // openSession, traces dispose, poller dispose.
    expect(context.subscriptions.length).toBeGreaterThanOrEqual(5);
  });
});

describe("deactivate()", () => {
  it("resolves without throwing", async () => {
    await expect(deactivate()).resolves.not.toThrow();
  });
});
