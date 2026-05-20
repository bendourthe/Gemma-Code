import { describe, it, expect } from "vitest";
import {
  LocalEmbedder,
  EMBEDDING_DIM,
  DEFAULT_MODEL_ID,
  defaultWeightsPath,
  hashEmbed,
  cosineSimilarity,
} from "../../../../core/memory/LocalEmbedder.js";

/**
 * v1.1.0 Phase 5.1 -- LocalEmbedder unit tests.
 *
 * Exercises the embedder against its hash-fallback backend (the real
 * `@xenova/transformers` pipeline is an optional dep that requires
 * downloading 80 MB of weights; CI runs against the fallback). The
 * fallback is contractually identical -- 384-dim, deterministic, L2
 * normalized, batch-callable -- so the surrounding consumers
 * (`DenseIndex`, `HybridRetriever`) get the same guarantees in both
 * environments.
 */

describe("LocalEmbedder", () => {
  it("EMBEDDING_DIM is 384", () => {
    expect(EMBEDDING_DIM).toBe(384);
  });

  it("DEFAULT_MODEL_ID points to all-MiniLM-L6-v2 on Hub", () => {
    expect(DEFAULT_MODEL_ID).toBe("Xenova/all-MiniLM-L6-v2");
  });

  it("embed('hello world') is deterministic and 384-dim", async () => {
    const e = new LocalEmbedder({ forceFallback: true });
    const a = await e.embed("hello world");
    const b = await e.embed("hello world");
    expect(a.length).toBe(384);
    expect(b.length).toBe(384);
    for (let i = 0; i < a.length; i++) expect(a[i]).toBe(b[i]);
  });

  it("embed result is L2-normalized (norm == 1) for non-empty input", async () => {
    const e = new LocalEmbedder({ forceFallback: true });
    const v = await e.embed("python pathlib resolve");
    let sumSq = 0;
    for (let i = 0; i < v.length; i++) sumSq += v[i]! * v[i]!;
    expect(Math.sqrt(sumSq)).toBeCloseTo(1, 5);
  });

  it("embed('') returns a 384-dim zero vector (no NaN)", async () => {
    const e = new LocalEmbedder({ forceFallback: true });
    const v = await e.embed("");
    expect(v.length).toBe(384);
    let sumSq = 0;
    let nan = false;
    for (let i = 0; i < v.length; i++) {
      if (Number.isNaN(v[i]!)) nan = true;
      sumSq += v[i]! * v[i]!;
    }
    expect(nan).toBe(false);
    expect(sumSq).toBe(0);
  });

  it("embedBatch returns one vector per input and is fast (<200ms for 10 strings)", async () => {
    const e = new LocalEmbedder({ forceFallback: true });
    const inputs = [
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
    const start = Date.now();
    const out = await e.embedBatch(inputs);
    const elapsed = Date.now() - start;
    expect(out).toHaveLength(10);
    for (const v of out) expect(v.length).toBe(384);
    expect(elapsed).toBeLessThan(200);
  });

  it("embedBatch([]) returns []", async () => {
    const e = new LocalEmbedder({ forceFallback: true });
    expect(await e.embedBatch([])).toEqual([]);
  });

  it("backend is 'hash-fallback' when forceFallback is true", async () => {
    const e = new LocalEmbedder({ forceFallback: true });
    await e.embed("warm up");
    expect(e.backend).toBe("hash-fallback");
  });

  it("fromInstallPath produces an embedder with the given weightsPath", () => {
    const e = LocalEmbedder.fromInstallPath("/tmp/embedder");
    expect(e).toBeInstanceOf(LocalEmbedder);
    expect(e.dim).toBe(384);
  });

  it("defaultWeightsPath honours NEXUS_HOME override", () => {
    const original = process.env["NEXUS_HOME"];
    process.env["NEXUS_HOME"] = "/tmp/nx-test";
    try {
      const p = defaultWeightsPath();
      expect(p).toContain("nx-test");
      expect(p).toContain("all-MiniLM-L6-v2");
    } finally {
      if (original === undefined) delete process.env["NEXUS_HOME"];
      else process.env["NEXUS_HOME"] = original;
    }
  });
});

describe("hashEmbed", () => {
  it("is deterministic and 384-dim", () => {
    const a = hashEmbed("the quick brown fox");
    const b = hashEmbed("the quick brown fox");
    expect(a.length).toBe(384);
    for (let i = 0; i < a.length; i++) expect(a[i]).toBe(b[i]);
  });

  it("different strings produce different sketches", () => {
    const a = hashEmbed("alpha beta gamma");
    const b = hashEmbed("xylophone yacht zebra");
    let same = true;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        same = false;
        break;
      }
    }
    expect(same).toBe(false);
  });

  it("empty input returns a zero vector", () => {
    const v = hashEmbed("");
    expect(v.length).toBe(384);
    for (let i = 0; i < v.length; i++) expect(v[i]).toBe(0);
  });

  it("similar inputs (shared tokens) have higher cosine similarity than unrelated", () => {
    const a = hashEmbed("python pathlib resolve absolute");
    const b = hashEmbed("python pathlib normalize");
    const c = hashEmbed("typescript array map filter");
    const ab = cosineSimilarity(a, b);
    const ac = cosineSimilarity(a, c);
    expect(ab).toBeGreaterThan(ac);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical unit vectors", () => {
    const v = new Float32Array(4);
    v[0] = 1;
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal unit vectors", () => {
    const a = new Float32Array(2);
    a[0] = 1;
    const b = new Float32Array(2);
    b[1] = 1;
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it("clamps to shorter input length", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });
});
