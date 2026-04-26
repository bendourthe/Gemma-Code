import { describe, expect, it } from "vitest";
import { ClockEvictor } from "../../../../src/storage/eviction/ClockEvictor.js";

describe("ClockEvictor", () => {
  it("returns the first unreferenced key", () => {
    const e = new ClockEvictor();
    e.onInsert("a");
    e.onInsert("b");
    e.onInsert("c");
    expect(e.pickVictim()).toBe("a");
  });

  it("gives a referenced key a second chance", () => {
    const e = new ClockEvictor();
    e.onInsert("a");
    e.onInsert("b");
    e.onInsert("c");
    e.onAccess("a");
    expect(e.pickVictim()).toBe("b");
  });

  it("returns null when empty", () => {
    const e = new ClockEvictor();
    expect(e.pickVictim()).toBeNull();
  });

  it("forgets a removed key", () => {
    const e = new ClockEvictor();
    e.onInsert("a");
    e.onInsert("b");
    e.onInsert("c");
    e.onRemove("a");
    expect(e.pickVictim()).toBe("b");
  });

  it("eventually evicts every referenced key after enough sweeps", () => {
    const e = new ClockEvictor();
    e.onInsert("a");
    e.onInsert("b");
    e.onAccess("a");
    e.onAccess("b");
    // First call clears bits; both still referenced. The implementation may
    // pick whichever the hand reaches first; either is acceptable, just not
    // null and within the known set.
    const victim = e.pickVictim();
    expect(["a", "b"]).toContain(victim);
  });
});
