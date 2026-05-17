/**
 * Unit tests for `ChatExplorerStore` (v1.0.0 Phase 4.1).
 *
 * Uses an in-memory SQLite database (`:memory:`) so the test suite does not
 * touch the filesystem. The integration test in
 * `tests/integration/chat/ChatExplorerStore.integration.test.ts` exercises a
 * real on-disk file to cover the migration / WAL journaling path.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ChatExplorerStore } from "../../../modules/chat/storage/ChatExplorerStore.js";

describe("ChatExplorerStore", () => {
  let store: ChatExplorerStore;

  beforeEach(() => {
    store = new ChatExplorerStore(":memory:");
  });

  describe("folder CRUD", () => {
    it("creates a folder and reads it back", () => {
      const folder = store.createFolder({ parentId: null, name: "Projects" });
      expect(folder.id).toBeDefined();
      expect(folder.parentId).toBeNull();
      expect(folder.name).toBe("Projects");
      const got = store.getFolder(folder.id);
      expect(got?.name).toBe("Projects");
    });

    it("rejects an empty folder name on create", () => {
      expect(() => store.createFolder({ parentId: null, name: "   " })).toThrow();
    });

    it("rejects an empty folder name on rename", () => {
      const folder = store.createFolder({ parentId: null, name: "x" });
      expect(() => store.renameFolder(folder.id, "  ")).toThrow();
    });

    it("rejects creating under a missing parent", () => {
      expect(() =>
        store.createFolder({ parentId: "00000000-0000-0000-0000-000000000000", name: "x" }),
      ).toThrow(/parent folder not found/);
    });

    it("trims folder names", () => {
      const folder = store.createFolder({ parentId: null, name: "  Work  " });
      expect(folder.name).toBe("Work");
    });

    it("renames a folder and updates updatedAt", async () => {
      const folder = store.createFolder({ parentId: null, name: "Work" });
      await new Promise((r) => setTimeout(r, 5));
      const renamed = store.renameFolder(folder.id, "Personal");
      expect(renamed.name).toBe("Personal");
      expect(renamed.updatedAt).toBeGreaterThanOrEqual(folder.updatedAt);
    });

    it("rejects renaming a missing folder", () => {
      expect(() => store.renameFolder("missing", "x")).toThrow(/folder not found/);
    });

    it("moves a folder under a new parent", () => {
      const a = store.createFolder({ parentId: null, name: "A" });
      const b = store.createFolder({ parentId: null, name: "B" });
      const moved = store.moveFolder(a.id, b.id);
      expect(moved.parentId).toBe(b.id);
    });

    it("moves a folder back to the root", () => {
      const a = store.createFolder({ parentId: null, name: "A" });
      const b = store.createFolder({ parentId: a.id, name: "B" });
      const moved = store.moveFolder(b.id, null);
      expect(moved.parentId).toBeNull();
    });

    it("refuses to move a folder into itself", () => {
      const a = store.createFolder({ parentId: null, name: "A" });
      expect(() => store.moveFolder(a.id, a.id)).toThrow(/itself/);
    });

    it("refuses to move a folder into its own descendant", () => {
      const a = store.createFolder({ parentId: null, name: "A" });
      const b = store.createFolder({ parentId: a.id, name: "B" });
      const c = store.createFolder({ parentId: b.id, name: "C" });
      expect(() => store.moveFolder(a.id, c.id)).toThrow(/descendant/);
    });

    it("rejects moving under a missing parent", () => {
      const a = store.createFolder({ parentId: null, name: "A" });
      expect(() => store.moveFolder(a.id, "missing")).toThrow(/new parent folder not found/);
    });

    it("rejects moving a missing folder", () => {
      expect(() => store.moveFolder("missing", null)).toThrow(/folder not found/);
    });

    it("cascades delete to child folders and chats", () => {
      const a = store.createFolder({ parentId: null, name: "A" });
      const b = store.createFolder({ parentId: a.id, name: "B" });
      const chat = store.createChat({ folderId: b.id, title: "hi", modelId: "m" });
      store.deleteFolder(a.id);
      expect(store.getFolder(a.id)).toBeNull();
      expect(store.getFolder(b.id)).toBeNull();
      expect(store.getChat(chat.id)).toBeNull();
    });

    it("deleteFolder is a no-op for missing ids", () => {
      expect(() => store.deleteFolder("missing")).not.toThrow();
    });
  });

  describe("chat CRUD", () => {
    it("creates a chat and derives the scope from the folder", () => {
      const folder = store.createFolder({ parentId: null, name: "Work" });
      const chat = store.createChat({
        folderId: folder.id,
        title: "Q3 roadmap",
        modelId: "gemma4:e4b",
      });
      expect(chat.title).toBe("Q3 roadmap");
      expect(chat.contextScopeId).toBe(folder.id);
      expect(chat.messageCount).toBe(0);
    });

    it("honours an explicit contextScopeId override", () => {
      const folder = store.createFolder({ parentId: null, name: "Work" });
      const chat = store.createChat({
        folderId: folder.id,
        title: "scoped",
        modelId: "m",
        contextScopeId: "custom-scope",
      });
      expect(chat.contextScopeId).toBe("custom-scope");
    });

    it("rejects empty title / modelId", () => {
      expect(() => store.createChat({ folderId: null, title: "  ", modelId: "m" })).toThrow();
      expect(() => store.createChat({ folderId: null, title: "t", modelId: "  " })).toThrow();
    });

    it("rejects creating under a missing folder", () => {
      expect(() => store.createChat({ folderId: "missing", title: "t", modelId: "m" })).toThrow(
        /folder not found/,
      );
    });

    it("renames a chat", () => {
      const chat = store.createChat({ folderId: null, title: "old", modelId: "m" });
      const renamed = store.renameChat(chat.id, "new");
      expect(renamed.title).toBe("new");
    });

    it("rejects renaming with an empty title", () => {
      const chat = store.createChat({ folderId: null, title: "old", modelId: "m" });
      expect(() => store.renameChat(chat.id, "  ")).toThrow();
    });

    it("rejects renaming a missing chat", () => {
      expect(() => store.renameChat("missing", "x")).toThrow(/chat not found/);
    });

    it("moves a chat into a different folder and retags the scope by default", () => {
      const a = store.createFolder({ parentId: null, name: "A" });
      const b = store.createFolder({ parentId: null, name: "B" });
      const chat = store.createChat({ folderId: a.id, title: "c", modelId: "m" });
      const moved = store.moveChat(chat.id, b.id);
      expect(moved.folderId).toBe(b.id);
      expect(moved.contextScopeId).toBe(b.id);
    });

    it("preserves the scope when retagScope is false", () => {
      const a = store.createFolder({ parentId: null, name: "A" });
      const b = store.createFolder({ parentId: null, name: "B" });
      const chat = store.createChat({ folderId: a.id, title: "c", modelId: "m" });
      const moved = store.moveChat(chat.id, b.id, { retagScope: false });
      expect(moved.folderId).toBe(b.id);
      expect(moved.contextScopeId).toBe(a.id);
    });

    it("rejects moving a missing chat", () => {
      expect(() => store.moveChat("missing", null)).toThrow(/chat not found/);
    });

    it("rejects moving into a missing folder", () => {
      const chat = store.createChat({ folderId: null, title: "c", modelId: "m" });
      expect(() => store.moveChat(chat.id, "missing")).toThrow(/folder not found/);
    });

    it("deletes a chat", () => {
      const chat = store.createChat({ folderId: null, title: "c", modelId: "m" });
      store.deleteChat(chat.id);
      expect(store.getChat(chat.id)).toBeNull();
    });

    it("bumps and floors the message count", () => {
      const chat = store.createChat({ folderId: null, title: "c", modelId: "m" });
      store.bumpMessageCount(chat.id, 3);
      expect(store.getChat(chat.id)?.messageCount).toBe(3);
      store.bumpMessageCount(chat.id, -10);
      expect(store.getChat(chat.id)?.messageCount).toBe(0);
    });

    it("rejects non-finite deltas", () => {
      const chat = store.createChat({ folderId: null, title: "c", modelId: "m" });
      expect(() => store.bumpMessageCount(chat.id, Number.NaN)).toThrow();
    });
  });

  describe("listTree", () => {
    it("builds the nested tree with root chats and folder children", () => {
      const projects = store.createFolder({ parentId: null, name: "Projects" });
      const work = store.createFolder({ parentId: projects.id, name: "Work" });
      const q3 = store.createFolder({ parentId: work.id, name: "Q3-roadmap" });
      const rootChat = store.createChat({ folderId: null, title: "scratch", modelId: "m" });
      const q3Chat = store.createChat({ folderId: q3.id, title: "kickoff", modelId: "m" });

      const tree = store.listTree();
      expect(tree.folder).toBeNull();
      expect(tree.chats.map((c) => c.id)).toContain(rootChat.id);
      expect(tree.children.map((c) => c.folder?.id)).toContain(projects.id);

      const projectsNode = tree.children.find((c) => c.folder?.id === projects.id);
      expect(projectsNode?.children[0]?.folder?.id).toBe(work.id);
      const workNode = projectsNode?.children[0];
      expect(workNode?.children[0]?.folder?.id).toBe(q3.id);
      const q3Node = workNode?.children[0];
      expect(q3Node?.chats.map((c) => c.id)).toContain(q3Chat.id);
    });
  });

  describe("search", () => {
    it("matches folders by name and chats by title", () => {
      const work = store.createFolder({ parentId: null, name: "Work" });
      store.createFolder({ parentId: null, name: "Personal" });
      const chat = store.createChat({ folderId: work.id, title: "roadmap planning", modelId: "m" });

      const hits = store.search("roadmap");
      expect(hits.find((h) => h.kind === "chat" && h.id === chat.id)).toBeDefined();

      const workHits = store.search("work");
      expect(workHits.find((h) => h.kind === "folder" && h.id === work.id)).toBeDefined();
    });

    it("returns an empty list for whitespace queries", () => {
      store.createFolder({ parentId: null, name: "Work" });
      expect(store.search("   ").length).toBe(0);
    });

    it("respects the limit argument", () => {
      for (let i = 0; i < 10; i++) {
        store.createFolder({ parentId: null, name: `match folder ${i}` });
      }
      const hits = store.search("match", 3);
      expect(hits.length).toBe(3);
    });

    it("strips FTS5 operators from the query", () => {
      const folder = store.createFolder({ parentId: null, name: "AND OR work" });
      const hits = store.search("AND OR work");
      expect(hits.some((h) => h.kind === "folder" && h.id === folder.id)).toBe(true);
    });
  });

  describe("ancestors", () => {
    it("returns the chain root-first for a nested folder", () => {
      const projects = store.createFolder({ parentId: null, name: "Projects" });
      const work = store.createFolder({ parentId: projects.id, name: "Work" });
      const q3 = store.createFolder({ parentId: work.id, name: "Q3-roadmap" });
      const chain = store.ancestors(q3.id);
      expect(chain.map((f) => f.name)).toEqual(["Projects", "Work", "Q3-roadmap"]);
    });

    it("returns an empty chain for root chats", () => {
      expect(store.ancestors(null)).toEqual([]);
    });

    it("returns an empty chain for missing folders", () => {
      expect(store.ancestors("missing")).toEqual([]);
    });
  });

  describe("close", () => {
    it("releases the database handle", () => {
      const ephemeral = new ChatExplorerStore(":memory:");
      ephemeral.createFolder({ parentId: null, name: "x" });
      expect(() => ephemeral.close()).not.toThrow();
    });
  });
});
