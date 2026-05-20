import { describe, it, expect } from "vitest";
import {
  InMemoryAuditLog,
  previewText,
  rowFromProvenance,
  type MemoryAuditRow,
} from "../../../../core/memory/MemoryAuditLog.js";

const baseRow = (overrides: Partial<MemoryAuditRow> = {}): MemoryAuditRow => ({
  timestamp: 1_700_000_000_000,
  op: "write",
  tier: "working",
  entryId: "e1",
  sessionId: "session-a",
  hookKind: "lifecycle.user.prompt",
  toolName: null,
  textPreview: "hello world",
  ...overrides,
});

describe("previewText", () => {
  it("collapses whitespace and trims", () => {
    expect(previewText("  hello\n\n  world\t!  ")).toBe("hello world !");
  });

  it("truncates with ellipsis when over n", () => {
    const s = "x".repeat(200);
    const out = previewText(s, 50);
    expect(out.length).toBe(50);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("rowFromProvenance", () => {
  it("projects provenance fields into the row shape", () => {
    const row = rowFromProvenance({
      op: "read",
      tier: "semantic",
      entryId: "id-1",
      text: "Python pathlib helpers",
      provenance: { sessionId: "s1", hookKind: "lifecycle.tool.post", toolName: "read_file" },
      timestamp: 42,
    });
    expect(row).toEqual({
      timestamp: 42,
      op: "read",
      tier: "semantic",
      entryId: "id-1",
      sessionId: "s1",
      hookKind: "lifecycle.tool.post",
      toolName: "read_file",
      textPreview: "Python pathlib helpers",
    });
  });

  it("defaults sessionId/hookKind/toolName to null when provenance is null", () => {
    const row = rowFromProvenance({
      op: "delete",
      tier: "working",
      entryId: "id-2",
      text: "x",
      provenance: null,
      timestamp: 1,
    });
    expect(row.sessionId).toBeNull();
    expect(row.hookKind).toBeNull();
    expect(row.toolName).toBeNull();
  });
});

describe("InMemoryAuditLog", () => {
  it("appends and queries unfiltered rows in insertion order", () => {
    const log = new InMemoryAuditLog();
    log.append(baseRow({ timestamp: 1 }));
    log.append(baseRow({ timestamp: 2 }));
    log.append(baseRow({ timestamp: 3 }));
    expect(log.size()).toBe(3);
    const rows = log.query();
    expect(rows.map((r) => r.timestamp)).toEqual([1, 2, 3]);
  });

  it("filters by sinceMs (inclusive)", () => {
    const log = new InMemoryAuditLog();
    log.append(baseRow({ timestamp: 100 }));
    log.append(baseRow({ timestamp: 200 }));
    log.append(baseRow({ timestamp: 300 }));
    const rows = log.query({ sinceMs: 200 });
    expect(rows.map((r) => r.timestamp)).toEqual([200, 300]);
  });

  it("filters by tier, op, sessionId, limit", () => {
    const log = new InMemoryAuditLog();
    log.append(baseRow({ op: "write", tier: "working", sessionId: "a" }));
    log.append(baseRow({ op: "read", tier: "semantic", sessionId: "b" }));
    log.append(baseRow({ op: "delete", tier: "working", sessionId: "a" }));
    expect(log.query({ tier: "working" }).map((r) => r.op)).toEqual(["write", "delete"]);
    expect(log.query({ op: "read" }).map((r) => r.tier)).toEqual(["semantic"]);
    expect(log.query({ sessionId: "a" })).toHaveLength(2);
    expect(log.query({ limit: 1 })).toHaveLength(1);
  });

  it("drops oldest rows when capacity is exceeded", () => {
    const log = new InMemoryAuditLog(2);
    log.append(baseRow({ timestamp: 1 }));
    log.append(baseRow({ timestamp: 2 }));
    log.append(baseRow({ timestamp: 3 }));
    expect(log.size()).toBe(2);
    expect(log.query().map((r) => r.timestamp)).toEqual([2, 3]);
  });

  it("rejects capacity < 1", () => {
    expect(() => new InMemoryAuditLog(0)).toThrow();
  });

  it("clear empties the log", () => {
    const log = new InMemoryAuditLog();
    log.append(baseRow());
    log.append(baseRow());
    log.clear();
    expect(log.size()).toBe(0);
    expect(log.query()).toEqual([]);
  });
});
