/**
 * v1.1.0 Phase 5.5 -- hybrid memory retriever.
 *
 * A single façade that runs BM25 + Dense + Graph in parallel, fuses via
 * Reciprocal Rank Fusion (RRF, default `k = 60`), and returns the top-K
 * memory hits. The retriever is corpus-agnostic: it operates on opaque
 * `entryId` strings and an `entryProvider` callback that maps ids back to
 * `MemoryHit` shapes for the caller.
 *
 * The retriever is intentionally tolerant of partial readiness:
 *   * If the BM25 index is empty -> only the dense + graph rankings
 *     contribute (and vice versa).
 *   * If the dense index is empty -> BM25 + graph contribute alone.
 *   * If all three are empty -> the retriever returns the empty array.
 *
 * Callers that want substring-fallback behaviour for very small corpora
 * (< 100 entries) wrap the retriever with `UnifiedMemoryRetriever` (or its
 * desktop-side equivalent). The retriever itself does not do fallback
 * because corpus-size policy belongs to the consumer.
 *
 * Adopts agentmemory A1 (see docs/v1.1.0/comparison-agentmemory.md
 * Section 11.2 P1).
 */

import type { MemoryHit, ScopeId } from "./MemoryHub.js";
import { isVisibleFromScope } from "./MemoryHub.js";
import type { Embedder } from "./LocalEmbedder.js";
import { Bm25Index } from "./Bm25Index.js";
import { DenseIndex } from "./DenseIndex.js";
import { RrfFuser, DEFAULT_RRF_K } from "./RrfFuser.js";

/** Per-stage cap before fusion. */
export const DEFAULT_STAGE_LIMIT = 50;

export interface GraphRanker {
  /**
   * Rank entries by graph traversal from the query. Implementations
   * typically extract named entities, walk the graph, and return entries
   * weighted by edge proximity. Return value is an ordered map
   * (insertion-order == rank) of entryId -> score.
   */
  entitySearch(query: string, limit: number): Promise<Map<string, number>>;
}

export interface HybridRetrieveOpts {
  /** Top-K hits to return after fusion. Default 10. */
  readonly limit?: number;
  /** Scope filter (see MemoryHub.RetrieveOpts.scopeId). */
  readonly scopeId?: ScopeId;
  /** Visible scope chain (see MemoryHub.RetrieveOpts.visibleScopes). */
  readonly visibleScopes?: ReadonlyArray<ScopeId>;
  /** Override the per-stage cap (default 50). */
  readonly stageLimit?: number;
}

export interface HybridRetrieverDeps {
  readonly embedder: Embedder;
  readonly bm25: Bm25Index;
  readonly dense: DenseIndex;
  readonly graph?: GraphRanker | null;
  /**
   * Map a resolved entryId to its `MemoryHit` shape. Returning `undefined`
   * drops the id from the result (entry was deleted concurrently / scope
   * filter applied).
   */
  readonly entryProvider: (entryId: string) => MemoryHit | undefined;
  /** RRF fusion constant. Defaults to 60; updates flow through setRrfK(). */
  readonly rrfK?: number;
}

/**
 * Hybrid memory retriever façade. Holds a single RrfFuser and the three
 * ranking sources (BM25, dense, graph). Callers update the indexes
 * directly via `MemoryHub.write`; the retriever queries them in parallel
 * on every `retrieve` call.
 */
export class HybridRetriever {
  private readonly _embedder: Embedder;
  private readonly _bm25: Bm25Index;
  private readonly _dense: DenseIndex;
  private readonly _graph: GraphRanker | null;
  private readonly _entryProvider: (entryId: string) => MemoryHit | undefined;
  private readonly _fuser: RrfFuser;

  constructor(deps: HybridRetrieverDeps) {
    this._embedder = deps.embedder;
    this._bm25 = deps.bm25;
    this._dense = deps.dense;
    this._graph = deps.graph ?? null;
    this._entryProvider = deps.entryProvider;
    this._fuser = new RrfFuser(deps.rrfK ?? DEFAULT_RRF_K);
  }

  /** Update RRF `k` at runtime (called by SettingsStore listeners). */
  setRrfK(k: number): void {
    this._fuser.k = k;
  }

  /** Read the active RRF `k`. */
  get rrfK(): number {
    return this._fuser.k;
  }

  /** Whether the indexes have any data to query. */
  get isReady(): boolean {
    return this._bm25.size > 0 || this._dense.size > 0;
  }

  /**
   * Retrieve the top-K hits. Internally runs BM25, dense, and graph
   * rankings in parallel; fuses via RRF; resolves ids to `MemoryHit`
   * via `entryProvider`; filters by scope visibility; truncates to
   * `limit`.
   */
  async retrieve(query: string, opts: HybridRetrieveOpts = {}): Promise<MemoryHit[]> {
    const limit = opts.limit ?? 10;
    const stageLimit = opts.stageLimit ?? DEFAULT_STAGE_LIMIT;
    if (!query || stageLimit <= 0) return [];

    const [denseRanking, graphRanking] = await Promise.all([
      this._runDense(query, stageLimit),
      this._runGraph(query, stageLimit),
    ]);
    const bm25Ranking = this._runBm25(query, stageLimit);

    const rankings: Array<ReadonlyMap<string, number>> = [];
    if (bm25Ranking.size > 0) rankings.push(bm25Ranking);
    if (denseRanking.size > 0) rankings.push(denseRanking);
    if (graphRanking.size > 0) rankings.push(graphRanking);
    if (rankings.length === 0) return [];

    const fused = this._fuser.fuse(rankings);
    const hits: MemoryHit[] = [];
    for (const [entryId, score] of fused) {
      const base = this._entryProvider(entryId);
      if (!base) continue;
      if (!isVisibleFromScope(base.scopeId, opts)) continue;
      hits.push({ ...base, score });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  private _runBm25(query: string, stageLimit: number): Map<string, number> {
    if (this._bm25.size === 0) return new Map();
    return this._bm25.search(query, stageLimit);
  }

  private async _runDense(query: string, stageLimit: number): Promise<Map<string, number>> {
    if (this._dense.size === 0) return new Map();
    let vec: Float32Array;
    try {
      vec = await this._embedder.embed(query);
    } catch {
      return new Map();
    }
    const hits = this._dense.search(vec, stageLimit);
    const out = new Map<string, number>();
    for (const hit of hits) out.set(hit.entryId, hit.score);
    return out;
  }

  private async _runGraph(query: string, stageLimit: number): Promise<Map<string, number>> {
    if (!this._graph) return new Map();
    try {
      return await this._graph.entitySearch(query, stageLimit);
    } catch {
      return new Map();
    }
  }
}

/**
 * Fast-path substring fallback used by callers (e.g. the desktop sidecar's
 * `UnifiedMemoryRetriever` wrapper) when the hybrid path is not yet
 * warm. The retriever itself does not own this -- corpus-size policy is
 * the consumer's responsibility.
 */
export function substringFallback(
  query: string,
  entries: ReadonlyArray<MemoryHit>,
  limit = 10,
): MemoryHit[] {
  if (!query) return [];
  const needle = query.toLowerCase();
  const matched: MemoryHit[] = [];
  for (const entry of entries) {
    if (entry.content.toLowerCase().includes(needle)) matched.push(entry);
    if (matched.length >= limit) break;
  }
  return matched;
}
