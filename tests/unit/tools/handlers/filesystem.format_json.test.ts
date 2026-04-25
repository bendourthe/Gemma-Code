import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ListDirectoryTool,
  GrepCodebaseTool,
} from "../../../../src/tools/handlers/filesystem.js";
import { mockFs, MOCK_WORKSPACE_ROOT } from "../../../setup.js";
import { mockOf } from "../../../helpers/factories.js";

const ROOT = MOCK_WORKSPACE_ROOT;

function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { _callId: "call_json", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// list_directory(format='json')
// ---------------------------------------------------------------------------

describe("ListDirectoryTool format='json'", () => {
  it("returns RFC-8259 valid JSON with path and structured entries", async () => {
    mockFs.readDirectory.mockResolvedValueOnce([
      ["extension.ts", 1 /* File */],
      ["sub", 2 /* Directory */],
    ]);
    mockFs.readDirectory.mockResolvedValueOnce([]); // sub/ is empty
    // Stat lookups for files (only files are stat'd, not directories).
    mockFs.stat.mockResolvedValueOnce({ type: 1, size: 1024 });

    const tool = new ListDirectoryTool();
    const result = await tool.execute(params({ path: "src", format: "json" }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output) as {
      path: string;
      entries: Array<{ name: string; type: string; size_bytes?: number }>;
    };
    expect(parsed.path).toBeTypeOf("string");
    expect(Array.isArray(parsed.entries)).toBe(true);
    const fileEntry = parsed.entries.find((e) => e.name === "extension.ts");
    expect(fileEntry).toEqual({
      name: "extension.ts",
      type: "file",
      size_bytes: 1024,
    });
    const dirEntry = parsed.entries.find((e) => e.name === "sub");
    expect(dirEntry).toEqual({ name: "sub", type: "directory" });
  });

  it("default format='text' is byte-equivalent to the legacy output", async () => {
    mockFs.readDirectory.mockResolvedValueOnce([
      ["a.ts", 1 /* File */],
      ["b.ts", 1 /* File */],
    ]);

    const tool = new ListDirectoryTool();
    const textResult = await tool.execute(
      params({ path: "src", recursive: false }),
    );

    // Reset and call again with format='text' explicitly.
    mockFs.readDirectory.mockResolvedValueOnce([
      ["a.ts", 1 /* File */],
      ["b.ts", 1 /* File */],
    ]);
    const explicitTextResult = await tool.execute(
      params({ path: "src", recursive: false, format: "text" }),
    );

    expect(textResult.output).toBe(explicitTextResult.output);

    // Sanity check: this is the legacy {entries, count} shape (no `path` field).
    const parsed = JSON.parse(textResult.output);
    expect(parsed).toHaveProperty("entries");
    expect(parsed).toHaveProperty("count");
    expect(parsed).not.toHaveProperty("path");
  });

  it("produces parseable JSON with a _truncation field when over the byte cap", async () => {
    // Generate 3000 file entries with long names so the raw JSON exceeds 64 KB.
    const longName = (i: number) =>
      `entry_${String(i).padStart(4, "0")}_${"x".repeat(40)}.ts`;
    const entries: [string, number][] = Array.from({ length: 3000 }, (_, i) => [
      longName(i),
      1, // File
    ]);
    mockFs.readDirectory.mockResolvedValueOnce(entries);
    // Stat for every file entry — 1024 bytes each.
    for (let i = 0; i < entries.length; i++) {
      mockFs.stat.mockResolvedValueOnce({ type: 1, size: 1024 });
    }

    const tool = new ListDirectoryTool();
    const result = await tool.execute(
      params({ path: "src", recursive: false, format: "json" }),
    );

    expect(result.success).toBe(true);
    // Output must round-trip through JSON.parse.
    const parsed = JSON.parse(result.output) as {
      path: string;
      entries: unknown[];
      _truncation?: string;
    };
    expect(parsed._truncation).toMatch(/Showing \d+ of 3000 entries/);
    expect(Buffer.byteLength(result.output, "utf8")).toBeLessThanOrEqual(64 * 1024);
    expect(parsed.entries.length).toBeLessThan(3000);
    expect(parsed.entries.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// grep_codebase(format='json')
// ---------------------------------------------------------------------------

describe("GrepCodebaseTool format='json'", () => {
  async function mockFindFiles(uris: string[]): Promise<void> {
    const { findFiles } = await import("vscode").then((m) => m.workspace);
    vi.mocked(findFiles).mockResolvedValueOnce(
      uris.map((p) =>
        mockOf<import("vscode").Uri>({ fsPath: p, toString: () => p }),
      ),
    );
  }

  it("returns RFC-8259 valid JSON with pattern and per-match fields", async () => {
    await mockFindFiles([`${ROOT}/src/x.ts`]);
    mockFs.readFile.mockResolvedValueOnce(
      new TextEncoder().encode("foo\nTODO: x\nbar\nTODO: y\n"),
    );

    const tool = new GrepCodebaseTool();
    const result = await tool.execute(
      params({ pattern: "TODO", format: "json" }),
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output) as {
      pattern: string;
      matches: Array<{ file_path: string; line_number: number; line: string }>;
    };
    expect(parsed.pattern).toBe("TODO");
    expect(parsed.matches.length).toBe(2);
    expect(parsed.matches[0]).toMatchObject({
      file_path: expect.stringContaining("x.ts"),
      line_number: 2,
      line: expect.stringContaining("TODO"),
    });
  });

  it("default format='text' preserves the legacy {file/line/content} shape", async () => {
    await mockFindFiles([`${ROOT}/src/y.ts`]);
    mockFs.readFile.mockResolvedValueOnce(new TextEncoder().encode("hit\n"));

    const tool = new GrepCodebaseTool();
    const result = await tool.execute(params({ pattern: "hit" }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output) as {
      matches: Array<{ file: string; line: number; content: string }>;
      count: number;
    };
    expect(parsed.matches[0]).toHaveProperty("file");
    expect(parsed.matches[0]).toHaveProperty("line");
    expect(parsed.matches[0]).toHaveProperty("content");
    expect(parsed).toHaveProperty("count");
  });

  it("produces parseable JSON with a _truncation field when over the byte cap", async () => {
    // Single huge file with many matches; we cap max_results at 500 (the ceiling)
    // and craft long match lines so the JSON inevitably exceeds 64 KB.
    await mockFindFiles([`${ROOT}/src/many.ts`]);
    const longLine = "needle " + "y".repeat(200);
    const content = Array.from({ length: 600 }, () => longLine).join("\n");
    mockFs.readFile.mockResolvedValueOnce(new TextEncoder().encode(content));

    const tool = new GrepCodebaseTool();
    const result = await tool.execute(
      params({ pattern: "needle", max_results: 500, format: "json" }),
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output) as {
      pattern: string;
      matches: unknown[];
      _truncation?: string;
    };
    expect(parsed.pattern).toBe("needle");
    expect(Buffer.byteLength(result.output, "utf8")).toBeLessThanOrEqual(64 * 1024);
    if (parsed._truncation !== undefined) {
      expect(parsed._truncation).toMatch(/Showing \d+ of \d+ matches/);
    }
    expect(parsed.matches.length).toBeGreaterThan(0);
  });

  it("includes next_offset in JSON output when results paginate", async () => {
    await mockFindFiles([`${ROOT}/src/page.ts`]);
    const content = Array.from({ length: 20 }, (_, i) => `match ${i}`).join("\n");
    mockFs.readFile.mockResolvedValueOnce(new TextEncoder().encode(content));

    const tool = new GrepCodebaseTool();
    const result = await tool.execute(
      params({ pattern: "match", max_results: 5, format: "json" }),
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output) as {
      matches: unknown[];
      next_offset?: string;
    };
    expect(parsed.matches.length).toBe(5);
    expect(parsed.next_offset).toBeTypeOf("string");
  });
});
