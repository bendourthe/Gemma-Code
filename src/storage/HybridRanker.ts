import type { MemoryEntry } from "./MemoryShared.types.js";

/**
 * v0.8.0 Phase 4 sub-task 4.6 (items A5 / A6) -- hybrid scoring layered on
 * top of the v0.7.0 Phase 7 HNSW index.
 *
 * The ranker combines three sub-scores into a single ranked list with a
 * `reason` explanation attached to every entry:
 *
 *   - **Vector** (HNSW or linear-scan fallback cosine similarity)
 *   - **Lexical** (FTS5 BM25-shaped rank)
 *   - **Recency** (exponential decay from `updatedAt`)
 *
 * Two fusion methods are supported via `method`:
 *
 *   - `rrf` (default): Reciprocal Rank Fusion with k = 60. Robust to score
 *     scale differences between sub-rankers.
 *   - `weighted`: 50% vector + 30% lexical + 20% recency. Useful when the
 *     vector engine consistently dominates and the operator wants a
 *     deterministic linear blend.
 *
 * `HybridRanker` is a pure module: no I/O, no fs, no embedder calls. Callers
 * (MemoryStore, UnifiedMemoryRetriever) feed in pre-fetched candidate lists
 * and receive a fused output. Tests cover RRF determinism, recency decay,
 * and the invariant that every output carries at least one reason.
 */

export type FusionMethod = "rrf" | "weighted";

export interface HybridRankerOptions {
  readonly method?: FusionMethod;
  /** Reciprocal-rank-fusion constant. Defaults to 60 per the Mnemosyne paper. */
  readonly rrfK?: number;
  /** Recency decay half-life in milliseconds. Defaults to 7 days. */
  readonly recencyHalfLifeMs?: number;
  /** Maximum number of fused results to return. Defaults to 20. */
  readonly limit?: number;
  /** Override `Date.now()` for deterministic tests. */
  readonly now?: number;
}

export interface VectorCandidate {
  readonly entry: MemoryEntry;
  /** Cosine similarity (0..1). */
  readonly similarity: number;
  /** Optional descriptor for the source ("hnsw" | "linear-scan"). */
  readonly source?: "hnsw" | "linear-scan";
}

export interface LexicalCandidate {
  readonly entry: MemoryEntry;
  /** BM25-shaped score normalised to 0..1. */
  readonly score: number;
}

export interface RankedEntry {
  readonly entry: MemoryEntry;
  readonly score: number;
  readonly reason: readonly string[];
}

const DEFAULT_OPTIONS: Required<Omit<HybridRankerOptions, "now">> = {
  method: "rrf",
  rrfK: 60,
  recencyHalfLifeMs: 7 * 24 * 60 * 60 * 1000,
  limit: 20,
};

export class HybridRanker {
  private readonly _options: Required<Omit<HybridRankerOptions, "now">>;
  private readonly _nowProvider: () => number;

  constructor(options: HybridRankerOptions = {}) {
    const { now, ...rest } = options;
    this._options = { ...DEFAULT_OPTIONS, ...rest };
    this._nowProvider = now !== undefined ? () => now : () => Date.now();
  }

  /**
   * Fuse the vector and lexical candidate lists. The recency sub-score is
   * computed from `entry.accessedAt` (the most recent access in the store).
   * Returns a sorted list with `reason` strings explaining provenance.
   */
  rank(
    vector: readonly VectorCandidate[],
    lexical: readonly LexicalCandidate[],
  ): RankedEntry[] {
    if (vector.length === 0 && lexical.length === 0) return [];

    const vectorRankById = new Map<string, number>();
    vector.forEach((c, i) => vectorRankById.set(c.entry.id, i + 1));
    const lexicalRankById = new Map<string, number>();
    lexical.forEach((c, i) => lexicalRankById.set(c.entry.id, i + 1));

    // Build the union of entries.
    const entryById = new Map<string, MemoryEntry>();
    for (const c of vector) entryById.set(c.entry.id, c.entry);
    for (const c of lexical) entryById.set(c.entry.id, c.entry);

    const now = this._nowProvider();
    const halfLife = this._options.recencyHalfLifeMs;

    const ranked: RankedEntry[] = [];
    for (const [id, entry] of entryById) {
      const vRank = vectorRankById.get(id);
      const lRank = lexicalRankById.get(id);
      const vCandidate = vector.find((c) => c.entry.id === id);
      const lCandidate = lexical.find((c) => c.entry.id === id);
      const recency = computeRecencyScore(entry.accessedAt, now, halfLife);

      let score: number;
      const reasons: string[] = [];

      if (this._options.method === "rrf") {
        score = 0;
        if (vRank !== undefined) {
          const contribution = 1 / (this._options.rrfK + vRank);
          score += contribution;
          const sourceLabel = vCandidate?.source ?? "vector";
          reasons.push(
            `${sourceLabel === "hnsw" ? "HNSW" : sourceLabel === "linear-scan" ? "Linear-scan" : "Vector"} rank #${vRank} (cosine ${vCandidate?.similarity?.toFixed(2) ?? "n/a"})`,
          );
        }
        if (lRank !== undefined) {
          const contribution = 1 / (this._options.rrfK + lRank);
          score += contribution;
          reasons.push(`FTS5 rank #${lRank}`);
        }
        // Recency factored as a low-weight rank: index 1 if very recent (<1
        // half-life ago), index 2 if within 2 half-lives, etc.
        const recencyRank = Math.max(1, Math.ceil(-Math.log2(Math.max(recency, 1e-3))));
        const recencyContribution = 1 / (this._options.rrfK + recencyRank);
        score += recencyContribution * 0.5; // recency weighs half what rank-based signals do
        reasons.push(recencyLabel(entry.accessedAt, now));
      } else {
        // Weighted 50/30/20.
        const vScore = vCandidate ? vCandidate.similarity : 0;
        const lScore = lCandidate ? lCandidate.score : 0;
        score = 0.5 * vScore + 0.3 * lScore + 0.2 * recency;
        if (vCandidate) {
          const sourceLabel = vCandidate.source ?? "vector";
          reasons.push(
            `${sourceLabel === "hnsw" ? "HNSW" : sourceLabel === "linear-scan" ? "Linear-scan" : "Vector"} cosine ${vCandidate.similarity.toFixed(2)}`,
          );
        }
        if (lCandidate) reasons.push(`FTS5 score ${lCandidate.score.toFixed(2)}`);
        reasons.push(recencyLabel(entry.accessedAt, now));
      }

      ranked.push({ entry, score, reason: reasons });
    }

    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, this._options.limit);
  }
}

/**
 * Exponential decay from the entry's `accessedAt` timestamp. Returns a value
 * in (0, 1] where 1 means "accessed right now" and approaches 0 as the entry
 * ages past several half-lives.
 */
export function computeRecencyScore(
  accessedAt: number,
  now: number,
  halfLifeMs: number,
): number {
  if (accessedAt <= 0 || halfLifeMs <= 0) return 0;
  const deltaMs = Math.max(0, now - accessedAt);
  return Math.pow(0.5, deltaMs / halfLifeMs);
}

function recencyLabel(accessedAt: number, now: number): string {
  const delta = Math.max(0, now - accessedAt);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days} day${days === 1 ? "" : "s"} ago`;
}
