/**
 * v1.2.0 Phase 4.2 -- LEANN-derived pruned dense index.
 *
 * Stores only a graph topology (`outDegree=32` by default) and the chunk text
 * per node; embeddings are recomputed on the search path via the configured
 * `Embedder`. A small LRU caches the most recently recomputed embeddings so
 * repeated traversals in the same session do not re-embed the same nodes.
 *
 * This is the storage-side counterpart to the LEANN paper's "graph-pruned
 * recompute-on-query" trick. The on-disk size collapses from
 * `(text + dim * 4)` per node to `(text + outDegree * 4)` per node; for
 * `dim=384, outDegree=32` the per-node embedding contribution drops from
 * 1,536 bytes to 128 bytes (a 12x reduction) before counting the text.
 *
 * Graph build (v1.4.0 Phase 7 / gap 4.2.P3.K):
 *   * The neighbor graph is built with true multi-layer HNSW via the optional
 *     `hnswlib-node` dependency -- O(N log N) construction that scales past
 *     ~50k nodes without the quadratic compact time the original all-pairs
 *     build hit. Only the resulting topology (neighbor indices) is kept; the
 *     embeddings hnswlib needs during construction are discarded, so the
 *     LEANN disk-savings are preserved (the file format is unchanged).
 *   * When `hnswlib-node` is unavailable (its native module did not build) or
 *     the corpus is tiny (<= HNSW_MIN_NODES, where the quadratic scan is
 *     trivially cheap and deterministic), the build falls back to the original
 *     all-pairs kNN scan -- the same graceful-degradation contract LocalEmbedder
 *     uses for its hash fallback. `lastBuildMethod` reports which path ran.
 *   * Search walks the graph BFS-style from a small set of entry points,
 *     scoring every visited node against the query embedding.
 *   * Recomputed embeddings hit a 512-entry LRU cache (configurable).
 *
 * The API mirrors the DenseIndex surface that `HybridRetriever._runDense`
 * already consumes (`search(query, limit)` returns `DenseHit[]`). The
 * ingest surface is intentionally different because PrunedDenseIndex needs
 * the chunk text -- `add(entryId, vec)` is intentionally *not* supported.
 * The Memory-tier policy (Phase 4.3) is responsible for selecting the
 * appropriate ingest path per tier.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { DenseHit } from "./DenseIndex.js";
import {
  cosineSimilarity,
  EMBEDDING_DIM,
  type Embedder,
} from "./LocalEmbedder.js";

export const DEFAULT_OUT_DEGREE = 32;
export const DEFAULT_EMBED_CACHE_SIZE = 512;
export const DEFAULT_ENTRY_POINTS = 8;
export const DEFAULT_BFS_EXPANSION = 4;

/**
 * Corpus size at/below which `compact()` uses the deterministic all-pairs kNN
 * scan instead of HNSW. Below this the quadratic scan is trivially cheap and
 * its determinism keeps the small-fixture tests stable; above it the O(N log N)
 * HNSW build wins and is the path that scales past ~50k nodes.
 */
export const HNSW_MIN_NODES = 256;

/** Build path taken by the most recent `compact()`. */
export type CompactBuildMethod = "hnsw" | "allpairs" | "none";

/* eslint-disable @typescript-eslint/no-explicit-any */
// hnswlib-node is an optional native dependency; loaded lazily and gated behind
// a try/catch so an absent/unbuildable native module degrades to all-pairs.
let _hnswModule: any | null | undefined;
function loadHnsw(): any | null {
  if (_hnswModule !== undefined) return _hnswModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _hnswModule = require("hnswlib-node");
  } catch {
    _hnswModule = null;
  }
  return _hnswModule;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface PrunedDenseIndexOptions {
  readonly dim?: number;
  readonly outDegree?: number;
  /** LRU cache size for recomputed embeddings. Default 512. */
  readonly cacheSize?: number;
  /** Number of random entry-point nodes to seed BFS. Default 8. */
  readonly entryPoints?: number;
  /**
   * Per-visit fan-out limit. Each BFS step keeps the top-K nodes by score
   * and expands their neighbors. Default 4.
   */
  readonly bfsExpansion?: number;
}

