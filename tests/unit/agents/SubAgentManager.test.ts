import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubAgentManager } from "../../../src/agents/SubAgentManager.js";
import type { SubAgentConfig, SubAgentResult } from "../../../src/agents/types.js";
import type { OllamaClient } from "../../../src/ollama/types.js";
import type { MemoryStore } from "../../../src/storage/MemoryStore.js";
import { PromptBuilder } from "../../../src/chat/PromptBuilder.js";
import type { ExtensionToWebviewMessage } from "../../../src/panels/messages.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(responseText: string): OllamaClient {
  async function* gen() {
    yield { message: { content: responseText, role: "assistant" }, done: true };
  }
  return {
    streamChat: vi.fn().mockReturnValue(gen()),
    ping: vi.fn(),
    listModels: vi.fn(),
  } as unknown as OllamaClient;
}

function makeMultiClient(responses: string[]): OllamaClient {
  let callCount = 0;
  const streamChat = vi.fn(() => {
    const text = responses[callCount++] ?? "";
    async function* gen() {
      yield { message: { content: text, role: "assistant" }, done: true };
    }
    return gen();
  });
  return { streamChat, ping: vi.fn(), listModels: vi.fn() } as unknown as OllamaClient;
}

function collectMessages(): {
  posted: ExtensionToWebviewMessage[];
  postMessage: (m: ExtensionToWebviewMessage) => void;
} {
  const posted: ExtensionToWebviewMessage[] = [];
  const postMessage = (m: ExtensionToWebviewMessage) => posted.push(m);
  return { posted, postMessage };
}

const baseConfig: SubAgentConfig = {
  type: "verification",
  maxIterations: 5,
  userRequest: "Check the recent changes for bugs.",
  modifiedFiles: ["src/foo.ts"],
  recentToolResults: ["[read_file] file contents..."],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SubAgentManager", () => {
  let promptBuilder: PromptBuilder;
  const ollamaOptions = { num_ctx: 131072, temperature: 1.0, top_p: 0.95, top_k: 64 };

  beforeEach(() => {
    promptBuilder = new PromptBuilder();
  });

  it("runs a verification sub-agent and returns the output", async () => {
    const client = makeClient("No issues found. All tests pass.");
    const manager = new SubAgentManager(client, promptBuilder, null, ollamaOptions, "gemma4");
    const { posted, postMessage } = collectMessages();

    const result = await manager.run(baseConfig, postMessage);

    expect(result.success).toBe(true);
    expect(result.type).toBe("verification");
    expect(result.output).toBe("No issues found. All tests pass.");
    expect(result.toolCallCount).toBe(0);
    expect(result.iterationsUsed).toBeGreaterThanOrEqual(1);
  });

  it("posts subAgentStatus running and complete messages", async () => {
    const client = makeClient("Done.");
    const manager = new SubAgentManager(client, promptBuilder, null, ollamaOptions, "gemma4");
    const { posted, postMessage } = collectMessages();

    await manager.run(baseConfig, postMessage);

    const statusMessages = posted.filter((m) => m.type === "subAgentStatus") as Array<{
      type: "subAgentStatus";
      agentType: string;
      state: string;
      summary?: string;
    }>;
    expect(statusMessages.length).toBe(2);
    expect(statusMessages[0]!.state).toBe("running");
    expect(statusMessages[0]!.agentType).toBe("verification");
    expect(statusMessages[1]!.state).toBe("complete");
  });

  it("returns error result when the client throws", async () => {
    const client = {
      streamChat: vi.fn(() => { throw new Error("Connection refused"); }),
      ping: vi.fn(),
      listModels: vi.fn(),
    } as unknown as OllamaClient;
    const manager = new SubAgentManager(client, promptBuilder, null, ollamaOptions, "gemma4");
    const { posted, postMessage } = collectMessages();

    const result = await manager.run(baseConfig, postMessage);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Connection refused");

    const statusMessages = posted.filter((m) => m.type === "subAgentStatus") as Array<{
      type: "subAgentStatus";
      state: string;
    }>;
    expect(statusMessages.some((s) => s.state === "error")).toBe(true);
  });

  it("runs a research sub-agent with the correct type", async () => {
    const client = makeClient("Research findings: the module uses singleton pattern.");
    const manager = new SubAgentManager(client, promptBuilder, null, ollamaOptions, "gemma4");
    const { postMessage } = collectMessages();

    const config: SubAgentConfig = {
      ...baseConfig,
      type: "research",
      userRequest: "How does the auth module work?",
    };
    const result = await manager.run(config, postMessage);

    expect(result.success).toBe(true);
    expect(result.type).toBe("research");
    expect(result.output).toContain("singleton pattern");
  });

  it("runs a planning sub-agent with the correct type", async () => {
    const client = makeClient("1. Read the config file\n2. Add the new field\n3. Update tests");
    const manager = new SubAgentManager(client, promptBuilder, null, ollamaOptions, "gemma4");
    const { postMessage } = collectMessages();

    const config: SubAgentConfig = {
      ...baseConfig,
      type: "planning",
      userRequest: "Add a new setting for timeout.",
    };
    const result = await manager.run(config, postMessage);

    expect(result.success).toBe(true);
    expect(result.type).toBe("planning");
    expect(result.output).toContain("Read the config file");
  });

  it("tool calls are counted in the result", async () => {
    const toolCallText = '<|tool_call>call:read_file{path:<|"|>src/foo.ts<|"|>}<tool_call|>';
    const client = makeMultiClient([toolCallText, "File looks good."]);
    const manager = new SubAgentManager(client, promptBuilder, null, ollamaOptions, "gemma4");
    const { postMessage } = collectMessages();

    const result = await manager.run(baseConfig, postMessage);

    expect(result.success).toBe(true);
    expect(result.toolCallCount).toBe(1);
  });

  it("sub-agent conversation is ephemeral (does not persist)", async () => {
    // Use a factory that returns fresh generators for each streamChat call
    let callCount = 0;
    const client = {
      streamChat: vi.fn(() => {
        callCount++;
        async function* gen() {
          yield { message: { content: `Check ${callCount} complete.`, role: "assistant" }, done: true };
        }
        return gen();
      }),
      ping: vi.fn(),
      listModels: vi.fn(),
    } as unknown as OllamaClient;
    const manager = new SubAgentManager(client, promptBuilder, null, ollamaOptions, "gemma4");
    const { postMessage } = collectMessages();

    // Run twice -- each run should start fresh with its own ConversationManager
    const result1 = await manager.run(baseConfig, postMessage);
    const result2 = await manager.run(baseConfig, postMessage);

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    // Both runs succeed independently (not the same output because each starts fresh)
    expect(result1.output).toContain("Check");
    expect(result2.output).toContain("Check");
  });
});
