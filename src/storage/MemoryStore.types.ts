// ---------------------------------------------------------------------------
// MemoryStore -- public type surface
// ---------------------------------------------------------------------------
// Foundation types (MemoryEntry, MemoryProvenance, MemoryTTL, MemoryType)
// live in MemoryShared.types.ts; layer-specific types live in
// MemoryLayers.types.ts. This file re-exports them for callers that prefer
// the historical "MemoryStore.types" import path.
// ---------------------------------------------------------------------------

import type { MemoryEntry } from "./MemoryShared.types.js";

// Re-export shared foundations so existing call sites keep working.
export type {
  MemoryEntry,
  MemoryType,
  MemoryProvenance,
  MemoryTTL,
  CorroborationTier,
} from "./MemoryShared.types.js";
export { isStale, isExpired } from "./MemoryShared.types.js";

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
  readonly corroborationTier?: import("./MemoryShared.types.js").CorroborationTier;
}

export interface MemoryStats {
  readonly totalEntries: number;
  readonly byType: Record<
    import("./MemoryShared.types.js").MemoryType,
    number
  >;
  readonly oldestEntryAt: number | null;
  readonly newestEntryAt: number | null;
  readonly embeddingCount: number;
}

// Re-export layer types for convenience (preserves the historical surface).
export type {
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
