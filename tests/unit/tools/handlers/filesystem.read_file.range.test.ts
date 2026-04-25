import { describe, it, expect, beforeEach } from "vitest";
import { ReadFileTool } from "../../../../src/tools/handlers/filesystem.js";
import { mockFs } from "../../../setup.js";

function textToUint8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function call(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { _callId: "call_range", path: "fixture.txt", ...extra };
}

beforeEach(() => {
  mockFs.readFile.mockReset();
});

describe("ReadFileTool — range_start / range_end pagination", () => {
  it("returns the requested byte window when range_start and range_end are valid", async () => {
    const content = "abcdefghijklmnopqrstuvwxyz";
    mockFs.readFile.mockResolvedValueOnce(textToUint8(content));

    const tool = new ReadFileTool();
    const result = await tool.execute(call({ range_start: 5, range_end: 10 }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.content).toBe("fghij");
    expect(parsed.range_start).toBe(5);
    expect(parsed.range_end).toBe(10);
    expect(parsed.file_size).toBe(content.length);
    expect(parsed.eof).toBe(false);
  });

  it("appends an EOF marker when the requested range_end goes past EOF", async () => {
    const content = "abcdef";
    mockFs.readFile.mockResolvedValueOnce(textToUint8(content));

    const tool = new ReadFileTool();
    const result = await tool.execute(call({ range_start: 2, range_end: 1000 }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.content).toContain("cdef");
    expect(parsed.content).toContain("End of file at byte 6");
    expect(parsed.eof).toBe(true);
  });

  it("returns an actionable error for a negative range_start", async () => {
    const tool = new ReadFileTool();
    const result = await tool.execute(call({ range_start: -1, range_end: 10 }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("range_start");
    expect(result.error).toContain("Usage:");
  });

  it("returns an actionable error when range_end <= range_start", async () => {
    const tool = new ReadFileTool();
    const result = await tool.execute(call({ range_start: 50, range_end: 50 }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("range_end");
    expect(result.error).toContain("Usage:");
  });

  it("rejects a window larger than 1 MB", async () => {
    const tool = new ReadFileTool();
    const result = await tool.execute(call({ range_start: 0, range_end: 1024 * 1024 + 1 }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("window");
    expect(result.error).toContain("Usage:");
  });

  it("allows a 1 MB window exactly", async () => {
    const content = "x".repeat(2 * 1024 * 1024);
    mockFs.readFile.mockResolvedValueOnce(textToUint8(content));

    const tool = new ReadFileTool();
    const result = await tool.execute(call({ range_start: 0, range_end: 1024 * 1024 }));
    expect(result.success).toBe(true);
  });

  it("falls back to legacy line-truncation when no range is specified", async () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join("\n");
    mockFs.readFile.mockResolvedValueOnce(textToUint8(lines));

    const tool = new ReadFileTool();
    const result = await tool.execute(call());
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.truncated).toBe(true);
    expect(parsed.lines).toBe(1000);
  });
});
