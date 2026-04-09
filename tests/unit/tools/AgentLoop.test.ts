import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentLoop } from "../../../src/tools/AgentLoop.js";
import type { ConversationManager } from "../../../src/chat/ConversationManager.js";
import type { ToolRegistry } from "../../../src/tools/ToolRegistry.js";
import type { OllamaClient } from "../../../src/ollama/types.js";
import type { ExtensionToWebviewMessage } from "../../../src/panels/messages.js";
import type { ToolCall, ToolResult } from "../../../src/tools/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(id: string, role: "user" | "assistant" | "system", content: string) {
  return { id, role, content, timestamp: Date.now() };
}

function makeManager(): ConversationManager {
  const messages = [makeMessage("sys", "system", "You are Gemma Code.")];
  let counter = 0;

  const addMsg = (role: "user" | "assistant" | "system", content: string) => {
    const msg = makeMessage(String(++counter), role, content);
    messages.push(msg);
    return msg;
  };

  return {
    getHistory: vi.fn(() => [...messages]),
    addUserMessage: vi.fn((c: string) => addMsg("user", c)),
    addAssistantMessage: vi.fn((c: string) => addMsg("assistant", c)),
    addSystemMessage: vi.fn((c: string) => addMsg("system", c)),
  } as unknown as ConversationManager;
}

function makeRegistry(result?: ToolResult): ToolRegistry {
  const defaultResult: ToolResult = {
    id: "call_001",
    success: true,
    output: JSON.stringify({ content: "file content", lines: 3 }),
  };
  return {
    execute: vi.fn<[ToolCall], Promise<ToolResult>>().mockResolvedValue(result ?? defaultResult),
    register: vi.fn(),
    has: vi.fn(() => true),
  } as unknown as ToolRegistry;
}

// Build a mock OllamaClient whose streamChat yields the given text as a single chunk.
function makeClient(responseText: string): OllamaClient {
  async function* gen() {
    yield { message: { content: responseText, role: "assistant" }, done: true };
  }
  return {
    streamChat: vi.fn().mockReturnValue(gen()),
    ping: vi.fn(),
  } as unknown as OllamaClient;
}

// Build a client that yields multiple responses in sequence (one per call).
function makeMultiClient(responses: string[]): OllamaClient {
  let callCount = 0;
  const streamChat = vi.fn(() => {
    const text = responses[callCount++] ?? "";
    async function* gen() {
      yield { message: { content: text, role: "assistant" }, done: true };
    }
    return gen();
  });
  return { streamChat, ping: vi.fn() } as unknown as OllamaClient;
}

function collectMessages(loop: AgentLoop): {
  posted: ExtensionToWebviewMessage[];
  postMessage: (m: ExtensionToWebviewMessage) => void;
} {
  const posted: ExtensionToWebviewMessage[] = [];
  const postMessage = (m: ExtensionToWebviewMessage) => posted.push(m);
  return { posted, postMessage };
}