interface Node {
  readonly entryId: string;
  readonly text: string;
  /** Edge list (indices into `_nodes`). */
  edges: number[];
  tombstoned: boolean;
}

const MAGIC = "NXPI";
const VERSION = 1;

export class PrunedDenseIndex {
  readonly dim: number;
  readonly outDegree: number;

  private readonly _embedder: Embedder;
  private readonly _entryPoints: number;
  private readonly _bfsExpansion: number;
  private readonly _cacheCap: number;

  private _nodes: Node[] = [];
  private _byId = new Map<string, number>();

  private _embedCache = new Map<string, Float32Array>();
  private _cacheHits = 0;
  private _cacheMisses = 0;

  /** True if the graph topology is stale (adds/deletes since last compact). */
  private _dirty = false;

  /** Which build path the most recent compact() ran (for tests/diagnostics). */
  private _lastBuild: CompactBuildMethod = "none";

  constructor(embedder: Embedder, opts: PrunedDenseIndexOptions = {}) {
    this._embedder = embedder;
    this.dim = opts.dim ?? embedder.dim ?? EMBEDDING_DIM;
    this.outDegree = Math.max(2, opts.outDegree ?? DEFAULT_OUT_DEGREE);
    this._cacheCap = Math.max(0, opts.cacheSize ?? DEFAULT_EMBED_CACHE_SIZE);
    this._entryPoints = Math.max(1, opts.entryPoints ?? DEFAULT_ENTRY_POINTS);
    this._bfsExpansion = Math.max(1, opts.bfsExpansion ?? DEFAULT_BFS_EXPANSION);
  }

  /** Number of live (non-tombstoned) nodes. */
  get size(): number {
    let n = 0;
    for (const node of this._nodes) if (!node.tombstoned) n += 1;
    return n;
  }

  /** Whether the graph topology has been built since the last add/delete. */
  get isCompact(): boolean {
    return !this._dirty;
  }

  /** Build path taken by the most recent compact(): "hnsw", "allpairs", or "none". */
  get lastBuildMethod(): CompactBuildMethod {
    return this._lastBuild;
  }

  cacheStats(): { hits: number; misses: number; size: number; capacity: number } {
    return {
      hits: this._cacheHits,
      misses: this._cacheMisses,
      size: this._embedCache.size,
      capacity: this._cacheCap,
    };
  }

  allEntryIds(): readonly string[] {
    return this._nodes.map((n) => n.entryId);
  }

  /**
   * Insert or replace `entryId` with `text`. The graph is marked dirty;
   * `compact()` (or any search after the threshold heuristic kicks in)
   * rebuilds the topology.
   */
  add(entryId: string, text: string): void {
    const existing = this._byId.get(entryId);
    if (existing !== undefined) {
      const node = this._nodes[existing]!;
      this._nodes[existing] = { ...node, text, edges: [], tombstoned: false };
      this._dirty = true;
      this._embedCache.delete(entryId);
      return;
    }
    this._byId.set(entryId, this._nodes.length);
    this._nodes.push({ entryId, text, edges: [], tombstoned: false });
    this._dirty = true;
  }

  /** Batched add. Marks the graph dirty exactly once. */
  addChunks(items: ReadonlyArray<{ entryId: string; text: string }>): void {
    for (const item of items) this.add(item.entryId, item.text);
  }

  delete(entryId: string): boolean {
    const idx = this._byId.get(entryId);
    if (idx === undefined) return false;
    const node = this._nodes[idx]!;
    if (node.tombstoned) return false;
    node.tombstoned = true;
    this._embedCache.delete(entryId);
    this._dirty = true;
    return true;
  }

