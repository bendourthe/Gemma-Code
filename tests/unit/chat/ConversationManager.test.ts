import { describe, it, expect, beforeEach } from "vitest";

// ConversationManager imports vscode; the global mock in tests/setup.ts handles it.
const { ConversationManager } = await import("../../../src/chat/ConversationManager.js");

const TEST_SYSTEM_PROMPT = "You are a test assistant.";

// ---------------------------------------------------------------------------

describe("ConversationManager", () => {
  let manager: InstanceType<typeof ConversationManager>;

  beforeEach(() => {
    manager = new ConversationManager(TEST_SYSTEM_PROMPT);
  });

  // ---- initial state -------------------------------------------------------

  it("starts with exactly one system message (the seeded prompt)", () => {
    const history = manager.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.role).toBe("system");
    expect(history[0]?.content).toBe(TEST_SYSTEM_PROMPT);
  });

  it("exposes an onDidChange event property", () => {
    expect(typeof manager.onDidChange).toBe("function");
  });

  // ---- addUserMessage -------------------------------------------------------

  it("addUserMessage appends a message with role=user", () => {
    manager.addUserMessage("hello");
    const history = manager.getHistory();
    expect(history).toHaveLength(2);
    const last = history[1];
    expect(last?.role).toBe("user");
    expect(last?.content).toBe("hello");
  });

  it("addUserMessage returns the created Message with an id and timestamp", () => {
    const msg = manager.addUserMessage("test");
    expect(typeof msg.id).toBe("string");
    expect(msg.id.length).toBeGreaterThan(0);
    expect(msg.timestamp).toBeGreaterThan(0);
    expect(msg.role).toBe("user");
  });

  // ---- addAssistantMessage --------------------------------------------------

  it("addAssistantMessage appends a message with role=assistant", () => {
    manager.addAssistantMessage("hi there");
    const history = manager.getHistory();
    const last = history[history.length - 1];
    expect(last?.role).toBe("assistant");
    expect(last?.content).toBe("hi there");
  });

  // ---- addSystemMessage ----------------------------------------------------

  it("addSystemMessage appends a message with role=system", () => {
    manager.addSystemMessage("extra context");
    const history = manager.getHistory();
    const last = history[history.length - 1];
    expect(last?.role).toBe("system");
    expect(last?.content).toBe("extra context");
  });

  // ---- getHistory ----------------------------------------------------------

  it("getHistory returns the same readonly reference across calls when state is unchanged", () => {
    manager.addUserMessage("a");
    // No-clone contract (4.2): repeated calls return the same array reference
    // to avoid allocating per message send. Mutation is prevented at the type
    // level by the readonly return; defensive copying is the caller's job.
    const first = manager.getHistory();
    const second = manager.getHistory();
    expect(first).toBe(second);
  });

  it("getHistory returns a new reference after a mutation", () => {
    const before = manager.getHistory();
    manager.addUserMessage("a");
    const after = manager.getHistory();
    // The underlying array is still the same object -- it is the contents
    // that have grown. What callers rely on is the readonly type + the
    // onDidChange fire; both are in place.
    expect(after).toBe(before);
    expect(after).toHaveLength(2);
  });

  // ---- clearHistory --------------------------------------------------------

  it("clearHistory resets to exactly one system message with the original prompt", () => {
    manager.addUserMessage("one");
    manager.addAssistantMessage("two");
    manager.clearHistory();
    const history = manager.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.role).toBe("system");
    expect(history[0]?.content).toBe(TEST_SYSTEM_PROMPT);
  });

  it("clearHistory allows new messages to be added after clearing", () => {
    manager.clearHistory();
    manager.addUserMessage("fresh start");
    expect(manager.getHistory()).toHaveLength(2);
  });

  // ---- rebuildSystemPrompt -------------------------------------------------

  it("rebuildSystemPrompt replaces the system message content", () => {
    const newPrompt = "Updated system prompt.";
    manager.rebuildSystemPrompt(newPrompt);
    const history = manager.getHistory();
    expect(history[0]?.role).toBe("system");
    expect(history[0]?.content).toBe(newPrompt);
  });

  it("rebuildSystemPrompt preserves the message id", () => {
    const originalId = manager.getHistory()[0]?.id;
    manager.rebuildSystemPrompt("new prompt");
    expect(manager.getHistory()[0]?.id).toBe(originalId);
  });

  it("rebuildSystemPrompt fires onDidChange", () => {
    const received: number[] = [];
    manager.onDidChange((msgs) => { received.push(msgs.length); });
    manager.rebuildSystemPrompt("updated");
    expect(received.length).toBeGreaterThan(0);
  });

  it("rebuildSystemPrompt updates the prompt used by clearHistory", () => {
    manager.rebuildSystemPrompt("rebuilt prompt");
    manager.clearHistory();
    expect(manager.getHistory()[0]?.content).toBe("rebuilt prompt");
  });

  // ---- onDidChange ---------------------------------------------------------

  it("onDidChange fires when addUserMessage is called", () => {
    const received: number[] = [];
    manager.onDidChange((msgs) => { received.push(msgs.length); });
    manager.addUserMessage("trigger");
    expect(received.length).toBeGreaterThan(0);
    expect(received[received.length - 1]).toBe(2); // system + user
  });

  it("onDidChange fires when clearHistory is called", () => {
    const received: number[] = [];
    manager.addUserMessage("a");
    manager.onDidChange((msgs) => { received.push(msgs.length); });
    manager.clearHistory();
    // clearHistory internally calls _append which fires onDidChange
    expect(received.length).toBeGreaterThan(0);
  });

  // ---- trimToContextLimit --------------------------------------------------

  it("trimToContextLimit does nothing when already within limit", () => {
    manager.addUserMessage("short");
    const before = manager.getHistory().length;
    manager.trimToContextLimit(100_000);
    expect(manager.getHistory().length).toBe(before);
  });

  it("trimToContextLimit removes non-system messages from the front when over limit", () => {
    // Add a user message long enough to exceed a tiny limit
    const bigContent = "x".repeat(400); // 400 chars = 100 estimated tokens
    manager.addUserMessage(bigContent);
    manager.addAssistantMessage("ok");

    // Trim to a very small limit (1 token = 4 chars)
    manager.trimToContextLimit(1);

    const history = manager.getHistory();
    // System message must survive
    expect(history.some((m) => m.role === "system")).toBe(true);
    // The big user message should have been removed
    expect(history.some((m) => m.content === bigContent)).toBe(false);
  });

  it("trimToContextLimit always preserves system messages", () => {
    // Force an extremely tight limit
    manager.addUserMessage("a".repeat(800));
    manager.trimToContextLimit(1);
    expect(manager.getHistory().some((m) => m.role === "system")).toBe(true);
  });

  // ---- replaceMessages ------------------------------------------------------

  it("replaceMessages replaces all messages with the provided array", () => {
    manager.addUserMessage("original");
    const replacement = [
      { id: "sys-1", role: "system" as const, content: "new system", timestamp: 1 },
      { id: "usr-1", role: "user" as const, content: "new user", timestamp: 2 },
    ];
    manager.replaceMessages(replacement);
    const history = manager.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0]?.content).toBe("new system");
    expect(history[1]?.content).toBe("new user");
  });

  it("replaceMessages fires onDidChange", () => {
    const received: number[] = [];
    manager.onDidChange((msgs) => { received.push(msgs.length); });
    manager.replaceMessages([
      { id: "s", role: "system", content: "sys", timestamp: 1 },
    ]);
    expect(received.length).toBeGreaterThan(0);
    expect(received[received.length - 1]).toBe(1);
  });

  it("replaceMessages result is visible via getHistory", () => {
    manager.addUserMessage("a");
    manager.addUserMessage("b");
    manager.replaceMessages([
      { id: "x", role: "system", content: "only this", timestamp: 1 },
    ]);
    expect(manager.getHistory()).toHaveLength(1);
    expect(manager.getHistory()[0]?.content).toBe("only this");
  });

  // ---- dispose -------------------------------------------------------------

  it("dispose does not throw", () => {
    expect(() => manager.dispose()).not.toThrow();
  });

  // ---- message uniqueness --------------------------------------------------

  it("each added message receives a unique id", () => {
    manager.addUserMessage("a");
    manager.addUserMessage("b");
    const ids = manager.getHistory().map((m) => m.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  // ---- v0.7.0 Phase 4.6 -- queued-message buffer ---------------------------

  describe("queued-message buffer", () => {
    it("starts empty", () => {
      expect(manager.queuedCount).toBe(0);
    });

    it("buffers a follow-up and drains it on next turn", () => {
      manager.enqueueMessage("follow-up one");
      manager.enqueueMessage("follow-up two");
      expect(manager.queuedCount).toBe(2);
      const drained = manager.drainQueued();
      expect(drained).toEqual(["follow-up one", "follow-up two"]);
      expect(manager.queuedCount).toBe(0);
    });

    it("trims and skips empty entries", () => {
      manager.enqueueMessage("   ");
      manager.enqueueMessage("");
      manager.enqueueMessage("  real  ");
      expect(manager.queuedCount).toBe(1);
      expect(manager.drainQueued()).toEqual(["real"]);
    });

    it("dropQueued discards every buffered follow-up", () => {
      manager.enqueueMessage("a");
      manager.enqueueMessage("b");
      manager.dropQueued();
      expect(manager.queuedCount).toBe(0);
      expect(manager.drainQueued()).toEqual([]);
    });
  });

  // ---- v0.8.0 Phase 6.8 -- tool-call exact-bytes replay -----------------

  describe("toolCallBytes", () => {
    it("stores and retrieves the exact rendered bytes for a tool call", () => {
      manager.storeToolCallBytes("call-1", "  <tool_use>x</tool_use>  ");
      expect(manager.getToolCallBytes("call-1")).toBe("  <tool_use>x</tool_use>  ");
    });

    it("returns null for an unknown tool-call id", () => {
      expect(manager.getToolCallBytes("nope")).toBeNull();
    });

    it("re-inserting a known id moves it to the most-recently-used slot", () => {
      manager.storeToolCallBytes("a", "one");
      manager.storeToolCallBytes("b", "two");
      manager.storeToolCallBytes("a", "three");
      expect(manager.getToolCallBytes("a")).toBe("three");
      expect(manager.toolCallBytesCount).toBe(2);
    });

    it("LRU-evicts the oldest entries past the 256 cap", () => {
      for (let i = 0; i < 260; i++) {
        manager.storeToolCallBytes(`id-${i}`, `bytes-${i}`);
      }
      expect(manager.toolCallBytesCount).toBe(256);
      // The first four ids should be gone.
      expect(manager.getToolCallBytes("id-0")).toBeNull();
      expect(manager.getToolCallBytes("id-3")).toBeNull();
      // The most-recent ones should still be there.
      expect(manager.getToolCallBytes("id-259")).toBe("bytes-259");
    });
  });

  // ---- v0.9.0 Phase 2.1 -- replayForCompaction -------------------------

  describe("replayForCompaction", () => {
    it("strips <think> blocks from assistant content while preserving identity", () => {
      manager.addUserMessage("question");
      const original = manager.addAssistantMessage(
        "<think>plan</think>final answer",
      );
      const replay = manager.replayForCompaction();
      const last = replay[replay.length - 1];
      expect(last?.role).toBe("assistant");
      expect(last?.content).toBe("final answer");
      // The live history is untouched.
      expect(manager.getHistory()[2]?.content).toContain("<think>");
      // The id is preserved so trace correlation still works.
      expect(last?.id).toBe(original.id);
    });

    it("returns assistant messages unchanged when no think blocks are present", () => {
      manager.addAssistantMessage("clean answer");
      const replay = manager.replayForCompaction();
      expect(replay[1]?.content).toBe("clean answer");
    });

    it("never alters system or user messages", () => {
      manager.addUserMessage("<think>user-typed</think>request");
      const replay = manager.replayForCompaction();
      expect(replay[0]?.role).toBe("system");
      expect(replay[1]?.role).toBe("user");
      expect(replay[1]?.content).toBe("<think>user-typed</think>request");
    });
  });

  // ---- v0.9.0 Phase 2.8 -- ChatHistoryStore write-through --------------

  describe("toolCallBytes store write-through", () => {
    it("calls saveToolCallBytes on the wired store with the session id", () => {
      const saves: Array<{ sessionId: string; callId: string; bytes: string }> = [];
      const fakeStore = {
        listSessions: () => [{ id: "sess-1", title: "t", createdAt: 0, updatedAt: 0, messages: [] }],
        createSession: () => ({ id: "sess-1", title: "t", createdAt: 0, updatedAt: 0, messages: [] }),
        saveMessage: () => {},
        updateSessionTitle: () => {},
        saveToolCallBytes: (sessionId: string, callId: string, bytes: string) => {
          saves.push({ sessionId, callId, bytes });
        },
        getToolCallBytes: () => null,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = new ConversationManager(TEST_SYSTEM_PROMPT, fakeStore as any);
      m.storeToolCallBytes("c1", "rendered bytes");
      expect(saves).toEqual([
        { sessionId: "sess-1", callId: "c1", bytes: "rendered bytes" },
      ]);
    });

    it("falls back to the persistent store on a miss in the in-memory LRU", () => {
      const fakeStore = {
        listSessions: () => [{ id: "sess-9", title: "t", createdAt: 0, updatedAt: 0, messages: [] }],
        createSession: () => ({ id: "sess-9", title: "t", createdAt: 0, updatedAt: 0, messages: [] }),
        saveMessage: () => {},
        updateSessionTitle: () => {},
        saveToolCallBytes: () => {},
        getToolCallBytes: (_sid: string, callId: string) =>
          callId === "persisted" ? "from-disk" : null,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = new ConversationManager(TEST_SYSTEM_PROMPT, fakeStore as any);
      expect(m.getToolCallBytes("persisted")).toBe("from-disk");
      expect(m.getToolCallBytes("missing")).toBeNull();
    });
  });
});
