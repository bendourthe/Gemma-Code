import * as fs from "fs";
import * as path from "path";
import { getLogger } from "../../modules/coding/utils/logger.js";
import { formatForLog } from "../../modules/coding/utils/errors.js";

// The TypeScript module setting is `Node16`, but the package.json has no
// `"type": "module"`, so the compiled output is CommonJS. `require` is
// available at runtime; this declaration tells the compiler so we can
// lazy-load the optional native binary without forcing an ESM build.
declare const require: NodeRequire;

/**
 * v0.7.0 Phase 7 -- optional HNSW vector index over memory embeddings.
 *
 * The native `hnswlib-node` binary is loaded lazily via `tryCreate`; if the
 * load fails the caller (MemoryStore) falls back to the existing linear-scan
 * + FTS5 pre-filter path. Failure modes covered: missing optionalDependency,
 * cross-platform binary mismatch, corrupt index file on disk.
 *
 * Labels are SQL rowids (positive integers). `searchSemantic` joins the
 * returned labels back to the `memories` table to materialize entries.
 */
export interface MemoryHnswSearchResult {
  readonly label: number;
  readonly distance: number;
}

export interface MemoryHnswCreateOptions {
  readonly dimensions: number;
  readonly maxElements: number;
  readonly persistPath: string;
  /**
   * Full-rebuild cadence (after N incremental mutations the in-memory index
   * is dropped and rebuilt from scratch). Bounds drift from incremental
   * deletes that hnswlib-node marks but does not reclaim.
   */
  readonly fullRebuildEvery?: number;
}

export class MemoryHnswIndex {
  private readonly _index: HnswIndexHandle;
  private readonly _persistPath: string;
  private readonly _fullRebuildEvery: number;
  private _maxElements: number;
  private readonly _dimensions: number;
  private _mutationCount = 0;
  private _dirty = false;

  private constructor(
    index: HnswIndexHandle,
    persistPath: string,
    dimensions: number,
    maxElements: number,
    fullRebuildEvery: number,
  ) {
    this._index = index;
    this._persistPath = persistPath;
    this._dimensions = dimensions;
    this._maxElements = maxElements;
    this._fullRebuildEvery = fullRebuildEvery;
  }

