// ---------------------------------------------------------------------------
// Memory Shared Types
// ---------------------------------------------------------------------------
// Foundation type declarations shared between MemoryLayers.types and
// MemoryStore.types. Hosting them here breaks the circular dependency that
// existed when each file imported from the other (BASELINE-2026-04-25,
// closed by Phase 4 of the v0.6.0 cycle).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export interface MemoryProvenance {
  readonly source:
    | "user_stated"
    | "tool_verified"
    | "llm_extracted"
    | "pattern_detected"
    | "consolidated";
  readonly sourceSessionId: string | null;
  readonly sourceMessageId: string | null;
  readonly timestamp: number;
  readonly confidence: number; // 0.0 to 1.0
}

// ---------------------------------------------------------------------------
// TTL and Staleness
// ---------------------------------------------------------------------------

export interface MemoryTTL {
  readonly createdAt: number;
  readonly expiresAt: number | null; // null = no expiry
  readonly lastVerifiedAt: number;
  readonly staleAfterMs: number; // mark stale after this duration without access
}

/** Returns true when the memory has not been verified within its staleAfterMs window. */
export function isStale(ttl: MemoryTTL, now?: number): boolean {
  const ts = now ?? Date.now();
  return ts - ttl.lastVerifiedAt > ttl.staleAfterMs;
}

/** Returns true when the memory has passed its expiresAt timestamp. */
export function isExpired(ttl: MemoryTTL, now?: number): boolean {
  if (ttl.expiresAt === null) return false;
  const ts = now ?? Date.now();
  return ts >= ttl.expiresAt;
}

// ---------------------------------------------------------------------------
// MemoryEntry (Layer 3 row shape)
// ---------------------------------------------------------------------------

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
  /**
   * v1.1.0 Phase 4.1 -- lifecycle write context. The structured hook +
   * tool + span identifier that originated the row. Distinct from
   * `provenance` above (which is the consolidation-pipeline's source /
   * confidence record). `null` for legacy rows that pre-date the
   * Phase-4 migration.
   */
  readonly lifecycleProvenance?: import("../../core/memory/types.js").LifecycleProvenance | null;
  /**
   * v1.1.0 Phase 4.1 -- folder-scope tag that mirrors the in-memory
   * `MemoryHub` scope filter. `null` for unscoped (root) rows.
   */
  readonly scopeId?: string | null;
}

/** Retrieval tier for a memory entry. */
export type CorroborationTier = "fact" | "candidate";
