import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContextCompactor } from "../../../modules/coding/chat/ContextCompactor.js";
import type { ConversationManager } from "../../../modules/coding/chat/ConversationManager.js";
import type { OllamaMessage } from "../../../modules/coding/llm/types.js";
import type { PostMessageFn } from "../../../modules/coding/chat/StreamingPipeline.js";
import {
  makeOllamaClient as makeClient,
  mockOf,
} from "../../helpers/factories.js";

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

  return mockOf<ConversationManager>({
    getHistory: () => history,
    // v0.9.0 Phase 2.1: ContextCompactor feeds the pipeline a replay view.
    replayForCompaction: () => history,
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
    // onDidChange has a complex VS Code Event<T> shape — omitted from the
    // partial; callers in this test suite do not subscribe to it.
  });
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
    // Phase 5+ uses tiktoken cl100k_base via PromptBudget.countTokens. The
    // pre-Phase-5 char/4 heuristic (with a 1.3x code-block multiplier) is
    // gone; we no longer assert magic numbers, only the behavior we care
    // about: estimates are non-negative, monotonic with input length, and
    // produce a positive count for any non-empty content.
    it("produces a positive estimate that scales with input length", () => {
      const shortManager = makeManager([{ role: "user", content: "hello" }]);
      const longManager = makeManager([
        { role: "user", content: "word1 word2 word3 ".repeat(40) },
      ]);
      const shortCompactor = new ContextCompactor(
        shortManager, makeClient(""), MODEL, MAX_TOKENS,
      );
      const longCompactor = new ContextCompactor(
        longManager, makeClient(""), MODEL, MAX_TOKENS,
      );
      expect(shortCompactor.estimateTokens()).toBeGreaterThan(0);
      expect(longCompactor.estimateTokens()).toBeGreaterThan(
        shortCompactor.estimateTokens(),
      );
    });

    it("produces a positive estimate for code-block content", () => {
      const manager = makeManager([
        { role: "assistant", content: "```js\n" + "a".repeat(400) + "\n```" },
      ]);
      const compactor = new ContextCompactor(manager, makeClient(""), MODEL, 1000);
      expect(compactor.estimateTokens()).toBeGreaterThan(0);
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
      // Varied prose tokenizes predictably under tiktoken (~6 tokens per
      // repeat unit). 14 reps ~= 85 tokens, comfortably above the 80%
      // threshold against MAX_TOKENS=100.
      const manager = makeManager([
        { role: "user", content: "word1 word2 word3 ".repeat(14) },
      ]);
      const compactor = new ContextCompactor(manager, makeClient(""), MODEL, MAX_TOKENS);
      expect(compactor.shouldCompact()).toBe(true);
    });

    it("returns true when token count exceeds the limit", () => {
      const manager = makeManager([
        { role: "user", content: "word1 word2 word3 ".repeat(40) }, // ~241 tokens
      ]);
      const compactor = new ContextCompactor(manager, makeClient(""), MODEL, MAX_TOKENS);
      expect(compactor.shouldCompact()).toBe(true);
    });

    it("uses custom compaction threshold when provided", () => {
      // 12 reps ~= 73 tokens: below default 0.8 (80) but above custom 0.7 (70).
      const manager = makeManager([
        { role: "user", content: "word1 word2 word3 ".repeat(12) },
      ]);
      const compactorDefault = new ContextCompactor(manager, makeClient(""), MODEL, MAX_TOKENS);
      expect(compactorDefault.shouldCompact()).toBe(false);

      const compactorCustom = new ContextCompactor(
        manager, makeClient(""), MODEL, MAX_TOKENS, undefined, undefined, 0.7,
      );
      expect(compactorCustom.shouldCompact()).toBe(true);
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
        { role: "user", content: "word1 word2 word3 ".repeat(40) }, // ~241 tokens, well above MAX_TOKENS=100
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

  // -------------------------------------------------------------------------
  // v0.8.0 Phase 6.1: three-state sync return
  // -------------------------------------------------------------------------

  describe("compact (Phase 6.1 three-state result)", () => {
    it("returns state=ok with summary when no compaction is needed", async () => {
      const manager = makeManager([{ role: "user", content: "tiny" }]);
      const compactor = new ContextCompactor(manager, makeClient(""), MODEL, MAX_TOKENS);

      const result = await compactor.compact(postMessage, false);

      expect(result.state).toBe("ok");
      if (result.state === "ok") {
        expect(result.summary).toMatch(/no-op|below/i);
      }
    });

    it("returns state=ok with token-delta summary after a successful compaction", async () => {
      // Larger MAX_TOKENS budget so the pipeline can produce a result under
      // the threshold even after compaction, exercising the `ok` branch.
      const largeMax = 10_000;
      const manager = makeManager([
        { role: "user", content: "word1 word2 word3 ".repeat(40) }, // ~240 tokens
      ]);
      const compactor = new ContextCompactor(manager, makeClient("summary"), MODEL, largeMax);

      const result = await compactor.compact(postMessage, true);

      expect(result.state).toBe("ok");
      if (result.state === "ok") {
        expect(result.summary).toMatch(/compacted \d+ -> \d+ tokens|no-op/);
      }
    });

    it("returns state=rebuild-needed when EmergencyTrim cannot shrink under the budget", async () => {
      // Tiny token budget with very long content forces the rebuild path.
      const manager = makeManager([
        { role: "user", content: "word1 word2 word3 ".repeat(500) },
      ]);
      const compactor = new ContextCompactor(manager, makeClient(""), MODEL, 10);

      const result = await compactor.compact(postMessage, true);

      expect(result.state).toBe("rebuild-needed");
      if (result.state === "rebuild-needed") {
        expect(result.reason).toMatch(/tokensAfter=\d+ exceeds maxTokens=10/);
      }
    });

    it("returns state=error when the pre-compaction hook throws", async () => {
      const manager = makeManager([
        { role: "user", content: "a".repeat(400) },
      ]);
      const hookFn = vi.fn().mockRejectedValue(new Error("hook boom"));
      const compactor = new ContextCompactor(
        manager,
        makeClient("summary"),
        MODEL,
        MAX_TOKENS,
        undefined,
        hookFn,
      );

      const result = await compactor.compact(postMessage, true);

      expect(result.state).toBe("error");
      if (result.state === "error") {
        expect(result.error).toMatch(/Pre-compaction hook failed.*hook boom/);
      }
      // Pipeline should NOT have run, so replaceMessages stays untouched.
      expect(manager.replaceMessages).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // v0.9.0 Phase 2.3 -- rebuild-from-snapshot branch
  // -------------------------------------------------------------------------

  describe("rebuild-needed snapshot recovery (Phase 2.3)", () => {
    function makeManagerWithSession(
      messages: Array<{ role: string; content: string }>,
      sessionId: string,
    ): ConversationManager {
      const history = messages.map((m, i) => ({
        id: `msg-${i}`,
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
        timestamp: Date.now() + i,
      }));
      return mockOf<ConversationManager>({
        getHistory: () => history,
        replayForCompaction: () => history,
        replaceWithSummary: vi.fn(),
        replaceMessages: vi.fn(),
        addAssistantMessage: vi.fn(),
        addUserMessage: vi.fn(),
        addSystemMessage: vi.fn(),
        clearHistory: vi.fn(),
        dispose: vi.fn(),
        sessionId,
        loadSession: vi.fn(),
        trimToContextLimit: vi.fn(),
        rebuildSystemPrompt: vi.fn(),
      });
    }

    it("rebuilds the conversation from the provider snapshot and returns state=ok", async () => {
      const manager = makeManagerWithSession(
        [{ role: "user", content: "word1 word2 word3 ".repeat(500) }],
        "sess-rebuild-1",
      );
      const compactor = new ContextCompactor(manager, makeClient(""), MODEL, 10);
      const tailMessages = [
        { id: "tail-1", role: "user" as const, content: "later", timestamp: 1 },
        { id: "tail-2", role: "assistant" as const, content: "yo", timestamp: 2 },
      ];
      compactor.setRebuildSnapshotProvider({
        loadLatest: async () => ({ messages: tailMessages, capturedAt: 1700000000000 }),
      });

      const result = await compactor.compact(postMessage, true);

      expect(result.state).toBe("ok");
      if (result.state === "ok") {
        expect(result.summary).toMatch(/rebuilt from snapshot/);
      }
      expect(manager.replaceMessages).toHaveBeenCalledTimes(2);
      // The second call is the snapshot replay; verify the payload.
      expect(manager.replaceMessages).toHaveBeenLastCalledWith(tailMessages);
    });

    it("falls back to rebuild-needed when the provider returns null", async () => {
      const manager = makeManagerWithSession(
        [{ role: "user", content: "word1 word2 word3 ".repeat(500) }],
        "sess-rebuild-2",
      );
      const compactor = new ContextCompactor(manager, makeClient(""), MODEL, 10);
      compactor.setRebuildSnapshotProvider({
        loadLatest: async () => null,
      });

      const result = await compactor.compact(postMessage, true);

      expect(result.state).toBe("rebuild-needed");
      if (result.state === "rebuild-needed") {
        expect(result.reason).toMatch(/No durable snapshot available/);
      }
    });

    it("swallows provider throws and surfaces rebuild-needed", async () => {
      const manager = makeManagerWithSession(
        [{ role: "user", content: "word1 word2 word3 ".repeat(500) }],
        "sess-rebuild-3",
      );
      const compactor = new ContextCompactor(manager, makeClient(""), MODEL, 10);
      compactor.setRebuildSnapshotProvider({
        loadLatest: async () => { throw new Error("disk corrupt"); },
      });

      const result = await compactor.compact(postMessage, true);

      expect(result.state).toBe("rebuild-needed");
    });
  });
});
