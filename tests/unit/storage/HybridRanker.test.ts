import { describe, it, expect } from "vitest";
import {
  HybridRanker,
  computeRecencyScore,
  type VectorCandidate,
  type LexicalCandidate,
} from "../../../src/storage/HybridRanker.js";
import type { MemoryEntry } from "../../../src/storage/MemoryShared.types.js";

function entry(id: string, accessedAt = 0): MemoryEntry {
  return {
    id,
    sessionId: null,
    content: `content-${id}`,
    type: "fact",
    embedding: null,
    createdAt: 0,
    accessedAt,
    accessCount: 0,
    relevanceDecay: 1,
    corroborationCount: 1,
  };
}

describe("HybridRanker", () => {
  it("returns an empty list when both inputs are empty", () => {
    const ranker = new HybridRanker({ now: 0 });
    expect(ranker.rank([], [])).toEqual([]);
  });

  it("RRF fuses entries that appear in both rankers above singletons", () => {
    const v: VectorCandidate[] = [
      { entry: entry("a"), similarity: 0.9, source: "hnsw" },
      { entry: entry("b"), similarity: 0.7 },
    ];
    const l: LexicalCandidate[] = [
      { entry: entry("a"), score: 0.8 },
      { entry: entry("c"), score: 0.6 },
    ];
    const ranker = new HybridRanker({ method: "rrf", now: 0 });
    const out = ranker.rank(v, l);
    expect(out[0]!.entry.id).toBe("a");
    expect(out[0]!.reason.length).toBeGreaterThanOrEqual(2);
  });

  it("every RRF result carries at least one reason (property test)", () => {
    const v: VectorCandidate[] = Array.from({ length: 5 }, (_, i) => ({
      entry: entry(`v${i}`, Date.now() - i * 1000),
      similarity: 0.9 - i * 0.1,
    }));
    const l: LexicalCandidate[] = Array.from({ length: 5 }, (_, i) => ({
      entry: entry(`l${i}`),
      score: 0.8 - i * 0.1,
    }));
    const ranker = new HybridRanker({ now: Date.now() });
    const out = ranker.rank(v, l);
    expect(out.length).toBeGreaterThan(0);
    for (const r of out) {
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it("weighted method uses 50/30/20 split", () => {
    const ts = 1_000_000;
    const v: VectorCandidate[] = [{ entry: entry("a", ts), similarity: 1.0 }];
    const l: LexicalCandidate[] = [{ entry: entry("a", ts), score: 1.0 }];
    const ranker = new HybridRanker({ method: "weighted", now: ts });
    const out = ranker.rank(v, l);
    // 0.5 * 1 + 0.3 * 1 + 0.2 * 1 = 1.0
    expect(out[0]!.score).toBeCloseTo(1.0, 5);
  });

  it("recency decay halves around the half-life", () => {
    const halfLife = 1000;
    const now = 10_000;
    const fresh = computeRecencyScore(now, now, halfLife);
    const oneHalfLife = computeRecencyScore(now - halfLife, now, halfLife);
    const twoHalfLives = computeRecencyScore(now - 2 * halfLife, now, halfLife);
    expect(fresh).toBeCloseTo(1.0, 5);
    expect(oneHalfLife).toBeCloseTo(0.5, 5);
    expect(twoHalfLives).toBeCloseTo(0.25, 5);
  });

  it("ranking is deterministic given the same inputs", () => {
    const v: VectorCandidate[] = [
      { entry: entry("a", 1), similarity: 0.9 },
      { entry: entry("b", 1), similarity: 0.6 },
    ];
    const l: LexicalCandidate[] = [
      { entry: entry("b", 1), score: 0.7 },
      { entry: entry("c", 1), score: 0.5 },
    ];
    const r1 = new HybridRanker({ method: "rrf", now: 100 }).rank(v, l);
    const r2 = new HybridRanker({ method: "rrf", now: 100 }).rank(v, l);
    expect(r1.map((r) => r.entry.id)).toEqual(r2.map((r) => r.entry.id));
  });

  it("respects the limit option", () => {
    const v: VectorCandidate[] = Array.from({ length: 10 }, (_, i) => ({
      entry: entry(`v${i}`),
      similarity: 0.9 - i * 0.05,
    }));
    const ranker = new HybridRanker({ limit: 3, now: 0 });
    const out = ranker.rank(v, []);
    expect(out.length).toBe(3);
  });
});
