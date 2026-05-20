import { describe, it, expect } from "vitest";
import { InMemoryMemoryHub } from "../../../../core/memory/MemoryHub.js";
import { HybridRetriever } from "../../../../core/memory/HybridRetriever.js";
import { Bm25Index } from "../../../../core/memory/Bm25Index.js";
import { DenseIndex } from "../../../../core/memory/DenseIndex.js";
import { LocalEmbedder, hashEmbed } from "../../../../core/memory/LocalEmbedder.js";
import type { MemoryHit } from "../../../../core/memory/MemoryHub.js";

/**
 * v1.1.0 Phase 5.5 -- InMemoryMemoryHub <-> HybridRetriever wiring tests.
 *
 * The hub's retrieve() switches between substring and hybrid paths
 * depending on (a) whether a HybridRetriever was wired and (b) whether
 * the in-memory corpus has exceeded `hybridMinCorpus`. Verifies both
 * branches.
 */

function makeEntry(id: string, content: string): MemoryHit {
  return { id, layer: "semantic", content, score: 0 };
}

describe("InMemoryMemoryHub hybrid wiring", () => {
  it("with no hybridRetriever: falls back to substring", async () => {
    const hub = new InMemoryMemoryHub();
    hub.workingMemory.add({ id: "w1", content: "python pathlib resolve" });
    hub.workingMemory.add({ id: "w2", content: "typescript array" });
    const hits = await hub.retrieve("python", { limit: 5 });
    expect(hits.map((h) => h.id)).toEqual(["w1"]);
  });

  it("with hybridRetriever but small corpus (< hybridMinCorpus): substring", async () => {
    const bm25 = new Bm25Index();
    const dense = new DenseIndex();
    const entries = new Map<string, MemoryHit>();
    for (let i = 0; i < 5; i++) {
      const id = `h${i}`;
      const text = `python pathlib ${i}`;
      bm25.add(id, text);
      dense.add(id, hashEmbed(text));
      entries.set(id, makeEntry(id, text));
    }
    const retriever = new HybridRetriever({
      embedder: new LocalEmbedder({ forceFallback: true }),
      bm25,
      dense,
      entryProvider: (id) => entries.get(id),
    });
    const hub = new InMemoryMemoryHub({
      hybridRetriever: retriever,
      hybridMinCorpus: 100,
    });
    // populate hub working memory with 5 entries -- below the 100 threshold
    for (let i = 0; i < 5; i++) {
      hub.workingMemory.add({ id: `w${i}`, content: `python pathlib working ${i}` });
    }
    const hits = await hub.retrieve("python", { limit: 5 });
    // substring path returns working entries only
    expect(hits.every((h) => h.id.startsWith("w"))).toBe(true);
  });

  it("with hybridRetriever and large corpus (>= hybridMinCorpus): hybrid path", async () => {
    const bm25 = new Bm25Index();
    const dense = new DenseIndex();
    const entries = new Map<string, MemoryHit>();
    for (let i = 0; i < 5; i++) {
      const id = `h${i}`;
      const text = `python pathlib hybrid ${i}`;
      bm25.add(id, text);
      dense.add(id, hashEmbed(text));
      entries.set(id, makeEntry(id, text));
    }
    const retriever = new HybridRetriever({
      embedder: new LocalEmbedder({ forceFallback: true }),
      bm25,
      dense,
      entryProvider: (id) => entries.get(id),
    });
    const hub = new InMemoryMemoryHub({
      hybridRetriever: retriever,
      hybridMinCorpus: 3,
    });
    hub.workingMemory.add({ id: "w1", content: "unrelated" });
    hub.workingMemory.add({ id: "w2", content: "unrelated" });
    hub.workingMemory.add({ id: "w3", content: "unrelated" });
    hub.workingMemory.add({ id: "w4", content: "unrelated" });
    const hits = await hub.retrieve("python pathlib", { limit: 5 });
    // hybrid path returns the indexed h* entries, not the substring w* ones
    expect(hits.every((h) => h.id.startsWith("h"))).toBe(true);
  });

  it("setHybridRetriever can be flipped at runtime (warm-build path)", async () => {
    const hub = new InMemoryMemoryHub({ hybridMinCorpus: 0 });
    hub.workingMemory.add({ id: "w1", content: "python pathlib" });
    const beforeHits = await hub.retrieve("python");
    expect(beforeHits[0]?.id).toBe("w1");
    const bm25 = new Bm25Index();
    const dense = new DenseIndex();
    const entries = new Map<string, MemoryHit>();
    bm25.add("h1", "python pathlib indexed");
    dense.add("h1", hashEmbed("python pathlib indexed"));
    entries.set("h1", makeEntry("h1", "python pathlib indexed"));
    const retriever = new HybridRetriever({
      embedder: new LocalEmbedder({ forceFallback: true }),
      bm25,
      dense,
      entryProvider: (id) => entries.get(id),
    });
    hub.setHybridRetriever(retriever);
    const afterHits = await hub.retrieve("python pathlib");
    expect(afterHits[0]?.id).toBe("h1");
  });

  it("empty hybrid retriever degrades back to substring", async () => {
    const bm25 = new Bm25Index();
    const dense = new DenseIndex();
    const retriever = new HybridRetriever({
      embedder: new LocalEmbedder({ forceFallback: true }),
      bm25,
      dense,
      entryProvider: () => undefined,
    });
    const hub = new InMemoryMemoryHub({
      hybridRetriever: retriever,
      hybridMinCorpus: 0,
    });
    hub.workingMemory.add({ id: "w1", content: "python" });
    const hits = await hub.retrieve("python");
    expect(hits.map((h) => h.id)).toEqual(["w1"]);
  });
});
