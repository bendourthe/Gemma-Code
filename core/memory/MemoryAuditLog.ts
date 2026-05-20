/**
 * v1.1.0 Phase 6.1 -- lightweight audit log for memory writes / reads /
 * deletes.
 *
 * The four-tier memory subsystem already persists row-level data in SQLite
 * (`src/storage/MemoryStore.ts`) and in the in-memory hub
 * (`core/memory/MemoryHub.ts`). The audit log is intentionally a separate
 * append-only surface so the `nexus memory audit` CLI and the Memory panel
 * can reconstruct a forensic trail without rebuilding it from row-level
 * accessed_at timestamps (which lose op kind and intent).
 *
 * Storage shape:
 *
 *   timestamp     unix ms when the op occurred
 *   op            one of "write" | "read" | "delete"
 *   tier          one of "working" | "episodic" | "semantic" | "graph"
 *   entryId       opaque row id
 *   sessionId     originating Coding / Chat session id (or null)
 *   hookKind      lifecycle hook that triggered the op (or null)
 *   toolName      populated for lifecycle.tool.* ops (or null)
 *   textPreview   first ~120 chars of the row text (or empty for delete)
 *
 * The default `InMemoryAuditLog` keeps rows in a ring buffer so unbounded
 * sessions do not balloon memory. A SQLite-backed implementation can be
 * dropped in by satisfying the same interface (the Phase 4 schema migration
 * already reserves the `memory_audit_log` table name for it).
 *
 * Adopts agentmemory A11 (see comparison-agentmemory.md Section 11.2 P1).
 */

import type { LifecycleProvenance } from "./types.js";

export type MemoryAuditOp = "write" | "read" | "delete";

export type MemoryTier = "working" | "episodic" | "semantic" | "graph";

export interface MemoryAuditRow {
  readonly timestamp: number;
  readonly op: MemoryAuditOp;
  readonly tier: MemoryTier;
  readonly entryId: string;
  readonly sessionId: string | null;
  readonly hookKind: string | null;
  readonly toolName: string | null;
  readonly textPreview: string;
}

export interface MemoryAuditFilter {
  /** Inclusive lower bound (unix ms). */
  readonly sinceMs?: number;
  /** Inclusive upper bound (unix ms). */
  readonly untilMs?: number;
  readonly tier?: MemoryTier;
  readonly sessionId?: string;
  readonly op?: MemoryAuditOp;
  /** Cap the rows returned. Default unbounded. */
  readonly limit?: number;
}

export interface MemoryAuditLog {
  append(row: MemoryAuditRow): void;
  query(filter?: MemoryAuditFilter): readonly MemoryAuditRow[];
  size(): number;
  clear(): void;
}

/** Truncate `text` to `n` chars, replacing newlines and trimming whitespace. */
export function previewText(text: string, n = 120): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= n) return normalized;
  return normalized.slice(0, n - 1) + "…";
}

/**
 * Helper that constructs a `MemoryAuditRow` from a `LifecycleProvenance`
 * record and the op specifics. The caller decides which tier the op
 * touched; provenance contributes the session + hook + tool fields.
 */
export function rowFromProvenance(args: {
  readonly op: MemoryAuditOp;
  readonly tier: MemoryTier;
  readonly entryId: string;
  readonly text: string;
  readonly provenance?: LifecycleProvenance | null;
  readonly timestamp?: number;
}): MemoryAuditRow {
  const provenance = args.provenance ?? null;
  return {
    timestamp: args.timestamp ?? Date.now(),
    op: args.op,
    tier: args.tier,
    entryId: args.entryId,
    sessionId: provenance?.sessionId ?? null,
    hookKind: provenance?.hookKind ?? null,
    toolName: provenance?.toolName ?? null,
    textPreview: previewText(args.text),
  };
}

/**
 * Default ring-buffer implementation. Bounded by `capacity` (default
 * 10,000 rows); when full the oldest row is dropped. Query honours
 * insertion order (which is monotonically non-decreasing in `timestamp`
 * because the only writer is single-threaded MemoryHub).
 */
export class InMemoryAuditLog implements MemoryAuditLog {
  private readonly _capacity: number;
  private readonly _rows: MemoryAuditRow[] = [];

  constructor(capacity = 10_000) {
    if (capacity < 1) throw new Error("InMemoryAuditLog: capacity must be >= 1");
    this._capacity = capacity;
  }

  append(row: MemoryAuditRow): void {
    this._rows.push(row);
    if (this._rows.length > this._capacity) {
      this._rows.splice(0, this._rows.length - this._capacity);
    }
  }

  query(filter: MemoryAuditFilter = {}): readonly MemoryAuditRow[] {
    const out: MemoryAuditRow[] = [];
    for (const row of this._rows) {
      if (filter.sinceMs !== undefined && row.timestamp < filter.sinceMs) continue;
      if (filter.untilMs !== undefined && row.timestamp > filter.untilMs) continue;
      if (filter.tier !== undefined && row.tier !== filter.tier) continue;
      if (filter.sessionId !== undefined && row.sessionId !== filter.sessionId) continue;
      if (filter.op !== undefined && row.op !== filter.op) continue;
      out.push(row);
      if (filter.limit !== undefined && out.length >= filter.limit) break;
    }
    return out;
  }

  size(): number {
    return this._rows.length;
  }

  clear(): void {
    this._rows.length = 0;
  }
}
