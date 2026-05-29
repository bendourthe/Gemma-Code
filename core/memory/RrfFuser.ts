/**
 * v1.1.0 Phase 5.4 -- Reciprocal Rank Fusion (RRF).
 *
 * Reference: Cormack, Clarke, Buettcher, "Reciprocal Rank Fusion outperforms
 * Condorcet and individual rank learning methods" (SIGIR 2009). The fused
 * score for an entry `e` is `sum_over_rankings(1 / (k + rank_i(e)))`, where
 * `rank_i(e)` is its 1-based position in ranking `i`. Entries absent from
 * a ranking contribute nothing from that ranking.
 *
 * The default `k = 60` matches the paper's canonical value and the
 * SettingsStore key `nexus.memory.rrf.k`. Lower `k` boosts top-of-list
 * confidence; higher `k` smooths between rankings.
 *
 * Input format: each ranking is a `Map<entryId, score>` whose insertion
 * order encodes the ranking position. Callers that produce score-sorted
 * arrays should build the map by iterating descending-score-first so the
 * 1st-inserted key is rank 1. (Maps preserve insertion order in JS by
 * spec.)
 *
 * Adopts agentmemory A1 (see docs/versions/v1/v1.1.0/comparison-agentmemory.md
 * Section 11.2 P1).
 */

export const DEFAULT_RRF_K = 60;

/**
 * Fuse rankings via Reciprocal Rank Fusion. Returns a `Map<entryId,
 * fusedScore>` whose iteration order is descending by score. Ties are
 * broken by entryId for determinism.
 */
export function fuse(
  rankings: ReadonlyArray<ReadonlyMap<string, number>>,
  k: number = DEFAULT_RRF_K,
): Map<string, number> {
  const fused = new Map<string, number>();
  for (const ranking of rankings) {
    let position = 0;
    for (const entryId of ranking.keys()) {
      position++;
      const contribution = 1 / (k + position);
      fused.set(entryId, (fused.get(entryId) ?? 0) + contribution);
    }
  }
  const ordered = [...fused.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0] < b[0] ? -1 : 1;
  });
  return new Map(ordered);
}

/**
 * Convenience class wrapping `fuse` with a configurable `k`. The
 * SettingsStore-aware sidecar wiring creates one `RrfFuser` per
 * `HybridRetriever` and updates `k` on settings change rather than
 * re-instantiating.
 */
export class RrfFuser {
  k: number;

  constructor(k: number = DEFAULT_RRF_K) {
    this.k = k;
  }

  /** Same semantics as the free `fuse()` function but uses the instance `k`. */
  fuse(
    rankings: ReadonlyArray<ReadonlyMap<string, number>>,
  ): Map<string, number> {
    return fuse(rankings, this.k);
  }
}
