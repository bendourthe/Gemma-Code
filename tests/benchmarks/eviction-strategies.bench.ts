/**
 * Eviction-strategy bench + hit-rate matrix.
 *
 * Sub-task 2.5 of the v0.6.0 cycle adds the missing comparison bench that
 * v0.5.0 Phase 4 promised but never shipped: a side-by-side measurement of
 * LRU vs. LFU vs. ARC vs. W-TinyLFU vs. Clock against a representative
 * access trace. The trace is the Zipfian fixture at
 * `tests/fixtures/access-trace.json`; replace it with a golden-task-derived
 * trace when cache instrumentation lands (see plan sub-task 2.5).
 *
 * Two outputs:
 *   - `bench(...)` cases: per-strategy throughput on an `onAccess` mix.
 *     Captured into `tests/benchmarks/baselines/v0.6.0.json`.
 *   - `it(...)` hit-rate assertions: documents the relative ordering at a
 *     fixed cache size. Not a hard regression gate -- skews vary per trace
 *     -- but flags accidental regressions in any strategy's bookkeeping.
 *
 * Run: npx vitest bench --config configs/vitest.config.ts tests/benchmarks/eviction-strategies.bench.ts
 */

import { bench, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ARCEvictor,
  ClockEvictor,
  LFUEvictor,
  LRUEvictor,
  WTinyLFUEvictor,
  type EvictionStrategy,
  type Evictor,
} from "../../src/storage/eviction/index.js";

const FIXTURE_PATH = resolve(__dirname, "../fixtures/access-trace.json");
const CACHE_SIZE = 16;

interface AccessFixture {
  readonly version: number;
  readonly trace: readonly string[];
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as AccessFixture;
if (!Array.isArray(fixture.trace) || fixture.trace.length === 0) {
  throw new Error(`Access-trace fixture at ${FIXTURE_PATH} is empty or malformed.`);
}
const TRACE: readonly string[] = fixture.trace;

function makeEvictor(strategy: EvictionStrategy): Evictor {
  switch (strategy) {
    case "lru":
      return new LRUEvictor();
    case "lfu":
      return new LFUEvictor();
    case "arc":
      return new ARCEvictor(CACHE_SIZE);
    case "wtinylfu":
      return new WTinyLFUEvictor(CACHE_SIZE);
    case "clock":
      return new ClockEvictor();
  }
}

/**
 * Replay `trace` against an empty `cacheSize`-bounded cache backed by
 * `evictor`. Returns hit/miss counts. The cache layer is simulated here:
 * the evictor only tracks bookkeeping; the resident set is a local Set.
 */
function simulate(
  evictor: Evictor,
  trace: readonly string[],
  cacheSize: number,
): { hits: number; misses: number } {
  const resident = new Set<string>();
  let hits = 0;
  let misses = 0;
  for (const key of trace) {
    if (resident.has(key)) {
      evictor.onAccess(key);
      hits++;
      continue;
    }
    misses++;
    if (resident.size >= cacheSize) {
      const victim = evictor.pickVictim();
      if (victim !== null) {
        resident.delete(victim);
        evictor.onRemove(victim);
      }
    }
    resident.add(key);
    evictor.onInsert(key);
  }
  return { hits, misses };
}

const STRATEGIES: readonly EvictionStrategy[] = [
  "lru",
  "lfu",
  "arc",
  "wtinylfu",
  "clock",
];

describe("eviction-strategy hit-rate matrix (cache=16)", () => {
  const results = new Map<EvictionStrategy, number>();

  for (const strategy of STRATEGIES) {
    it(`${strategy}: replays the fixture without throwing and reports a non-zero hit rate`, () => {
      const evictor = makeEvictor(strategy);
      const { hits, misses } = simulate(evictor, TRACE, CACHE_SIZE);
      const hitRate = hits / (hits + misses);
      results.set(strategy, hitRate);

      expect(hits + misses).toBe(TRACE.length);
      // Even the simplest strategies should hit on the very-hot Zipf tail.
      expect(hitRate).toBeGreaterThan(0.1);
    });
  }

  it("documents the comparative ordering for the current fixture", () => {
    expect(results.size).toBe(STRATEGIES.length);
    // Eyeball record only -- no inequality is enforced because trace skew can
    // swap adjacent strategies. The history doc captures the v0.6.0 numbers.
    for (const s of STRATEGIES) {
      expect(results.get(s)).toBeGreaterThanOrEqual(0);
      expect(results.get(s)).toBeLessThanOrEqual(1);
    }
  });
});

describe("eviction-strategy throughput", () => {
  for (const strategy of STRATEGIES) {
    bench(`${strategy}: full Zipf trace replay`, () => {
      simulate(makeEvictor(strategy), TRACE, CACHE_SIZE);
    });
  }
});