  /** Drop tombstones and rebuild the kNN graph. */
  async compact(): Promise<void> {
    const live: Node[] = [];
    const map = new Map<string, number>();
    for (const node of this._nodes) {
      if (node.tombstoned) continue;
      map.set(node.entryId, live.length);
      live.push({ ...node, edges: [] });
    }
    this._nodes = live;
    this._byId = map;

    if (live.length <= 1) {
      this._lastBuild = "none";
      this._dirty = false;
      return;
    }

    // Embed every live node so we can compute kNN edges. We DO NOT persist
    // these; they only exist within this function's stack and the LRU cache.
    const texts = live.map((n) => n.text);
    const vecs = await this._embedder.embedBatch(texts);

    // Warm the cache with these so the first round of queries does not refetch.
    if (this._cacheCap > 0) {
      const start = Math.max(0, vecs.length - this._cacheCap);
      for (let i = start; i < vecs.length; i += 1) {
        const node = live[i]!;
        const vec = vecs[i];
        if (vec) this._cacheSet(node.entryId, vec);
      }
    }

    // Build the kNN adjacency. Prefer multi-layer HNSW (O(N log N)); fall back
    // to the all-pairs scan for tiny corpora (<= HNSW_MIN_NODES) or when the
    // hnswlib-node native module is unavailable.
    const adj: Set<number>[] = live.map(() => new Set<number>());
    const hnsw = live.length > HNSW_MIN_NODES ? loadHnsw() : null;
    if (hnsw) {
      this._buildAdjHnsw(hnsw, vecs, adj);
      this._lastBuild = "hnsw";
    } else {
      this._buildAdjAllPairs(vecs, adj);
      this._lastBuild = "allpairs";
    }

    for (let i = 0; i < live.length; i += 1) {
      live[i]!.edges = Array.from(adj[i]!);
    }

    this._dirty = false;
  }

  clear(): void {
    this._nodes = [];
    this._byId.clear();
    this._embedCache.clear();
    this._cacheHits = 0;
    this._cacheMisses = 0;
    this._dirty = false;
  }

