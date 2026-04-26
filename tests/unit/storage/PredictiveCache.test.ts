import { describe, expect, it } from "vitest";
import {
  fitARIMA101,
  forecastARIMA101,
  PredictiveCache,
} from "../../../src/storage/PredictiveCache.js";

describe("PredictiveCache", () => {
  it("ignores paths with too few samples", () => {
    const c = new PredictiveCache();
    c.observe("/a", 1000);
    c.observe("/a", 2000);
    expect(c.predict(5, 3000)).toEqual([]);
  });

  it("ranks a periodic path above sporadic paths", () => {
    const c = new PredictiveCache();
    // /periodic is read every ~100 ms, /sporadic is read with random gaps.
    let t = 1000;
    for (let i = 0; i < 12; i++) {
      c.observe("/periodic", t);
      t += 100;
    }
    let s = 1500;
    for (const gap of [1500, 800, 4000, 200, 6000, 90, 3300]) {
      c.observe("/sporadic", s);
      s += gap;
    }
    const top = c.predict(2, t + 10);
    expect(top[0]).toBe("/periodic");
  });

  it("tracks the configured paths and clears them", () => {
    const c = new PredictiveCache();
    c.observe("/a", 1);
    c.observe("/b", 2);
    expect(c.trackedPathCount()).toBe(2);
    c.clear();
    expect(c.trackedPathCount()).toBe(0);
  });
});

describe("fitARIMA101 + forecastARIMA101", () => {
  it("returns null below minimum sample count", () => {
    expect(fitARIMA101([1, 2])).toBeNull();
  });

  it("forecasts a roughly periodic next delta", () => {
    const samples: number[] = [];
    let t = 0;
    for (let i = 0; i < 30; i++) {
      samples.push(t);
      t += 100;
    }
    const fit = fitARIMA101(samples);
    expect(fit).not.toBeNull();
    if (!fit) return;
    const next = forecastARIMA101(fit, 100);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(500);
  });

  it("never returns a negative forecast", () => {
    const samples = [0, 50, 110, 170, 230, 290, 350];
    const fit = fitARIMA101(samples);
    if (!fit) throw new Error("fit returned null");
    expect(forecastARIMA101(fit, -5000)).toBeGreaterThanOrEqual(0);
  });

  it("fit completes promptly on 1000 observations", () => {
    const samples: number[] = [];
    let t = 0;
    for (let i = 0; i < 1000; i++) {
      samples.push(t);
      t += 100 + (i % 7);
    }
    const start = Date.now();
    const fit = fitARIMA101(samples);
    const elapsed = Date.now() - start;
    expect(fit).not.toBeNull();
    expect(elapsed).toBeLessThan(500);
  });
});
