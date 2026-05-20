import { describe, it, expect } from "vitest";
import {
  formatAuditTable,
  formatAuditJsonl,
  formatTimestamp,
  parseSinceFlag,
} from "../../../../core/memory/MemoryAudit.js";
import type { MemoryAuditRow } from "../../../../core/memory/MemoryAuditLog.js";

const rows: MemoryAuditRow[] = [
  {
    timestamp: Date.UTC(2026, 4, 1, 10, 30, 15),
    op: "write",
    tier: "working",
    entryId: "abc12345-6789",
    sessionId: "session-aaa",
    hookKind: "lifecycle.user.prompt",
    toolName: null,
    textPreview: "remember always use ruff format",
  },
  {
    timestamp: Date.UTC(2026, 4, 2, 11, 0, 0),
    op: "read",
    tier: "semantic",
    entryId: "ssss1234-9999",
    sessionId: "session-bbb",
    hookKind: "lifecycle.tool.post",
    toolName: "read_file",
    textPreview: "Python pathlib path operations",
  },
];

describe("formatTimestamp", () => {
  it("returns ISO 8601 without milliseconds", () => {
    expect(formatTimestamp(Date.UTC(2026, 4, 1, 10, 30, 15))).toBe("2026-05-01T10:30:15Z");
  });

  it("returns '-' for invalid input", () => {
    expect(formatTimestamp(Number.NaN)).toBe("-");
    expect(formatTimestamp(-1)).toBe("-");
  });
});

describe("formatAuditTable", () => {
  it("renders a header line plus one data line per row", () => {
    const out = formatAuditTable(rows);
    const lines = out.split("\n");
    // header + separator + 2 rows
    expect(lines).toHaveLength(4);
    expect(lines[0]?.startsWith("timestamp")).toBe(true);
    expect(lines[1]?.startsWith("-")).toBe(true);
    expect(lines[2]?.includes("write")).toBe(true);
    expect(lines[3]?.includes("read")).toBe(true);
  });

  it("still renders the header on empty input", () => {
    const out = formatAuditTable([]);
    expect(out.split("\n")[0]?.startsWith("timestamp")).toBe(true);
  });

  it("truncates long values to the column maxWidth", () => {
    const long = "x".repeat(200);
    const out = formatAuditTable([
      {
        ...rows[0]!,
        textPreview: long,
      },
    ]);
    // textPreview column is capped at 60 -> 59 chars + ellipsis
    expect(out).toContain("x".repeat(59) + "…");
  });
});

describe("formatAuditJsonl", () => {
  it("renders one JSON object per line with trailing newline", () => {
    const out = formatAuditJsonl(rows);
    expect(out.endsWith("\n")).toBe(true);
    const parsed = out.trim().split("\n").map((l) => JSON.parse(l));
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.op).toBe("write");
    expect(parsed[1]?.toolName).toBe("read_file");
  });

  it("returns empty string for empty input", () => {
    expect(formatAuditJsonl([])).toBe("");
  });
});

describe("parseSinceFlag", () => {
  it("accepts bare YYYY-MM-DD", () => {
    expect(parseSinceFlag("2026-05-01")).toBe(Date.UTC(2026, 4, 1));
  });

  it("accepts ISO 8601 date-time", () => {
    expect(parseSinceFlag("2026-05-01T12:00:00Z")).toBe(Date.UTC(2026, 4, 1, 12));
  });

  it("returns null for unparseable input", () => {
    expect(parseSinceFlag("not-a-date")).toBeNull();
    expect(parseSinceFlag("")).toBeNull();
    expect(parseSinceFlag(null)).toBeNull();
    expect(parseSinceFlag(undefined)).toBeNull();
  });
});
