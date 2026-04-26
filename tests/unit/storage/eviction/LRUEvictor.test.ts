import { describe, expect, it } from "vitest";
import { LRUEvictor } from "../../../../src/storage/eviction/LRUEvictor.js";

describe("LRUEvictor", () => {
  it("evicts the least-recently-used key", () => {
    const e = new LRUEvictor();
    e.onInsert("a");
    e.onInsert("b");
    e.onInsert("c");
    expect(e.pickVictim()).toBe("a");
  });

  it("promotes a key on access", () => {
    const e = new LRUEvictor();
    e.onInsert("a");
    e.onInsert("b");
    e.onInsert("c");
    e.onAccess("a");
    expect(e.pickVictim()).toBe("b");
  });

  it("returns null when empty", () => {
    const e = new LRUEvictor();
    expect(e.pickVictim()).toBeNull();
  });

  it("forgets a removed key", () => {
    const e = new LRUEvictor();
    e.onInsert("a");
    e.onInsert("b");
    e.onRemove("a");
    expect(e.pickVictim()).toBe("b");
  });

  it("clear empties the policy", () => {
    const e = new LRUEvictor();
    e.onInsert("a");
    e.onInsert("b");
    e.clear();
    expect(e.pickVictim()).toBeNull();
  });

  it("ignores access on unknown key", () => {
    const e = new LRUEvictor();
    e.onInsert("a");
    e.onInsert("b");
    e.onAccess("does-not-exist");
    expect(e.pickVictim()).toBe("a");
  });
});
