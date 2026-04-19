import type { EmbeddingClient } from "../storage/EmbeddingClient.js";
import { cosineSimilarityNormalized } from "../storage/embeddingUtils.js";
import type { PromptSection } from "./PromptBuilder.types.js";

/** Context signals used for relevance scoring. */
export interface ScoringContext {
  readonly currentQuery?: string;
  readonly currentTimestamp: number;
  readonly recentUserMessage?: string;
}

/** Weight distribution for relevance scoring components (must sum to 1.0). */
export interface ScoringWeights {
  readonly staticPriority: number;
  readonly temporalRecency: number;
  readonly semanticSimilarity: number;
  readonly userMention: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  staticPriority: 0.3,
  temporalRecency: 0.2,
  semanticSimilarity: 0.3,
  userMention: 0.2,
};

const ONE_HOUR_MS = 3600_000;
const SIX_HOURS_MS = 6 * ONE_HOUR_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

/**
 * Scores prompt sections by multiple relevance signals so that the most
 * useful context is packed first, not just the highest-static-priority.
 *
 * Components:
 * - staticPriority: normalized from section.priority (lower priority number = higher score)
 * - temporalRecency: decay from section.lastRelevantAt
 * - semanticSimilarity: cosine similarity via embedding (graceful degradation without embedder)
 * - userMention: keyword overlap with the most recent user message
 */
export class RelevanceScorer {
  private readonly _weights: ScoringWeights;
  private readonly _embeddingCache = new Map<string, number[] | null>();
  private _queryEmbedding: number[] | null | undefined;

  constructor(
    private readonly _embedder?: EmbeddingClient | null,
    weights?: ScoringWeights,
  ) {
    this._weights = weights ?? DEFAULT_WEIGHTS;
  }

  /**
   * Score a single section against the current context.
   * Returns a value in [0, 1] where higher is more relevant.
   */
  async scoreSection(
    section: PromptSection,
    context: ScoringContext,
  ): Promise<number> {
    const sp = this._scoreStaticPriority(section.priority);
    const tr = this._scoreTemporalRecency(section.lastRelevantAt, context.currentTimestamp);
    const ss = await this._scoreSemanticSimilarity(section.content, context.currentQuery);
    const um = this._scoreUserMention(section, context.recentUserMessage);

    return (
      this._weights.staticPriority * sp +
      this._weights.temporalRecency * tr +
      this._weights.semanticSimilarity * ss +
      this._weights.userMention * um
    );
  }

  /** Clear cached embeddings between build calls. */
  clearCache(): void {
    this._embeddingCache.clear();
    this._queryEmbedding = undefined;
  }

  // -------------------------------------------------------------------------
  // Scoring components
  // -------------------------------------------------------------------------

  /**
   * Normalize section priority to [0, 1].
   * Priority 0 maps to 1.0, priority 100 maps to 0.0.
   */
  _scoreStaticPriority(priority: number): number {
    return Math.max(0, Math.min(1, 1 - priority / 100));
  }

  /**
   * Temporal recency decay based on how recently the section was relevant.
   */
  _scoreTemporalRecency(
    lastRelevantAt: number | undefined,
    currentTimestamp: number,
  ): number {
    if (lastRelevantAt === undefined) return 0.5; // neutral default
    const age = currentTimestamp - lastRelevantAt;
    if (age < ONE_HOUR_MS) return 1.0;
    if (age < SIX_HOURS_MS) return 0.8;
    if (age < ONE_DAY_MS) return 0.5;
    return 0.2;
  }

  /**
   * Cosine similarity between the query and section content embeddings.
   * Returns 0.5 when no embedder is available (neutral).
   */
  private async _scoreSemanticSimilarity(
    sectionContent: string,
    currentQuery: string | undefined,
  ): Promise<number> {
    if (!this._embedder || !currentQuery) return 0.5;

    // Get or compute query embedding (cached for the entire scoring pass).
    if (this._queryEmbedding === undefined) {
      this._queryEmbedding = await this._embedder.embed(currentQuery);
    }
    if (!this._queryEmbedding) return 0.5;

    // Get or compute section content embedding.
    let sectionEmb = this._embeddingCache.get(sectionContent);
    if (sectionEmb === undefined) {
      // Embed only the first 500 chars to keep it cheap.
      sectionEmb = await this._embedder.embed(sectionContent.slice(0, 500));
      this._embeddingCache.set(sectionContent, sectionEmb);
    }
    if (!sectionEmb) return 0.5;

    return this._cosineSimilarity(this._queryEmbedding, sectionEmb);
  }

  /**
   * Simple keyword overlap between the recent user message and
   * the section's id + content. Returns 1.0 on match, 0.0 otherwise.
   */
  _scoreUserMention(
    section: PromptSection,
    recentUserMessage: string | undefined,
  ): number {
    if (!recentUserMessage) return 0.0;

    const keywords = recentUserMessage
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    if (keywords.length === 0) return 0.0;

    const haystack = `${section.id} ${section.content}`.toLowerCase();
    const matchCount = keywords.filter((kw) => haystack.includes(kw)).length;
    return matchCount / keywords.length;
  }

  /** Cosine similarity normalized to [0, 1]; 0.5 for empty/zero-norm vectors. */
  private _cosineSimilarity(a: number[], b: number[]): number {
    return cosineSimilarityNormalized(a, b);
  }
}
