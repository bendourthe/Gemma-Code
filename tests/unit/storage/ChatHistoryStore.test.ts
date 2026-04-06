import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ChatHistoryStore } from "../../../src/storage/ChatHistoryStore.js";
import type { Message } from "../../../src/chat/types.js";

function makeMessage(role: "user" | "assistant" | "system", content: string): Message {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: Date.now(),
  };
}

describe("ChatHistoryStore", () => {
  let store: ChatHistoryStore;

  beforeEach(() => {
    // Use in-memory SQLite database for all tests.
    store = new ChatHistoryStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  // -------------------------------------------------------------------------

  describe("createSession", () => {
    it("creates a session with a generated id and timestamps", () => {
      const session = store.createSession("Test session");

      expect(session.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(session.title).toBe("Test session");
      expect(session.createdAt).toBeGreaterThan(0);
      expect(session.updatedAt).toBeGreaterThan(0);
      expect(session.messages).toEqual([]);
    });

    it("creates sessions with unique ids", () => {
      const a = store.createSession("A");
      const b = store.createSession("B");
      expect(a.id).not.toBe(b.id);
    });
  });

  // -------------------------------------------------------------------------

  describe("saveMessage", () => {
    it("persists a message linked to the session", () => {
      const session = store.createSession("Persist test");
      const msg = makeMessage("user", "hello world");

      store.saveMessage(session.id, msg);

      const loaded = store.getSession(session.id);
      expect(loaded).not.toBeNull();
      expect(loaded?.messages).toHaveLength(1);
      expect(loaded?.messages[0]?.content).toBe("hello world");
      expect(loaded?.messages[0]?.role).toBe("user");
    });

    it("updates session updated_at timestamp", async () => {
      const session = store.createSession("Timestamp test");
      const before = Date.now();
      await new Promise<void>((r) => setTimeout(r, 5));

      store.saveMessage(session.id, makeMessage("assistant", "response"));

      const loaded = store.getSession(session.id);
      expect(loaded?.updatedAt).toBeGreaterThanOrEqual(before);
    });
  });

  // -------------------------------------------------------------------------

  describe("getSession", () => {
    it("returns null for a non-existent session id", () => {
      const result = store.getSession("non-existent-id");
      expect(result).toBeNull();
    });

    it("retrieves session with messages in timestamp order", async () => {
      const session = store.createSession("Order test");

      const msg1 = { ...makeMessage("user", "first"), timestamp: 1000 };
      const msg2 = { ...makeMessage("assistant", "second"), timestamp: 2000 };
      const msg3 = { ...makeMessage("user", "third"), timestamp: 3000 };

      store.saveMessage(session.id, msg2); // inserted out-of-order
      store.saveMessage(session.id, msg1);
      store.saveMessage(session.id, msg3);

      const loaded = store.getSession(session.id);
      expect(loaded?.messages.map((m) => m.content)).toEqual([
        "first",
        "second",
        "third",
      ]);
    });
  });

  // -------------------------------------------------------------------------

  describe("listSessions", () => {
    it("returns sessions sorted by updated_at descending", async () => {
      const s1 = store.createSession("Oldest");
      await new Promise<void>((r) => setTimeout(r, 5));
      const s2 = store.createSession("Middle");
      await new Promise<void>((r) => setTimeout(r, 5));
      const s3 = store.createSession("Newest");

      const list = store.listSessions();
      const ids = list.map((s) => s.id);

      // Newest session should appear first.
      expect(ids.indexOf(s3.id)).toBeLessThan(ids.indexOf(s2.id));
      expect(ids.indexOf(s2.id)).toBeLessThan(ids.indexOf(s1.id));
    });

    it("respects the limit parameter", () => {
      for (let i = 0; i < 10; i++) {
        store.createSession(`Session ${i}`);
      }
      const list = store.listSessions(3);
      expect(list).toHaveLength(3);
    });

    it("returns an empty array when no sessions exist", () => {
      expect(store.listSessions()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------

  describe("deleteSession", () => {
    it("cascade-deletes associated messages", () => {
      const session = store.createSession("Delete test");
      store.saveMessage(session.id, makeMessage("user", "to be deleted"));

      store.deleteSession(session.id);

      expect(store.getSession(session.id)).toBeNull();
      // Also confirm the session is gone from the list.
      expect(store.listSessions().map((s) => s.id)).not.toContain(session.id);
    });

    it("does not throw when deleting a non-existent session", () => {
      expect(() => store.deleteSession("ghost-id")).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------

  describe("searchSessions", () => {
    it("returns sessions containing the query term in message content", () => {
      const s1 = store.createSession("React project");
      store.saveMessage(s1.id, makeMessage("user", "how do I use useState in React?"));

      const s2 = store.createSession("Node project");
      store.saveMessage(s2.id, makeMessage("user", "how do I use fs.readFile?"));

      const results = store.searchSessions("useState");
      const ids = results.map((s) => s.id);

      expect(ids).toContain(s1.id);
      expect(ids).not.toContain(s2.id);
    });

    it("returns an empty array when no messages match the query", () => {
      const s1 = store.createSession("Irrelevant session");
      store.saveMessage(s1.id, makeMessage("user", "tell me about Go interfaces"));

      expect(store.searchSessions("TypeScript generics")).toEqual([]);
    });

    it("is case-insensitive via SQL LIKE", () => {
      const session = store.createSession("Case test");
      store.saveMessage(session.id, makeMessage("user", "talk about TypeScript generics"));

      const results = store.searchSessions("typescript");
      expect(results.map((s) => s.id)).toContain(session.id);
    });
  });
});
