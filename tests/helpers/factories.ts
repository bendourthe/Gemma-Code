import { vi } from "vitest";
import type {
  OllamaClient,
  OllamaChatChunk,
  OllamaModel,
} from "../../modules/coding/llm/types.js";
import type { ConversationManager } from "../../modules/coding/chat/ConversationManager.js";
import type { ToolRegistry } from "../../src/tools/ToolRegistry.js";
import type { ToolCall, ToolResult } from "../../src/tools/types.js";
import type { SubAgentManager } from "../../modules/coding/agents/SubAgentManager.js";
import type { SubAgentResult } from "../../modules/coding/agents/types.js";
import type { OrchestratorConfig } from "../../modules/coding/orchestration/Orchestrator.js";
import type { HardwareTierConfig } from "../../modules/coding/config/HardwareTier.types.js";
import { getTierConfig } from "../../modules/coding/config/HardwareTier.js";
import type { MemoryStore } from "../../src/storage/MemoryStore.js";
import type { TaskNode } from "../../modules/coding/orchestration/TaskDAG.js";
import type { ExtensionToWebviewMessage } from "../../src/panels/messages.js";

/**
 * Cast a Partial<T> to T for mock construction. Encapsulates the only
 * unsafe cast the test suite needs; prefer the typed factory functions
 * below whenever an interface is well-known.
 */
export function mockOf<T extends object>(partial: Partial<T>): T {
  return partial as unknown as T;
}

// Smoke-test classification helpers (see docs/archive/v0/v0.5/test-pyramid.md).
// `missing_env`: skip when required environment variables are absent.
// `upstream_unavailable`: skip when a configured upstream is unreachable.

export function skipIfMissingEnv(...keys: string[]): boolean {
  return keys.some((k) => !process.env[k] || process.env[k] === "");
}

export function skipIfNoOllama(): boolean {
  return skipIfMissingEnv("OLLAMA_URL");
}

export type ChatRole = "user" | "assistant" | "system";

export interface TestChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
}

export function makeMessage(
  id: string,
  role: ChatRole,
  content: string,
): TestChatMessage {
  return { id, role, content, timestamp: Date.now() };
}

/**
 * Build an OllamaClient whose streamChat yields `responseText` as one chunk.
 */
export function makeOllamaClient(responseText = ""): OllamaClient {
  async function* gen(): AsyncGenerator<OllamaChatChunk> {
    yield { message: { content: responseText, role: "assistant" }, done: true };
  }
  const client: OllamaClient = {
    checkHealth: vi.fn(async () => true),
    listModels: vi.fn(async (): Promise<OllamaModel[]> => []),
    streamChat: vi.fn().mockReturnValue(gen()),
  };
  return client;
}

/**
 * Build an OllamaClient whose streamChat yields one response per call, in order.
 * Exhausted responses fall back to the last item (or empty string if none).
 */
export function makeMultiResponseOllamaClient(responses: string[]): OllamaClient {
  let callCount = 0;
  const streamChat = vi.fn(() => {
    const text = responses[callCount++] ?? responses[responses.length - 1] ?? "";
    async function* gen(): AsyncGenerator<OllamaChatChunk> {
      yield { message: { content: text, role: "assistant" }, done: true };
    }
    return gen();
  });
  const client: OllamaClient = {
    checkHealth: vi.fn(async () => true),
    listModels: vi.fn(async (): Promise<OllamaModel[]> => []),
    streamChat,
  };
  return client;
}

/**
 * Build a ConversationManager mock that tracks messages in-memory.
 */
export function makeConversationManager(): ConversationManager {
  const messages: TestChatMessage[] = [
    makeMessage("sys", "system", "You are Gemma Code."),
  ];
  let counter = 0;
  const addMsg = (role: ChatRole, content: string): TestChatMessage => {
    const msg = makeMessage(String(++counter), role, content);
    messages.push(msg);
    return msg;
  };
  return mockOf<ConversationManager>({
    getHistory: vi.fn(() => [...messages]),
    addUserMessage: vi.fn((c: string) => addMsg("user", c)),
    addAssistantMessage: vi.fn((c: string) => addMsg("assistant", c)),
    addSystemMessage: vi.fn((c: string) => addMsg("system", c)),
  });
}

