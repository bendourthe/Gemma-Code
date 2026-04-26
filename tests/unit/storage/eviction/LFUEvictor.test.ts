import { describe, expect, it } from "vitest";
import { LFUEvictor } from "../../../../src/storage/eviction/LFUEvictor.js";

describe("LFUEvictor", () => {
  it("evicts the least-frequently-used key", () => {
    const e = new LFUEvictor();
    e.onInsert("a");
    e.onInsert("b");
    e.onInsert("c");
    e.onAccess("a");
    e.onAccess("a");
    e.onAccess("b");
    expect(e.pickVictim()).toBe("c");
  });

  it("breaks frequency ties by insertion order (oldest wins)", () => {
    const e = new LFUEvictor();
    e.onInsert("a");
    e.onInsert("b");
    e.onInsert("c");
    expect(e.pickVictim()).toBe("a");
  });

  it("returns null when empty", () => {
    const e = new LFUEvictor();
    expect(e.pickVictim()).toBeNull();
  });

  it("counts the initial insert as one access", () => {
    const e = new LFUEvictor();
    e.onInsert("a");
    e.onInsert("b");
    e.onInsert("b");
    expect(e.pickVictim()).toBe("a");
  });

  it("forgets removed keys", () => {
    const e = new LFUEvictor();
    e.onInsert("a");
    e.onInsert("b");
    e.onRemove("a");
    expect(e.pickVictim()).toBe("b");
  });
});
