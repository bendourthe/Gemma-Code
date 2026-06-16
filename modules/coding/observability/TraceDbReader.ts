import Database from "better-sqlite3";
import type { Span, SpanKind, SpanStatus } from "./TraceStore.js";
import type { ExportableTrace } from "./TraceHtmlExport.js";

/**
 * v1.6.0 Phase 2 (A4) -- read a single trace (and its spans) from the local
 * SQLite trace store for the `nexus trace export` CLI.
 *
 * Why this exists separately from `TraceStore.getTrace`: `TraceStore` pulls in
 * `secureDbPermissions` -> the vscode-coupled logger, so it cannot be loaded in
 * a plain-Node CLI process (no `vscode` module). This reader opens the DB
 * read-only with no such coupling, mirroring the exact `traces` / `spans`
 * schema `TraceStore` defines. It is intentionally read-only: it never writes,
 * migrates, or mutates the store. The type imports are erased at compile time,
 * so the compiled module has no runtime dependency on `TraceStore`.
 */

interface TraceRow {
  trace_id: string;
  session_id: string | null;
  root_span_id: string;
  start_time: number;
  end_time: number | null;
}

interface SpanRow {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  kind: string;
  start_time: number;
  end_time: number | null;
  duration_ms: number | null;
  status: string;
  attributes: string;
  events: string;
}

function rowToSpan(row: SpanRow): Span {
  return {
    traceId: row.trace_id,
    spanId: row.span_id,
    parentSpanId: row.parent_span_id,
    name: row.name,
    kind: row.kind as SpanKind,
    startTime: row.start_time,
    endTime: row.end_time,
    durationMs: row.duration_ms,
    status: row.status as SpanStatus,
    attributes: safeParse(row.attributes, {}),
    events: safeParse(row.events, []),
  };
}

function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Open `dbPath` read-only and return the requested trace with its full span
 * list (ordered by start time), or `null` when no such trace exists.
 */
export function readExportableTrace(dbPath: string, traceId: string): ExportableTrace | null {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const traceRow = db
      .prepare(
        "SELECT trace_id, session_id, root_span_id, start_time, end_time FROM traces WHERE trace_id = ?",
      )
      .get(traceId) as TraceRow | undefined;
    if (!traceRow) return null;

    const spanRows = db
      .prepare(
        "SELECT span_id, trace_id, parent_span_id, name, kind, start_time, end_time, duration_ms, status, attributes, events FROM spans WHERE trace_id = ? ORDER BY start_time ASC",
      )
      .all(traceId) as SpanRow[];

    const spans = spanRows.map(rowToSpan);
    return {
      traceId: traceRow.trace_id,
      sessionId: traceRow.session_id,
      rootSpanId: traceRow.root_span_id,
      startTime: traceRow.start_time,
      endTime: traceRow.end_time,
      spanCount: spans.length,
      spans,
    };
  } finally {
    db.close();
  }
}
