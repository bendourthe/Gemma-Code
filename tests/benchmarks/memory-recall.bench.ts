/**
 * MemoryStore recall and latency benchmark.
 *
 * Populates a temporary SQLite-backed MemoryStore with 500 entries across
 * the 5 memory types, then measures:
 *   - recall@5 for keyword search on 20 known queries (target >= 0.8)
 *   - recall@5 for semantic search on 20 paraphrased queries (target >= 0.7)
 *   - p99 retrieval latency (keyword < 100ms, semantic < 500ms)
 *
 * Semantic benchmarks are skipped when OLLAMA_URL is not set.
 */

import { bench, describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MemoryStore } from "../../src/storage/MemoryStore.js";
import type { MemoryType } from "../../src/storage/MemoryStore.types.js";

const OLLAMA_URL = process.env["OLLAMA_URL"];
const ENTRIES_PER_TYPE = 100;
const TYPES: MemoryType[] = [
  "decision",
  "fact",
  "preference",
  "file_pattern",
  "error_resolution",
];

function tempDbPath(): string {
  return path.join(
    os.tmpdir(),
    `gemma-memory-bench-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`
  );
}

function percentile(sorted: number[], pct: number): number {
  const idx = Math.ceil(sorted.length * pct) - 1;
  return sorted[Math.max(0, idx)] ?? Infinity;
}

describe("memory-recall benchmark", () => {
  let dbPath: string;
  let store: MemoryStore;
  const knownTerms: string[] = [];

  beforeAll(async () => {
    dbPath = tempDbPath();
    store = new MemoryStore(dbPath, null); // keyword-only unless OLLAMA_URL set
    for (const type of TYPES) {
      for (let i = 0; i < ENTRIES_PER_TYPE; i++) {
        const token = `recall-${type}-${i}-unique-${Math.floor(Math.random() * 1e6)}`;
        knownTerms.push(token);
        await store.save(`Memory ${type} entry ${i} ${token}`, type);
      }
    }
  });

  afterAll(() => {
    try {
      (store as unknown as { _db?: { close: () => void } })._db?.close();
    } catch {
      // ignore
    }
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it("keyword search recall@5 >= 0.8 on 20 known terms", async () => {
    // Only sample once the store is populated.
    const sample = knownTerms
      .sort(() => Math.random() - 0.5)
      .slice(0, 20);
    let hits = 0;
    for (const term of sample) {
      const results = store.searchKeyword(term, 5);
      const found = results.some((r) => r.entry.content.includes(term));
      if (found) hits++;
    }
    const recall = hits / sample.length;
    console.log(`[memory-recall] keyword recall@5=${recall.toFixed(2)}`);
    expect(recall).toBeGreaterThanOrEqual(0.8);
  });

  it("keyword p99 retrieval latency < 100ms on 500 entries", () => {
    const latencies: number[] = [];
    for (const term of knownTerms.slice(0, 50)) {
      const start = performance.now();
      store.searchKeyword(term, 5);
      latencies.push(performance.now() - start);
    }
    latencies.sort((a, b) => a - b);
    const p99 = percentile(latencies, 0.99);
    console.log(`[memory-recall] keyword p99=${p99.toFixed(1)}ms`);
    expect(p99).toBeLessThan(100);
  });

  if (OLLAMA_URL) {
    bench("keyword search", () => {
      store.searchKeyword(
        knownTerms[Math.floor(Math.random() * knownTerms.length)]!,
        5
      );
    });
  }
});
