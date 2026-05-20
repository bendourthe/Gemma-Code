/**
 * v1.1.0 Phase 6.2 -- `nexus memory export` / `nexus memory import` JSONL
 * transport.
 *
 * One JSONL line per row, full row contents preserved verbatim. Vectors are
 * encoded base64 to keep line length predictable and to avoid the precision
 * loss inherent in JSON's decimal serialization. The export path is clamped
 * to `~/.nexus/exports/` by the CLI surface; this module itself is path-
 * agnostic so it can be unit-tested against in-memory sources.
 *
 * Round-trip integrity is asserted by the import sink: every imported row
 * carries the original `id` so re-importing into an empty store reproduces
 * the source corpus exactly.
 *
 * Adopts agentmemory A10 (see comparison-agentmemory.md Section 11.2 P1).
 */

import type { LifecycleProvenance } from "./types.js";
import type { MemoryTier } from "./MemoryAuditLog.js";

export interface ExportableRow {
  readonly id: string;
  readonly tier: MemoryTier;
  readonly content: string;
  /** Base64-encoded little-endian Float32 vector, or `null` if no embedding. */
  readonly vectorB64: string | null;
  readonly scopeId: string | null;
  readonly provenance: LifecycleProvenance | null;
  readonly createdAt: number;
  readonly accessedAt: number;
  readonly accessCount: number;
  readonly corroborationCount: number;
}

export interface ExportFilter {
  readonly tiers?: ReadonlyArray<MemoryTier>;
  readonly scopeId?: string;
  readonly sinceMs?: number;
}

export interface ExportSource {
  /** Yield rows matching `filter`. Order is implementation-defined. */
  list(filter: ExportFilter): Iterable<ExportableRow>;
}

export interface ImportSink {
  /**
   * Upsert a row by `id`. Implementations should preserve `createdAt`
   * and `accessedAt` from the import payload to keep audit semantics
   * intact across export/import cycles.
   */
  upsert(row: ExportableRow): void;
}

/**
 * Encode a `Float32Array` as base64. Browser-safe: uses `Buffer` when
 * available, otherwise falls back to a manual binary-string conversion.
 */
export function encodeVectorB64(vec: Float32Array | null | undefined): string | null {
  if (!vec || vec.length === 0) return null;
  const bytes = new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0);
  // btoa is available in modern Node and all browsers.
  return globalThis.btoa(bin);
}

/** Decode a base64-encoded Float32 vector. Returns null for null/empty input. */
export function decodeVectorB64(b64: string | null | undefined): Float32Array | null {
  if (b64 === null || b64 === undefined || b64.length === 0) return null;
  let bytes: Uint8Array;
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(b64, "base64");
    bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } else {
    const bin = globalThis.atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
  }
  if (bytes.length % 4 !== 0) return null;
  // Copy into an aligned buffer so Float32Array view is safe regardless of
  // the underlying ArrayBuffer alignment from Buffer.
  const aligned = new ArrayBuffer(bytes.length);
  new Uint8Array(aligned).set(bytes);
  return new Float32Array(aligned);
}

export interface ExportResult {
  readonly text: string;
  readonly rowCount: number;
}

/**
 * Serialise `source` to JSONL. One row per line; trailing newline. The
 * order of rows in the output is the order the source's iterator yields
 * them, which lets callers control export determinism by providing an
 * already-sorted source.
 */
export function exportToJsonl(source: ExportSource, filter: ExportFilter = {}): ExportResult {
  const lines: string[] = [];
  let rowCount = 0;
  for (const row of source.list(filter)) {
    lines.push(JSON.stringify(row));
    rowCount += 1;
  }
  const text = lines.length === 0 ? "" : lines.join("\n") + "\n";
  return { text, rowCount };
}

export interface ImportResult {
  readonly imported: number;
  readonly skipped: number;
  readonly errors: ReadonlyArray<{ readonly line: number; readonly reason: string }>;
}

function isExportableRow(value: unknown): value is ExportableRow {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (typeof v.tier !== "string") return false;
  if (typeof v.content !== "string") return false;
  if (v.vectorB64 !== null && typeof v.vectorB64 !== "string") return false;
  if (v.scopeId !== null && typeof v.scopeId !== "string") return false;
  if (typeof v.createdAt !== "number") return false;
  if (typeof v.accessedAt !== "number") return false;
  if (typeof v.accessCount !== "number") return false;
  return true;
}

/**
 * Parse JSONL `text` and feed every well-formed row to `sink.upsert`.
 * Malformed lines are recorded in `result.errors` but do not abort the
 * import (so a single corrupted row never wedges the whole file).
 */
export function importFromJsonl(text: string, sink: ImportSink): ImportResult {
  const errors: Array<{ line: number; reason: string }> = [];
  let imported = 0;
  let skipped = 0;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      errors.push({
        line: i + 1,
        reason: `JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
      });
      skipped += 1;
      continue;
    }
    if (!isExportableRow(parsed)) {
      errors.push({ line: i + 1, reason: "row failed shape validation" });
      skipped += 1;
      continue;
    }
    sink.upsert(parsed);
    imported += 1;
  }
  return { imported, skipped, errors };
}

/**
 * Validate that an absolute target path lies under the supplied `allowedRoot`.
 * Returns `true` when safe, `false` when the resolved path escapes the root
 * (path traversal attempt). Pure -- callers pass already-resolved paths.
 */
export function isPathInside(absoluteTarget: string, allowedRoot: string): boolean {
  if (!absoluteTarget || !allowedRoot) return false;
  const a = absoluteTarget.replace(/\\/g, "/").replace(/\/+$/, "");
  const b = allowedRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  if (a === b) return true;
  return a.startsWith(b + "/");
}
