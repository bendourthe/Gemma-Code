import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { secureDbPermissions } from "../storage/dbPermissions.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpanKind =
  | "agent_turn"
  | "tool_call"
  | "llm_call"
  | "compaction"
  | "sub_agent"
  | "planning"
  | "reflexion"
  | "custom";

export type SpanStatus = "ok" | "error" | "cancelled";

export interface SpanEvent {
  readonly name: string;
  readonly timestamp: number;
  readonly attributes?: Record<string, string | number | boolean>;
}

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly name: string;
  readonly kind: SpanKind;
  readonly startTime: number;
  readonly endTime: number | null;
  readonly durationMs: number | null;
  readonly status: SpanStatus;
  readonly attributes: Record<string, string | number | boolean>;
  readonly events: SpanEvent[];
}

export interface Trace {
  readonly traceId: string;
  readonly sessionId: string | null;
  readonly rootSpanId: string;
  readonly startTime: number;
  readonly endTime: number | null;
  readonly spanCount: number;
}

/** Pre-aggregated counts for a single trace, populated by getTraceAggregates. */
export interface TraceAggregate {
  readonly traceId: string;
  readonly durationMs: number;
  readonly toolCount: number;
  readonly llmCount: number;
  readonly retryCount: number;
  readonly compactionCount: number;
  readonly subAgentCount: number;
  readonly toolSuccessCount: number;
  readonly humanInterventionCount: number;
  readonly tokensEstimated: number;
}

interface TraceAggregateRow {
  trace_id: string;
  duration_ms: number | null;
  tool_count: number | null;
  llm_count: number | null;
  retry_count: number | null;
  compaction_count: number | null;
  sub_agent_count: number | null;
  tool_success_count: number | null;
  human_intervention_count: number | null;
  tokens_estimated: number | null;
}

// ---------------------------------------------------------------------------
// Internal row types
// ---------------------------------------------------------------------------

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

interface CountRow {
  count: number;
}

// ---------------------------------------------------------------------------
// TraceStore
// ---------------------------------------------------------------------------

// Buffered pending writes — fed by startSpan/endSpan, drained by _flush().
interface PendingInsert {
  readonly kind: "insert";
  readonly spanId: string;
  readonly traceId: string;
  readonly parentSpanId: string | null;
  readonly name: string;
  readonly spanKind: SpanKind;
  readonly startTime: number;
  attributes: Record<string, string | number | boolean>;
}

interface PendingUpdate {
  readonly kind: "update";
  readonly spanId: string;
  readonly endTime: number;
  readonly durationMs: number;
  readonly status: SpanStatus;
  readonly attributes: Record<string, string | number | boolean>;
}

type PendingOp = PendingInsert | PendingUpdate;

/**
 * Phase 9 (v0.5.0): batch size for the count-based flush. Hitting this
 * threshold drains the buffer immediately; otherwise the time-based interval
 * (`FLUSH_INTERVAL_MS`) handles the drain.
 */
const FLUSH_BATCH_SIZE = 100;

/** Phase 9: maximum interval between time-based flushes (5 seconds). */
const FLUSH_INTERVAL_MS = 5_000;

/** Phase 9: snapshot of the trace-write buffer for observability. */
export interface TraceBufferStats {
  readonly bufferedEvents: number;
  readonly lastFlushMs: number;
  readonly totalFlushed: number;
}

export class TraceStore {
  private readonly _db: Database.Database;
  /** In-memory span state so endSpan() never issues a SELECT. */
  private readonly _liveSpans = new Map<
    string,
    { startTime: number; attributes: Record<string, string | number | boolean> }
  >();
  /** Pending INSERT/UPDATE operations to drain in one transaction. */
  private readonly _pendingOps: PendingOp[] = [];
  private _flushScheduled = false;
  // Phase 9: time-based flush so a quiet stream of writes still lands within
  // 5 s. The interval is created lazily on the first scheduled flush so test
  // instances that immediately close don't leak handles.
  private _flushInterval: NodeJS.Timeout | null = null;
  private _lastFlushMs = 0;
  private _totalFlushed = 0;

  constructor(dbPath: string) {
    this._db = new Database(dbPath);
    secureDbPermissions(dbPath);
    this._db.pragma("journal_mode = WAL");
    this._db.pragma("foreign_keys = ON");
    this._initSchema();
  }

