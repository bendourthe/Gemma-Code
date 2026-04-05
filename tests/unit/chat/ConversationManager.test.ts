import { describe, it, expect, beforeEach } from "vitest";

// ConversationManager imports vscode; the global mock in tests/setup.ts handles it.
const { ConversationManager } = await import("../../../src/chat/ConversationManager.js");

// ---------------------------------------------------------------------------

describe("ConversationManager", () => {
  let manager: InstanceType<typeof ConversationManager>;

  beforeEach(() => {
    manager = new ConversationManager();
  });

  // ---- initial state -------------------------------------------------------

  it("starts with exactly one system message (the seeded prompt)", () => {
    const history = manager.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.role).toBe("system");
    expect(history[0]?.content.length).toBeGreaterThan(0);
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
    expect(msg.id).toBeTruthy();
    expect(typeof msg.id).toBe("string");
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

  it("getHistory returns a defensive copy — mutating the result does not affect internal state", () => {
    manager.addUserMessage("a");
    const snapshot = manager.getHistory() as ReturnType<typeof manager.getHistory> extends readonly (infer E)[] ? E[] : never[];
    // Attempt to push to the snapshot
    (snapshot as unknown[]).push({ role: "user", content: "injected", id: "x", timestamp: 0 });
    expect(manager.getHistory()).toHaveLength(2); // still just system + user
  });

  // ---- clearHistory --------------------------------------------------------

  it("clearHistory resets to exactly one system message", () => {
    manager.addUserMessage("one");
    manager.addAssistantMessage("two");
    manager.clearHistory();
    const history = manager.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.role).toBe("system");
  });

  it("clearHistory allows new messages to be added after clearing", () => {
    manager.clearHistory();
    manager.addUserMessage("fresh start");
    expect(manager.getHistory()).toHaveLength(2);
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
    const bigContent = "x".repeat(400); // 400 chars ≈ 100 estimated tokens
    manager.addUserMessage(bigContent);
    manager.addAssistantMessage("ok");

    // Trim to a very small limit (1 token ≈ 4 chars)
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
});
