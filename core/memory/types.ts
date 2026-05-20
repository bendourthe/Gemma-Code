/**
 * v1.1.0 Phase 4.1 -- shared memory types.
 *
 * `LifecycleProvenance` is the structured write-context that every memory
 * write carries from v1.1.0 onward. It is intentionally distinct from
 * `MemoryProvenance` (in `src/storage/MemoryShared.types.ts`), which is
 * the consolidation-pipeline's source/confidence record. The new shape is
 * tied to the `HookBus` lifecycle event that originated the write so the
 * Memory panel can render `{hookKind, toolName}` chips and the audit CLI
 * can group rows by session / hook.
 *
 * Adopts agentmemory A8 (see comparison-agentmemory.md Section 11.2 P0).
 */

import type { ScopeId } from "./MemoryHub.js";

export type LifecycleHookKind =
  | "lifecycle.session.start"
  | "lifecycle.session.stop"
  | "lifecycle.session.end"
  | "lifecycle.user.prompt"
  | "lifecycle.tool.pre"
  | "lifecycle.tool.post"
  | "lifecycle.tool.failed"
  | "lifecycle.subagent.start"
  | "lifecycle.subagent.stop"
  | "lifecycle.context.preCompact"
  | "lifecycle.notification"
  | "lifecycle.skill.entry";

/**
 * Provenance attached to every memory write under v1.1.0.
 *
 * Mandatory fields:
 *   * `sessionId`  -- the originating Coding / Chat session id.
 *   * `hookKind`   -- the `LifecycleEvent.kind` that triggered the write.
 *
 * Optional fields:
 *   * `toolName`     -- populated for `lifecycle.tool.*` writes.
 *   * `parentSpanId` -- populated when an active Tracer span exists.
 */
export interface LifecycleProvenance {
  readonly sessionId: string;
  readonly hookKind: LifecycleHookKind | string;
  readonly toolName?: string;
  readonly parentSpanId?: string;
}

/**
 * Row-level metadata persisted alongside `LifecycleProvenance`. The
 * `scope_id` mirrors the in-memory `MemoryHub` scope filter so the SQLite
 * tier honours the same per-folder visibility rules.
 */
export interface MemoryEntryMetadata {
  readonly provenance?: LifecycleProvenance | null;
  readonly scopeId?: ScopeId;
}

/** Type guard used by the JSON-from-SQLite read path. */
export function isLifecycleProvenance(value: unknown): value is LifecycleProvenance {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.sessionId !== "string" || v.sessionId.length === 0) return false;
  if (typeof v.hookKind !== "string" || v.hookKind.length === 0) return false;
  if (v.toolName !== undefined && typeof v.toolName !== "string") return false;
  if (v.parentSpanId !== undefined && typeof v.parentSpanId !== "string") return false;
  return true;
}

/**
 * Safely parse a JSON column value (text or null) into a
 * `LifecycleProvenance`. Returns `null` when the column is null, empty,
 * malformed JSON, or fails the shape guard -- never throws.
 */
export function parseProvenance(value: string | null | undefined): LifecycleProvenance | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isLifecycleProvenance(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Inverse of `parseProvenance` -- safe for use in INSERT/UPDATE binds.
 * Returns `null` when the input is null/undefined so the column stays
 * NULL rather than the literal string "null".
 */
export function serializeProvenance(p: LifecycleProvenance | null | undefined): string | null {
  if (!p) return null;
  return JSON.stringify(p);
}