  /**
   * Top-K nearest neighbors. Embeds the query once, then walks the kNN
   * graph BFS-style scoring every visited node. When the graph is dirty
   * (recent adds/deletes), falls back to a linear scan over the texts
   * (recomputing embeddings as it goes -- slow but correct).
   *
   * `query` is a pre-computed embedding (consistent with the DenseIndex
   * surface). Callers that have only text should embed first.
   */
  async search(query: Float32Array, limit = 10): Promise<DenseHit[]> {
    if (this._nodes.length === 0 || limit <= 0) return [];
    const fitted = this._fit(query);

    if (this._dirty) {
      return this._linearSearch(fitted, limit);
    }

    const liveIndices = this._liveIndices();
    if (liveIndices.length === 0) return [];
    // Visited budget scales with limit AND corpus size so small corpora
    // effectively get a near-exhaustive scan (cheap because the cache
    // covers most nodes) while large corpora stay bounded.
    const budget = Math.min(
      liveIndices.length,
      Math.max(128, limit * this.outDegree * 4),
    );

    // Seed selection: stride-sample live nodes, score them, take the top
    // `_entryPoints` as starting points. The sample size scales with the
    // entry-point count so we always have enough diversity.
    const sampleSize = Math.min(
      liveIndices.length,
      Math.max(this._entryPoints * 8, 64),
    );
    const stride = Math.max(1, Math.floor(liveIndices.length / sampleSize));
    const scores = new Map<number, number>();
    const sampledScores: Array<{ idx: number; score: number }> = [];
    for (let s = 0; s < liveIndices.length && sampledScores.length < sampleSize; s += stride) {
      const idx = liveIndices[s]!;
      const node = this._nodes[idx]!;
      const vec = await this._embed(node.entryId, node.text);
      const score = cosineSimilarity(fitted, vec);
      sampledScores.push({ idx, score });
      scores.set(idx, score);
    }

    // Best-first graph traversal. Frontier is sorted by score descending;
    // we pop the highest-scoring un-expanded node, score every unvisited
    // neighbor, and merge them back into the frontier. The frontier never
    // exceeds the budget. This is the classic HNSW-style query routine
    // (simplified to a single layer to match our pruned-graph topology).
    const visited = new Set<number>(sampledScores.map((s) => s.idx));
    const expanded = new Set<number>();
    const frontier: Array<{ idx: number; score: number }> = sampledScores
      .slice()
      .sort((a, b) => b.score - a.score);

    while (frontier.length > 0 && visited.size < budget) {
      const top = frontier.shift();
      if (!top) break;
      if (expanded.has(top.idx)) continue;
      expanded.add(top.idx);
      const node = this._nodes[top.idx];
      if (!node) continue;
      for (const ne of node.edges) {
        if (visited.has(ne)) continue;
        const neNode = this._nodes[ne];
        if (!neNode || neNode.tombstoned) continue;
        visited.add(ne);
        const vec = await this._embed(neNode.entryId, neNode.text);
        const score = cosineSimilarity(fitted, vec);
        scores.set(ne, score);
        // Insert into frontier in score-desc order (small bounded size).
        let inserted = false;
        for (let i = 0; i < frontier.length; i += 1) {
          if (score > frontier[i]!.score) {
            frontier.splice(i, 0, { idx: ne, score });
            inserted = true;
            break;
          }
        }
        if (!inserted) frontier.push({ idx: ne, score });
        // Cap frontier size to avoid pathological growth.
        if (frontier.length > budget) frontier.length = budget;
        if (visited.size >= budget) break;
      }
    }

    const hits: DenseHit[] = [];
    for (const [idx, score] of scores) {
      const node = this._nodes[idx];
      if (!node || node.tombstoned) continue;
      hits.push({ entryId: node.entryId, score });
    }
    hits.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.entryId < b.entryId ? -1 : 1;
    });
    return hits.slice(0, limit);
  }

  /**
   * Persist the index to disk. Format:
   *   header  : "NXPI" (4) + uint32 version + uint32 dim + uint32 outDegree
   *             + uint32 count
   *   nodes   : [ uint32 idLen | utf8 id | uint32 textLen | utf8 text
   *             | uint32 edgeCount | uint32 * edgeCount ]
   *
   * Embedding bytes are NOT persisted. Tombstones are dropped at save time.
   */
  async save(filePath: string): Promise<void> {
    const live = this._nodes
      .map((n, i) => ({ node: n, oldIdx: i }))
      .filter(({ node }) => !node.tombstoned);
    const oldToNew = new Map<number, number>();
    live.forEach(({ oldIdx }, newIdx) => oldToNew.set(oldIdx, newIdx));

    const buffers: Buffer[] = [];
    const header = Buffer.alloc(4 + 4 + 4 + 4 + 4);
    header.write(MAGIC, 0, 4, "utf8");
    header.writeUInt32LE(VERSION, 4);
    header.writeUInt32LE(this.dim, 8);
    header.writeUInt32LE(this.outDegree, 12);
    header.writeUInt32LE(live.length, 16);
    buffers.push(header);

    for (const { node } of live) {
      const idBuf = Buffer.from(node.entryId, "utf8");
      const textBuf = Buffer.from(node.text, "utf8");
      const renumberedEdges: number[] = [];
      for (const e of node.edges) {
        const mapped = oldToNew.get(e);
        if (mapped !== undefined) renumberedEdges.push(mapped);
      }
      const nodeBuf = Buffer.alloc(
        4 + idBuf.length + 4 + textBuf.length + 4 + renumberedEdges.length * 4,
      );
      let off = 0;
      nodeBuf.writeUInt32LE(idBuf.length, off);
      off += 4;
      idBuf.copy(nodeBuf, off);
      off += idBuf.length;
      nodeBuf.writeUInt32LE(textBuf.length, off);
      off += 4;
      textBuf.copy(nodeBuf, off);
      off += textBuf.length;
      nodeBuf.writeUInt32LE(renumberedEdges.length, off);
      off += 4;
      for (const e of renumberedEdges) {
        nodeBuf.writeUInt32LE(e, off);
        off += 4;
      }
      buffers.push(nodeBuf);
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, Buffer.concat(buffers));
  }

  /**
   * Load an index from disk. Returns an empty index when the file does not
   * exist. Throws on malformed input.
   */
  static async load(filePath: string, embedder: Embedder): Promise<PrunedDenseIndex> {
    let buf: Buffer;
    try {
      buf = await fs.readFile(filePath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return new PrunedDenseIndex(embedder);
      }
      throw e;
    }
    if (buf.length < 20) {
      throw new Error(`PrunedDenseIndex.load: file too small (${buf.length} bytes)`);
    }
    const magic = buf.toString("utf8", 0, 4);
    if (magic !== MAGIC) {
      throw new Error(`PrunedDenseIndex.load: bad magic '${magic}' (expected '${MAGIC}')`);
    }
    const version = buf.readUInt32LE(4);
    if (version !== VERSION) {
      throw new Error(`PrunedDenseIndex.load: unsupported version ${version}`);
    }
    const dim = buf.readUInt32LE(8);
    const outDegree = buf.readUInt32LE(12);
    const count = buf.readUInt32LE(16);
    const idx = new PrunedDenseIndex(embedder, { dim, outDegree });
    let off = 20;
    const tempNodes: Array<{ entryId: string; text: string; edges: number[] }> = [];
    for (let i = 0; i < count; i += 1) {
      if (off + 4 > buf.length) throw new Error("PrunedDenseIndex.load: truncated id len");
      const idLen = buf.readUInt32LE(off);
      off += 4;
      if (off + idLen > buf.length) throw new Error("PrunedDenseIndex.load: truncated id");
      const entryId = buf.toString("utf8", off, off + idLen);
      off += idLen;
      if (off + 4 > buf.length) throw new Error("PrunedDenseIndex.load: truncated text len");
      const textLen = buf.readUInt32LE(off);
      off += 4;
      if (off + textLen > buf.length) throw new Error("PrunedDenseIndex.load: truncated text");
      const text = buf.toString("utf8", off, off + textLen);
      off += textLen;
      if (off + 4 > buf.length) throw new Error("PrunedDenseIndex.load: truncated edge count");
      const edgeCount = buf.readUInt32LE(off);
      off += 4;
      const edges: number[] = [];
      for (let j = 0; j < edgeCount; j += 1) {
        if (off + 4 > buf.length) throw new Error("PrunedDenseIndex.load: truncated edges");
        edges.push(buf.readUInt32LE(off));
        off += 4;
      }
      tempNodes.push({ entryId, text, edges });
    }
    for (const t of tempNodes) {
      idx._byId.set(t.entryId, idx._nodes.length);
      idx._nodes.push({
        entryId: t.entryId,
        text: t.text,
        edges: t.edges,
        tombstoned: false,
      });
    }
    idx._dirty = false;
    return idx;
  }

  /** Default on-disk location for the persisted pruned index. */
  static defaultPath(): string {
    const home =
      process.env["NEXUS_HOME"] ??
      path.join(process.env["HOME"] ?? process.env["USERPROFILE"] ?? ".", ".nexus");
    return path.join(home, "memory", "dense-pruned.bin");
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  /**
   * Build the kNN adjacency via multi-layer HNSW (hnswlib-node). Constructs a
   * cosine-space index over the live embeddings, then queries each node's
   * outDegree nearest neighbors -- O(N log N) overall vs the all-pairs O(N^2).
   * Only the neighbor indices are kept; the index (and its vectors) is dropped
   * when this method returns, preserving the topology-only on-disk format.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _buildAdjHnsw(
    hnsw: any,
    vecs: ReadonlyArray<Float32Array | undefined>,
    adj: Set<number>[],
  ): void {
    const n = vecs.length;
    const efConstruction = Math.max(this.outDegree * 2, 200);
    const index = new hnsw.HierarchicalNSW("cosine", this.dim);
    index.initIndex(n, this.outDegree, efConstruction, 100);
    for (let i = 0; i < n; i += 1) {
      const v = vecs[i];
      if (!v || v.length !== this.dim) continue;
      index.addPoint(Array.from(v), i);
    }
    index.setEf(Math.max(this.outDegree * 2, 64));
    const k = Math.min(this.outDegree + 1, n);
    for (let i = 0; i < n; i += 1) {
      const v = vecs[i];
      if (!v || v.length !== this.dim) continue;
      let neighbors: number[];
      try {
        neighbors = index.searchKnn(Array.from(v), k).neighbors as number[];
      } catch {
        continue;
      }
      for (const j of neighbors) {
        if (j === i || j < 0 || j >= n) continue;
        // Undirected: mirror the reverse edge so the graph stays connected
        // (same connectivity guarantee the all-pairs build provides).
        adj[i]!.add(j);
        adj[j]!.add(i);
      }
    }
  }

  /** All-pairs kNN build (the v1.2.0 fallback for tiny corpora / no hnswlib). */
  private _buildAdjAllPairs(
    vecs: ReadonlyArray<Float32Array | undefined>,
    adj: Set<number>[],
  ): void {
    const n = vecs.length;
    for (let i = 0; i < n; i += 1) {
      const target = vecs[i];
      if (!target) continue;
      const heap: Array<{ idx: number; score: number }> = [];
      for (let j = 0; j < n; j += 1) {
        if (i === j) continue;
        const other = vecs[j];
        if (!other) continue;
        const score = cosineSimilarity(target, other);
        if (heap.length < this.outDegree) {
          heap.push({ idx: j, score });
          heap.sort((a, b) => a.score - b.score);
        } else if (heap[0] && score > heap[0].score) {
          heap[0] = { idx: j, score };
          heap.sort((a, b) => a.score - b.score);
        }
      }
      for (const h of heap) {
        adj[i]!.add(h.idx);
        adj[h.idx]!.add(i);
      }
    }
  }

  private async _linearSearch(query: Float32Array, limit: number): Promise<DenseHit[]> {
    const hits: DenseHit[] = [];
    for (const node of this._nodes) {
      if (node.tombstoned) continue;
      const vec = await this._embed(node.entryId, node.text);
      const score = cosineSimilarity(query, vec);
      hits.push({ entryId: node.entryId, score });
    }
    hits.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.entryId < b.entryId ? -1 : 1;
    });
    return hits.slice(0, limit);
  }

  private _liveIndices(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this._nodes.length; i += 1) {
      if (!this._nodes[i]!.tombstoned) out.push(i);
    }
    return out;
  }

  private async _embed(entryId: string, text: string): Promise<Float32Array> {
    const cached = this._embedCache.get(entryId);
    if (cached) {
      // Refresh recency for LRU.
      this._embedCache.delete(entryId);
      this._embedCache.set(entryId, cached);
      this._cacheHits += 1;
      return cached;
    }
    this._cacheMisses += 1;
    const vec = this._fit(await this._embedder.embed(text));
    this._cacheSet(entryId, vec);
    return vec;
  }

  private _cacheSet(entryId: string, vec: Float32Array): void {
    if (this._cacheCap === 0) return;
    if (this._embedCache.size >= this._cacheCap) {
      // Evict the least-recently-used (the oldest insertion key).
      const oldest = this._embedCache.keys().next().value;
      if (oldest !== undefined) this._embedCache.delete(oldest);
    }
    this._embedCache.set(entryId, vec);
  }

  private _fit(vec: Float32Array): Float32Array {
    if (vec.length === this.dim) return vec;
    const fitted = new Float32Array(this.dim);
    const n = Math.min(vec.length, this.dim);
    for (let i = 0; i < n; i += 1) fitted[i] = vec[i] ?? 0;
    return fitted;
  }
}