/**
 * Build a ToolRegistry mock whose execute() resolves with `result` (or a
 * successful default). `has()` returns true so registered tool lookups succeed.
 */
export function makeToolRegistry(result?: ToolResult): ToolRegistry {
  const defaultResult: ToolResult = {
    id: "call_001",
    success: true,
    output: JSON.stringify({ content: "file content", lines: 3 }),
  };
  return mockOf<ToolRegistry>({
    execute: vi.fn<[ToolCall], Promise<ToolResult>>().mockResolvedValue(
      result ?? defaultResult,
    ),
    register: vi.fn(),
    has: vi.fn(() => true),
  });
}

export interface SubAgentManagerOptions {
  success?: boolean;
  output?: string;
  error?: string;
  toolCallCount?: number;
  iterationsUsed?: number;
}

/**
 * Build a SubAgentManager mock whose run() resolves with a configurable
 * SubAgentResult. Defaults to a successful planning run.
 */
export function makeSubAgentManager(
  options: SubAgentManagerOptions = {},
): SubAgentManager {
  const {
    success = true,
    output = success ? "Task done" : "",
    error,
    toolCallCount = success ? 1 : 0,
    iterationsUsed = 1,
  } = options;
  const result: SubAgentResult = {
    type: "planning",
    success,
    output,
    toolCallCount,
    iterationsUsed,
    ...(error !== undefined ? { error } : {}),
  };
  return mockOf<SubAgentManager>({
    run: vi.fn().mockResolvedValue(result),
  });
}

export function makeTier1Profile(): HardwareTierConfig {
  return getTierConfig(1);
}

export interface MessageCollector {
  posted: ExtensionToWebviewMessage[];
  postMessage: (m: ExtensionToWebviewMessage) => void;
}

export function collectMessages(): MessageCollector {
  const posted: ExtensionToWebviewMessage[] = [];
  const postMessage = (m: ExtensionToWebviewMessage): void => {
    posted.push(m);
  };
  return { posted, postMessage };
}

/**
 * Build an OrchestratorConfig with sensible defaults; override any field.
 */
export function makeOrchestratorConfig(
  overrides: Partial<OrchestratorConfig> = {},
): OrchestratorConfig {
  const { postMessage } = collectMessages();
  return {
    client: makeOllamaClient(),
    modelName: "gemma4:e4b",
    ollamaOptions: { num_ctx: 131072 },
    subAgentManager: makeSubAgentManager({ success: true }),
    hardwareTier: makeTier1Profile(),
    memoryStore: null,
    postMessage,
    ...overrides,
  };
}

/**
 * Build a MemoryStore mock whose save() returns a minimal record and
 * search() returns an empty list. Override either via parameters.
 */
export function makeMemoryStore(options: {
  saveResult?: unknown;
  searchResult?: unknown;
} = {}): MemoryStore {
  const saveResult = options.saveResult ?? {
    id: "mem_1",
    content: "test",
    type: "error_resolution",
    createdAt: Date.now(),
  };
  const searchResult = options.searchResult ?? [];
  return mockOf<MemoryStore>({
    save: vi.fn().mockResolvedValue(saveResult),
    search: vi.fn().mockResolvedValue(searchResult),
  });
}

/**
 * Build a failed TaskNode useful for reflection/replan tests.
 */
export function makeFailedTaskNode(id: string): TaskNode {
  return {
    id,
    title: `Task ${id}`,
    description: `Description for task ${id}`,
    type: "code",
    dependencies: [],
    status: "failed",
    retryCount: 1,
    maxRetries: 2,
  };
}
