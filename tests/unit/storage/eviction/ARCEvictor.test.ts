import { describe, expect, it } from "vitest";
import { ARCEvictor } from "../../../../src/storage/eviction/ARCEvictor.js";

describe("ARCEvictor", () => {
  it("evicts a recency-only key first", () => {
    const e = new ARCEvictor(3);
    e.onInsert("a");
    e.onInsert("b");
    e.onInsert("c");
    expect(e.pickVictim()).toBe("a");
  });

  it("promotes accessed keys into the frequency tier", () => {
    const e = new ARCEvictor(3);
    e.onInsert("a");
    e.onInsert("b");
    e.onInsert("c");
    e.onAccess("a");
    e.onAccess("b");
    // a and b are now in T2 (frequency); c is the only T1 entry => victim.
    expect(e.pickVictim()).toBe("c");
  });

  it("returns null when empty", () => {
    const e = new ARCEvictor(3);
    expect(e.pickVictim()).toBeNull();
  });

  it("forgets removed keys completely", () => {
    const e = new ARCEvictor(3);
    e.onInsert("a");
    e.onInsert("b");
    e.onInsert("c");
    e.onRemove("a");
    e.onRemove("b");
    expect(e.pickVictim()).toBe("c");
  });

  it("re-inserting a key in T1 promotes it to T2 (treated as access)", () => {
    const e = new ARCEvictor(3);
    e.onInsert("a");
    e.onInsert("b");
    e.onInsert("a");
    // a is now in T2; b in T1; pickVictim should select b
    expect(e.pickVictim()).toBe("b");
  });

  it("clear resets state", () => {
    const e = new ARCEvictor(3);
    e.onInsert("a");
    e.onInsert("b");
    e.clear();
    expect(e.pickVictim()).toBeNull();
  });
});
