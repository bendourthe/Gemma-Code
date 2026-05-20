import { describe, it, expect } from "vitest";
import {
  encodeVectorB64,
  decodeVectorB64,
  exportToJsonl,
  importFromJsonl,
  isPathInside,
  type ExportableRow,
  type ExportFilter,
  type ExportSource,
  type ImportSink,
} from "../../../../core/memory/MemoryExport.js";

function makeRow(overrides: Partial<ExportableRow> = {}): ExportableRow {
  return {
    id: "row-1",
    tier: "working",
    content: "hello world",
    vectorB64: null,
    scopeId: null,
    provenance: null,
    createdAt: 1_700_000_000_000,
    accessedAt: 1_700_000_500_000,
    accessCount: 0,
    corroborationCount: 1,
    ...overrides,
  };
}

describe("encodeVectorB64 / decodeVectorB64", () => {
  it("round-trips a Float32Array", () => {
    const vec = Float32Array.from([0.1, -0.2, 0.333, 0.0, 1e-5]);
    const encoded = encodeVectorB64(vec);
    expect(encoded).not.toBeNull();
    const decoded = decodeVectorB64(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.length).toBe(vec.length);
    for (let i = 0; i < vec.length; i++) {
      expect(decoded![i]).toBeCloseTo(vec[i]!, 6);
    }
  });

  it("returns null for null/empty vector", () => {
    expect(encodeVectorB64(null)).toBeNull();
    expect(encodeVectorB64(undefined)).toBeNull();
    expect(encodeVectorB64(new Float32Array(0))).toBeNull();
  });

  it("returns null for null/empty base64", () => {
    expect(decodeVectorB64(null)).toBeNull();
    expect(decodeVectorB64(undefined)).toBeNull();
    expect(decodeVectorB64("")).toBeNull();
  });
});

describe("exportToJsonl + importFromJsonl round-trip", () => {
  it("preserves every row across export/import", () => {
    const rows: ExportableRow[] = [
      makeRow({ id: "a", content: "alpha" }),
      makeRow({ id: "b", tier: "semantic", content: "beta", vectorB64: encodeVectorB64(Float32Array.from([1, 2, 3])) }),
      makeRow({ id: "c", tier: "episodic", content: "gamma", scopeId: "scope-1" }),
    ];
    const source: ExportSource = {
      list: (_f: ExportFilter) => rows,
    };
    const result = exportToJsonl(source);
    expect(result.rowCount).toBe(3);
    expect(result.text.endsWith("\n")).toBe(true);

    const imported: ExportableRow[] = [];
    const sink: ImportSink = { upsert: (row) => imported.push(row) };
    const importResult = importFromJsonl(result.text, sink);
    expect(importResult.imported).toBe(3);
    expect(importResult.skipped).toBe(0);
    expect(importResult.errors).toHaveLength(0);
    expect(imported.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(imported[1]?.vectorB64).not.toBeNull();
  });

  it("filters by tier when filter is supplied", () => {
    const rows: ExportableRow[] = [
      makeRow({ id: "a", tier: "working" }),
      makeRow({ id: "b", tier: "semantic" }),
    ];
    const source: ExportSource = {
      list: (f) => {
        const set = f.tiers ? new Set(f.tiers) : null;
        return set ? rows.filter((r) => set.has(r.tier)) : rows;
      },
    };
    const result = exportToJsonl(source, { tiers: ["semantic"] });
    expect(result.rowCount).toBe(1);
    expect(result.text.includes('"id":"b"')).toBe(true);
  });

  it("skips malformed JSONL lines but records the error", () => {
    const malformed = '{"id":"ok","tier":"working","content":"x","vectorB64":null,"scopeId":null,"provenance":null,"createdAt":0,"accessedAt":0,"accessCount":0,"corroborationCount":1}\n{not json}\n';
    const sink: ImportSink = { upsert: () => {} };
    const result = importFromJsonl(malformed, sink);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.line).toBe(2);
  });

  it("skips rows that fail shape validation", () => {
    const text = JSON.stringify({ id: 1, tier: "working" }) + "\n";
    const sink: ImportSink = { upsert: () => {} };
    const result = importFromJsonl(text, sink);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors[0]?.reason).toContain("shape");
  });
});

describe("isPathInside", () => {
  it("accepts a path equal to the root", () => {
    expect(isPathInside("/home/user/.nexus/exports", "/home/user/.nexus/exports")).toBe(true);
  });

  it("accepts a nested path", () => {
    expect(isPathInside("/home/user/.nexus/exports/a.jsonl", "/home/user/.nexus/exports")).toBe(true);
  });

  it("rejects a parent or sibling path", () => {
    expect(isPathInside("/home/user/.nexus", "/home/user/.nexus/exports")).toBe(false);
    expect(isPathInside("/home/user/.nexus/exports-other/a.jsonl", "/home/user/.nexus/exports")).toBe(false);
  });

  it("normalizes backslashes for windows-style paths", () => {
    expect(isPathInside("C:\\Users\\me\\.nexus\\exports\\a.jsonl", "C:\\Users\\me\\.nexus\\exports")).toBe(true);
  });

  it("rejects empty inputs", () => {
    expect(isPathInside("", "/root")).toBe(false);
    expect(isPathInside("/root/a", "")).toBe(false);
  });
});
