import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";

// Mock the ollama client so the extension doesn't make real HTTP calls
vi.mock("../../src/ollama/client.js", () => ({
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

vi.mock("../../src/config/settings.js", () => ({
  getSettings: vi.fn(() => ({
    ollamaUrl: "http://localhost:11434",
    modelName: "gemma3:27b",
    maxTokens: 8192,
    temperature: 0.2,
    requestTimeout: 60000,
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
      globalStorageUri: {} as vscode.Uri,
      globalStoragePath: "",
      logUri: {} as vscode.Uri,
      logPath: "",
      extensionMode: 1, // ExtensionMode.Production
      environmentVariableCollection: {} as vscode.GlobalEnvironmentVariableCollection,
      asAbsolutePath: vi.fn((p: string) => p),
      extension: {} as vscode.Extension<unknown>,
      languageModelAccessInformation: {} as vscode.LanguageModelAccessInformation,
    };
  });

  it("registers the gemma-code.ping command in context.subscriptions", () => {
    activate(context);

    const registeredIds = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: unknown[]) => call[0]
    );

    expect(registeredIds).toContain("gemma-code.ping");
  });

  it("adds disposables to context.subscriptions", () => {
    activate(context);

    expect(context.subscriptions.length).toBeGreaterThan(0);
  });
});

describe("deactivate()", () => {
  it("does not throw", () => {
    expect(() => deactivate()).not.toThrow();
  });
});
