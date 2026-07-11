/**
 * Cache-hit benchmark suite.
 *
 * Phase 4 (v0.5.0) -- ToolOutputCache lookup latency.
 *
 * Targets (from docs/archive/v0/v0.5/plans/implementation-plan.md):
 *   - p99 < 1 ms for a hit on a populated cache
 *   - p99 < 0.5 ms for a miss on a populated cache
 *
 * Run: npx vitest bench --config configs/vitest.config.ts tests/benchmarks/cache-hit.bench.ts
 */

import { bench, describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ToolOutputCache } from "../../src/storage/ToolOutputCache.js";

const HIT_P99_LIMIT_MS = 1.0;
const MISS_P99_LIMIT_MS = 0.5;
const ITERATIONS = 200;
const POPULATED_ENTRIES = 500;

function p99(sorted: number[]): number {
  const idx = Math.ceil(sorted.length * 0.99) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

// ---------------------------------------------------------------------------
// Fixture: populate a cache with 500 file-backed entries.
// ---------------------------------------------------------------------------

let tmpdir: string;
let cache: ToolOutputCache;
let hitPath: string;
let missPath: string;

beforeAll(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-hit-bench-"));
  cache = new ToolOutputCache({ capacity: POPULATED_ENTRIES + 10 });
  cache.open(":memory:");

  for (let i = 0; i < POPULATED_ENTRIES; i++) {
    const p = path.join(tmpdir, `f${i}.txt`);
    const content = `entry ${i}\n`.repeat(64);
    fs.writeFileSync(p, content);
    cache.store(p, content);
  }

  hitPath = path.join(tmpdir, `f${Math.floor(POPULATED_ENTRIES / 2)}.txt`);
  missPath = path.join(tmpdir, "nonexistent-file.txt");
  // Touch the miss path so statSync can succeed (the cache returns null because
  // there is no row for it). This separates "miss because of stat failure" from
  // "miss because the row is absent".
  fs.writeFileSync(missPath, "miss\n");
});

afterAll(() => {
  cache.close();
  try {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  } catch {
    /* swallow */
  }
});

// ---------------------------------------------------------------------------
// Latency gates
// ---------------------------------------------------------------------------

describe("ToolOutputCache latency gate", () => {
  function measureLookup(p: string, n: number): number[] {
    const times: number[] = [];
    for (let i = 0; i < n; i++) {
      const start = performance.now();
      cache.lookup(p);
      times.push(performance.now() - start);
    }
    return times.sort((a, b) => a - b);
  }

  it(`hit p99 < ${HIT_P99_LIMIT_MS} ms on a populated cache`, () => {
    const times = measureLookup(hitPath, ITERATIONS);
    expect(p99(times)).toBeLessThan(HIT_P99_LIMIT_MS);
  });

  it(`miss p99 < ${MISS_P99_LIMIT_MS} ms on a populated cache`, () => {
    const times = measureLookup(missPath, ITERATIONS);
    expect(p99(times)).toBeLessThan(MISS_P99_LIMIT_MS);
  });
});

// ---------------------------------------------------------------------------
// Throughput benchmarks
// ---------------------------------------------------------------------------

describe("ToolOutputCache throughput", () => {
  bench("hit on populated cache", () => {
    cache.lookup(hitPath);
  });

  bench("miss on populated cache", () => {
    cache.lookup(missPath);
  });
});
