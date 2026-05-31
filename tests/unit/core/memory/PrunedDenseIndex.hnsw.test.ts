/**
 * v1.4.0 Phase 7 (T023 / gap 4.2.P3.K) -- PrunedDenseIndex HNSW build tests.
 *
 * Proves the multi-layer HNSW build path (hnswlib-node) (a) is taken above
 * HNSW_MIN_NODES, (b) falls back to all-pairs below it, (c) preserves recall
 * (exact-match queries retrieve their document), and (d) round-trips through
 * the unchanged topology-only on-disk format.
 */

import { beforeAll, describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  PrunedDenseIndex,
  HNSW_MIN_NODES,
} from "../../../../core/memory/PrunedDenseIndex.js";
import { LocalEmbedder, hashEmbed } from "../../../../core/memory/LocalEmbedder.js";

function embedder(): LocalEmbedder {
  return new LocalEmbedder({ forceFallback: true });
}

// hnswlib-node is an optional native dependency; it may not build on every CI
// host. When present, compact() above the threshold must use the HNSW path;
// when absent it gracefully falls back to all-pairs. Recall is asserted on
// both paths, so the test is meaningful either way.
let HNSW_AVAILABLE = false;
beforeAll(async () => {
  try {
    await import("hnswlib-node");
    HNSW_AVAILABLE = true;
  } catch {
    HNSW_AVAILABLE = false;
  }
});

const N = HNSW_MIN_NODES + 200; // comfortably above the HNSW crossover threshold

function buildDocs(): Array<{ entryId: string; text: string }> {
  return Array.from({ length: N }, (_, i) => ({
    entryId: `d${i}`,
    text: `document number ${i} concerning topic ${i % 37} with tokens alpha beta gamma delta ${i}`,
  }));
}

describe("PrunedDenseIndex HNSW build (gap 4.2.P3.K)", () => {
  it("takes the HNSW build above the threshold and preserves exact-match recall", async () => {
    const idx = new PrunedDenseIndex(embedder());
    idx.addChunks(buildDocs());
    await idx.compact();

    expect(idx.lastBuildMethod).toBe(HNSW_AVAILABLE ? "hnsw" : "allpairs");
    expect(idx.isCompact).toBe(true);
    expect(idx.size).toBe(N);

    const docs = buildDocs();
    for (const target of ["d10", "d123", "d300", "d400"]) {
      const doc = docs.find((d) => d.entryId === target)!;
      const hits = await idx.search(hashEmbed(doc.text), 8);
      expect(hits.length).toBeGreaterThan(0);
      // The exact-match document (cosine 1.0 with itself) is retrieved.
      expect(hits.map((h) => h.entryId)).toContain(target);
    }
  });

  it("falls back to the all-pairs build at/below the threshold", async () => {
    const idx = new PrunedDenseIndex(embedder());
    idx.addChunks(
      Array.from({ length: 12 }, (_, i) => ({ entryId: `s${i}`, text: `small doc ${i}` })),
    );
    await idx.compact();
    expect(idx.lastBuildMethod).toBe("allpairs");
  });

  it("round-trips the HNSW-built topology through save/load (format unchanged)", async () => {
    const idx = new PrunedDenseIndex(embedder());
    idx.addChunks(buildDocs());
    await idx.compact();
    expect(idx.lastBuildMethod).toBe(HNSW_AVAILABLE ? "hnsw" : "allpairs");

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-hnsw-"));
    const file = path.join(tmpDir, "dense-pruned.bin");
    try {
      await idx.save(file);
      const loaded = await PrunedDenseIndex.load(file, embedder());
      expect(loaded.size).toBe(N);
      expect(loaded.isCompact).toBe(true);

      const doc = buildDocs().find((d) => d.entryId === "d50")!;
      const hits = await loaded.search(hashEmbed(doc.text), 8);
      expect(hits.map((h) => h.entryId)).toContain("d50");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
