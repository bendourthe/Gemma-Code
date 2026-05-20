import { describe, it, expect } from "vitest";
import {
  DecaySweep,
  retentionAt,
  DEFAULT_HALF_LIVES,
  HOUR_MS,
  DAY_MS,
  type DecayableEntry,
  type DecayProvider,
} from "../../../../core/memory/DecaySweep.js";

describe("retentionAt", () => {
  it("returns 1 at t = 0", () => {
    expect(retentionAt(0, DAY_MS)).toBe(1);
  });

  it("returns 0.5 at t = halfLife", () => {
    expect(retentionAt(DAY_MS, DAY_MS)).toBeCloseTo(0.5, 6);
  });

  it("returns 0.25 at t = 2 * halfLife", () => {
    expect(retentionAt(2 * DAY_MS, DAY_MS)).toBeCloseTo(0.25, 6);
  });

  it("returns 0 when halfLife <= 0", () => {
    expect(retentionAt(100, 0)).toBe(0);
  });
});

describe("DecaySweep", () => {
  function makeProvider(entries: DecayableEntry[]): DecayProvider & { evicted: string[] } {
    return {
      evicted: [] as string[],
      list() {
        return entries.filter((e) => !this.evicted.includes(e.id));
      },
      evict(id: string) {
        this.evicted.push(id);
        return true;
      },
    };
  }

  it("evicts entries below the retention floor with accessCount < min", () => {
    const now = 100 * DAY_MS;
    const oldEntry: DecayableEntry = {
      id: "old",
      tier: "working",
      lastAccessedAt: now - 10 * DAY_MS,
      accessCount: 0,
    };
    const recentEntry: DecayableEntry = {
      id: "recent",
      tier: "working",
      lastAccessedAt: now - 1 * HOUR_MS,
      accessCount: 0,
    };
    const popularEntry: DecayableEntry = {
      id: "popular",
      tier: "working",
      lastAccessedAt: now - 10 * DAY_MS,
      accessCount: 10,
    };
    const provider = makeProvider([oldEntry, recentEntry, popularEntry]);
    const sweep = new DecaySweep(provider, { now: () => now });
    const result = sweep.sweep();
    expect(result.evicted.map((e) => e.id)).toEqual(["old"]);
    expect(result.kept).toBe(2);
    expect(result.scanned).toBe(3);
  });

  it("uses default per-tier half-lives", () => {
    const sweep = new DecaySweep(makeProvider([]));
    expect(sweep.halfLives).toEqual(DEFAULT_HALF_LIVES);
  });

  it("respects half-life overrides per tier", () => {
    const provider = makeProvider([]);
    const sweep = new DecaySweep(provider, { halfLives: { working: 2 * HOUR_MS } });
    expect(sweep.halfLives.working).toBe(2 * HOUR_MS);
    expect(sweep.halfLives.semantic).toBe(DEFAULT_HALF_LIVES.semantic);
  });

  it("shouldEvict is pure and exposes retention", () => {
    const now = 100 * DAY_MS;
    const sweep = new DecaySweep(makeProvider([]), { now: () => now });
    const result = sweep.shouldEvict({
      id: "x",
      tier: "working",
      lastAccessedAt: now - 24 * HOUR_MS,
      accessCount: 0,
    });
    // working tier half-life is 24h, so retention should be 0.5
    expect(result.retention).toBeCloseTo(0.5, 6);
    expect(result.evict).toBe(false);
  });

  it("survives provider.evict throwing -- the entry stays in the kept bucket", () => {
    const now = 100 * DAY_MS;
    const flakyProvider: DecayProvider = {
      list() {
        return [
          {
            id: "x",
            tier: "working",
            lastAccessedAt: now - 30 * DAY_MS,
            accessCount: 0,
          },
        ];
      },
      evict() {
        throw new Error("boom");
      },
    };
    const sweep = new DecaySweep(flakyProvider, { now: () => now });
    const result = sweep.sweep();
    expect(result.evicted).toHaveLength(0);
    expect(result.kept).toBe(1);
  });

  it("evicts roughly the right number of stale rows within 5% of the math", () => {
    // 100 working-tier rows; 70 accessed 7 days ago with count=0 (deep decay),
    // 30 accessed 1 hour ago with count=5 (fresh + popular).
    const now = 100 * DAY_MS;
    const entries: DecayableEntry[] = [];
    for (let i = 0; i < 70; i++) {
      entries.push({
        id: `stale-${i}`,
        tier: "working",
        lastAccessedAt: now - 7 * DAY_MS,
        accessCount: 0,
      });
    }
    for (let i = 0; i < 30; i++) {
      entries.push({
        id: `fresh-${i}`,
        tier: "working",
        lastAccessedAt: now - 1 * HOUR_MS,
        accessCount: 5,
      });
    }
    const provider = makeProvider(entries);
    const sweep = new DecaySweep(provider, { now: () => now });
    const result = sweep.sweep();
    // working tier half-life 24h; after 7 days retention ~ 0.5^7 = 0.0078 < 0.05.
    // accessCount 0 < 3 -> should be evicted.
    expect(result.evicted.length).toBeGreaterThanOrEqual(Math.floor(70 * 0.95));
    expect(result.evicted.length).toBeLessThanOrEqual(70);
    expect(result.kept).toBe(30);
  });
});