const toolCallText = '<|tool_call>call:read_file{path:<|"|>src/extension.ts<|"|>}<tool_call|>';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentLoop", () => {
  let manager: ConversationManager;
  let registry: ToolRegistry;

  beforeEach(() => {
    manager = makeManager();
    registry = makeRegistry();
  });

  it("single turn with no tool call: posts tokens and messageComplete", async () => {
    const client = makeClient("Here is my answer.");
    const loop = new AgentLoop(client, manager, registry, "gemma3:27b");
    const { posted, postMessage } = collectMessages(loop);

    await loop.run(postMessage);

    expect(posted.some((m) => m.type === "token")).toBe(true);
    expect(posted.some((m) => m.type === "messageComplete")).toBe(true);
    expect(manager.addAssistantMessage).toHaveBeenCalledWith("Here is my answer.");
  });

  it("single tool call: executes tool and continues to final answer", async () => {
    const client = makeMultiClient([
      toolCallText,       // first turn: model emits a tool call
      "Done reading.",    // second turn: model gives final answer
    ]);
    const loop = new AgentLoop(client, manager, registry, "gemma3:27b");
    const { posted, postMessage } = collectMessages(loop);

    await loop.run(postMessage);

    expect(registry.execute).toHaveBeenCalledOnce();
    expect(posted.some((m) => m.type === "toolUse")).toBe(true);
    expect(posted.some((m) => m.type === "toolResult")).toBe(true);
    expect(posted.some((m) => m.type === "messageComplete")).toBe(true);
    // Tool result is injected as user message in Gemma 4 format
    expect(manager.addUserMessage).toHaveBeenCalledWith(expect.stringContaining("<|tool_result>"));
  });

  it("multi-turn: two consecutive tool calls then final answer", async () => {
    const toolCall2 = '<|tool_call>call:list_directory{path:<|"|>src<|"|>}<tool_call|>';
    const client = makeMultiClient([
      toolCallText,   // turn 1
      toolCall2,      // turn 2
      "All done.",    // turn 3 — final answer
    ]);
    const loop = new AgentLoop(client, manager, registry, "gemma3:27b");
    const { posted, postMessage } = collectMessages(loop);

    await loop.run(postMessage);

    expect(registry.execute).toHaveBeenCalledTimes(2);
    expect(posted.filter((m) => m.type === "toolUse")).toHaveLength(2);
    expect(posted.some((m) => m.type === "messageComplete")).toBe(true);
  });

  it("stops and posts an error when max iterations is reached", async () => {
    // Every response contains a tool call → loop never terminates naturally
    const client = makeMultiClient(Array(5).fill(toolCallText));
    const loop = new AgentLoop(client, manager, registry, "gemma3:27b", 3 /* maxIterations */);
    const { posted, postMessage } = collectMessages(loop);

    await loop.run(postMessage);

    const errorMsg = posted.find((m) => m.type === "error");
    expect(errorMsg).toBeDefined();
    expect((errorMsg as { type: "error"; text: string }).text).toMatch(/maximum/i);
    expect(posted.some((m) => m.type === "messageComplete")).toBe(false);
  });

  it("cancel() stops the loop before the next iteration", async () => {
    let callCount = 0;
    const streamChat = vi.fn((_req, signal: AbortSignal) => {
      callCount++;
      async function* gen() {
        yield { message: { content: toolCallText, role: "assistant" }, done: true };
        // Simulate detecting cancellation between iterations
      }
      return gen();
    });
    const client = { streamChat, ping: vi.fn() } as unknown as OllamaClient;
    const loop = new AgentLoop(client, manager, registry, "gemma3:27b");

    const { postMessage } = collectMessages(loop);

    // Cancel immediately — the loop should exit after at most one iteration
    loop.cancel();
    await loop.run(postMessage);

    // With immediate cancellation the loop exits right away
    expect(callCount).toBeLessThanOrEqual(1);
  });

  it("registry error is injected as a failed tool result and loop continues", async () => {
    const failingRegistry: ToolRegistry = {
      execute: vi.fn<[ToolCall], Promise<ToolResult>>().mockResolvedValueOnce({
        id: "call_001",
        success: false,
        output: "",
        error: "disk full",
      }),
      register: vi.fn(),
      has: vi.fn(() => true),
    } as unknown as ToolRegistry;

    const client = makeMultiClient([toolCallText, "Recovered."]);
    const loop = new AgentLoop(client, manager, failingRegistry, "gemma3:27b");
    const { posted, postMessage } = collectMessages(loop);

    await loop.run(postMessage);

    const toolResult = posted.find((m) => m.type === "toolResult") as
      | { type: "toolResult"; success: boolean }
      | undefined;
    expect(toolResult?.success).toBe(false);
    // Loop should still complete with a messageComplete
    expect(posted.some((m) => m.type === "messageComplete")).toBe(true);
  });

  it("toolUse and toolResult messages are posted before the next streaming turn", async () => {
    const client = makeMultiClient([toolCallText, "Final."]);
    const loop = new AgentLoop(client, manager, registry, "gemma3:27b");
    const { posted, postMessage } = collectMessages(loop);

    await loop.run(postMessage);

    const toolUseIdx = posted.findIndex((m) => m.type === "toolUse");
    const toolResultIdx = posted.findIndex((m) => m.type === "toolResult");
    const mcIdx = posted.findIndex((m) => m.type === "messageComplete");

    expect(toolUseIdx).toBeGreaterThanOrEqual(0);
    expect(toolResultIdx).toBeGreaterThan(toolUseIdx);
    expect(mcIdx).toBeGreaterThan(toolResultIdx);
  });
});
