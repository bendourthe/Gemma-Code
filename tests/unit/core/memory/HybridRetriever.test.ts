import { describe, it, expect } from "vitest";
import {
  HybridRetriever,
  substringFallback,
} from "../../../../core/memory/HybridRetriever.js";
import { Bm25Index } from "../../../../core/memory/Bm25Index.js";
import { DenseIndex } from "../../../../core/memory/DenseIndex.js";
import {
  LocalEmbedder,
  hashEmbed,
} from "../../../../core/memory/LocalEmbedder.js";
import type { MemoryHit } from "../../../../core/memory/MemoryHub.js";

/**
 * v1.1.0 Phase 5.5 -- HybridRetriever unit + integration tests.
 *
 * Covers:
 *   - BM25 + Dense + Graph all-three ranking
 *   - Graceful degradation when a stage is empty
 *   - Scope filtering honours visibleScopes
 *   - 1,000-entry corpus retrieves in <50 ms p50, <150 ms p99
 *   - Regression: substring top hits stay in the hybrid top-10
 */

function makeEntry(id: string, content: string, scopeId?: string | null): MemoryHit {
  return {
    id,
    layer: "semantic",
    content,
    score: 0,
    ...(scopeId !== undefined ? { scopeId } : {}),
  };
}

function buildCorpus(): {
  bm25: Bm25Index;
  dense: DenseIndex;
  entries: Map<string, MemoryHit>;
  embedder: LocalEmbedder;
} {
  const bm25 = new Bm25Index();
  const dense = new DenseIndex();
  const entries = new Map<string, MemoryHit>();
  const embedder = new LocalEmbedder({ forceFallback: true });
  const fixtures: Array<[string, string]> = [
    ["e1", "python pathlib resolve absolute"],
    ["e2", "python pathlib normalize relative"],
    ["e3", "typescript array map filter reduce"],
    ["e4", "rust ownership borrowing lifetimes"],
    ["e5", "go goroutine channel select"],
    ["e6", "python typing generics"],
    ["e7", "javascript promise async await"],
    ["e8", "git rebase interactive squash"],
    ["e9", "docker compose multi-stage build"],
    ["e10", "react hooks useEffect cleanup"],
  ];
  for (const [id, text] of fixtures) {
    bm25.add(id, text);
    dense.add(id, hashEmbed(text));
    entries.set(id, makeEntry(id, text));
  }
  return { bm25, dense, entries, embedder };
}

describe("HybridRetriever", () => {
  it("uses default RRF k=60", () => {
    const c = buildCorpus();
    const r = new HybridRetriever({
      embedder: c.embedder,
      bm25: c.bm25,
      dense: c.dense,
      entryProvider: (id) => c.entries.get(id),
    });
    expect(r.rrfK).toBe(60);
  });

  it("setRrfK updates the fuser at runtime", () => {
    const c = buildCorpus();
    const r = new HybridRetriever({
      embedder: c.embedder,
      bm25: c.bm25,
      dense: c.dense,
      entryProvider: (id) => c.entries.get(id),
    });
    r.setRrfK(30);
    expect(r.rrfK).toBe(30);
  });

  it("isReady is true once at least one index has data", () => {
    const c = buildCorpus();
    const r = new HybridRetriever({
      embedder: c.embedder,
      bm25: c.bm25,
      dense: c.dense,
      entryProvider: (id) => c.entries.get(id),
    });
    expect(r.isReady).toBe(true);
    const empty = new HybridRetriever({
      embedder: c.embedder,
      bm25: new Bm25Index(),
      dense: new DenseIndex(),
      entryProvider: () => undefined,
    });
    expect(empty.isReady).toBe(false);
  });

  it("retrieve('python pathlib') returns python pathlib entries at the top", async () => {
    const c = buildCorpus();
    const r = new HybridRetriever({
      embedder: c.embedder,
      bm25: c.bm25,
      dense: c.dense,
      entryProvider: (id) => c.entries.get(id),
    });
    const hits = await r.retrieve("python pathlib", { limit: 5 });
    const top = hits.map((h) => h.id);
    expect(top.slice(0, 2).sort()).toEqual(["e1", "e2"]);
  });

  it("empty query returns []", async () => {
    const c = buildCorpus();
    const r = new HybridRetriever({
      embedder: c.embedder,
      bm25: c.bm25,
      dense: c.dense,
      entryProvider: (id) => c.entries.get(id),
    });
    expect(await r.retrieve("", { limit: 5 })).toEqual([]);
  });

  it("graceful degradation: empty dense + populated bm25 still returns hits", async () => {
    const bm25 = new Bm25Index();
    const dense = new DenseIndex();
    const entries = new Map<string, MemoryHit>();
    bm25.add("e1", "python pathlib resolve");
    bm25.add("e2", "typescript map filter");
    entries.set("e1", makeEntry("e1", "python pathlib resolve"));
    entries.set("e2", makeEntry("e2", "typescript map filter"));
    const r = new HybridRetriever({
      embedder: new LocalEmbedder({ forceFallback: true }),
      bm25,
      dense,
      entryProvider: (id) => entries.get(id),
    });
    const hits = await r.retrieve("python pathlib", { limit: 5 });
    expect(hits.map((h) => h.id)[0]).toBe("e1");
  });

  it("graph ranker contributes to the fused ranking", async () => {
    const c = buildCorpus();
    const r = new HybridRetriever({
      embedder: c.embedder,
      bm25: c.bm25,
      dense: c.dense,
      graph: {
        async entitySearch(_q: string, _limit: number) {
          return new Map<string, number>([["e8", 1]]);
        },
      },
      entryProvider: (id) => c.entries.get(id),
    });
    const hits = await r.retrieve("python", { limit: 10 });
    expect(hits.map((h) => h.id)).toContain("e8");
  });

  it("scope filter drops entries that are not visible", async () => {
    const bm25 = new Bm25Index();
    const dense = new DenseIndex();
    const entries = new Map<string, MemoryHit>();
    bm25.add("e1", "python pathlib resolve");
    bm25.add("e2", "python pathlib normalize");
    dense.add("e1", hashEmbed("python pathlib resolve"));
    dense.add("e2", hashEmbed("python pathlib normalize"));
    entries.set("e1", makeEntry("e1", "python pathlib resolve", "Work"));
    entries.set("e2", makeEntry("e2", "python pathlib normalize", "Personal"));
    const r = new HybridRetriever({
      embedder: new LocalEmbedder({ forceFallback: true }),
      bm25,
      dense,
      entryProvider: (id) => entries.get(id),
    });
    const hits = await r.retrieve("python pathlib", {
      limit: 10,
      scopeId: "Work",
      visibleScopes: ["Work", null],
    });
    const ids = hits.map((h) => h.id);
    expect(ids).toContain("e1");
    expect(ids).not.toContain("e2");
  });

  it("entryProvider returning undefined drops the id from results", async () => {
    const c = buildCorpus();
    const r = new HybridRetriever({
      embedder: c.embedder,
      bm25: c.bm25,
      dense: c.dense,
      entryProvider: (id) => (id === "e1" ? undefined : c.entries.get(id)),
    });
    const hits = await r.retrieve("python", { limit: 10 });
    expect(hits.map((h) => h.id)).not.toContain("e1");
  });
});

