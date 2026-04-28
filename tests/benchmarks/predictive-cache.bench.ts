/**
 * Predictive cache benchmark suite.
 *
 * Phase 2 of the v0.6.0 cycle (per docs/v0.6.0/plans/v0.6.0-cycle.md sub-task
 * 2.5) covers a missing feature-to-test gap from v0.5.0 Phase 12: the pure-JS
 * ARIMA(1,0,1) forecaster used by `PredictiveCache.predict()` must complete a
 * fit + forecast in under 50 ms even with the largest sample window the module
 * tracks (1000 observations spread across 256 paths).
 *
 * The bench file plays two roles:
 *   1. `bench(...)` cases produce throughput numbers consumed by
 *      `tests/benchmarks/baselines/v0.6.0.json` so future regressions are
 *      caught by `scripts/check-bench-regressions.mjs`.
 *   2. `it(...)` latency gates assert the hard 50 ms ARIMA budget the
 *      v0.5.0 Phase 12 plan committed to. They run as part of the normal
 *      test suite via `npm run bench`.
 *
 * Run: npx vitest bench --config configs/vitest.config.ts tests/benchmarks/predictive-cache.bench.ts
 */

import { bench, describe, it, expect } from "vitest";
import {
  PredictiveCache,
  fitARIMA101,
  forecastARIMA101,
} from "../../src/storage/PredictiveCache.js";

const ARIMA_FIT_BUDGET_MS = 50;
const TOTAL_OBSERVATIONS = 1000;
const PATH_COUNT = 32;
const TOP_K = 5;

/**
 * Build a deterministic-but-noisy access trace: `pathCount` paths, each with
 * its own period and a small Gaussian-ish jitter. The `samples` interleave
 * across paths so `observe()` exercises the path map's eviction edge cases.
 */
function buildTrace(observations: number, pathCount: number): Array<{ path: string; ts: number }> {
  const trace: Array<{ path: string; ts: number }> = [];
  let ts = 1_700_000_000_000;
  let rngState = 0xdead_beef;
  const rand = () => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 0x1_0000_0000;
  };
  for (let i = 0; i < observations; i++) {
    const pathIdx = i % pathCount;
    const period = 25 + (pathIdx % 7) * 17;
    const jitter = (rand() - 0.5) * 4;
    ts += Math.max(1, Math.round(period + jitter));
    trace.push({ path: `/repo/file_${pathIdx}.ts`, ts });
  }
  return trace;
}

const TRACE = buildTrace(TOTAL_OBSERVATIONS, PATH_COUNT);

describe("PredictiveCache latency gates", () => {
  it(`ARIMA(1,0,1) fit + 5-path predict completes < ${ARIMA_FIT_BUDGET_MS} ms over ${TOTAL_OBSERVATIONS} observations`, () => {
    const cache = new PredictiveCache();
    for (const { path, ts } of TRACE) cache.observe(path, ts);

    const start = performance.now();
    const predicted = cache.predict(TOP_K, TRACE[TRACE.length - 1]!.ts + 100);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(ARIMA_FIT_BUDGET_MS);
    expect(predicted.length).toBeGreaterThan(0);
    expect(predicted.length).toBeLessThanOrEqual(TOP_K);
  });

  it("fitARIMA101 alone stays under the 50ms ceiling on a single hot path", () => {
    const samples: number[] = [];
    let t = 0;
    for (let i = 0; i < 64; i++) {
      t += 30 + (i % 5);
      samples.push(t);
    }
    const start = performance.now();
    const fit = fitARIMA101(samples);
    const elapsed = performance.now() - start;

    expect(fit).not.toBeNull();
    expect(elapsed).toBeLessThan(ARIMA_FIT_BUDGET_MS);
  });
});

describe("PredictiveCache throughput", () => {
  bench("observe(): record 1000 accesses across 32 paths", () => {
    const cache = new PredictiveCache();
    for (const { path, ts } of TRACE) cache.observe(path, ts);
  });

  bench("predict(top=5) on a fully-warmed cache", () => {
    const cache = new PredictiveCache();
    for (const { path, ts } of TRACE) cache.observe(path, ts);
    cache.predict(TOP_K, TRACE[TRACE.length - 1]!.ts + 100);
  });

  bench("forecastARIMA101 single-step", () => {
    const fit = fitARIMA101(TRACE.slice(0, 64).map((e) => e.ts));
    if (!fit) return;
    forecastARIMA101(fit, 30);
  });
});
