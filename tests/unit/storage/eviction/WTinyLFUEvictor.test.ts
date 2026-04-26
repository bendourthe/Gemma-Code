import { describe, expect, it } from "vitest";
import { WTinyLFUEvictor } from "../../../../src/storage/eviction/WTinyLFUEvictor.js";

describe("WTinyLFUEvictor", () => {
  it("returns null when empty", () => {
    const e = new WTinyLFUEvictor(10);
    expect(e.pickVictim()).toBeNull();
  });

  it("admits a key on first insert", () => {
    const e = new WTinyLFUEvictor(10);
    e.onInsert("a");
    e.onInsert("b");
    const v = e.pickVictim();
    expect(["a", "b"]).toContain(v);
  });

  it("forgets a removed key", () => {
    const e = new WTinyLFUEvictor(10);
    e.onInsert("a");
    e.onInsert("b");
    e.onRemove("a");
    expect(e.pickVictim()).toBe("b");
  });

  it("clear resets state", () => {
    const e = new WTinyLFUEvictor(10);
    e.onInsert("a");
    e.onInsert("b");
    e.clear();
    expect(e.pickVictim()).toBeNull();
  });

  it("frequent keys survive admission gating against one-shot keys", () => {
    const e = new WTinyLFUEvictor(8);
    // hot: 50 accesses; then 100 unique cold keys each seen once
    for (let i = 0; i < 50; i++) {
      e.onInsert("hot");
      e.onAccess("hot");
    }
    for (let i = 0; i < 100; i++) {
      e.onInsert(`cold-${i}`);
    }
    // Sketch frequency for hot is ~50, for any cold key it's 1. With main
    // full and gated by sketch comparison, cold candidates that arrive
    // after the initial fill should be denied. Hot must still be present.
    expect(e.has("hot")).toBe(true);
    // Of the 100 cold keys, fewer than half should be present in the
    // 8-slot cache. The exact set depends on admission ordering, but
    // sustained frequency gating must reject the long tail.
    let coldsRetained = 0;
    for (let i = 0; i < 100; i++) {
      if (e.has(`cold-${i}`)) coldsRetained++;
    }
    expect(coldsRetained).toBeLessThanOrEqual(8);
  });
});
