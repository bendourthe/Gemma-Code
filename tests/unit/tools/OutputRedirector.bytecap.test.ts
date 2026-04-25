import { describe, it, expect, beforeEach } from "vitest";
import {
  applyByteCap,
  resolveMaxBytes,
  DEFAULT_MAX_BYTES,
  MAX_BYTES_CEILING,
  TRUNCATION_MARKER,
  resetTruncationStats,
  getTruncationStats,
} from "../../../src/tools/OutputRedirector.js";

describe("applyByteCap", () => {
  beforeEach(() => {
    resetTruncationStats();
  });

  it("returns the original output unchanged when below the cap", () => {
    const output = "a".repeat(1000);
    const result = applyByteCap(output, "read_file", DEFAULT_MAX_BYTES);
    expect(result.truncated).toBe(false);
    expect(result.output).toBe(output);
    expect(result.originalBytes).toBe(1000);
    expect(result.maxBytes).toBe(DEFAULT_MAX_BYTES);
  });

  it("truncates at the byte boundary when output exceeds the cap", () => {
    const output = "a".repeat(100 * 1024); // 100 KB
    const result = applyByteCap(output, "read_file", DEFAULT_MAX_BYTES);
    expect(result.truncated).toBe(true);
    expect(result.originalBytes).toBe(100 * 1024);
    expect(result.output.length).toBeGreaterThan(DEFAULT_MAX_BYTES);
    expect(result.output).toContain(TRUNCATION_MARKER);
    // The truncated head must be at most maxBytes bytes (footer is appended after).
    const head = result.output.split("\n=== TRUNCATED")[0]!;
    expect(Buffer.byteLength(head, "utf8")).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
  });

  it("does not split a multi-byte UTF-8 character at the boundary", () => {
    // Each emoji is 4 bytes in UTF-8. Build a string whose byte length straddles 64 KB.
    const emoji = "\u{1F600}"; // 4 UTF-8 bytes
    const repeats = Math.ceil((DEFAULT_MAX_BYTES + 16) / 4);
    const output = emoji.repeat(repeats);
    const result = applyByteCap(output, "read_file", DEFAULT_MAX_BYTES);
    expect(result.truncated).toBe(true);
    // The head must round-trip through UTF-8 without producing replacement chars.
    const head = result.output.split("\n=== TRUNCATED")[0]!;
    expect(head).not.toContain("�"); // U+FFFD is the replacement character
  });

  it("contains tool-specific narrowing guidance for read_file", () => {
    const output = "x".repeat(DEFAULT_MAX_BYTES + 100);
    const result = applyByteCap(output, "read_file", DEFAULT_MAX_BYTES);
    expect(result.output).toContain("range_start");
  });

  it("contains tool-specific narrowing guidance for grep_codebase", () => {
    const output = "x".repeat(DEFAULT_MAX_BYTES + 100);
    const result = applyByteCap(output, "grep_codebase", DEFAULT_MAX_BYTES);
    expect(result.output).toContain("max_results");
    expect(result.output).toContain("next_offset");
  });

  it("respects a per-call max_bytes override greater than the default", () => {
    const output = "a".repeat(200 * 1024); // 200 KB
    const result = applyByteCap(output, "read_file", 200_000);
    // 200 KB == 204800 bytes, override is 200_000 so it still truncates slightly.
    expect(result.truncated).toBe(true);
    const head = result.output.split("\n=== TRUNCATED")[0]!;
    expect(Buffer.byteLength(head, "utf8")).toBeLessThanOrEqual(200_000);
  });

  it("respects a per-call max_bytes override smaller than the default", () => {
    const output = "a".repeat(2000);
    const result = applyByteCap(output, "read_file", 1024);
    expect(result.truncated).toBe(true);
    const head = result.output.split("\n=== TRUNCATED")[0]!;
    expect(Buffer.byteLength(head, "utf8")).toBeLessThanOrEqual(1024);
  });

  it("updates truncation counters", () => {
    const output = "x".repeat(100 * 1024);
    applyByteCap(output, "read_file", DEFAULT_MAX_BYTES);
    const stats = getTruncationStats();
    expect(stats.truncatedCount).toBe(1);
    expect(stats.totalBytesSeen).toBe(100 * 1024);
    expect(stats.totalBytesTruncated).toBeGreaterThan(0);
  });
});

describe("resolveMaxBytes", () => {
  it("returns DEFAULT_MAX_BYTES when no override is provided", () => {
    expect(resolveMaxBytes(undefined)).toBe(DEFAULT_MAX_BYTES);
    expect(resolveMaxBytes(null)).toBe(DEFAULT_MAX_BYTES);
  });

  it("accepts a positive number override", () => {
    expect(resolveMaxBytes(200_000)).toBe(200_000);
    expect(resolveMaxBytes(1024)).toBe(1024);
  });

  it("rejects a non-number override with an actionable error", () => {
    expect(() => resolveMaxBytes("64000")).toThrow(/max_bytes/);
    expect(() => resolveMaxBytes("64000")).toThrow(/Usage:/);
  });

  it("rejects a zero or negative override with an actionable error", () => {
    expect(() => resolveMaxBytes(0)).toThrow(/max_bytes/);
    expect(() => resolveMaxBytes(-100)).toThrow(/Usage:/);
  });

  it("rejects an override above the per-call ceiling with an actionable error", () => {
    expect(() => resolveMaxBytes(MAX_BYTES_CEILING + 1)).toThrow(/ceiling/);
    expect(() => resolveMaxBytes(MAX_BYTES_CEILING + 1)).toThrow(/Usage:/);
  });
});
