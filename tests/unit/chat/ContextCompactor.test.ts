import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContextCompactor } from "../../../src/chat/ContextCompactor.js";
import type { ConversationManager } from "../../../src/chat/ConversationManager.js";
import type { OllamaClient, OllamaMessage, OllamaChatChunk } from "../../../src/ollama/types.js";
import type { PostMessageFn } from "../../../src/chat/StreamingPipeline.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManager(messages: Array<{ role: string; content: string }>): ConversationManager {
  const history = messages.map((m, i) => ({
    id: `msg-${i}`,
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
    timestamp: Date.now() + i,
  }));

  return {
    getHistory: () => history,
    replaceWithSummary: vi.fn(),
    addAssistantMessage: vi.fn(),
    addUserMessage: vi.fn(),
    addSystemMessage: vi.fn(),
    clearHistory: vi.fn(),
    dispose: vi.fn(),
    sessionId: null,
    loadSession: vi.fn(),
    trimToContextLimit: vi.fn(),
    onDidChange: { event: vi.fn(), fire: vi.fn(), dispose: vi.fn() },
  } as unknown as ConversationManager;
}

async function* singleChunkStream(text: string): AsyncGenerator<OllamaChatChunk> {
  yield { message: { role: "assistant", content: text }, done: true };
}

function makeClient(summaryText: string): OllamaClient {
  return {
    streamChat: vi.fn(() => singleChunkStream(summaryText)),
    checkHealth: vi.fn(),
    listModels: vi.fn(),
  } as unknown as OllamaClient;
}

// ---------------------------------------------------------------------------

describe("ContextCompactor", () => {
  const MODEL = "gemma3:27b";
  const MAX_TOKENS = 100;
  let postMessage: PostMessageFn;

  beforeEach(() => {
    postMessage = vi.fn();
  });

  // -------------------------------------------------------------------------

  describe("estimateTokens", () => {
    it("estimates tokens as char_count / 4 for plain text", () => {
      const manager = makeManager([
        { role: "user", content: "a".repeat(400) }, // 400 chars → 100 tokens
      ]);
      const compactor = new ContextCompactor(manager, makeClient(""), MODEL, MAX_TOKENS);
      expect(compactor.estimateTokens()).toBe(100);
    });

    it("applies a 1.3x multiplier for messages containing code blocks", () => {
      const manager = makeManager([
        { role: "assistant", content: "```js\n" + "a".repeat(400) + "\n```" }, // ~100+ tokens
      ]);
      const compactor = new ContextCompactor(manager, makeClient(""), MODEL, 1000);
      expect(compactor.estimateTokens()).toBeGreaterThan(100);
    });
  });

  // -------------------------------------------------------------------------

  describe("shouldCompact", () => {
    it("returns false when token count is below 80% of limit", () => {
      const manager = makeManager([
        { role: "user", content: "a".repeat(200) }, // 50 tokens = 50% of 100
      ]);
      const compactor = new ContextCompactor(manager, makeClient(""), MODEL, MAX_TOKENS);
      expect(compactor.shouldCompact()).toBe(false);
    });

    it("returns true when token count reaches 80% of limit", () => {
      const manager = makeManager([
        { role: "user", content: "a".repeat(320) }, // 80 tokens = 80% of 100
      ]);
      const compactor = new ContextCompactor(manager, makeClient(""), MODEL, MAX_TOKENS);
      expect(compactor.shouldCompact()).toBe(true);
    });

    it("returns true when token count exceeds the limit", () => {
      const manager = makeManager([
        { role: "user", content: "a".repeat(600) }, // 150 tokens > 100
      ]);
      const compactor = new ContextCompactor(manager, makeClient(""), MODEL, MAX_TOKENS);
      expect(compactor.shouldCompact()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------

  describe("compact", () => {
    it("does not compact when token count is below threshold and force=false", async () => {
      const manager = makeManager([
        { role: "user", content: "short message" },
      ]);
      const client = makeClient("summary");
      const compactor = new ContextCompactor(manager, client, MODEL, MAX_TOKENS);

      await compactor.compact(postMessage, false);

      expect(client.streamChat).not.toHaveBeenCalled();
      expect(manager.replaceWithSummary).not.toHaveBeenCalled();
    });

    it("compacts when token count crosses the threshold", async () => {
      const manager = makeManager([
        { role: "user", content: "a".repeat(400) }, // 100 tokens = threshold
      ]);
      const client = makeClient("This is the summary.");
      const compactor = new ContextCompactor(manager, client, MODEL, MAX_TOKENS);

      await compactor.compact(postMessage, false);

      expect(client.streamChat).toHaveBeenCalledOnce();
      expect(manager.replaceWithSummary).toHaveBeenCalledWith(
        "This is the summary.",
        4 // PRESERVED_MESSAGES constant
      );
    });

    it("compacts regardless of token count when force=true", async () => {
      const manager = makeManager([
        { role: "user", content: "tiny" }, // well below threshold
      ]);
      const client = makeClient("forced summary");
      const compactor = new ContextCompactor(manager, client, MODEL, MAX_TOKENS);

      await compactor.compact(postMessage, true);

      expect(client.streamChat).toHaveBeenCalledOnce();
      expect(manager.replaceWithSummary).toHaveBeenCalledWith("forced summary", 4);
    });

    it("posts a compactionStatus banner before and after compaction", async () => {
      const manager = makeManager([
        { role: "user", content: "a".repeat(400) },
      ]);
      const compactor = new ContextCompactor(manager, makeClient("s"), MODEL, MAX_TOKENS);

      await compactor.compact(postMessage, true);

      const calls = vi.mocked(postMessage).mock.calls.map((c) => c[0]);
      const statuses = calls
        .filter((m) => m.type === "compactionStatus")
        .map((m) => (m as { type: string; text: string }).text);

      expect(statuses[0]).toMatch(/compacting/i);
      expect(statuses[1]).toMatch(/compacted/i);
    });

    it("gracefully handles a stream error without modifying the conversation", async () => {
      const manager = makeManager([
        { role: "user", content: "a".repeat(400) },
      ]);
      const client = {
        streamChat: vi.fn().mockImplementation(async function* () {
          throw new Error("network error");
        }),
      } as unknown as OllamaClient;

      const compactor = new ContextCompactor(manager, client, MODEL, MAX_TOKENS);
      // Should not throw.
      await expect(compactor.compact(postMessage, true)).resolves.not.toThrow();
      expect(manager.replaceWithSummary).not.toHaveBeenCalled();
    });

    it("excludes system messages from the compaction summary request", async () => {
      const manager = makeManager([
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "a".repeat(400) },
      ]);
      const client = makeClient("summary");
      const compactor = new ContextCompactor(manager, client, MODEL, MAX_TOKENS);

      await compactor.compact(postMessage, true);

      const [request] = vi.mocked(client.streamChat).mock.calls[0] as [
        { messages: OllamaMessage[] },
      ];
      const roles = request.messages.map((m: OllamaMessage) => m.role);
      expect(roles).not.toContain("system");
    });
  });
});
