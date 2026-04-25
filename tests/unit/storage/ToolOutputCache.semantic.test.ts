import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  ToolOutputCache,
  resetEmbeddingStats,
  getEmbeddingStats,
} from "../../../src/storage/ToolOutputCache.js";
import type { EmbeddingClient } from "../../../src/storage/EmbeddingClient.js";
import { mockOf } from "../../helpers/factories.js";

/**
 * Phase 5 (v0.5.0) -- Semantic recall over the persistent tool-output cache.
 *
 * Each test runs against an in-memory SQLite database and a freshly-created
 * tmpdir for the file fixtures. EmbeddingClient is mocked with vector
 * literals so cosine math is deterministic; no Ollama dependency.
 */
describe("ToolOutputCache (Phase 5 -- semantic recall)", () => {
  let cache: ToolOutputCache;
  let tmpdir: string;

  // Three vectors picked so cosine vs. QUERY_NEAR_A is unambiguous:
  //   VEC_B is collinear with the query (cosine = 1)
  //   VEC_A is just off-axis (cosine ~ 0.9986)
  //   VEC_C is orthogonal (cosine = 0, below 0.85 threshold)
  const VEC_A = [1, 0, 0, 0];
  const VEC_B = [0.95, 0.05, 0, 0];
  const VEC_C = [0, 1, 0, 0];
  const QUERY_NEAR_A = [0.95, 0.05, 0, 0];

  function makeEmbedder(
    map: Record<string, number[] | null>,
  ): EmbeddingClient {
    return mockOf<EmbeddingClient>({
      isAvailable: vi.fn(async () => true),
      embed: vi.fn(async (text: string) => map[text] ?? null),
      embedBatch: vi.fn(async (texts: string[]) => texts.map((t) => map[t] ?? null)),
    });
  }

  function writeFile(name: string, content: string): string {
    const p = path.join(tmpdir, name);
    fs.writeFileSync(p, content);
    return p;
  }

  beforeEach(() => {
    cache = new ToolOutputCache({ capacity: 50 });
    cache.open(":memory:");
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-output-cache-semantic-"));
    resetEmbeddingStats();
  });

  afterEach(() => {
    cache.close();
    try {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
  });

  // -------------------------------------------------------------------------
  // Schema migration
  // -------------------------------------------------------------------------

  it("includes embedding and excerpt columns after _initSchema", () => {
    // Round-trip a fresh entry; getEmbedding should be queryable (returns null
    // because no embedder is wired) without throwing -- proves the column
    // exists.
    const p = writeFile("a.txt", "hello world");
    cache.store(p, "hello world");
    expect(cache.getEmbedding(p)).toBeNull();
    expect(cache.embeddedCount()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Embed-after-store (with embedder wired)
  // -------------------------------------------------------------------------

  it("populates the embedding column asynchronously after store() when an embedder is wired", async () => {
    const embedder = makeEmbedder({ "hello world": VEC_A });
    cache.setEmbedder(embedder);

    const p = writeFile("a.txt", "hello world");
    cache.store(p, "hello world");
    expect(cache.embeddedCount()).toBe(0); // not yet -- async
    await cache.waitForPendingEmbeddings();

    expect(cache.embeddedCount()).toBe(1);
    const stored = cache.getEmbedding(p);
    expect(stored).not.toBeNull();
    expect(stored!.length).toBe(VEC_A.length);
    // Float64 round-trip should be lossless.
    for (let i = 0; i < VEC_A.length; i++) {
      expect(stored![i]).toBeCloseTo(VEC_A[i]!, 10);
    }

    expect(getEmbeddingStats().embeddedRows).toBe(1);
  });

  it("increments skippedOllamaOffline when the embedder returns null", async () => {
    const embedder = makeEmbedder({ "offline content": null });
    cache.setEmbedder(embedder);

    const p = writeFile("a.txt", "offline content");
    cache.store(p, "offline content");
    await cache.waitForPendingEmbeddings();

    expect(cache.embeddedCount()).toBe(0);
    expect(getEmbeddingStats().skippedOllamaOffline).toBe(1);
  });

  it("increments skippedNoEmbedder when no embedder is wired", () => {
    const p = writeFile("a.txt", "without embedder");
    cache.store(p, "without embedder");

    expect(getEmbeddingStats().skippedNoEmbedder).toBeGreaterThanOrEqual(1);
    expect(getEmbeddingStats().embeddedRows).toBe(0);
  });

  it("clears the embedding when the row is overwritten by a fresh store()", async () => {
    const embedder = makeEmbedder({ "v1": VEC_A, "v2": VEC_C });
    cache.setEmbedder(embedder);

    const p = writeFile("a.txt", "v1");
    cache.store(p, "v1");
    await cache.waitForPendingEmbeddings();
    expect(cache.embeddedCount()).toBe(1);

    // Overwrite with new content.
    fs.writeFileSync(p, "v2");
    cache.store(p, "v2");
    // Immediately after store, embedding should be NULL (cleared).
    expect(cache.getEmbedding(p)).toBeNull();

    await cache.waitForPendingEmbeddings();
    const refreshed = cache.getEmbedding(p);
    expect(refreshed).not.toBeNull();
    expect(refreshed![0]).toBeCloseTo(VEC_C[0]!, 10);
  });

  // -------------------------------------------------------------------------
  // searchByEmbedding -- cosine similarity ranking
  // -------------------------------------------------------------------------

  it("ranks results by cosine similarity descending", async () => {
    const embedder = makeEmbedder({
      "near-A content": VEC_B,
      "far-from-A content": VEC_C,
      "is-A content": VEC_A,
    });
    cache.setEmbedder(embedder);

    const pA = writeFile("a.txt", "is-A content");
    const pB = writeFile("b.txt", "near-A content");
    const pC = writeFile("c.txt", "far-from-A content");
    cache.store(pA, "is-A content");
    cache.store(pB, "near-A content");
    cache.store(pC, "far-from-A content");
    await cache.waitForPendingEmbeddings();

    const results = cache.searchByEmbedding(QUERY_NEAR_A, { topK: 5 });
    // Threshold 0.85 should keep VEC_A (score 0.95) and VEC_B (~0.997)
    // and drop VEC_C (score 0).
    expect(results.length).toBe(2);
    // Highest cosine first.
    expect(results[0]!.absolutePath).toBe(pB);
    expect(results[1]!.absolutePath).toBe(pA);
    expect(results[0]!.similarity).toBeGreaterThan(results[1]!.similarity);
    expect(results.find((r) => r.absolutePath === pC)).toBeUndefined();
  });

  it("respects the threshold parameter override", async () => {
    const embedder = makeEmbedder({
      "near-A content": VEC_B,
      "is-A content": VEC_A,
    });
    cache.setEmbedder(embedder);

    const pA = writeFile("a.txt", "is-A content");
    const pB = writeFile("b.txt", "near-A content");
    cache.store(pA, "is-A content");
    cache.store(pB, "near-A content");
    await cache.waitForPendingEmbeddings();

    // A draconian threshold should drop everything except the (near-)perfect match.
    const results = cache.searchByEmbedding(QUERY_NEAR_A, {
      topK: 5,
      threshold: 0.999,
    });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("respects topK", async () => {
    const embedder = makeEmbedder({
      "is-A": VEC_A,
      "near-A": VEC_B,
    });
    cache.setEmbedder(embedder);

    const pA = writeFile("a.txt", "is-A");
    const pB = writeFile("b.txt", "near-A");
    cache.store(pA, "is-A");
    cache.store(pB, "near-A");
    await cache.waitForPendingEmbeddings();

    const results = cache.searchByEmbedding(QUERY_NEAR_A, { topK: 1 });
    expect(results.length).toBe(1);
  });

  it("returns empty result when no rows have embeddings", () => {
    const p = writeFile("a.txt", "no embedding");
    cache.store(p, "no embedding");
    const results = cache.searchByEmbedding(QUERY_NEAR_A, { topK: 5 });
    expect(results).toEqual([]);
  });

  it("returns empty result for an empty queryVec", () => {
    const results = cache.searchByEmbedding([], { topK: 5 });
    expect(results).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // searchByKeyword (FTS5 fallback)
  // -------------------------------------------------------------------------

  it("FTS5 keyword fallback returns rows whose excerpt matches", () => {
    const p1 = writeFile("a.txt", "the quick brown fox jumps over the lazy dog");
    const p2 = writeFile("b.txt", "lorem ipsum dolor sit amet");
    cache.store(p1, "the quick brown fox jumps over the lazy dog");
    cache.store(p2, "lorem ipsum dolor sit amet");

    const results = cache.searchByKeyword("brown fox", 5);
    expect(results.length).toBe(1);
    expect(results[0]!.absolutePath).toBe(p1);
    expect(results[0]!.content).toBe(
      "the quick brown fox jumps over the lazy dog",
    );
    expect(results[0]!.similarity).toBeGreaterThan(0);
  });

  it("FTS5 returns empty when no row matches", () => {
    const p = writeFile("a.txt", "alpha beta gamma");
    cache.store(p, "alpha beta gamma");
    const results = cache.searchByKeyword("xyzzy unknownword", 5);
    expect(results).toEqual([]);
  });

  it("FTS5 returns empty for an empty / pure-operator query", () => {
    const p = writeFile("a.txt", "alpha beta gamma");
    cache.store(p, "alpha beta gamma");
    expect(cache.searchByKeyword("", 5)).toEqual([]);
    expect(cache.searchByKeyword("AND OR NOT", 5)).toEqual([]);
  });

  it("FTS5 truncates long content to the excerpt length but still indexes it", () => {
    // Content longer than the 4 KB excerpt cap; the unique keyword must live
    // in the first 4 KB to be searchable.
    const head = "anchor_token_unique alpha beta ";
    const tail = "x".repeat(8 * 1024);
    const content = head + tail;
    const p = writeFile("a.txt", content);
    cache.store(p, content);

    const results = cache.searchByKeyword("anchor_token_unique", 5);
    expect(results.length).toBe(1);
    // The full content -- not the excerpt -- is returned.
    expect(results[0]!.content.length).toBe(content.length);
  });
});
