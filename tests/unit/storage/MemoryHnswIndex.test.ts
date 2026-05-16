import { describe, it, expect } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { MemoryHnswIndex } from "../../../src/storage/MemoryHnswIndex.js";

/**
 * v0.7.0 Phase 7 -- MemoryHnswIndex tests.
 *
 * The native `hnswlib-node` binary is an optional dependency; in CI / local
 * machines where the binary fails to load, `MemoryHnswIndex.tryCreate`
 * returns null. The test suite covers BOTH the "loaded" path (via probe)
 * and the "unloaded" fallback contract. When the binary is unavailable
 * every test below is reduced to a single assertion: `tryCreate` returns
 * null and callers fall back to linear scan.
 */

function hnswlibLoadable(): boolean {
  try {
    const lib = require("hnswlib-node");
    return typeof lib?.HierarchicalNSW === "function";
  } catch {
    return false;
  }
}

const HNSW_AVAILABLE = hnswlibLoadable();

describe("MemoryHnswIndex", () => {
  it("returns null when hnswlib-node is unavailable", () => {
    if (HNSW_AVAILABLE) {
      return;
    }
    const tmp = path.join(os.tmpdir(), `hnsw-test-${Date.now()}.bin`);
    const idx = MemoryHnswIndex.tryCreate({
      dimensions: 4,
      maxElements: 16,
      persistPath: tmp,
    });
    expect(idx).toBeNull();
  });

  it.runIf(HNSW_AVAILABLE)(
    "creates a fresh index when no persisted file exists",
    () => {
      const tmp = path.join(os.tmpdir(), `hnsw-fresh-${Date.now()}.bin`);
      const idx = MemoryHnswIndex.tryCreate({
        dimensions: 4,
        maxElements: 16,
        persistPath: tmp,
      });
      expect(idx).not.toBeNull();
      expect(idx!.size()).toBe(0);
      try { fs.unlinkSync(tmp); } catch { /* swallow */ }
    },
  );

  it.runIf(HNSW_AVAILABLE)(
    "returns nearest neighbors after inserts",
    () => {
      const tmp = path.join(os.tmpdir(), `hnsw-insert-${Date.now()}.bin`);
      const idx = MemoryHnswIndex.tryCreate({
        dimensions: 3,
        maxElements: 16,
        persistPath: tmp,
      });
      expect(idx).not.toBeNull();

      idx!.insert(1, new Float32Array([1, 0, 0]));
      idx!.insert(2, new Float32Array([0, 1, 0]));
      idx!.insert(3, new Float32Array([0, 0, 1]));

      const results = idx!.search(new Float32Array([1, 0, 0]), 1);
      expect(results).toHaveLength(1);
      expect(results[0]!.label).toBe(1);

      try { fs.unlinkSync(tmp); } catch { /* swallow */ }
    },
  );

  it.runIf(HNSW_AVAILABLE)(
    "persists and reloads the index from disk (v0.8.0 Phase 0.8 / closes v0.7.0 10.O.18)",
    () => {
      const tmp = path.join(os.tmpdir(), `hnsw-persist-${Date.now()}.bin`);
      try {
        const idx1 = MemoryHnswIndex.tryCreate({
          dimensions: 3,
          maxElements: 16,
          persistPath: tmp,
        });
        expect(idx1).not.toBeNull();
        idx1!.insert(1, new Float32Array([1, 0, 0]));
        idx1!.insert(2, new Float32Array([0, 1, 0]));
        idx1!.persist();
        expect(fs.existsSync(tmp)).toBe(true);

        const idx2 = MemoryHnswIndex.tryCreate({
          dimensions: 3,
          maxElements: 16,
          persistPath: tmp,
        });
        expect(idx2).not.toBeNull();
        const results = idx2!.search(new Float32Array([0, 1, 0]), 1);
        expect(results).toHaveLength(1);
        expect(results[0]!.label).toBe(2);
      } finally {
        try { fs.unlinkSync(tmp); } catch { /* swallow */ }
      }
    },
  );

  it.runIf(HNSW_AVAILABLE)(
    "skips inserts whose dimensions do not match",
    () => {
      const tmp = path.join(os.tmpdir(), `hnsw-dim-${Date.now()}.bin`);
      const idx = MemoryHnswIndex.tryCreate({
        dimensions: 3,
        maxElements: 16,
        persistPath: tmp,
      });
      expect(idx).not.toBeNull();
      idx!.insert(1, new Float32Array([1, 0, 0, 0])); // wrong shape
      expect(idx!.size()).toBe(0);
      try { fs.unlinkSync(tmp); } catch { /* swallow */ }
    },
  );

  it.runIf(HNSW_AVAILABLE)(
    "returns empty array when search runs on an empty index",
    () => {
      const tmp = path.join(os.tmpdir(), `hnsw-empty-${Date.now()}.bin`);
      const idx = MemoryHnswIndex.tryCreate({
        dimensions: 3,
        maxElements: 16,
        persistPath: tmp,
      });
      expect(idx).not.toBeNull();
      const results = idx!.search(new Float32Array([1, 0, 0]), 3);
      expect(results).toEqual([]);
      try { fs.unlinkSync(tmp); } catch { /* swallow */ }
    },
  );
});