  private _initSchema(): void {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS traces (
        trace_id TEXT PRIMARY KEY,
        session_id TEXT,
        root_span_id TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER
      );

      CREATE TABLE IF NOT EXISTS spans (
        span_id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL REFERENCES traces(trace_id) ON DELETE CASCADE,
        parent_span_id TEXT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        duration_ms INTEGER,
        status TEXT NOT NULL DEFAULT 'ok',
        attributes TEXT NOT NULL DEFAULT '{}',
        events TEXT NOT NULL DEFAULT '[]'
      );

      CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(trace_id);
      CREATE INDEX IF NOT EXISTS idx_spans_parent ON spans(parent_span_id);
      CREATE INDEX IF NOT EXISTS idx_spans_kind ON spans(kind);
      CREATE INDEX IF NOT EXISTS idx_spans_start ON spans(start_time);
    `);
  }

  // -------------------------------------------------------------------------
  // Trace lifecycle
  // -------------------------------------------------------------------------

  startTrace(sessionId?: string): Trace {
    const traceId = randomUUID();
    const rootSpanId = randomUUID();
    const now = Date.now();

    this._db
      .prepare(
        "INSERT INTO traces (trace_id, session_id, root_span_id, start_time) VALUES (?, ?, ?, ?)",
      )
      .run(traceId, sessionId ?? null, rootSpanId, now);

    this._db
      .prepare(
        "INSERT INTO spans (span_id, trace_id, parent_span_id, name, kind, start_time, status, attributes, events) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(rootSpanId, traceId, null, "root", "agent_turn", now, "ok", "{}", "[]");

    return {
      traceId,
      sessionId: sessionId ?? null,
      rootSpanId,
      startTime: now,
      endTime: null,
      spanCount: 1,
    };
  }

  // -------------------------------------------------------------------------
  // Span lifecycle
  // -------------------------------------------------------------------------

  startSpan(
    traceId: string,
    name: string,
    kind: SpanKind,
    parentSpanId?: string,
    attributes?: Record<string, string | number | boolean>,
  ): Span {
    const spanId = randomUUID();
    const now = Date.now();
    const attrs = attributes ?? {};

    // Remember the start info in memory so endSpan() does not hit the DB.
    this._liveSpans.set(spanId, { startTime: now, attributes: { ...attrs } });

    this._pendingOps.push({
      kind: "insert",
      spanId,
      traceId,
      parentSpanId: parentSpanId ?? null,
      name,
      spanKind: kind,
      startTime: now,
      attributes: attrs,
    });
    this._scheduleFlush(kind === "agent_turn" && parentSpanId === undefined);

    return {
      traceId,
      spanId,
      parentSpanId: parentSpanId ?? null,
      name,
      kind,
      startTime: now,
      endTime: null,
      durationMs: null,
      status: "ok",
      attributes: attrs,
      events: [],
    };
  }

  endSpan(
    spanId: string,
    status: SpanStatus,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    const now = Date.now();

    // Fast path: the in-memory map holds startTime + attributes. No SELECT.
    const live = this._liveSpans.get(spanId);
    if (!live) return;

    const durationMs = now - live.startTime;
    const merged = attributes ? { ...live.attributes, ...attributes } : live.attributes;

    this._pendingOps.push({
      kind: "update",
      spanId,
      endTime: now,
      durationMs,
      status,
      attributes: merged,
    });
    this._liveSpans.delete(spanId);
    this._scheduleFlush(false);
  }

  /**
   * Synchronously drain buffered inserts/updates in a single transaction.
   * Callers: extension deactivate(), process exit, and readers that need
   * fully-synchronized data (the test suite calls this before querying).
   */
  flush(): void {
    if (this._pendingOps.length === 0) {
      this._flushScheduled = false;
      this._lastFlushMs = Date.now();
      return;
    }
    const ops = this._pendingOps.splice(0, this._pendingOps.length);
    this._flushScheduled = false;

    const insertStmt = this._db.prepare(
      "INSERT INTO spans (span_id, trace_id, parent_span_id, name, kind, start_time, status, attributes, events) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const updateStmt = this._db.prepare(
      "UPDATE spans SET end_time = ?, duration_ms = ?, status = ?, attributes = ? WHERE span_id = ?",
    );

    this._db.transaction(() => {
      for (const op of ops) {
        if (op.kind === "insert") {
          insertStmt.run(
            op.spanId,
            op.traceId,
            op.parentSpanId,
            op.name,
            op.spanKind,
            op.startTime,
            "ok",
            JSON.stringify(op.attributes),
            "[]",
          );
        } else {
          updateStmt.run(
            op.endTime,
            op.durationMs,
            op.status,
            JSON.stringify(op.attributes),
            op.spanId,
          );
        }
      }
    })();

    this._lastFlushMs = Date.now();
    this._totalFlushed += ops.length;
  }

  /**
   * Phase 9: synchronous-resolved Promise variant of `flush()` for callers
   * that need to await drain (e.g. correctness-critical confirmation
   * decisions). Behaves identically to `flush()` but composes with async
   * code paths.
   */
  async flushImmediately(): Promise<void> {
    this.flush();
  }

  /**
   * Phase 9: snapshot of buffer state for observability. Surfaces
   * `bufferedEvents`, `lastFlushMs`, and `totalFlushed` so the dashboard
   * can render flush cadence without a separate query path.
   */
  bufferStats(): TraceBufferStats {
    return {
      bufferedEvents: this._pendingOps.length,
      lastFlushMs: this._lastFlushMs,
      totalFlushed: this._totalFlushed,
    };
  }

  private _scheduleFlush(forceSync: boolean): void {
    if (this._pendingOps.length >= FLUSH_BATCH_SIZE || forceSync) {
      this.flush();
      return;
    }

    // Phase 9: ensure the time-based flush interval is running. Lazy startup
    // keeps short-lived test stores from leaking handles when nothing is
    // ever scheduled.
    if (this._flushInterval === null) {
      this._flushInterval = setInterval(() => {
        try {
          this.flush();
        } catch {
          /* swallow -- interval continues on next tick */
        }
      }, FLUSH_INTERVAL_MS);
      // unref() so the interval does not keep the Node process alive at
      // shutdown -- vscode disposes via dispose()/close() before exit.
      if (typeof this._flushInterval.unref === "function") {
        this._flushInterval.unref();
      }
    }

    if (this._flushScheduled) return;
    this._flushScheduled = true;
    process.nextTick(() => {
      try {
        this.flush();
      } catch {
        this._flushScheduled = false;
      }
    });
  }

  addEvent(spanId: string, event: SpanEvent): void {
    // Events require the span row to be persisted, so flush first.
    this.flush();
    const row = this._db
      .prepare("SELECT events FROM spans WHERE span_id = ?")
      .get(spanId) as { events: string } | undefined;

    if (!row) return;

    const events: SpanEvent[] = JSON.parse(row.events);
    events.push(event);

    this._db
      .prepare("UPDATE spans SET events = ? WHERE span_id = ?")
      .run(JSON.stringify(events), spanId);
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getTrace(traceId: string): (Trace & { spans: Span[] }) | null {
    this.flush();
    const row = this._db
      .prepare(
        "SELECT trace_id, session_id, root_span_id, start_time, end_time FROM traces WHERE trace_id = ?",
      )
      .get(traceId) as TraceRow | undefined;

    if (!row) return null;

    const spanRows = this._db
      .prepare(
        "SELECT span_id, trace_id, parent_span_id, name, kind, start_time, end_time, duration_ms, status, attributes, events FROM spans WHERE trace_id = ? ORDER BY start_time ASC",
      )
      .all(traceId) as SpanRow[];

    const countRow = this._db
      .prepare("SELECT COUNT(*) as count FROM spans WHERE trace_id = ?")
      .get(traceId) as CountRow;

    return {
      traceId: row.trace_id,
      sessionId: row.session_id,
      rootSpanId: row.root_span_id,
      startTime: row.start_time,
      endTime: row.end_time,
      spanCount: countRow.count,
      spans: spanRows.map((s) => this._rowToSpan(s)),
    };
  }

  listTraces(limit = 50, offset = 0): Trace[] {
    this.flush();
    const rows = this._db
      .prepare(
        `SELECT t.trace_id, t.session_id, t.root_span_id, t.start_time, t.end_time,
                (SELECT COUNT(*) FROM spans s WHERE s.trace_id = t.trace_id) as span_count
         FROM traces t
         ORDER BY t.start_time DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as Array<TraceRow & { span_count: number }>;

    return rows.map((r) => ({
      traceId: r.trace_id,
      sessionId: r.session_id,
      rootSpanId: r.root_span_id,
      startTime: r.start_time,
      endTime: r.end_time,
      spanCount: r.span_count,
    }));
  }

