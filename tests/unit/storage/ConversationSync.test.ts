import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ConversationSync } from "../../../src/storage/ConversationSync.js";
import type { Message } from "../../../src/chat/types.js";

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    role: "user",
    content: "Hello world",
    timestamp: 1000,
    ...overrides,
  };
}

describe("ConversationSync", () => {
  let tmpDir: string;
  let sync: ConversationSync;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "conv-sync-"));
    sync = new ConversationSync(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------

  describe("syncMessage()", () => {
    it("creates directory and appends a JSONL line", () => {
      const subDir = path.join(tmpDir, "sub");
      const subSync = new ConversationSync(subDir);

      subSync.syncMessage("session-1", makeMessage());

      const filePath = path.join(subDir, "session-1.jsonl");
      expect(fs.existsSync(filePath)).toBe(true);

      const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]!);
      expect(parsed).toEqual({
        id: "msg-1",
        role: "user",
        content: "Hello world",
        timestamp: 1000,
      });
    });

    it("appends multiple messages to the same file", () => {
      sync.syncMessage("session-1", makeMessage({ id: "m1", content: "first" }));
      sync.syncMessage("session-1", makeMessage({ id: "m2", content: "second" }));

      const filePath = path.join(tmpDir, "session-1.jsonl");
      const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!).content).toBe("first");
      expect(JSON.parse(lines[1]!).content).toBe("second");
    });

    it("writes messages from different sessions to separate files", () => {
      sync.syncMessage("s1", makeMessage({ id: "m1" }));
      sync.syncMessage("s2", makeMessage({ id: "m2" }));

      expect(fs.existsSync(path.join(tmpDir, "s1.jsonl"))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, "s2.jsonl"))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------

  describe("syncSession()", () => {
    it("overwrites the file with all messages", () => {
      // Seed the file with an existing message.
      sync.syncMessage("session-1", makeMessage({ id: "old" }));

      const messages: Message[] = [
        makeMessage({ id: "new-1", content: "alpha" }),
        makeMessage({ id: "new-2", content: "beta" }),
      ];

      sync.syncSession("session-1", messages);

      const filePath = path.join(tmpDir, "session-1.jsonl");
      const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!).id).toBe("new-1");
      expect(JSON.parse(lines[1]!).id).toBe("new-2");
    });

    it("creates the file if it does not exist", () => {
      sync.syncSession("new-session", [makeMessage()]);

      const filePath = path.join(tmpDir, "new-session.jsonl");
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------

  describe("deleteSession()", () => {
    it("removes the JSONL file", () => {
      sync.syncMessage("session-1", makeMessage());
      const filePath = path.join(tmpDir, "session-1.jsonl");
      expect(fs.existsSync(filePath)).toBe(true);

      sync.deleteSession("session-1");
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it("is a no-op when the file does not exist", () => {
      // Should not throw.
      sync.deleteSession("nonexistent");
    });
  });

  // -------------------------------------------------------------------------

  describe("getSessionPath()", () => {
    it("returns the correct file path", () => {
      const expected = path.join(tmpDir, "abc-123.jsonl");
      expect(sync.getSessionPath("abc-123")).toBe(expected);
    });
  });

  // -------------------------------------------------------------------------

  describe("listSyncedSessions()", () => {
    it("returns session IDs from JSONL filenames", () => {
      sync.syncMessage("alpha", makeMessage());
      sync.syncMessage("beta", makeMessage());

      const sessions = sync.listSyncedSessions();
      expect(sessions).toContain("alpha");
      expect(sessions).toContain("beta");
      expect(sessions).toHaveLength(2);
    });

    it("returns an empty array when the directory does not exist", () => {
      const emptySync = new ConversationSync(path.join(tmpDir, "nope"));
      expect(emptySync.listSyncedSessions()).toEqual([]);
    });

    it("ignores non-JSONL files", () => {
      sync.syncMessage("valid", makeMessage());
      fs.writeFileSync(path.join(tmpDir, "notes.txt"), "not a session");

      const sessions = sync.listSyncedSessions();
      expect(sessions).toEqual(["valid"]);
    });
  });
});
