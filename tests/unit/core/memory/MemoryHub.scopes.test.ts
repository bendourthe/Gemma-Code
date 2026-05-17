/**
 * v1.0.0 Phase 4.2 -- scope-aware MemoryHub tests.
 *
 * Verifies per-folder context isolation: a chat in `Projects/Work/Q3-roadmap`
 * sees its own scope plus all ancestor scopes (`Work`, `Projects`, `root`)
 * but never sees sibling scopes (`Projects/Personal`).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryMemoryHub,
  computeVisibleScopes,
  isVisibleFromScope,
} from "../../../../core/memory/MemoryHub.js";

describe("MemoryHub scopes", () => {
  let hub: InMemoryMemoryHub;
  beforeEach(() => {
    hub = new InMemoryMemoryHub();
  });

  it("isVisibleFromScope allows unscoped entries unconditionally", () => {
    expect(isVisibleFromScope(undefined, { scopeId: "work" })).toBe(true);
    expect(isVisibleFromScope(undefined, {})).toBe(true);
  });

  it("isVisibleFromScope bypasses filter when no scope is queried", () => {
    expect(isVisibleFromScope("scope-x", {})).toBe(true);
  });

  it("isVisibleFromScope matches the queried scope itself", () => {
    expect(isVisibleFromScope("work", { scopeId: "work" })).toBe(true);
    expect(isVisibleFromScope("personal", { scopeId: "work" })).toBe(false);
  });

  it("isVisibleFromScope honours visibleScopes ancestors", () => {
    expect(
      isVisibleFromScope("projects", {
        scopeId: "q3",
        visibleScopes: ["q3", "work", "projects", null],
      }),
    ).toBe(true);
    expect(
      isVisibleFromScope("personal", {
        scopeId: "q3",
        visibleScopes: ["q3", "work", "projects", null],
      }),
    ).toBe(false);
  });

  it("isVisibleFromScope matches the root sentinel", () => {
    expect(isVisibleFromScope(null, { scopeId: "q3", visibleScopes: [null] })).toBe(true);
  });

  it("retrieve() returns only hits in the queried scope or its ancestors", async () => {
    hub.workingMemory.add({ id: "w-work", content: "work note", scopeId: "work" });
    hub.workingMemory.add({ id: "w-personal", content: "personal note", scopeId: "personal" });
    await hub.episodic.record({ id: "e-q3", content: "kickoff note", scopeId: "q3" });
    await hub.semantic.upsert({ id: "s-projects", content: "projects fact", scopeId: "projects" });
    await hub.semantic.upsert({ id: "s-root", content: "global fact", scopeId: null });

    const hits = await hub.retrieve("note", {
      scopeId: "q3",
      visibleScopes: ["q3", "work", "projects", null],
    });
    const ids = new Set(hits.map((h) => h.id));
    expect(ids.has("w-work")).toBe(true);
    expect(ids.has("e-q3")).toBe(true);
    expect(ids.has("w-personal")).toBe(false);
  });

  it("retrieve() of root scope excludes scoped entries except root-tagged", async () => {
    await hub.semantic.upsert({ id: "scoped", content: "fact", scopeId: "work" });
    await hub.semantic.upsert({ id: "root", content: "fact", scopeId: null });
    const hits = await hub.retrieve("fact", { scopeId: null, visibleScopes: [null] });
    const ids = new Set(hits.map((h) => h.id));
    expect(ids.has("root")).toBe(true);
    expect(ids.has("scoped")).toBe(false);
  });

  it("retrieve() with no scope returns every hit regardless of tag", async () => {
    await hub.semantic.upsert({ id: "a", content: "fact a", scopeId: "work" });
    await hub.semantic.upsert({ id: "b", content: "fact b", scopeId: "personal" });
    const hits = await hub.retrieve("fact", {});
    expect(hits).toHaveLength(2);
  });

  it("graph memory honours scope filter on neighbors", async () => {
    await hub.graph.link("a", "b", "calls", "work");
    await hub.graph.link("a", "c", "calls", "personal");
    await hub.graph.link("a", "d", "calls"); // unscoped
    const workNeighbors = await hub.graph.neighbors("a", "calls", "work");
    expect(new Set(workNeighbors)).toEqual(new Set(["b", "d"]));
    const personalNeighbors = await hub.graph.neighbors("a", "calls", "personal");
    expect(new Set(personalNeighbors)).toEqual(new Set(["c", "d"]));
    const all = await hub.graph.neighbors("a", "calls");
    expect(new Set(all)).toEqual(new Set(["b", "c", "d"]));
  });

  it("graph memory neighbors without kind also honours scope", async () => {
    await hub.graph.link("a", "b", "calls", "work");
    await hub.graph.link("a", "c", "imports", "personal");
    const allWork = await hub.graph.neighbors("a", undefined, "work");
    expect(allWork).toEqual(["b"]);
  });

  it("graph memory dedupes identical (to, scope) edges", async () => {
    await hub.graph.link("a", "b", "calls", "work");
    await hub.graph.link("a", "b", "calls", "work");
    const neighbors = await hub.graph.neighbors("a", "calls");
    expect(neighbors).toEqual(["b"]);
  });

  it("retagScope updates every layer's scope tag", async () => {
    hub.workingMemory.add({ id: "w", content: "x", scopeId: "old" });
    await hub.episodic.record({ id: "e", content: "x", scopeId: "old" });
    await hub.semantic.upsert({ id: "s", content: "x", scopeId: "old" });
    await hub.graph.link("a", "b", "calls", "old");

    const touched = await hub.retagScope("old", "new");
    expect(touched).toBe(4);

    const hits = await hub.retrieve("x", { scopeId: "new", visibleScopes: ["new"] });
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const neighbors = await hub.graph.neighbors("a", "calls", "new");
    expect(neighbors).toEqual(["b"]);
  });

  it("retagScope of an empty scope returns 0", async () => {
    const touched = await hub.retagScope("absent", "elsewhere");
    expect(touched).toBe(0);
  });
});

describe("computeVisibleScopes", () => {
  it("includes the root sentinel even when scopeId is null", () => {
    const chain = computeVisibleScopes(null, () => undefined);
    expect(chain).toEqual([null]);
  });

  it("walks the ancestor chain via the getParent callback", () => {
    const parents = new Map<string, string | null | undefined>([
      ["q3", "work"],
      ["work", "projects"],
      ["projects", null],
    ]);
    const chain = computeVisibleScopes("q3", (id) => parents.get(id));
    expect(chain).toEqual(["q3", "work", "projects", null]);
  });

  it("stops walking when getParent returns undefined (missing folder)", () => {
    const chain = computeVisibleScopes("orphan", () => undefined);
    expect(chain).toEqual(["orphan", null]);
  });

  it("breaks cycles defensively", () => {
    const parents = new Map<string, string>([
      ["a", "b"],
      ["b", "a"],
    ]);
    const chain = computeVisibleScopes("a", (id) => parents.get(id));
    expect(chain).toEqual(["a", "b", null]);
  });
});