  /**
   * Batched aggregate counts for many traces in a single SQL query.
   * Used by MetricsCollector.computeAggregateMetrics to avoid loading every
   * span and parsing every attributes JSON for a dashboard refresh
   * (finding #34). Detail queries still use `getTrace` / `getSpansByKind`
   * which preserve full span fidelity.
   */
  getTraceAggregates(traceIds: readonly string[]): TraceAggregate[] {
    if (traceIds.length === 0) return [];
    this.flush();
    const placeholders = traceIds.map(() => "?").join(",");
    const rows = this._db
      .prepare(
        `SELECT
           trace_id,
           COALESCE(MAX(end_time), MAX(start_time)) - MIN(start_time) AS duration_ms,
           SUM(CASE WHEN kind = 'tool_call' THEN 1 ELSE 0 END) AS tool_count,
           SUM(CASE WHEN kind = 'llm_call' THEN 1 ELSE 0 END) AS llm_count,
           SUM(CASE WHEN kind = 'reflexion' THEN 1 ELSE 0 END) AS retry_count,
           SUM(CASE WHEN kind = 'compaction' THEN 1 ELSE 0 END) AS compaction_count,
           SUM(CASE WHEN kind = 'sub_agent' THEN 1 ELSE 0 END) AS sub_agent_count,
           SUM(CASE WHEN kind = 'tool_call' AND status = 'ok' THEN 1 ELSE 0 END) AS tool_success_count,
           SUM(CASE WHEN kind = 'tool_call' AND json_extract(attributes, '$.confirmation_required') = 1 THEN 1 ELSE 0 END) AS human_intervention_count,
           COALESCE(SUM(CAST(json_extract(attributes, '$.tokens_estimated') AS INTEGER)), 0) AS tokens_estimated
         FROM spans
         WHERE trace_id IN (${placeholders})
         GROUP BY trace_id`,
      )
      .all(...traceIds) as TraceAggregateRow[];

    return rows.map((r) => ({
      traceId: r.trace_id,
      durationMs: r.duration_ms ?? 0,
      toolCount: r.tool_count ?? 0,
      llmCount: r.llm_count ?? 0,
      retryCount: r.retry_count ?? 0,
      compactionCount: r.compaction_count ?? 0,
      subAgentCount: r.sub_agent_count ?? 0,
      toolSuccessCount: r.tool_success_count ?? 0,
      humanInterventionCount: r.human_intervention_count ?? 0,
      tokensEstimated: r.tokens_estimated ?? 0,
    }));
  }

