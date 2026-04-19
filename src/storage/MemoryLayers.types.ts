// ---------------------------------------------------------------------------
// Memory Layer Architecture -- Type Definitions
// ---------------------------------------------------------------------------
// Defines the 4-layer memory stack: working, episodic, semantic, graph.
// All interfaces use readonly fields. No runtime code in this file except
// the isStale/isExpired utility functions.
// ---------------------------------------------------------------------------

import type { MemoryEntry } from "./MemoryStore.types.js";

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
// Write Policy
// ---------------------------------------------------------------------------

/**
 * Write policy that gates promotion of detected patterns to semantic memory.
 *
 * Note (v0.4.0, finding #57): the `user_requested` policy was removed because
 * the consolidation pipeline never has access to user-stated provenance and
 * the corresponding case in `MemoryConsolidator.shouldPersist` always returned
 * false. If user-stated promotion is reintroduced, extend `DetectedPattern`
 * with `provenance.source` so the gate can actually check it.
 */
export type WritePolicy =
  | "tool_verified"
  | "pattern_recurring"
  | "always";

export interface WriteGate {
  readonly policy: WritePolicy;
  readonly minRecurrences: number; // for pattern_recurring, default 2
  readonly requireVerification: boolean; // must be confirmed by tool result
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
// Layer 1: Working Memory
// ---------------------------------------------------------------------------

export interface WorkingMemoryState {
  currentTask: string | null;
  openFiles: string[];
  recentErrors: Array<{
    readonly file: string;
    readonly error: string;
    readonly timestamp: number;
  }>;
  architecturalDecisions: Array<{
    readonly decision: string;
    readonly rationale: string;
    readonly timestamp: number;
  }>;
  activeGoals: string[];
  scratchpad: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Layer 2: Episodic Memory
// ---------------------------------------------------------------------------

export interface EpisodicEntry {
  readonly id: string;
  readonly sessionId: string;
  readonly action: string;
  readonly context: string;
  readonly outcome: string | null;
  readonly timestamp: number;
  readonly provenance: MemoryProvenance;
  readonly tags: readonly string[];
}

// ---------------------------------------------------------------------------
// Layer 3: Semantic Memory (extends existing MemoryEntry)
// ---------------------------------------------------------------------------

export interface SemanticMemoryEntry extends MemoryEntry {
  readonly provenance: MemoryProvenance;
  readonly ttl: MemoryTTL;
  readonly scope: "global" | "project" | "session";
}

// ---------------------------------------------------------------------------
// Layer 4: Graph Memory
// ---------------------------------------------------------------------------

export type EntityType =
  | "file"
  | "function"
  | "class"
  | "module"
  | "variable"
  | "concept"
  | "person"
  | "technology"
  | "error"
  | "decision";

export interface GraphEntity {
  readonly id: string;
  readonly name: string;
  readonly type: EntityType;
  readonly properties: Record<string, unknown>;
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly mentionCount: number;
}

export type RelationType =
  | "imports"
  | "calls"
  | "extends"
  | "implements"
  | "depends_on"
  | "causes"
  | "resolves"
  | "related_to"
  | "modifies"
  | "tests"
  | "decided_for"
  | "decided_against";

export interface GraphRelation {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly type: RelationType;
  readonly weight: number; // 0.0 to 1.0
  readonly provenance: MemoryProvenance;
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
}

// ---------------------------------------------------------------------------
// Unified Query
// ---------------------------------------------------------------------------

export type MemoryLayerId = "working" | "episodic" | "semantic" | "graph";

export interface MemoryQuery {
  readonly query: string;
  readonly layers: readonly MemoryLayerId[];
  readonly tokenBudget: number;
  readonly maxResults: number;
  readonly includeStale: boolean;
}

export interface MemoryResultEntry {
  readonly layer: MemoryLayerId;
  readonly content: string;
  readonly score: number;
  readonly provenance: MemoryProvenance;
}

export interface MemoryQueryResult {
  readonly entries: readonly MemoryResultEntry[];
  readonly totalTokens: number;
  readonly layerCounts: Record<MemoryLayerId, number>;
}
