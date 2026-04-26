import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ToolOutputCache } from "../../src/storage/ToolOutputCache.js";
import { UnifiedMemoryRetriever } from "../../src/storage/UnifiedMemoryRetriever.js";
import type { EmbeddingClient } from "../../src/storage/EmbeddingClient.js";
import { mockOf } from "../helpers/factories.js";

/**
 * Phase 5 (v0.5.0) -- end-to-end semantic-recall fallback test.
 *
 * Drives the full UnifiedMemoryRetriever -> ToolOutputCache path with a real
 * SQLite cache (in-memory) and a mocked EmbeddingClient. Two scenarios are
 * exercised:
 *
 *   1. Embedder reachable -> semantic cosine path returns the relevant row.
 *   2. Embedder unreachable (returns null / throws) -> FTS5 keyword fallback
 *      returns at least one result for an exact-keyword query.
 */
describe("Phase 5 -- semantic recall fallback (end-to-end)", () => {
  let cache: ToolOutputCache;
  let tmpdir: string;

  function writeFile(name: string, content: string): string {
    const p = path.join(tmpdir, name);
    fs.writeFileSync(p, content);
    return p;
  }

  beforeEach(() => {
    cache = new ToolOutputCache({ capacity: 50 });
    cache.open(":memory:");
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-recall-fallback-"));
  });

  afterEach(() => {
    cache.close();
    try {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
  });

  it("falls back to FTS5 when the embedder is unreachable", async () => {
    // Embedder permanently fails -- simulates Ollama down or model missing.
    const failingEmbedder = mockOf<EmbeddingClient>({
      isAvailable: vi.fn(async () => false),
      embed: vi.fn(async () => null),
      embedBatch: vi.fn(async (texts: string[]) => texts.map(() => null)),
    });

    cache.setEmbedder(failingEmbedder);
    const p1 = writeFile(
      "rag.txt",
      "Retrieval-augmented generation pipelines often combine vector search with keyword fallback.",
    );
    const p2 = writeFile(
      "ollama.txt",
      "Ollama is the local LLM runtime that powers offline-first agents.",
    );
    cache.store(p1, fs.readFileSync(p1, "utf8"));
    cache.store(p2, fs.readFileSync(p2, "utf8"));
    await cache.waitForPendingEmbeddings();

    // No row should have an embedding (embedder returned null).
    expect(cache.embeddedCount()).toBe(0);

    const retriever = new UnifiedMemoryRetriever(
      null,
      null,
      null,
      null,
      cache,
      failingEmbedder,
    );
    const results = await retriever.searchToolOutputs("vector keyword fallback", {
      topK: 5,
    });

    // FTS5 fallback should surface at least the rag.txt entry whose excerpt
    // contains the query keywords.
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.absolutePath === p1)).toBe(true);
  });

  it("uses semantic recall when the embedder is reachable", async () => {
    // Hand-rolled vectors: rag.txt is collinear with the query, ollama.txt is
    // orthogonal. Ranking is unambiguous so the test is deterministic.
    const vectors: Record<string, number[]> = {
      rag: [1, 0, 0, 0],
      ollama: [0, 1, 0, 0],
    };
    const resolveVec = (text: string): number[] => {
      if (text.includes("retrieval") || text.includes("Retrieval")) return vectors.rag!;
      if (text.includes("Ollama") || text.includes("ollama")) return vectors.ollama!;
      return vectors.rag!;
    };
    const reachableEmbedder = mockOf<EmbeddingClient>({
      isAvailable: vi.fn(async () => true),
      embed: vi.fn(async (text: string) => resolveVec(text)),
      embedBatch: vi.fn(),
      embedWithProvenance: vi.fn(async (text: string) => ({
        embedding: resolveVec(text),
        provenance: "ollama" as const,
      })),
      embedHeuristic: vi.fn(() => []),
    });

    cache.setEmbedder(reachableEmbedder);
    const p1 = writeFile(
      "rag.txt",
      "Retrieval-augmented generation combines vector search with keyword fallback.",
    );
    const p2 = writeFile(
      "ollama.txt",
      "Ollama is the local LLM runtime.",
    );
    cache.store(p1, fs.readFileSync(p1, "utf8"));
    cache.store(p2, fs.readFileSync(p2, "utf8"));
    await cache.waitForPendingEmbeddings();

    expect(cache.embeddedCount()).toBe(2);

    const retriever = new UnifiedMemoryRetriever(
      null,
      null,
      null,
      null,
      cache,
      reachableEmbedder,
    );
    const results = await retriever.searchToolOutputs("retrieval-augmented generation", {
      topK: 5,
    });

    expect(results.length).toBe(1);
    expect(results[0]!.absolutePath).toBe(p1);
    // Cosine of two collinear unit-ish vectors should be ~1.
    expect(results[0]!.similarity).toBeGreaterThan(0.95);
  });

  it("a paraphrased query still recalls the semantically-relevant row", async () => {
    // Paraphrase test: the query string differs from the stored content,
    // but their embeddings collapse onto the same axis. This confirms the
    // semantic path is doing more than a literal keyword match.
    const sharedVec = [0.7, 0.7, 0, 0]; // unit length doesn't matter for cosine
    const paraphraseEmbedder = mockOf<EmbeddingClient>({
      isAvailable: vi.fn(async () => true),
      embed: vi.fn(async () => sharedVec),
      embedBatch: vi.fn(),
      embedWithProvenance: vi.fn(async () => ({
        embedding: sharedVec,
        provenance: "ollama" as const,
      })),
      embedHeuristic: vi.fn(() => []),
    });

    cache.setEmbedder(paraphraseEmbedder);
    const p = writeFile(
      "doc.txt",
      "The function calculates the sum of two integers using a tail-recursive helper.",
    );
    cache.store(p, fs.readFileSync(p, "utf8"));
    await cache.waitForPendingEmbeddings();

    const retriever = new UnifiedMemoryRetriever(
      null,
      null,
      null,
      null,
      cache,
      paraphraseEmbedder,
    );
    // Paraphrase: literal keyword overlap is low, but embeddings are identical.
    const results = await retriever.searchToolOutputs(
      "computes addition recursively",
      { topK: 5 },
    );

    expect(results.length).toBe(1);
    expect(results[0]!.absolutePath).toBe(p);
  });
});
