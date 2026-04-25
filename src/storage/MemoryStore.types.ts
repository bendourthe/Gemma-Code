import type { MemoryProvenance, MemoryTTL } from "./MemoryLayers.types.js";

export type MemoryType =
  | "decision"
  | "fact"
  | "preference"
  | "file_pattern"
  | "error_resolution";

export interface MemoryEntry {
  readonly id: string;
  readonly sessionId: string | null;
  readonly content: string;
  readonly type: MemoryType;
  readonly embedding: number[] | null;
  readonly createdAt: number;
  readonly accessedAt: number;
  readonly accessCount: number;
  readonly relevanceDecay: number;
  /**
   * Number of independent observations that have corroborated this entry.
   * Default 1 on first save; incremented by `MemoryConsolidator` when a new
   * matching observation arrives. Compared against
   * `gemma-code.memoryCorroborationThreshold` to gate retrieval tier.
   */
  readonly corroborationCount: number;
  readonly provenance?: MemoryProvenance;
  readonly ttl?: MemoryTTL;
  readonly scope?: "global" | "project" | "session";
}

/** Retrieval tier for a memory entry. */
export type CorroborationTier = "fact" | "candidate";

export interface MemorySearchResult {
  readonly entry: MemoryEntry;
  /** Combined relevance score in the range 0..1. */
  readonly score: number;
  readonly matchSource: "keyword" | "semantic" | "both";
  /**
   * Corroboration tier derived from `entry.corroborationCount` and the
   * configured threshold. Surfaced so retrieval consumers can prefer
   * fact-tier rows over candidate-tier rows.
   */
  readonly corroborationTier?: CorroborationTier;
}

export interface MemoryStats {
  readonly totalEntries: number;
  readonly byType: Record<MemoryType, number>;
  readonly oldestEntryAt: number | null;
  readonly newestEntryAt: number | null;
  readonly embeddingCount: number;
}

// Re-export layer types for convenience.
export type {
  MemoryProvenance,
  MemoryTTL,
  WriteGate,
  WritePolicy,
  WorkingMemoryState,
  EpisodicEntry,
  SemanticMemoryEntry,
  GraphEntity,
  GraphRelation,
  EntityType,
  RelationType,
  MemoryLayerId,
  MemoryQuery,
  MemoryQueryResult,
  MemoryResultEntry,
} from "./MemoryLayers.types.js";

export { isStale, isExpired } from "./MemoryLayers.types.js";
