/**
 * Heuristic embedder fallback -- threshold-elevation regression test.
 *
 * Pen-test finding F-007 (and known-gaps section 5.1) flagged that semantic
 * memory search kept using the default 0.85 cosine threshold even for rows
 * embedded with the heuristic fallback. The heuristic embedder is a
 * deterministic 128-D bag-of-words approximation; its noise floor is
 * materially higher than Ollama's, so the configured threshold is raised
 * for `embedding_provenance = 'heuristic'` rows.
 *
 * Phase 5 / sub-task 5.2 of the v0.6.0 cycle plan landed the per-row
 * threshold elevation in `ToolOutputCache.searchByEmbedding`. This file
 * exercises the contract end-to-end through `UnifiedMemoryRetriever`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ToolOutputCache } from "../../src/storage/ToolOutputCache.js";
import { UnifiedMemoryRetriever } from "../../src/storage/UnifiedMemoryRetriever.js";
import type { EmbeddingClient } from "../../src/storage/EmbeddingClient.js";
import { mockOf } from "../helpers/factories.js";

describe("heuristic-fallback threshold elevation", () => {
  let cache: ToolOutputCache;
  let retriever: UnifiedMemoryRetriever;
  let tmpdir: string;

  // The query is collinear with VEC_NEAR (cosine ~= 1) and noticeably off
  // VEC_FAR (cosine ~= 0.92). With Ollama-tier threshold 0.85 both clear it;
  // with the elevated heuristic threshold 0.95, only VEC_NEAR survives.
  const VEC_NEAR = [1, 0, 0, 0];
  const VEC_FAR = [0.92, 0.39, 0, 0];
  const QUERY = [1, 0, 0, 0];

  function writeFile(name: string, content: string): string {
    const p = path.join(tmpdir, name);
    fs.writeFileSync(p, content);
    return p;
  }

  function makeEmbedder(
    map: Record<string, { embedding: number[]; provenance: "ollama" | "heuristic" }>,
  ): EmbeddingClient {
    return mockOf<EmbeddingClient>({
      isAvailable: vi.fn(async () => true),
      embed: vi.fn(async (text: string) => map[text]?.embedding ?? null),
      embedBatch: vi.fn(async (texts: string[]) =>
        texts.map((t) => map[t]?.embedding ?? null),
      ),
      embedWithProvenance: vi.fn(async (text: string) => {
        const entry = map[text];
        return entry
          ? { embedding: entry.embedding, provenance: entry.provenance }
          : null;
      }),
      embedHeuristic: vi.fn(() => []),
    });
  }

  beforeEach(() => {
    cache = new ToolOutputCache({ capacity: 50 });
    cache.open(":memory:");
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "heuristic-fallback-"));
  });

  afterEach(() => {
    cache.close();
    try {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
  });

  it("filters heuristic-tagged rows below the elevated cosine threshold", async () => {
    const nearPath = writeFile("near.txt", "near content");
    const farPath = writeFile("far.txt", "far content");

    const writeEmbedder = makeEmbedder({
      "near content": { embedding: VEC_NEAR, provenance: "heuristic" },
      "far content": { embedding: VEC_FAR, provenance: "heuristic" },
    });
    cache.setEmbedder(writeEmbedder);
    cache.store(nearPath, "near content");
    cache.store(farPath, "far content");
    await cache.waitForPendingEmbeddings();

    const queryEmbedder = makeEmbedder({
      query: { embedding: QUERY, provenance: "ollama" },
    });
    retriever = new UnifiedMemoryRetriever(null, null, null, null, cache, queryEmbedder);

    const results = await retriever.searchToolOutputs("query", { topK: 5 });

    // VEC_NEAR (cosine = 1) clears the elevated 0.95 bar; VEC_FAR (cosine ~ 0.92)
    // is filtered out even though it would have cleared the legacy 0.85 bar.
    expect(results).toHaveLength(1);
    expect(results[0]!.absolutePath).toBe(nearPath);
  });

  it("preserves the default 0.85 threshold for ollama-provenance rows", async () => {
    const nearPath = writeFile("near.txt", "near content");
    const farPath = writeFile("far.txt", "far content");

    const writeEmbedder = makeEmbedder({
      "near content": { embedding: VEC_NEAR, provenance: "ollama" },
      "far content": { embedding: VEC_FAR, provenance: "ollama" },
    });
    cache.setEmbedder(writeEmbedder);
    cache.store(nearPath, "near content");
    cache.store(farPath, "far content");
    await cache.waitForPendingEmbeddings();

    const queryEmbedder = makeEmbedder({
      query: { embedding: QUERY, provenance: "ollama" },
    });
    retriever = new UnifiedMemoryRetriever(null, null, null, null, cache, queryEmbedder);

    const results = await retriever.searchToolOutputs("query", { topK: 5 });

    // Both rows clear the 0.85 ollama-tier bar.
    expect(results).toHaveLength(2);
    const paths = results.map((r) => r.absolutePath).sort();
    expect(paths).toEqual([farPath, nearPath].sort());
  });

  it("falls back to keyword search when no rows clear the elevated threshold", async () => {
    const farPath = writeFile("far.txt", "the unique alpha keyword sits here");

    const writeEmbedder = makeEmbedder({
      "the unique alpha keyword sits here": {
        embedding: VEC_FAR,
        provenance: "heuristic",
      },
    });
    cache.setEmbedder(writeEmbedder);
    cache.store(farPath, "the unique alpha keyword sits here");
    await cache.waitForPendingEmbeddings();

    const queryEmbedder = makeEmbedder({
      alpha: { embedding: QUERY, provenance: "ollama" },
    });
    retriever = new UnifiedMemoryRetriever(null, null, null, null, cache, queryEmbedder);

    const results = await retriever.searchToolOutputs("alpha", { topK: 5 });

    // Semantic step returns 0 rows (only heuristic row is below 0.95);
    // FTS5 fallback then matches the literal keyword.
    expect(results).toHaveLength(1);
    expect(results[0]!.absolutePath).toBe(farPath);
  });
});