  getSpansByKind(traceId: string, kind: SpanKind): Span[] {
    this.flush();
    const rows = this._db
      .prepare(
        "SELECT span_id, trace_id, parent_span_id, name, kind, start_time, end_time, duration_ms, status, attributes, events FROM spans WHERE trace_id = ? AND kind = ? ORDER BY start_time ASC",
      )
      .all(traceId, kind) as SpanRow[];

    return rows.map((s) => this._rowToSpan(s));
  }

  getSpan(spanId: string): Span | null {
    this.flush();
    const row = this._db
      .prepare(
        "SELECT span_id, trace_id, parent_span_id, name, kind, start_time, end_time, duration_ms, status, attributes, events FROM spans WHERE span_id = ?",
      )
      .get(spanId) as SpanRow | undefined;

    if (!row) return null;
    return this._rowToSpan(row);
  }

  deleteOlderThan(daysAgo: number): number {
    this.flush();
    const cutoff = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
    const result = this._db
      .prepare("DELETE FROM traces WHERE start_time < ?")
      .run(cutoff);
    return result.changes;
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  close(): void {
    this.dispose();
  }

  /**
   * Phase 9 (v0.5.0): release the time-based flush interval, perform a final
   * synchronous flush so no buffered events are lost on extension
   * deactivation, and close the SQLite connection.
   */
  dispose(): void {
    if (this._flushInterval !== null) {
      clearInterval(this._flushInterval);
      this._flushInterval = null;
    }
    this.flush();
    try {
      this._db.close();
    } catch {
      /* swallow -- already closed */
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _rowToSpan(row: SpanRow): Span {
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
      attributes: JSON.parse(row.attributes),
      events: JSON.parse(row.events),
    };
  }
}
