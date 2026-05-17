/**
 * Tests for the desktop frontend's in-memory ChatExplorerClient
 * (`desktop/src/modules/chat/chatExplorerClient.ts`).
 *
 * The IPC-backed variant (deferred to follow-on per known-gap 3.P1.N) will
 * share the same interface, so these tests double as the contract spec.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryChatExplorerClient } from "../src/modules/chat/chatExplorerClient";

describe("InMemoryChatExplorerClient", () => {
  let client: InMemoryChatExplorerClient;
  beforeEach(() => {
    client = new InMemoryChatExplorerClient();
  });

  it("listTree returns an empty root node initially", () => {
    const tree = client.listTree();
    expect(tree.folder).toBeNull();
    expect(tree.children).toEqual([]);
    expect(tree.chats).toEqual([]);
  });

  it("creates / renames / moves / deletes folders", () => {
    const a = client.createFolder({ parentId: null, name: "A" });
    const b = client.createFolder({ parentId: a.id, name: "B" });
    expect(client.getFolder(a.id)?.name).toBe("A");
    const renamed = client.renameFolder(a.id, "Alpha");
    expect(renamed.name).toBe("Alpha");
    const moved = client.moveFolder(b.id, null);
    expect(moved.parentId).toBeNull();
    client.deleteFolder(a.id);
    expect(client.getFolder(a.id)).toBeNull();
  });

  it("trims folder names", () => {
    const f = client.createFolder({ parentId: null, name: "  A  " });
    expect(f.name).toBe("A");
  });

  it("rejects empty folder names", () => {
    expect(() => client.createFolder({ parentId: null, name: "   " })).toThrow();
    const f = client.createFolder({ parentId: null, name: "A" });
    expect(() => client.renameFolder(f.id, "  ")).toThrow();
  });

  it("rejects creating folder under missing parent", () => {
    expect(() => client.createFolder({ parentId: "missing", name: "x" })).toThrow();
  });

  it("rejects renaming a missing folder", () => {
    expect(() => client.renameFolder("missing", "x")).toThrow();
  });

  it("rejects moving folder into itself or its descendant", () => {
    const a = client.createFolder({ parentId: null, name: "A" });
    const b = client.createFolder({ parentId: a.id, name: "B" });
    expect(() => client.moveFolder(a.id, a.id)).toThrow();
    expect(() => client.moveFolder(a.id, b.id)).toThrow();
  });

  it("rejects moving folder into a missing parent", () => {
    const a = client.createFolder({ parentId: null, name: "A" });
    expect(() => client.moveFolder(a.id, "missing")).toThrow();
  });

  it("rejects moving a missing folder", () => {
    expect(() => client.moveFolder("missing", null)).toThrow();
  });

  it("cascades folder delete to chats and descendants", () => {
    const a = client.createFolder({ parentId: null, name: "A" });
    const b = client.createFolder({ parentId: a.id, name: "B" });
    const chat = client.createChat({ folderId: b.id, title: "c", modelId: "m" });
    client.deleteFolder(a.id);
    expect(client.getFolder(b.id)).toBeNull();
    expect(client.getChat(chat.id)).toBeNull();
  });

  it("deleteFolder is a no-op for missing ids", () => {
    expect(() => client.deleteFolder("missing")).not.toThrow();
  });

  it("creates chats with scope derived from the folder", () => {
    const a = client.createFolder({ parentId: null, name: "Work" });
    const chat = client.createChat({ folderId: a.id, title: "c", modelId: "m" });
    expect(chat.contextScopeId).toBe(a.id);
  });

  it("rejects empty chat title or modelId", () => {
    expect(() => client.createChat({ folderId: null, title: "  ", modelId: "m" })).toThrow();
    expect(() => client.createChat({ folderId: null, title: "x", modelId: "  " })).toThrow();
  });

  it("rejects creating a chat under a missing folder", () => {
    expect(() => client.createChat({ folderId: "missing", title: "x", modelId: "m" })).toThrow();
  });

  it("renames a chat and rejects empty rename", () => {
    const chat = client.createChat({ folderId: null, title: "old", modelId: "m" });
    expect(client.renameChat(chat.id, "new").title).toBe("new");
    expect(() => client.renameChat(chat.id, "  ")).toThrow();
    expect(() => client.renameChat("missing", "x")).toThrow();
  });

  it("moves a chat and retags scope", () => {
    const a = client.createFolder({ parentId: null, name: "A" });
    const b = client.createFolder({ parentId: null, name: "B" });
    const chat = client.createChat({ folderId: a.id, title: "c", modelId: "m" });
    const moved = client.moveChat(chat.id, b.id);
    expect(moved.folderId).toBe(b.id);
    expect(moved.contextScopeId).toBe(b.id);
  });

  it("rejects moving a missing chat or into a missing folder", () => {
    expect(() => client.moveChat("missing", null)).toThrow();
    const chat = client.createChat({ folderId: null, title: "x", modelId: "m" });
    expect(() => client.moveChat(chat.id, "missing")).toThrow();
  });

  it("deletes a chat", () => {
    const chat = client.createChat({ folderId: null, title: "x", modelId: "m" });
    client.deleteChat(chat.id);
    expect(client.getChat(chat.id)).toBeNull();
  });

  it("honours an explicit contextScopeId", () => {
    const chat = client.createChat({
      folderId: null,
      title: "x",
      modelId: "m",
      contextScopeId: "explicit",
    });
    expect(chat.contextScopeId).toBe("explicit");
  });

  it("ancestors returns root-first chain and empty for null", () => {
    const a = client.createFolder({ parentId: null, name: "A" });
    const b = client.createFolder({ parentId: a.id, name: "B" });
    expect(client.ancestors(b.id).map((f) => f.name)).toEqual(["A", "B"]);
    expect(client.ancestors(null)).toEqual([]);
    expect(client.ancestors("missing")).toEqual([]);
  });

  it("listTree groups chats under their folders and exposes the root node", () => {
    const a = client.createFolder({ parentId: null, name: "A" });
    const rootChat = client.createChat({ folderId: null, title: "scratch", modelId: "m" });
    const childChat = client.createChat({ folderId: a.id, title: "inside", modelId: "m" });
    const tree = client.listTree();
    expect(tree.chats.map((c) => c.id)).toContain(rootChat.id);
    const node = tree.children.find((c) => c.folder?.id === a.id);
    expect(node?.chats.map((c) => c.id)).toContain(childChat.id);
  });

  it("search returns folders and chats matching a substring", () => {
    const a = client.createFolder({ parentId: null, name: "Work" });
    client.createChat({ folderId: a.id, title: "Q3 roadmap planning", modelId: "m" });
    client.createFolder({ parentId: null, name: "Personal" });
    const hits = client.search("road");
    expect(hits.some((h) => h.kind === "chat")).toBe(true);
    expect(hits.some((h) => h.kind === "folder" && h.name === "Work")).toBe(false);
  });

  it("search returns nothing for whitespace queries", () => {
    client.createFolder({ parentId: null, name: "A" });
    expect(client.search("   ")).toEqual([]);
  });

  it("search respects the limit", () => {
    for (let i = 0; i < 10; i++) {
      client.createFolder({ parentId: null, name: `match-${i}` });
    }
    expect(client.search("match", 3).length).toBe(3);
  });
});
