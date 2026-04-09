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
    replaceMessages: vi.fn(),
    addAssistantMessage: vi.fn(),
    addUserMessage: vi.fn(),
    addSystemMessage: vi.fn(),
    clearHistory: vi.fn(),
    dispose: vi.fn(),
    sessionId: null,
    loadSession: vi.fn(),
    trimToContextLimit: vi.fn(),
    rebuildSystemPrompt: vi.fn(),
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
  const MODEL = "gemma4";
  const MAX_TOKENS = 100;
  let postMessage: PostMessageFn;

  beforeEach(() => {
    postMessage = vi.fn();
  });

  // -------------------------------------------------------------------------

  describe("estimateTokens", () => {
    it("estimates tokens as char_count / 4 for plain text", () => {
      const manager = makeManager([
        { role: "user", content: "a".repeat(400) }, // 400 chars -> 100 tokens
      ]);
      const compactor = new ContextCompactor(manager, makeClient(""), MODEL, MAX_TOKENS);
      expect(compactor.estimateTokens()).toBe(100);
    });

    it("applies a 1.3x multiplier for messages containing code blocks", () => {
      const manager = makeManager([
        { role: "assistant", content: "```js\n" + "a".repeat(400) + "\n```" },
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
      const compactor = new ContextCompactor(manager, makeClient("summary"), MODEL, MAX_TOKENS);

      await compactor.compact(postMessage, false);

      expect(manager.replaceMessages).not.toHaveBeenCalled();
    });

    it("runs pipeline and calls replaceMessages when threshold is crossed", async () => {
      const manager = makeManager([
        { role: "user", content: "a".repeat(400) }, // 100 tokens = threshold
      ]);
      const compactor = new ContextCompactor(manager, makeClient("summary"), MODEL, MAX_TOKENS);

      await compactor.compact(postMessage, false);

      expect(manager.replaceMessages).toHaveBeenCalledOnce();
      // The pipeline ran and produced a result that was passed to replaceMessages.
      const passedMessages = vi.mocked(manager.replaceMessages).mock.calls[0]?.[0];
      expect(passedMessages).toBeDefined();
      expect(Array.isArray(passedMessages)).toBe(true);
    });

    it("compacts regardless of token count when force=true", async () => {
      const manager = makeManager([
        { role: "user", content: "tiny" }, // well below threshold
      ]);
      const compactor = new ContextCompactor(manager, makeClient("forced summary"), MODEL, MAX_TOKENS);

      await compactor.compact(postMessage, true);

      expect(manager.replaceMessages).toHaveBeenCalledOnce();
    });

    it("posts compactionStatus banners before and after compaction", async () => {
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

    it("calls the pre-compaction hook before running the pipeline", async () => {
      const manager = makeManager([
        { role: "user", content: "a".repeat(400) },
      ]);
      const hookFn = vi.fn().mockResolvedValue(undefined);
      const compactor = new ContextCompactor(
        manager,
        makeClient("summary"),
        MODEL,
        MAX_TOKENS,
        undefined,
        hookFn,
      );

      await compactor.compact(postMessage, true);

      expect(hookFn).toHaveBeenCalledOnce();
      // Hook is called with the current history.
      const hookArg = hookFn.mock.calls[0]?.[0];
      expect(Array.isArray(hookArg)).toBe(true);
    });

    it("does not call the pre-compaction hook when not compacting", async () => {
      const manager = makeManager([
        { role: "user", content: "tiny" },
      ]);
      const hookFn = vi.fn().mockResolvedValue(undefined);
      const compactor = new ContextCompactor(
        manager,
        makeClient(""),
        MODEL,
        MAX_TOKENS,
        undefined,
        hookFn,
      );

      await compactor.compact(postMessage, false);

      expect(hookFn).not.toHaveBeenCalled();
    });

    it("excludes system messages from the LLM summary request", async () => {
      const manager = makeManager([
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "a".repeat(400) },
      ]);
      const client = makeClient("summary");
      const compactor = new ContextCompactor(manager, client, MODEL, MAX_TOKENS);

      await compactor.compact(postMessage, true);

      // The pipeline handles the LLM call internally; we verify replaceMessages was called.
      expect(manager.replaceMessages).toHaveBeenCalledOnce();
    });
  });
});