  /**
   * Attempt to create an index. Returns null when hnswlib-node is unavailable
   * or any setup step throws -- the caller must fall back to linear scan.
   */
  static tryCreate(options: MemoryHnswCreateOptions): MemoryHnswIndex | null {
    const lib = tryLoadHnswlib();
    if (!lib) return null;

    try {
      const dir = path.dirname(options.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const index = new lib.HierarchicalNSW("cosine", options.dimensions);
      const hasPersisted = fs.existsSync(options.persistPath);
      // After read, the actual maxElements is whatever the saved index
      // recorded; we reconcile our internal tracking with `getMaxElements()`
      // so subsequent capacity-bump checks compare against the real ceiling.
      // v0.8.0 Phase 0.8 (closes v0.7.0 10.O.18): the previous call passed
      // `options.maxElements` as the second argument, but hnswlib-node v3's
      // `readIndexSync(filename, allowReplaceDeleted?)` expects a boolean
      // there. JavaScript coerced the integer to truthy, silently flipping
      // `allowReplaceDeleted=true` and turning every loaded point into a
      // candidate for reclamation; `getCurrentCount()` then reported 0
      // after read. Dropping the second arg lets it default to false.
      let effectiveMax = options.maxElements;
      if (hasPersisted) {
        try {
          index.readIndexSync(options.persistPath);
          try {
            const saved = index.getMaxElements();
            if (saved > 0) effectiveMax = saved;
          } catch {
            /* keep options.maxElements */
          }
        } catch (err) {
          getLogger().debug(
            "[MemoryHnswIndex] persisted index unreadable; reinitializing:",
            formatForLog(err),
          );
          index.initIndex(options.maxElements);
        }
      } else {
        index.initIndex(options.maxElements);
      }

      return new MemoryHnswIndex(
        index,
        options.persistPath,
        options.dimensions,
        effectiveMax,
        Math.max(100, options.fullRebuildEvery ?? 1000),
      );
    } catch (err) {
      getLogger().debug(
        "[MemoryHnswIndex] init failed; falling back to linear scan:",
        formatForLog(err),
      );
      return null;
    }
  }

  /** Insert a vector with the given label. Resizes capacity on demand. */
  insert(label: number, vector: Float32Array): void {
    if (vector.length !== this._dimensions) return;
    try {
      if (this._index.getCurrentCount() >= this._maxElements) {
        this._maxElements = Math.ceil(this._maxElements * 1.5);
        this._index.resizeIndex(this._maxElements);
      }
      this._index.addPoint(Array.from(vector), label);
      this._dirty = true;
      this._mutationCount++;
    } catch (err) {
      getLogger().debug("[MemoryHnswIndex] insert failed:", formatForLog(err));
    }
  }

  /**
   * Mark a label as deleted. hnswlib-node does not reclaim space until a full
   * rebuild; callers should invoke `rebuild` after enough deletions.
   */
  remove(label: number): void {
    try {
      this._index.markDelete(label);
      this._dirty = true;
      this._mutationCount++;
    } catch (err) {
      getLogger().debug("[MemoryHnswIndex] remove failed:", formatForLog(err));
    }
  }

  /**
   * Search top-k nearest neighbors. Returns an empty array when the query
   * fails (e.g. empty index).
   */
  search(query: Float32Array, k: number): MemoryHnswSearchResult[] {
    if (query.length !== this._dimensions) return [];
    try {
      const count = this._index.getCurrentCount();
      if (count === 0) return [];
      const effectiveK = Math.max(1, Math.min(k, count));
      const result = this._index.searchKnn(Array.from(query), effectiveK);
      const out: MemoryHnswSearchResult[] = [];
      for (let i = 0; i < result.neighbors.length; i++) {
        const label = result.neighbors[i];
        const distance = result.distances[i];
        if (label !== undefined && distance !== undefined) {
          out.push({ label, distance });
        }
      }
      return out;
    } catch (err) {
      getLogger().debug("[MemoryHnswIndex] search failed:", formatForLog(err));
      return [];
    }
  }

  /** True when the mutation count crossed the configured rebuild cadence. */
  needsRebuild(): boolean {
    return this._mutationCount >= this._fullRebuildEvery;
  }

  /**
   * Drop the in-memory index and re-add every (label, vector) pair the caller
   * provides. Used by `rebuild` paths in MemoryStore.
   */
  rebuild(entries: Iterable<{ label: number; vector: Float32Array }>): void {
    try {
      this._index.initIndex(this._maxElements);
      for (const { label, vector } of entries) {
        if (vector.length === this._dimensions) {
          this._index.addPoint(Array.from(vector), label);
        }
      }
      this._mutationCount = 0;
      this._dirty = true;
    } catch (err) {
      getLogger().debug("[MemoryHnswIndex] rebuild failed:", formatForLog(err));
    }
  }

  /** Persist the index to disk if any mutation has occurred since last save. */
  persist(): void {
    if (!this._dirty) return;
    try {
      this._index.writeIndexSync(this._persistPath);
      this._dirty = false;
    } catch (err) {
      getLogger().debug("[MemoryHnswIndex] persist failed:", formatForLog(err));
    }
  }

  /** Total live element count (deleted markers excluded). */
  size(): number {
    try {
      return this._index.getCurrentCount();
    } catch {
      return 0;
    }
  }
}

interface HnswIndexHandle {
  initIndex(maxElements: number): void;
  /**
   * hnswlib-node v3: `readIndexSync(filename, allowReplaceDeleted?: boolean)`.
   * The second parameter is a boolean (default false), NOT a maxElements
   * number; passing a non-boolean silently coerces and breaks the loaded
   * index. See v0.7.0 known-gap 10.O.18 / v0.8.0 ADR for the bug history.
   */
  readIndexSync(path: string, allowReplaceDeleted?: boolean): void;
  writeIndexSync(path: string): void;
  addPoint(vector: number[], label: number): void;
  markDelete(label: number): void;
  resizeIndex(newMax: number): void;
  searchKnn(vector: number[], k: number): { neighbors: number[]; distances: number[] };
  getCurrentCount(): number;
  getMaxElements(): number;
}

interface HnswlibModule {
  HierarchicalNSW: new (space: string, dim: number) => HnswIndexHandle;
}

function tryLoadHnswlib(): HnswlibModule | null {
  try {
    return require("hnswlib-node") as HnswlibModule;
  } catch {
    return null;
  }
}
