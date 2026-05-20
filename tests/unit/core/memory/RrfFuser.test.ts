import { describe, it, expect } from "vitest";
import {
  fuse,
  RrfFuser,
  DEFAULT_RRF_K,
} from "../../../../core/memory/RrfFuser.js";

/**
 * v1.1.0 Phase 5.4 -- Reciprocal Rank Fusion unit tests.
 *
 * Covers:
 *   - DEFAULT_RRF_K is 60 (the canonical Cormack et al. value)
 *   - Hand-computed example from the original paper
 *   - Insertion-order semantics (Maps preserve iteration order)
 *   - Lower k boosts top-of-list confidence
 *   - Tie-breaking is deterministic
 */

describe("RrfFuser", () => {
  it("DEFAULT_RRF_K is 60", () => {
    expect(DEFAULT_RRF_K).toBe(60);
  });

  it("RrfFuser uses k=60 by default", () => {
    const f = new RrfFuser();
    expect(f.k).toBe(60);
  });

  it("hand-computed: three rankings, k=60", () => {
    // ranking A: [a, b, c, d]
    // ranking B: [b, a, e]
    // ranking C: [a, c, f]
    const a = new Map<string, number>([
      ["a", 4],
      ["b", 3],
      ["c", 2],
      ["d", 1],
    ]);
    const b = new Map<string, number>([
      ["b", 3],
      ["a", 2],
      ["e", 1],
    ]);
    const c = new Map<string, number>([
      ["a", 3],
      ["c", 2],
      ["f", 1],
    ]);
    const fused = fuse([a, b, c], 60);
    // a: 1/61 + 1/62 + 1/61 = 0.0163934 + 0.0161290 + 0.0163934 = 0.0489158
    // b: 1/62 + 1/61 = 0.0161290 + 0.0163934 = 0.0325224
    // c: 1/63 + 1/62 = 0.0158730 + 0.0161290 = 0.0320020
    // d: 1/64 = 0.0156250
    // e: 1/63 = 0.0158730
    // f: 1/63 = 0.0158730
    const order = [...fused.keys()];
    expect(order[0]).toBe("a");
    expect(order[1]).toBe("b");
    expect(fused.get("a")!).toBeCloseTo(1 / 61 + 1 / 62 + 1 / 61, 6);
    expect(fused.get("d")!).toBeCloseTo(1 / 64, 6);
  });

  it("single ranking: fused output preserves ranking order", () => {
    const r = new Map<string, number>([
      ["x", 5],
      ["y", 4],
      ["z", 3],
    ]);
    const fused = fuse([r]);
    expect([...fused.keys()]).toEqual(["x", "y", "z"]);
  });

  it("empty rankings list returns empty fused map", () => {
    expect([...fuse([]).keys()]).toEqual([]);
  });

  it("lower k boosts top-of-list confidence relative to lower ranks", () => {
    const r = new Map<string, number>([
      ["top", 10],
      ["mid", 5],
      ["bot", 1],
    ]);
    const tightK = fuse([r], 1);
    const loose = fuse([r], 1000);
    const tightRatio = tightK.get("top")! / tightK.get("bot")!;
    const looseRatio = loose.get("top")! / loose.get("bot")!;
    expect(tightRatio).toBeGreaterThan(looseRatio);
  });

  it("ties broken by entryId ascending", () => {
    const r1 = new Map<string, number>([["zeta", 1]]);
    const r2 = new Map<string, number>([["alpha", 1]]);
    const fused = fuse([r1, r2]);
    expect([...fused.keys()]).toEqual(["alpha", "zeta"]);
  });

  it("RrfFuser.fuse delegates to the free function with the instance k", () => {
    const f = new RrfFuser(10);
    const r = new Map<string, number>([
      ["x", 1],
      ["y", 1],
    ]);
    const fused = f.fuse([r]);
    expect(fused.get("x")!).toBeCloseTo(1 / 11, 6);
    expect(fused.get("y")!).toBeCloseTo(1 / 12, 6);
  });

  it("RrfFuser.k is mutable so SettingsStore listeners can update it", () => {
    const f = new RrfFuser(60);
    f.k = 30;
    expect(f.k).toBe(30);
    const r = new Map<string, number>([["x", 1]]);
    expect(f.fuse([r]).get("x")!).toBeCloseTo(1 / 31, 6);
  });
});
