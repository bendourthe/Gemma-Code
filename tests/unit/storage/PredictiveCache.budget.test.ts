/**
 * PredictiveCache latency budget -- hard gate complementary to the bench file.
 *
 * The matching `tests/benchmarks/predictive-cache.bench.ts` reports throughput
 * numbers consumed by `scripts/check-bench-regressions.mjs`. Bench-mode does
 * not execute `it()` blocks, so the v0.5.0 commitment ("ARIMA(1,0,1) fit and
 * 5-path forecast under 50 ms with the largest tracked sample window") needs
 * a real test that runs under `vitest run`. This file provides that gate.
 */

import { describe, it, expect } from "vitest";
import {
  PredictiveCache,
  fitARIMA101,
} from "../../../src/storage/PredictiveCache.js";

const ARIMA_BUDGET_MS = 50;

function buildTrace(
  observations: number,
  pathCount: number,
): Array<{ path: string; ts: number }> {
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

describe("PredictiveCache latency budget", () => {
  it(`ARIMA fit + top-5 predict over 1000 observations completes under ${ARIMA_BUDGET_MS} ms`, () => {
    const cache = new PredictiveCache();
    const trace = buildTrace(1000, 32);
    for (const { path, ts } of trace) cache.observe(path, ts);

    const start = performance.now();
    const predicted = cache.predict(5, trace[trace.length - 1]!.ts + 100);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(ARIMA_BUDGET_MS);
    expect(predicted.length).toBeGreaterThan(0);
    expect(predicted.length).toBeLessThanOrEqual(5);
  });

  it(`fitARIMA101 alone stays under ${ARIMA_BUDGET_MS} ms with a 64-sample window`, () => {
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
    expect(elapsed).toBeLessThan(ARIMA_BUDGET_MS);
  });
});
