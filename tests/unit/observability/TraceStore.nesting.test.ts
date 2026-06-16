import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";
import { TraceStore } from "../../../modules/coding/observability/TraceStore.js";

// v1.6.0 Phase 4 (A2) -- the additive run-nesting columns (group_id /
// parent_run_id) and the one-way migration that backfills them onto a trace
// store created before this change.

describe("TraceStore run-nesting (A2)", () => {
  let store: TraceStore;

  beforeEach(() => {
    store = new TraceStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("persists and reads back group_id / parent_run_id on a span", () => {
    const trace = store.startTrace();
    const span = store.startSpan(
      trace.traceId,
      "sub_agent_verification",
      "sub_agent",
      trace.rootSpanId,
      { agentType: "verification" },
      { groupId: "group-1", parentRunId: trace.rootSpanId },
    );

    expect(span.groupId).toBe("group-1");
    expect(span.parentRunId).toBe(trace.rootSpanId);

    const loaded = store.getSpan(span.spanId);
    expect(loaded?.groupId).toBe("group-1");
    expect(loaded?.parentRunId).toBe(trace.rootSpanId);

    const fromTrace = store.getTrace(trace.traceId);
    const sub = fromTrace?.spans.find((s) => s.spanId === span.spanId);
    expect(sub?.groupId).toBe("group-1");
    expect(sub?.parentRunId).toBe(trace.rootSpanId);
  });

  it("defaults group_id / parent_run_id to null for an un-stamped span", () => {
    const trace = store.startTrace();
    const span = store.startSpan(trace.traceId, "iteration", "agent_turn", trace.rootSpanId);

    expect(span.groupId).toBeNull();
    expect(span.parentRunId).toBeNull();

    const loaded = store.getSpan(span.spanId);
    expect(loaded?.groupId).toBeNull();
    expect(loaded?.parentRunId).toBeNull();
  });

  it("supports the new critic span kind", () => {
    const trace = store.startTrace();
    const span = store.startSpan(trace.traceId, "critic_task_1", "critic", trace.rootSpanId);
    const loaded = store.getSpan(span.spanId);
    expect(loaded?.kind).toBe("critic");
  });
});

describe("TraceStore nesting migration (A2)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nexus-tracestore-mig-"));
    dbPath = join(dir, "traces.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds the nesting columns to a pre-Phase-4 store and loads old rows as null", () => {
    // Build a store with the OLD spans schema (no group_id / parent_run_id) and
    // seed one trace + span, mirroring the pre-Phase-4 shape.
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE traces (
        trace_id TEXT PRIMARY KEY,
        session_id TEXT,
        root_span_id TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER
      );
      CREATE TABLE spans (
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
      INSERT INTO traces (trace_id, session_id, root_span_id, start_time)
        VALUES ('t-old', NULL, 's-root', 1000);
      INSERT INTO spans (span_id, trace_id, parent_span_id, name, kind, start_time, status, attributes, events)
        VALUES ('s-root', 't-old', NULL, 'root', 'agent_turn', 1000, 'ok', '{}', '[]');
    `);
    const cols = (legacy.prepare("PRAGMA table_info(spans)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(cols).not.toContain("group_id");
    legacy.close();

    // Opening the store runs the idempotent migration in the constructor.
    const migrated = new TraceStore(dbPath);
    try {
      const loaded = migrated.getTrace("t-old");
      expect(loaded).not.toBeNull();
      const root = loaded!.spans.find((s) => s.spanId === "s-root");
      expect(root).toBeDefined();
      expect(root!.groupId).toBeNull();
      expect(root!.parentRunId).toBeNull();

      // New writes against the migrated store carry the nesting fields.
      const span = migrated.startSpan(
        "t-old",
        "sub_agent_planning",
        "sub_agent",
        "s-root",
        {},
        { groupId: "g-new", parentRunId: "s-root" },
      );
      const reloaded = migrated.getSpan(span.spanId);
      expect(reloaded?.groupId).toBe("g-new");
      expect(reloaded?.parentRunId).toBe("s-root");
    } finally {
      migrated.close();
    }
  });

  it("is idempotent across repeated opens", () => {
    const first = new TraceStore(dbPath);
    first.startTrace("sess");
    first.close();
    // Re-opening must not throw on the ALTER (columns already exist).
    const second = new TraceStore(dbPath);
    expect(() => second.listTraces()).not.toThrow();
    second.close();
  });
});