describe("HybridRetriever 1,000-entry latency budget", () => {
  function build1k(): {
    bm25: Bm25Index;
    dense: DenseIndex;
    entries: Map<string, MemoryHit>;
    embedder: LocalEmbedder;
  } {
    const bm25 = new Bm25Index();
    const dense = new DenseIndex();
    const entries = new Map<string, MemoryHit>();
    const embedder = new LocalEmbedder({ forceFallback: true });
    const words = ["python", "typescript", "rust", "go", "ruby"];
    for (let i = 0; i < 1000; i++) {
      const id = `e${i}`;
      const text = `${words[i % words.length]} pattern ${i} foo bar baz`;
      bm25.add(id, text);
      dense.add(id, hashEmbed(text));
      entries.set(id, makeEntry(id, text));
    }
    return { bm25, dense, entries, embedder };
  }

  it("p50 < 50 ms, p99 < 150 ms over 50 retrievals", async () => {
    const c = build1k();
    const r = new HybridRetriever({
      embedder: c.embedder,
      bm25: c.bm25,
      dense: c.dense,
      entryProvider: (id) => c.entries.get(id),
    });
    // warm-up
    await r.retrieve("python pattern", { limit: 10 });
    const lats: number[] = [];
    for (let i = 0; i < 50; i++) {
      const start = process.hrtime.bigint();
      await r.retrieve("python pattern foo", { limit: 10 });
      lats.push(Number(process.hrtime.bigint() - start) / 1_000_000);
    }
    lats.sort((a, b) => a - b);
    const p50 = lats[Math.floor(lats.length * 0.5)]!;
    const p99 = lats[Math.floor(lats.length * 0.99)]!;
    expect(p50).toBeLessThan(50);
    expect(p99).toBeLessThan(150);
  });
});

describe("HybridRetriever regression: hybrid top-10 contains substring top hits", () => {
  it("for 10 canonical queries, substring-fallback top hits are present in the hybrid top-10", async () => {
    const c = buildCorpus();
    const r = new HybridRetriever({
      embedder: c.embedder,
      bm25: c.bm25,
      dense: c.dense,
      entryProvider: (id) => c.entries.get(id),
    });
    const queries = [
      "python pathlib",
      "typescript array",
      "rust ownership",
      "go goroutine",
      "javascript promise",
      "git rebase",
      "docker compose",
      "react hooks",
      "python typing",
      "filter reduce",
    ];
    const entryList = [...c.entries.values()];
    for (const q of queries) {
      const sub = substringFallback(q, entryList, 10);
      if (sub.length === 0) continue;
      const hybrid = await r.retrieve(q, { limit: 10 });
      const hybridIds = new Set(hybrid.map((h) => h.id));
      for (const subHit of sub) {
        expect(
          hybridIds.has(subHit.id),
          `expected hybrid top-10 for "${q}" to contain ${subHit.id}`,
        ).toBe(true);
      }
    }
  });
});

describe("substringFallback helper", () => {
  it("returns entries containing the query as a substring", () => {
    const entries: MemoryHit[] = [
      makeEntry("e1", "python pathlib"),
      makeEntry("e2", "typescript array"),
    ];
    expect(substringFallback("python", entries).map((h) => h.id)).toEqual(["e1"]);
  });

  it("empty query returns []", () => {
    expect(substringFallback("", [makeEntry("e1", "alpha")])).toEqual([]);
  });

  it("limit caps results", () => {
    const entries: MemoryHit[] = [
      makeEntry("e1", "python a"),
      makeEntry("e2", "python b"),
      makeEntry("e3", "python c"),
    ];
    expect(substringFallback("python", entries, 2)).toHaveLength(2);
  });
});
