import { describe, it, expect } from "vitest";
import { Bm25Index } from "../../../../core/memory/Bm25Index.js";
import { tokenize, STOPWORDS } from "../../../../core/memory/stopwords.js";

/**
 * v1.1.0 Phase 5.2 -- BM25 index unit tests.
 *
 * Covers:
 *   - Tokenization (case-folding, stop-word stripping, single-char drop)
 *   - Add / delete / replace mechanics
 *   - Search ranking matches a hand-computed reference on a small fixture
 *   - 1,000-entry corpus stays under a generous latency ceiling
 *   - k1 / b overrides actually change the ranking
 */

describe("tokenize", () => {
  it("strips stop-words and case-folds", () => {
    const tokens = tokenize("The quick brown fox jumps over the lazy DOG");
    // "the" and "over" are in the stop-word list.
    expect(tokens).toEqual(["quick", "brown", "fox", "jumps", "lazy", "dog"]);
  });

  it("drops single-character tokens", () => {
    expect(tokenize("a b c d e")).toEqual([]);
  });

  it("splits on non-alnum characters", () => {
    expect(tokenize("foo.bar/baz-qux")).toEqual(["foo", "bar", "baz", "qux"]);
  });

  it("STOPWORDS is non-trivial", () => {
    expect(STOPWORDS.has("the")).toBe(true);
    expect(STOPWORDS.has("python")).toBe(false);
  });
});

describe("Bm25Index basics", () => {
  it("defaults: k1=1.5, b=0.75", () => {
    const idx = new Bm25Index();
    expect(idx.k1).toBe(1.5);
    expect(idx.b).toBe(0.75);
  });

  it("constructor honours k1 / b / tokenize overrides", () => {
    const customTokens: string[] = [];
    const idx = new Bm25Index({
      k1: 1.2,
      b: 0.5,
      tokenize: (t: string) => {
        const out = t.split(/\s+/u).filter((s) => s.length > 0);
        customTokens.push(...out);
        return out;
      },
    });
    expect(idx.k1).toBe(1.2);
    expect(idx.b).toBe(0.5);
    idx.add("d1", "hello world");
    expect(customTokens).toEqual(["hello", "world"]);
  });

  it("add then delete: index stays consistent", () => {
    const idx = new Bm25Index();
    idx.add("d1", "python pathlib resolve");
    idx.add("d2", "typescript array map");
    expect(idx.size).toBe(2);
    expect(idx.delete("d1")).toBe(true);
    expect(idx.size).toBe(1);
    expect(idx.delete("d1")).toBe(false);
    expect(idx.search("python")).toEqual(new Map());
  });

  it("re-adding an existing entryId replaces old postings", () => {
    const idx = new Bm25Index();
    idx.add("d1", "python pathlib resolve");
    idx.add("d1", "typescript array");
    const hits = idx.search("python");
    expect(hits.size).toBe(0);
    const tsHits = idx.search("typescript");
    expect(tsHits.has("d1")).toBe(true);
  });

  it("clear empties the index", () => {
    const idx = new Bm25Index();
    idx.add("d1", "alpha beta");
    idx.add("d2", "gamma delta");
    idx.clear();
    expect(idx.size).toBe(0);
    expect(idx.avgDocLength).toBe(0);
    expect(idx.search("alpha").size).toBe(0);
  });

  it("empty queries return an empty ranking", () => {
    const idx = new Bm25Index();
    idx.add("d1", "python pathlib");
    expect(idx.search("").size).toBe(0);
    expect(idx.search("the and or but").size).toBe(0); // all stop-words
  });
});

describe("Bm25Index ranking", () => {
  it("ranks documents containing more query terms higher (canonical fixture)", () => {
    const idx = new Bm25Index();
    idx.add("d1", "python pathlib resolve absolute");
    idx.add("d2", "python pathlib normalize");
    idx.add("d3", "typescript array map filter reduce");
    idx.add("d4", "rust ownership borrowing lifetimes");
    const hits = idx.search("python pathlib resolve", 10);
    const ranked = [...hits.keys()];
    expect(ranked[0]).toBe("d1");
    expect(ranked[1]).toBe("d2");
    expect(ranked).not.toContain("d3");
    expect(ranked).not.toContain("d4");
  });

  it("longer documents are penalized by length normalization (b>0)", () => {
    const idx = new Bm25Index({ b: 1 });
    idx.add("short", "python good");
    idx.add(
      "long",
      "python " + "filler ".repeat(50).trim(),
    );
    const hits = idx.search("python");
    const ranked = [...hits.keys()];
    expect(ranked[0]).toBe("short");
  });

  it("b=0 disables length normalization", () => {
    const noNorm = new Bm25Index({ b: 0 });
    const norm = new Bm25Index({ b: 1 });
    for (const idx of [noNorm, norm]) {
      idx.add("short", "python");
      idx.add(
        "long",
        "python " + "filler ".repeat(50).trim(),
      );
    }
    const noNormScore = noNorm.search("python").get("long")!;
    const normScore = norm.search("python").get("long")!;
    expect(noNormScore).toBeGreaterThan(normScore);
  });

  it("ranking output is sorted by descending score", () => {
    const idx = new Bm25Index();
    idx.add("d1", "alpha");
    idx.add("d2", "alpha beta");
    idx.add("d3", "alpha beta gamma");
    const hits = idx.search("alpha beta gamma");
    const scores = [...hits.values()];
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]!).toBeGreaterThanOrEqual(scores[i]!);
    }
  });

  it("ties broken by entryId for determinism", () => {
    const idx = new Bm25Index();
    idx.add("zeta", "python");
    idx.add("alpha", "python");
    const hits = idx.search("python");
    const ranked = [...hits.keys()];
    expect(ranked).toEqual(["alpha", "zeta"]);
  });
});

describe("Bm25Index 1,000-entry corpus", () => {
  function buildCorpus(n: number): Bm25Index {
    const idx = new Bm25Index();
    const words = ["python", "typescript", "rust", "go", "ruby", "java"];
    for (let i = 0; i < n; i++) {
      const seed = words[i % words.length]!;
      idx.add(`e${i}`, `${seed} pattern ${i} foo bar baz`);
    }
    return idx;
  }

  it("indexes 1,000 entries quickly (<200 ms total)", () => {
    const start = Date.now();
    const idx = buildCorpus(1000);
    const elapsed = Date.now() - start;
    expect(idx.size).toBe(1000);
    expect(elapsed).toBeLessThan(200);
  });

  it("search latency on a 1,000-entry corpus is <50 ms median", () => {
    const idx = buildCorpus(1000);
    const lats: number[] = [];
    for (let i = 0; i < 50; i++) {
      const start = process.hrtime.bigint();
      idx.search("python pattern foo", 10);
      const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
      lats.push(elapsed);
    }
    lats.sort((a, b) => a - b);
    const median = lats[Math.floor(lats.length / 2)]!;
    expect(median).toBeLessThan(50);
  });

  it("single add() on a 1,000-entry corpus stays under 5 ms median", () => {
    const idx = buildCorpus(1000);
    const lats: number[] = [];
    for (let i = 0; i < 50; i++) {
      const start = process.hrtime.bigint();
      idx.add(`new${i}`, "python pattern fresh entry");
      const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
      lats.push(elapsed);
    }
    lats.sort((a, b) => a - b);
    const median = lats[Math.floor(lats.length / 2)]!;
    expect(median).toBeLessThan(5);
  });
});
