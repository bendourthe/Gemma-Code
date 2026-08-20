import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";
import { mockOf } from "../../helpers/factories.js";

// ---------------------------------------------------------------------------
// Module mocks (must be defined before dynamic imports)
// ---------------------------------------------------------------------------

vi.mock("../../../modules/coding/llm/OllamaClient.js", () => ({
  createOllamaClient: vi.fn(() => ({
    checkHealth: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([]),
    streamChat: vi.fn(async function* () {
      yield { message: { role: "assistant", content: "hi" }, done: true };
    }),
  })),
}));

vi.mock("../../../modules/coding/config/settings.js", () => ({
  getSettings: vi.fn(() => ({
    ollamaUrl: "http://localhost:11434",
    modelName: "gemma4:e4b",
    maxTokens: 131072,
    temperature: 1.0,
    topP: 0.95,
    topK: 64,
    requestTimeout: 60000,
    toolConfirmationMode: "ask",
    maxAgentIterations: 20,
    editMode: "auto" as const,
    thinkingMode: true,
    promptStyle: "concise" as const,
    systemPromptBudgetPercent: 10,
    secretPathDenyExtra: [] as readonly string[],
    permissionOverrides: {} as Record<string, number>,
    compactionProtectedTools: [] as readonly string[],
    compactExperimentalMessageMode: false,
    gpuTierOverride: 2,
    mcpEnabled: false,
    mcpServerMode: "off" as const,
    mcpExposedTools: [] as readonly string[],
  })),
  onSettingsChange: vi.fn(() => ({ dispose: vi.fn() })),
}));

// ---------------------------------------------------------------------------

const { bootstrapChatPanel } = await import("../../../src/panels/ChatPanelBootstrap.js");
const { NexusCodingRuntime } = await import("../../../modules/coding/runtime/NexusCodingRuntime.js");

function makeHooks(overrides: Partial<Parameters<typeof bootstrapChatPanel>[0]["hooks"]> = {}) {
  return {
    getSettings: vi.fn(() =>
      // Pull a fresh snapshot every call so tests can mutate without disturbing
      // the cache used during bootstrap.
      ({
        ollamaUrl: "http://localhost:11434",
        modelName: "gemma4:e4b",
        maxTokens: 131072,
        temperature: 1.0,
        topP: 0.95,
        topK: 64,
        requestTimeout: 60000,
        toolConfirmationMode: "ask" as const,
        maxAgentIterations: 20,
        editMode: "auto" as const,
        thinkingMode: true,
        promptStyle: "concise" as const,
        systemPromptBudgetPercent: 10,
        secretPathDenyExtra: [] as readonly string[],
        permissionOverrides: {} as Record<string, number>,
        compactionProtectedTools: [] as readonly string[],
        compactExperimentalMessageMode: false,
        gpuTierOverride: 2,
        mcpEnabled: false,
        mcpServerMode: "off" as const,
        mcpExposedTools: [] as readonly string[],
      }) as never,
    ),
    invalidateSettingsCache: vi.fn(),
    getMcpTools: vi.fn(() => []),
    setMcpTools: vi.fn(),
    getCurrentEditMode: vi.fn(() => "auto" as const),
    setCurrentEditMode: vi.fn(),
    getOllamaReachable: vi.fn(() => true),
    getTierConfig: vi.fn(() => undefined),
    getOutputChannel: vi.fn(
      () => ({ appendLine: vi.fn(), append: vi.fn(), dispose: vi.fn() }) as unknown as vscode.OutputChannel,
    ),
    postRaw: vi.fn(),
    handleWebviewMessage: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("ChatPanelBootstrap todos wiring (v0.8.0 Phase 0.5 / closes v0.7.0 10.O.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers update_todos in the tool registry after bootstrap", () => {
    const runtime = new NexusCodingRuntime();
    const extensionUri = mockOf<vscode.Uri>({ fsPath: "/ext", toString: () => "/ext" });
    const hostPostMessage = vi.fn();

    const result = bootstrapChatPanel({
      extensionUri,
      runtime,
      hooks: makeHooks(),
      hostPostMessage,
    });

    expect(result.registry.has("update_todos")).toBe(true);
    expect(result.registry.getEnabledNames()).toContain("update_todos");
  });

  it("update_todos handler posts renderTodoUpdate to hostPostMessage when invoked", async () => {
    const runtime = new NexusCodingRuntime();
    const extensionUri = mockOf<vscode.Uri>({ fsPath: "/ext", toString: () => "/ext" });
    const hostPostMessage = vi.fn();

    const result = bootstrapChatPanel({
      extensionUri,
      runtime,
      hooks: makeHooks(),
      hostPostMessage,
    });

    const handler = result.registry.get("update_todos");
    expect(handler).toBeDefined();
    await handler!.execute({
      todos: [
        { content: "step A", activeForm: "doing A", status: "in_progress" },
        { content: "step B", activeForm: "doing B", status: "pending" },
      ],
    });

    const todoUpdateCall = hostPostMessage.mock.calls.find(
      (c) => (c[0] as { type: string }).type === "renderTodoUpdate",
    );
    expect(todoUpdateCall).toBeTruthy();
    const payload = todoUpdateCall![0] as { todos: unknown[] };
    expect(payload.todos).toHaveLength(2);
  });
});

describe("ChatPanelBootstrap parse_document wiring (v1.20.0 Phase 1)", () => {
  it("does not register parse_document when the flag is off", () => {
    const result = bootstrapChatPanel({
      extensionUri: mockOf<vscode.Uri>({ fsPath: "/ext", toString: () => "/ext" }),
      runtime: new NexusCodingRuntime(),
      hooks: makeHooks(),
      hostPostMessage: vi.fn(),
    });
    expect(result.registry.has("parse_document")).toBe(false);
  });

  it("registers parse_document when the flag is on", () => {
    const base = makeHooks();
    const snapshot = base.getSettings();
    const result = bootstrapChatPanel({
      extensionUri: mockOf<vscode.Uri>({ fsPath: "/ext", toString: () => "/ext" }),
      runtime: new NexusCodingRuntime(),
      hooks: makeHooks({
        getSettings: vi.fn(() => ({ ...snapshot, parseDocumentEnabled: true }) as never),
      }),
      hostPostMessage: vi.fn(),
    });
    expect(result.registry.has("parse_document")).toBe(true);
  });
});
