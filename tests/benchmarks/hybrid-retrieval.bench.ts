/**
 * v1.1.0 Phase 5.7 -- hybrid retrieval latency benchmark.
 *
 * Populates a 1,000-entry HybridRetriever and asserts:
 *   - p50 retrieve() latency < 50 ms
 *   - p99 retrieve() latency < 150 ms
 *   - BM25 add() median latency < 5 ms
 *
 * Uses the `LocalEmbedder` hash-fallback so the benchmark runs in CI
 * without the optional `@xenova/transformers` runtime.
 */

import { describe, it, expect, bench, beforeAll } from "vitest";
import { HybridRetriever } from "../../core/memory/HybridRetriever.js";
import { Bm25Index } from "../../core/memory/Bm25Index.js";
import { DenseIndex } from "../../core/memory/DenseIndex.js";
import {
  LocalEmbedder,
  hashEmbed,
} from "../../core/memory/LocalEmbedder.js";
import type { MemoryHit } from "../../core/memory/MemoryHub.js";

const CORPUS_SIZE = 1000;
const WORDS = ["python", "typescript", "rust", "go", "ruby", "java"];

interface BenchFixture {
  bm25: Bm25Index;
  dense: DenseIndex;
  entries: Map<string, MemoryHit>;
  retriever: HybridRetriever;
}

function buildFixture(): BenchFixture {
  const bm25 = new Bm25Index();
  const dense = new DenseIndex();
  const entries = new Map<string, MemoryHit>();
  for (let i = 0; i < CORPUS_SIZE; i++) {
    const id = `e${i}`;
    const text = `${WORDS[i % WORDS.length]} pattern ${i} foo bar baz qux`;
    bm25.add(id, text);
    dense.add(id, hashEmbed(text));
    entries.set(id, { id, layer: "semantic", content: text, score: 0 });
  }
  const retriever = new HybridRetriever({
    embedder: new LocalEmbedder({ forceFallback: true }),
    bm25,
    dense,
    entryProvider: (id) => entries.get(id),
  });
  return { bm25, dense, entries, retriever };
}

describe("Phase 5.7 hybrid retrieval latency", () => {
  let fixture: BenchFixture;
  beforeAll(() => {
    fixture = buildFixture();
  });

  it("p50 < 50 ms and p99 < 150 ms over 100 retrievals", async () => {
    await fixture.retriever.retrieve("python pattern", { limit: 10 });
    const lats: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = process.hrtime.bigint();
      await fixture.retriever.retrieve(`${WORDS[i % WORDS.length]} pattern foo`, {
        limit: 10,
      });
      lats.push(Number(process.hrtime.bigint() - start) / 1_000_000);
    }
    lats.sort((a, b) => a - b);
    const p50 = lats[Math.floor(lats.length * 0.5)]!;
    const p99 = lats[Math.floor(lats.length * 0.99)]!;
    expect(p50).toBeLessThan(50);
    expect(p99).toBeLessThan(150);
  });

  it("BM25 add() median latency on a 1,000-entry corpus < 5 ms", () => {
    const lats: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = process.hrtime.bigint();
      fixture.bm25.add(`bench-${i}`, "python pattern fresh entry");
      lats.push(Number(process.hrtime.bigint() - start) / 1_000_000);
    }
    lats.sort((a, b) => a - b);
    const median = lats[Math.floor(lats.length / 2)]!;
    expect(median).toBeLessThan(5);
  });
});

bench("hybrid retrieve top-10 on 1,000 entries", async () => {
  const fixture = buildFixture();
  await fixture.retriever.retrieve("python pattern foo", { limit: 10 });
});
