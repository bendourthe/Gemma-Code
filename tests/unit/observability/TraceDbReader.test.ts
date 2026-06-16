import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TraceStore } from "../../../modules/coding/observability/TraceStore.js";
import { readExportableTrace } from "../../../modules/coding/observability/TraceDbReader.js";
import { serializeTraceToHtml } from "../../../modules/coding/observability/TraceHtmlExport.js";

// v1.6.0 Phase 2 (AS004) -- the vscode-free reader that backs `nexus trace
// export`. It must reproduce TraceStore.getTrace's shape while reading the DB
// read-only with no vscode coupling. The round-trip uses a temp FILE database
// (not :memory:, which is per-connection and cannot be reopened) so the reader
// opens a second, independent connection exactly as the CLI does.

describe("readExportableTrace", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nx-trace-reader-"));
    dbPath = path.join(dir, "traces.db");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seed(): string {
    const store = new TraceStore(dbPath);
    const trace = store.startTrace("session-xyz");
    const llm = store.startSpan(trace.traceId, "gemma4:e4b chat", "llm_call", trace.rootSpanId, {
      model: "gemma4:e4b",
    });
    store.endSpan(llm.spanId, "ok", { tokens_estimated: 512 });
    const tool = store.startSpan(trace.traceId, "run_terminal", "tool_call", trace.rootSpanId, {
      tool: "run_terminal",
    });
    store.endSpan(tool.spanId, "error");
    store.flush();
    store.close();
    return trace.traceId;
  }

  it("reads a trace and its spans back from a closed file DB", () => {
    const traceId = seed();
    const trace = readExportableTrace(dbPath, traceId);

    expect(trace).not.toBeNull();
    expect(trace!.traceId).toBe(traceId);
    expect(trace!.sessionId).toBe("session-xyz");
    // root + llm + tool
    expect(trace!.spanCount).toBe(3);
    expect(trace!.spans).toHaveLength(3);
    const names = trace!.spans.map((s) => s.name);
    expect(names).toContain("gemma4:e4b chat");
    expect(names).toContain("run_terminal");
  });

  it("parses span attributes and orders spans by start time", () => {
    const traceId = seed();
    const trace = readExportableTrace(dbPath, traceId)!;
    const llm = trace.spans.find((s) => s.name === "gemma4:e4b chat")!;
    expect(llm.kind).toBe("llm_call");
    expect(llm.attributes.model).toBe("gemma4:e4b");
    const tool = trace.spans.find((s) => s.name === "run_terminal")!;
    expect(tool.status).toBe("error");
    // start_time ASC: the root span (created first) leads.
    const starts = trace.spans.map((s) => s.startTime);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("returns null for an unknown trace id", () => {
    seed();
    expect(readExportableTrace(dbPath, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("produces a trace that serializes to a self-contained viewer", () => {
    const traceId = seed();
    const trace = readExportableTrace(dbPath, traceId)!;
    const html = serializeTraceToHtml(trace);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("gemma4:e4b chat");
    expect(html).toContain('<ol class="timeline"');
  });

  it("tolerates a corrupt attributes/events column (falls back, never throws)", () => {
    const traceId = seed();
    // Simulate a corrupt store: overwrite one span's JSON columns with invalid
    // JSON, mirroring a partially-written or hand-edited DB.
    const db = new Database(dbPath);
    db.prepare("UPDATE spans SET attributes = ?, events = ? WHERE name = ?").run(
      "{not valid json",
      "[also broken",
      "run_terminal",
    );
    db.close();

    const trace = readExportableTrace(dbPath, traceId)!;
    const tool = trace.spans.find((s) => s.name === "run_terminal")!;
    expect(tool.attributes).toEqual({});
    expect(tool.events).toEqual([]);
  });
});
