/**
 * v1.1.0 Phase 6.1 -- `nexus memory audit` output formatters.
 *
 * Pure functions over `MemoryAuditRow[]`. The CLI surface in
 * `bin/nexus.mjs` filters via `MemoryAuditLog.query()` and pipes the result
 * through `formatAuditTable` (human-readable) or `formatAuditJsonl` (one
 * JSON object per line). Both formats are deterministic so they can be
 * snapshot-tested without timestamps drifting.
 *
 * Adopts agentmemory A11 (see comparison-agentmemory.md Section 11.2 P1).
 */

import type { MemoryAuditRow } from "./MemoryAuditLog.js";

export interface AuditColumn<R> {
  readonly header: string;
  readonly project: (row: R) => string;
  /** Optional max width; longer values are truncated with `…`. */
  readonly maxWidth?: number;
}

/** Canonical column order shown by `nexus memory audit`. */
export const DEFAULT_AUDIT_COLUMNS: ReadonlyArray<AuditColumn<MemoryAuditRow>> = Object.freeze([
  { header: "timestamp", project: (r) => formatTimestamp(r.timestamp) },
  { header: "op", project: (r) => r.op, maxWidth: 6 },
  { header: "tier", project: (r) => r.tier, maxWidth: 9 },
  { header: "entryId", project: (r) => r.entryId, maxWidth: 12 },
  { header: "sessionId", project: (r) => r.sessionId ?? "-", maxWidth: 12 },
  { header: "hookKind", project: (r) => r.hookKind ?? "-", maxWidth: 28 },
  { header: "toolName", project: (r) => r.toolName ?? "-", maxWidth: 16 },
  { header: "textPreview", project: (r) => r.textPreview, maxWidth: 60 },
]);

/** ISO 8601 UTC timestamp without milliseconds. Stable across locales. */
export function formatTimestamp(unixMs: number): string {
  if (!Number.isFinite(unixMs) || unixMs < 0) return "-";
  const iso = new Date(unixMs).toISOString();
  return iso.slice(0, 19) + "Z";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, max);
  return s.slice(0, max - 1) + "…";
}

/**
 * Render rows as a fixed-width table. Column widths are computed from the
 * actual rows (capped at each column's `maxWidth`). Empty input still
 * renders the header line so callers can detect "no rows" by the lack of a
 * data row.
 */
export function formatAuditTable(
  rows: readonly MemoryAuditRow[],
  columns: ReadonlyArray<AuditColumn<MemoryAuditRow>> = DEFAULT_AUDIT_COLUMNS,
): string {
  const widths = columns.map((c) => c.header.length);
  const cells: string[][] = [];
  for (const row of rows) {
    const r: string[] = [];
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (!col) continue;
      const raw = col.project(row);
      const truncated = col.maxWidth !== undefined ? truncate(raw, col.maxWidth) : raw;
      r.push(truncated);
      if (truncated.length > (widths[i] ?? 0)) {
        widths[i] = truncated.length;
      }
    }
    cells.push(r);
  }

  const lines: string[] = [];
  lines.push(
    columns.map((c, i) => c.header.padEnd(widths[i] ?? c.header.length)).join("  "),
  );
  lines.push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of cells) {
    lines.push(row.map((cell, i) => cell.padEnd(widths[i] ?? cell.length)).join("  "));
  }
  return lines.join("\n");
}

/**
 * Render rows as JSONL. One JSON object per line; trailing newline.
 * Values are emitted exactly as recorded (no preview truncation beyond
 * what the log itself stored).
 */
export function formatAuditJsonl(rows: readonly MemoryAuditRow[]): string {
  if (rows.length === 0) return "";
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

/**
 * Parse an ISO 8601 string (date or date-time) into a unix-ms timestamp.
 * Returns `null` for unparseable input so the CLI can reject `--since`
 * gracefully.
 */
export function parseSinceFlag(value: string | undefined | null): number | null {
  if (!value) return null;
  // Accept bare date (2026-05-01) by appending T00:00:00Z so the parse is
  // explicit and timezone-stable.
  const trimmed = value.trim();
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00Z` : trimmed;
  const ms = Date.parse(candidate);
  return Number.isFinite(ms) ? ms : null;
}
