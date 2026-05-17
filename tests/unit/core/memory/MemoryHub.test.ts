import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryMemoryHub } from "../../../../core/memory/MemoryHub.js";

describe("InMemoryMemoryHub", () => {
  let hub: InMemoryMemoryHub;
  beforeEach(() => {
    hub = new InMemoryMemoryHub();
  });

  it("working memory: add, list, clear", () => {
    hub.workingMemory.add({ id: "1", content: "active task" });
    hub.workingMemory.add({ id: "2", content: "next step", source: "agent" });
    expect(hub.workingMemory.list()).toHaveLength(2);
    expect(hub.workingMemory.list()[1]?.source).toBe("agent");
    hub.workingMemory.clear();
    expect(hub.workingMemory.list()).toHaveLength(0);
  });

  it("episodic memory: record and recent (reverse chrono)", async () => {
    await hub.episodic.record({ id: "e1", content: "user said hello" });
    await hub.episodic.record({ id: "e2", content: "user asked for code" });
    const recent = await hub.episodic.recent(5);
    expect(recent).toHaveLength(2);
    expect(recent[0]?.id).toBe("e2");
    expect(recent[1]?.id).toBe("e1");
  });

  it("episodic memory: recent honours the limit", async () => {
    for (let i = 0; i < 30; i++) {
      await hub.episodic.record({ id: `e${i}`, content: `event ${i}` });
    }
    const recent = await hub.episodic.recent(5);
    expect(recent).toHaveLength(5);
  });

  it("semantic memory: upsert and search by substring", async () => {
    await hub.semantic.upsert({ id: "f1", content: "Nexus runs locally" });
    await hub.semantic.upsert({ id: "f2", content: "Gemma 4 is the default model" });
    const hits = await hub.semantic.search("gemma", 10);
    expect(hits.map((h) => h.id)).toEqual(["f2"]);
  });

  it("graph memory: link and neighbors", async () => {
    await hub.graph.link("a", "b", "calls");
    await hub.graph.link("a", "c", "calls");
    await hub.graph.link("a", "d", "imports");
    const calls = await hub.graph.neighbors("a", "calls");
    expect(new Set(calls)).toEqual(new Set(["b", "c"]));
    const all = await hub.graph.neighbors("a");
    expect(new Set(all)).toEqual(new Set(["b", "c", "d"]));
  });

  it("retrieve() merges hits across layers", async () => {
    hub.workingMemory.add({ id: "w", content: "the answer is 42" });
    await hub.episodic.record({ id: "e", content: "asked about 42" });
    await hub.semantic.upsert({ id: "s", content: "42 is the answer" });

    const hits = await hub.retrieve("42", { limit: 10 });
    const layers = new Set(hits.map((h) => h.layer));
    expect(layers.has("working")).toBe(true);
    expect(layers.has("episodic")).toBe(true);
    expect(layers.has("semantic")).toBe(true);
  });

  it("retrieve() respects an explicit layer subset", async () => {
    await hub.semantic.upsert({ id: "s", content: "needle" });
    await hub.episodic.record({ id: "e", content: "needle" });
    const hits = await hub.retrieve("needle", { layers: ["semantic"], limit: 10 });
    expect(hits.every((h) => h.layer === "semantic")).toBe(true);
  });

  it("retrieve() respects the limit", async () => {
    for (let i = 0; i < 20; i++) {
      await hub.semantic.upsert({ id: `s${i}`, content: `result ${i}` });
    }
    const hits = await hub.retrieve("result", { limit: 5 });
    expect(hits.length).toBeLessThanOrEqual(5);
  });
});
