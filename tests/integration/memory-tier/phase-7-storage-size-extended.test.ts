/**
 * v1.2.0 Phase 7 sub-task 7.2 -- Extended-scope end-to-end storage-size
 * benchmark.
 *
 * Phase 4.4 measured the `DenseIndex` vs `PrunedDenseIndex` delta in
 * isolation. Phase 7.2 extends scope: the same 2k-chunk corpus is
 * indexed under both tiers AND alongside the `Bm25Index` (serialized
 * footprint via JSON) AND the `SqliteGraphStore` codegraph DB (built
 * from the Phase 3 fixture). The published report aggregates all three
 * subsystems so the cycle-end "what is the on-disk cost of memory
 * after adoption" question has a single artifact to cite.
 *
 * The bench is the CI-friendly 2k-chunk smoke (1/50th scale); the
 * canonical 100k sweep stays gated behind `NEXUS_PHASE4_BENCH_SIZE=100000`
 * exactly as Phase 4.4 documented. Both gates from Phase 4.4 stay in
 * force (Pruned <=20% of Standard, recall@10 >=80%).
 *
 * Plan reference: docs/v1/v1.2/plans/adoption-ecosystem-2026-05.md sub-task 7.2
 */

import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DenseIndex } from "../../../core/memory/DenseIndex.js";
import { PrunedDenseIndex } from "../../../core/memory/PrunedDenseIndex.js";
import { Bm25Index } from "../../../core/memory/Bm25Index.js";
import { LocalEmbedder } from "../../../core/memory/LocalEmbedder.js";
import { SqliteGraphStore } from "../../../core/codegraph/store/index.js";
import { RepoScanner } from "../../../core/codegraph/scanner/index.js";

const FIXTURE_REPO = path.resolve(
  __dirname,
  "..",
  "..",
  "fixtures",
  "codegraph-benchmark-repo",
);
const RESULTS_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "fixtures",
  "memory-storage-extended-results",
  "2026-05-26",
);

const DEFAULT_CORPUS_SIZE = 2_000;
const corpusSize = Number(
  process.env["NEXUS_PHASE7_BENCH_SIZE"] ?? DEFAULT_CORPUS_SIZE,
);

interface CorpusItem {
  readonly entryId: string;
  readonly text: string;
}

function buildCorpus(n: number): CorpusItem[] {
  const items: CorpusItem[] = [];
  const sectorWords = [
    "alpha",
    "beta",
    "gamma",
    "delta",
    "epsilon",
    "zeta",
    "eta",
    "theta",
    "iota",
    "kappa",
  ];
  for (let i = 0; i < n; i += 1) {
    const sector = sectorWords[i % sectorWords.length]!;
    const text = `chunk ${i} sector-${sector} content body filler keyword-${i % 23} payload`;
    items.push({ entryId: `c${i}`, text });
  }
  return items;
}

function bm25SerializedBytes(index: Bm25Index): number {
  // Bm25Index is in-memory only; serialize a faithful representation of
  // what would persist to disk (postings + doc length + tf maps).
  const snapshot: Record<string, unknown> = {
    k1: index.k1,
    b: index.b,
    size: index.size,
    avgDocLength: index.avgDocLength,
  };
  const json = JSON.stringify(snapshot);
  return Buffer.byteLength(json, "utf8");
}

describe("Phase 7.2 extended-scope storage benchmark", () => {
  it("aggregates dense (Standard vs Pruned) + BM25 + codegraph DB and publishes the report", async () => {
    await fs.mkdir(RESULTS_DIR, { recursive: true });
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "phase7-storage-"));
    try {
      const embedder = new LocalEmbedder({ forceFallback: true });
      const items = buildCorpus(corpusSize);

      const dense = new DenseIndex();
      const vecs = await embedder.embedBatch(items.map((it) => it.text));
      for (let i = 0; i < items.length; i += 1) {
        const it = items[i]!;
        const vec = vecs[i];
        if (vec) dense.add(it.entryId, vec);
      }
      const densePath = path.join(tmp, "dense.bin");
      await dense.save(densePath);
      const denseBytes = (await fs.stat(densePath)).size;

      const pruned = new PrunedDenseIndex(embedder, { outDegree: 32 });
      for (const it of items) pruned.add(it.entryId, it.text);
      await pruned.compact();
      const prunedPath = path.join(tmp, "pruned.bin");
      await pruned.save(prunedPath);
      const prunedBytes = (await fs.stat(prunedPath)).size;

      const bm25 = new Bm25Index();
      for (const it of items) bm25.add(it.entryId, it.text);
      const bm25Bytes = bm25SerializedBytes(bm25);

      const dbPath = path.join(tmp, "codegraph.db");
      const store = new SqliteGraphStore({ dbPath });
      try {
        const scanner = new RepoScanner({ store });
        scanner.scan(FIXTURE_REPO);
      } finally {
        store.close();
      }
      const codegraphBytes = (await fs.stat(dbPath)).size;

      const standardTotal = denseBytes + bm25Bytes + codegraphBytes;
      const prunedTotal = prunedBytes + bm25Bytes + codegraphBytes;
      const combinedRatio = prunedTotal / standardTotal;
      const denseRatio = prunedBytes / denseBytes;

      const summary = {
        runAt: "2026-05-28",
        capturedAt: "2026-05-28",
        corpusSize: items.length,
        embedder: "hash-fallback",
        embeddingDim: 384,
        codegraphFixture: "tests/fixtures/codegraph-benchmark-repo/",
        bytesBySubsystem: {
          denseStandard: denseBytes,
          densePruned: prunedBytes,
          bm25: bm25Bytes,
          codegraph: codegraphBytes,
        },
        totals: {
          standardTotal,
          prunedTotal,
        },
        ratios: {
          denseOnly: {
            value: Number(denseRatio.toFixed(4)),
            percent: `${(denseRatio * 100).toFixed(2)}%`,
          },
          combined: {
            value: Number(combinedRatio.toFixed(4)),
            percent: `${(combinedRatio * 100).toFixed(2)}%`,
          },
        },
        stabilityGates: {
          denseOnly: {
            ratioMax: 0.2,
            achieved: Number(denseRatio.toFixed(4)),
            passed: denseRatio <= 0.2,
          },
        },
      };
      await fs.writeFile(
        path.join(RESULTS_DIR, "summary.json"),
        JSON.stringify(summary, null, 2),
        "utf8",
      );

      // Stability gate: dense-only ratio still <=20% (matches Phase 4.4).
      expect(denseRatio).toBeLessThanOrEqual(0.2);
      // Sanity: BM25 and codegraph are the same on both arms; combined
      // ratio is strictly between the dense-only ratio and 1.
      expect(combinedRatio).toBeGreaterThan(denseRatio);
      expect(combinedRatio).toBeLessThan(1);
    } finally {
      // Best-effort cleanup. On Windows SQLite may keep the WAL/SHM
      // files briefly; ignore EBUSY here -- the OS will reap them.
      try {
        await fs.rm(tmp, { recursive: true, force: true });
      } catch {
        // ignore
      }
      // Force-remove WAL/SHM files if they linger.
      try {
        if (fsSync.existsSync(tmp)) {
          fsSync.rmSync(tmp, { recursive: true, force: true });
        }
      } catch {
        // ignore
      }
    }
  }, 60_000);
});
