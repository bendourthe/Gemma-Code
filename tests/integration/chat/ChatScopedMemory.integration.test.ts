/**
 * v1.0.0 Phase 4.2 -- integration test for the ChatScopedMemory bridge.
 *
 * Builds a folder hierarchy `Projects/Work/Q3-roadmap` and `Projects/Personal`
 * via `ChatExplorerStore`, writes scope-tagged memory entries from chats in
 * each, and asserts retrieval respects isolation + ancestry. Also exercises
 * the MoveChat action that re-tags every memory entry to the new scope.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ChatExplorerStore } from "../../../modules/chat/storage/ChatExplorerStore.js";
import { ChatScopedMemory } from "../../../modules/chat/memory/ChatScopedMemory.js";
import { InMemoryMemoryHub } from "../../../core/memory/MemoryHub.js";

describe("ChatScopedMemory (integration)", () => {
  let store: ChatExplorerStore;
  let hub: InMemoryMemoryHub;
  let scoped: ChatScopedMemory;

  beforeEach(() => {
    store = new ChatExplorerStore(":memory:");
    hub = new InMemoryMemoryHub();
    scoped = new ChatScopedMemory(store, hub);
  });

  it("isolates retrieval between sibling folders and surfaces ancestor scopes", async () => {
    const projects = store.createFolder({ parentId: null, name: "Projects" });
    const work = store.createFolder({ parentId: projects.id, name: "Work" });
    const q3 = store.createFolder({ parentId: work.id, name: "Q3-roadmap" });
    const personal = store.createFolder({ parentId: projects.id, name: "Personal" });

    const q3Chat = store.createChat({ folderId: q3.id, title: "kickoff", modelId: "m" });
    const personalChat = store.createChat({
      folderId: personal.id,
      title: "weekend",
      modelId: "m",
    });

    hub.workingMemory.add({ id: "w-q3", content: "roadmap milestone", scopeId: q3.id });
    hub.workingMemory.add({ id: "w-work", content: "roadmap parent", scopeId: work.id });
    hub.workingMemory.add({ id: "w-projects", content: "roadmap projects", scopeId: projects.id });
    hub.workingMemory.add({
      id: "w-personal",
      content: "roadmap personal",
      scopeId: personal.id,
    });
    hub.workingMemory.add({ id: "w-root", content: "roadmap global", scopeId: null });

    const q3Hits = await scoped.retrieve(q3Chat, "roadmap");
    const q3Ids = new Set(q3Hits.map((h) => h.id));
    expect(q3Ids.has("w-q3")).toBe(true);
    expect(q3Ids.has("w-work")).toBe(true);
    expect(q3Ids.has("w-projects")).toBe(true);
    expect(q3Ids.has("w-root")).toBe(true);
    expect(q3Ids.has("w-personal")).toBe(false);

    const personalHits = await scoped.retrieve(personalChat, "roadmap");
    const personalIds = new Set(personalHits.map((h) => h.id));
    expect(personalIds.has("w-personal")).toBe(true);
    expect(personalIds.has("w-projects")).toBe(true);
    expect(personalIds.has("w-root")).toBe(true);
    expect(personalIds.has("w-q3")).toBe(false);
    expect(personalIds.has("w-work")).toBe(false);
  });

  it("re-tags memory entries on moveChat", async () => {
    const work = store.createFolder({ parentId: null, name: "Work" });
    const personal = store.createFolder({ parentId: null, name: "Personal" });
    const chat = store.createChat({ folderId: work.id, title: "draft", modelId: "m" });

    hub.workingMemory.add({ id: "w1", content: "draft note", scopeId: work.id });
    await hub.episodic.record({ id: "e1", content: "draft note", scopeId: work.id });

    const { chat: moved, rowsRetagged } = await scoped.moveChat(chat.id, personal.id);
    expect(moved.folderId).toBe(personal.id);
    expect(moved.contextScopeId).toBe(personal.id);
    expect(rowsRetagged).toBe(2);

    const afterMove = await scoped.retrieve(moved, "draft");
    const ids = new Set(afterMove.map((h) => h.id));
    expect(ids.has("w1")).toBe(true);
    expect(ids.has("e1")).toBe(true);

    const personalChat = store.createChat({
      folderId: personal.id,
      title: "sibling",
      modelId: "m",
    });
    const personalHits = await scoped.retrieve(personalChat, "draft");
    expect(personalHits.length).toBeGreaterThan(0);

    const workSibling = store.createChat({ folderId: work.id, title: "other", modelId: "m" });
    const workHits = await scoped.retrieve(workSibling, "draft");
    expect(workHits.length).toBe(0);
  });

  it("moveChat with the same target is a no-op for the memory rows", async () => {
    const work = store.createFolder({ parentId: null, name: "Work" });
    const chat = store.createChat({ folderId: work.id, title: "stay", modelId: "m" });
    hub.workingMemory.add({ id: "w1", content: "x", scopeId: work.id });
    const { rowsRetagged } = await scoped.moveChat(chat.id, work.id);
    expect(rowsRetagged).toBe(0);
  });

  it("moveChat throws for an unknown chat id", async () => {
    await expect(scoped.moveChat("missing", null)).rejects.toThrow(/chat not found/);
  });

  it("visibleScopesFor returns the chain including null", () => {
    const work = store.createFolder({ parentId: null, name: "Work" });
    const child = store.createFolder({ parentId: work.id, name: "Child" });
    const chat = store.createChat({ folderId: child.id, title: "x", modelId: "m" });
    const chain = scoped.visibleScopesFor(chat);
    expect(chain).toEqual([child.id, work.id, null]);
  });

  it("retrieve honours overrideVisibleScopes", async () => {
    const work = store.createFolder({ parentId: null, name: "Work" });
    const personal = store.createFolder({ parentId: null, name: "Personal" });
    const chat = store.createChat({ folderId: work.id, title: "x", modelId: "m" });
    hub.workingMemory.add({ id: "w-personal", content: "x", scopeId: personal.id });
    const hits = await scoped.retrieve(chat, "x", {
      overrideVisibleScopes: [personal.id],
    });
    expect(hits.map((h) => h.id)).toContain("w-personal");
  });
});
