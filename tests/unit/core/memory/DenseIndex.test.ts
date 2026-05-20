import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DenseIndex } from "../../../../core/memory/DenseIndex.js";
import { hashEmbed, EMBEDDING_DIM } from "../../../../core/memory/LocalEmbedder.js";

/**
 * v1.1.0 Phase 5.3 -- DenseIndex unit tests.
 *
 * Covers:
 *   - Add / delete (tombstone) / compact mechanics
 *   - Search returns top-K by cosine similarity
 *   - 1,000-entry indexing + scan latency budget
 *   - On-disk save / load round-trip
 */

let tmpDir = "";
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-dense-"));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("DenseIndex basics", () => {
  it("starts empty", () => {
    const idx = new DenseIndex();
    expect(idx.size).toBe(0);
    expect(idx.dim).toBe(EMBEDDING_DIM);
  });

  it("add then search returns the inserted entry", () => {
    const idx = new DenseIndex();
    const v = hashEmbed("alpha beta");
    idx.add("d1", v);
    const hits = idx.search(v, 10);
    expect(hits[0]?.entryId).toBe("d1");
    expect(hits[0]?.score).toBeGreaterThan(0.99);
  });

  it("delete tombstones the entry; search skips it", () => {
    const idx = new DenseIndex();
    idx.add("d1", hashEmbed("alpha beta"));
    idx.add("d2", hashEmbed("alpha gamma"));
    expect(idx.size).toBe(2);
    expect(idx.delete("d1")).toBe(true);
    expect(idx.size).toBe(1);
    expect(idx.delete("d1")).toBe(false);
    const hits = idx.search(hashEmbed("alpha"), 10);
    expect(hits.find((h) => h.entryId === "d1")).toBeUndefined();
  });

  it("add of existing id replaces the slot in place", () => {
    const idx = new DenseIndex();
    idx.add("d1", hashEmbed("alpha"));
    idx.add("d1", hashEmbed("beta"));
    expect(idx.size).toBe(1);
    const hits = idx.search(hashEmbed("beta"), 1);
    expect(hits[0]?.entryId).toBe("d1");
  });

  it("compact drops tombstones and preserves live entries", () => {
    const idx = new DenseIndex();
    idx.add("d1", hashEmbed("a"));
    idx.add("d2", hashEmbed("b"));
    idx.add("d3", hashEmbed("c"));
    idx.delete("d2");
    idx.compact();
    expect(idx.allEntryIds()).toEqual(["d1", "d3"]);
  });

  it("clear empties the index", () => {
    const idx = new DenseIndex();
    idx.add("d1", hashEmbed("alpha"));
    idx.clear();
    expect(idx.size).toBe(0);
    expect(idx.search(hashEmbed("alpha"), 10)).toEqual([]);
  });

  it("vectors of wrong dimensionality are zero-padded / truncated", () => {
    const idx = new DenseIndex({ dim: 8 });
    idx.add("short", new Float32Array([1, 0]));
    const hits = idx.search(new Float32Array([1, 0]), 1);
    expect(hits[0]?.entryId).toBe("short");
  });

  it("empty index search returns []", () => {
    const idx = new DenseIndex();
    expect(idx.search(hashEmbed("anything"), 10)).toEqual([]);
  });

  it("limit <= 0 returns []", () => {
    const idx = new DenseIndex();
    idx.add("d1", hashEmbed("alpha"));
    expect(idx.search(hashEmbed("alpha"), 0)).toEqual([]);
  });
});

describe("DenseIndex 1,000-entry corpus", () => {
  function buildCorpus(n: number): DenseIndex {
    const idx = new DenseIndex();
    for (let i = 0; i < n; i++) {
      idx.add(`e${i}`, hashEmbed(`document ${i} alpha beta`));
    }
    return idx;
  }

  it("indexes 1,000 entries quickly (<500 ms)", () => {
    const start = Date.now();
    const idx = buildCorpus(1000);
    const elapsed = Date.now() - start;
    expect(idx.size).toBe(1000);
    expect(elapsed).toBeLessThan(500);
  });

  it("query against a 1,000-entry corpus returns expected matches in top-10", () => {
    const idx = new DenseIndex();
    for (let i = 0; i < 1000; i++) {
      idx.add(`noise${i}`, hashEmbed(`random ${i} ${Math.random()}`));
    }
    idx.add("target", hashEmbed("python pathlib resolve absolute"));
    const hits = idx.search(hashEmbed("python pathlib resolve absolute"), 10);
    const top = hits.map((h) => h.entryId);
    expect(top).toContain("target");
  });

  it("search latency on a 1,000-entry corpus is <50 ms median", () => {
    const idx = buildCorpus(1000);
    const query = hashEmbed("document 500 alpha beta");
    const lats: number[] = [];
    for (let i = 0; i < 50; i++) {
      const start = process.hrtime.bigint();
      idx.search(query, 10);
      const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
      lats.push(elapsed);
    }
    lats.sort((a, b) => a - b);
    const median = lats[Math.floor(lats.length / 2)]!;
    expect(median).toBeLessThan(50);
  });
});

describe("DenseIndex persistence", () => {
  it("save then load round-trips live entries", async () => {
    const idx = new DenseIndex();
    idx.add("alpha", hashEmbed("alpha content"));
    idx.add("beta", hashEmbed("beta content"));
    idx.add("gamma", hashEmbed("gamma content"));
    idx.delete("beta");
    const file = path.join(tmpDir, "dense.bin");
    await idx.save(file);

    const loaded = await DenseIndex.load(file);
    expect(loaded.size).toBe(2);
    expect(loaded.allEntryIds().sort()).toEqual(["alpha", "gamma"]);
    const hits = loaded.search(hashEmbed("alpha content"), 1);
    expect(hits[0]?.entryId).toBe("alpha");
  });

  it("load returns an empty index for a missing file", async () => {
    const idx = await DenseIndex.load(path.join(tmpDir, "missing.bin"));
    expect(idx.size).toBe(0);
  });

  it("load rejects a file with the wrong magic", async () => {
    const file = path.join(tmpDir, "bogus.bin");
    await fs.writeFile(file, Buffer.from("XXXX\0\0\0\0\0\0\0\0"));
    await expect(DenseIndex.load(file)).rejects.toThrow(/bad magic/);
  });

  it("defaultPath honours NEXUS_HOME", () => {
    const original = process.env["NEXUS_HOME"];
    process.env["NEXUS_HOME"] = "/tmp/nx-dense-test";
    try {
      const p = DenseIndex.defaultPath();
      expect(p).toContain("nx-dense-test");
      expect(p).toContain("dense.bin");
    } finally {
      if (original === undefined) delete process.env["NEXUS_HOME"];
      else process.env["NEXUS_HOME"] = original;
    }
  });
});
