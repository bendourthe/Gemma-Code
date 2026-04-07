import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ReadFileTool,
  WriteFileTool,
  CreateFileTool,
  DeleteFileTool,
  EditFileTool,
  ListDirectoryTool,
  GrepCodebaseTool,
} from "../../../../src/tools/handlers/filesystem.js";
import { ConfirmationGate } from "../../../../src/tools/ConfirmationGate.js";
import { mockFs, mockFindTextInFiles, MOCK_WORKSPACE_ROOT } from "../../../setup.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = MOCK_WORKSPACE_ROOT;

function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { _callId: "call_001", ...overrides };
}

function makeGate(approved = true): ConfirmationGate {
  const gate = new ConfirmationGate(vi.fn());
  vi.spyOn(gate, "request").mockResolvedValue(approved);
  return gate;
}

function textToUint8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Restore workspace root default (cleared by clearAllMocks)
});

// ---------------------------------------------------------------------------
// ReadFileTool
// ---------------------------------------------------------------------------

describe("ReadFileTool", () => {
  it("returns file content and line count", async () => {
    const content = "line1\nline2\nline3";
    mockFs.readFile.mockResolvedValueOnce(textToUint8(content));

    const tool = new ReadFileTool();
    const result = await tool.execute(params({ path: "src/extension.ts" }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.content).toBe(content);
    expect(parsed.lines).toBe(3);
    expect(parsed.truncated).toBe(false);
  });

  it("caps output at 500 lines and appends a truncation notice", async () => {
    const bigContent = Array.from({ length: 600 }, (_, i) => `line ${i + 1}`).join("\n");
    mockFs.readFile.mockResolvedValueOnce(textToUint8(bigContent));

    const tool = new ReadFileTool();
    const result = await tool.execute(params({ path: "big.ts" }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.truncated).toBe(true);
    expect(parsed.lines).toBe(600);
    expect(parsed.content).toContain("truncated");
    expect(parsed.content.split("\n").length).toBeLessThan(600);
  });

  it("returns failure when file is not found", async () => {
    mockFs.readFile.mockRejectedValueOnce(new Error("FileNotFound"));

    const tool = new ReadFileTool();
    const result = await tool.execute(params({ path: "missing.ts" }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it("returns failure when path parameter is missing", async () => {
    const tool = new ReadFileTool();
    const result = await tool.execute(params());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/path/i);
  });

  it("rejects paths that escape the workspace root", async () => {
    const tool = new ReadFileTool();
    const result = await tool.execute(params({ path: "../../etc/passwd" }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Path traversal/i);
  });
});

// ---------------------------------------------------------------------------
// WriteFileTool
// ---------------------------------------------------------------------------

describe("WriteFileTool", () => {
  it("creates parent directories then writes the file", async () => {
    mockFs.createDirectory.mockResolvedValueOnce(undefined);
    mockFs.writeFile.mockResolvedValueOnce(undefined);

    const tool = new WriteFileTool();
    const result = await tool.execute(params({ path: "src/new.ts", content: "export {};" }));

    expect(result.success).toBe(true);
    expect(mockFs.createDirectory).toHaveBeenCalledOnce();
    expect(mockFs.writeFile).toHaveBeenCalledOnce();
  });

  it("returns failure when path is missing", async () => {
    const tool = new WriteFileTool();
    const result = await tool.execute(params({ content: "hi" }));
    expect(result.success).toBe(false);
  });

  it("returns failure when content is missing", async () => {
    const tool = new WriteFileTool();
    const result = await tool.execute(params({ path: "x.ts" }));
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CreateFileTool
// ---------------------------------------------------------------------------

describe("CreateFileTool", () => {
  it("fails when the file already exists", async () => {
    mockFs.stat.mockResolvedValueOnce({ type: 1, size: 100 }); // file exists

    const tool = new CreateFileTool();
    const result = await tool.execute(params({ path: "existing.ts" }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already exists/i);
  });

  it("creates the file when it does not exist", async () => {
    mockFs.stat.mockRejectedValueOnce(new Error("FileNotFound")); // not found
    mockFs.createDirectory.mockResolvedValueOnce(undefined);
    mockFs.writeFile.mockResolvedValueOnce(undefined);

    const tool = new CreateFileTool();
    const result = await tool.execute(params({ path: "new.ts", content: "" }));
    expect(result.success).toBe(true);
    expect(mockFs.writeFile).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// DeleteFileTool
// ---------------------------------------------------------------------------

describe("DeleteFileTool", () => {
  it("deletes the file and returns success", async () => {
    mockFs.delete.mockResolvedValueOnce(undefined);

    const tool = new DeleteFileTool();
    const result = await tool.execute(params({ path: "old.ts" }));
    expect(result.success).toBe(true);
    expect(mockFs.delete).toHaveBeenCalledOnce();
  });

  it("returns failure when delete throws", async () => {
    mockFs.delete.mockRejectedValueOnce(new Error("Permission denied"));

    const tool = new DeleteFileTool();
    const result = await tool.execute(params({ path: "locked.ts" }));
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EditFileTool
// ---------------------------------------------------------------------------

describe("EditFileTool", () => {
  it("replaces old_string with new_string and returns diff", async () => {
    const original = "const x = 1;\n";
    mockFs.readFile.mockResolvedValueOnce(textToUint8(original));
    mockFs.createDirectory.mockResolvedValueOnce(undefined);
    mockFs.writeFile.mockResolvedValueOnce(undefined);

    const gate = makeGate(true);
    const tool = new EditFileTool(gate, "ask");
    const result = await tool.execute(
      params({ path: "src/x.ts", old_string: "const x = 1;", new_string: "const x = 2;" })
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.diff).toContain("-const x = 1;");
    expect(parsed.diff).toContain("+const x = 2;");
    expect(gate.request).toHaveBeenCalledOnce();
  });

  it("returns failure when old_string is not found", async () => {
    mockFs.readFile.mockResolvedValueOnce(textToUint8("hello world\n"));

    const tool = new EditFileTool(makeGate(), "ask");
    const result = await tool.execute(
      params({ path: "f.ts", old_string: "missing", new_string: "x" })
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it("returns failure when old_string appears more than once", async () => {
    mockFs.readFile.mockResolvedValueOnce(textToUint8("foo\nfoo\n"));

    const tool = new EditFileTool(makeGate(), "ask");
    const result = await tool.execute(
      params({ path: "f.ts", old_string: "foo", new_string: "bar" })
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/2 times/);
  });

  it("skips the confirmation gate when mode is 'never'", async () => {
    mockFs.readFile.mockResolvedValueOnce(textToUint8("const a = 1;\n"));
    mockFs.createDirectory.mockResolvedValueOnce(undefined);
    mockFs.writeFile.mockResolvedValueOnce(undefined);

    const gate = makeGate(true);
    const tool = new EditFileTool(gate, "never");
    const result = await tool.execute(
      params({ path: "a.ts", old_string: "const a = 1;", new_string: "const a = 2;" })
    );
    expect(result.success).toBe(true);
    expect(gate.request).not.toHaveBeenCalled();
  });

  it("returns failure when user rejects confirmation", async () => {
    mockFs.readFile.mockResolvedValueOnce(textToUint8("let b = 1;\n"));

    const gate = makeGate(false);
    const tool = new EditFileTool(gate, "ask");
    const result = await tool.execute(
      params({ path: "b.ts", old_string: "let b = 1;", new_string: "let b = 2;" })
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rejected/i);
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ListDirectoryTool
// ---------------------------------------------------------------------------

describe("ListDirectoryTool", () => {
  it("returns a flat directory listing", async () => {
    mockFs.readDirectory.mockResolvedValueOnce([
      ["extension.ts", 1 /* File */],
      ["ollama", 2 /* Directory */],
    ]);
    // Second call for the ollama subdirectory (recursive, but we'll return empty)
    mockFs.readDirectory.mockResolvedValueOnce([]);

    const tool = new ListDirectoryTool();
    const result = await tool.execute(params({ path: "src", recursive: true }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.entries.some((e: { name: string }) => e.name === "extension.ts")).toBe(true);
    expect(parsed.entries.some((e: { name: string }) => e.name === "ollama")).toBe(true);
  });

  it("excludes node_modules directories", async () => {
    mockFs.readDirectory.mockResolvedValueOnce([
      ["node_modules", 2 /* Directory */],
      ["src", 2 /* Directory */],
    ]);
    mockFs.readDirectory.mockResolvedValueOnce([]); // src is empty

    const tool = new ListDirectoryTool();
    const result = await tool.execute(params({ path: "." }));

    const parsed = JSON.parse(result.output);
    expect(parsed.entries.some((e: { name: string }) => e.name === "node_modules")).toBe(false);
    expect(parsed.entries.some((e: { name: string }) => e.name === "src")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GrepCodebaseTool
// ---------------------------------------------------------------------------

describe("GrepCodebaseTool", () => {
  it("falls back to findFiles+readFile and returns matches", async () => {
    // ripgrep is not available in tests, so spawn will fail → falls through to findFiles
    const { findFiles } = await import("vscode").then((m) => m.workspace);
    vi.mocked(findFiles).mockResolvedValueOnce([
      { fsPath: `${ROOT}/src/extension.ts`, toString: () => "" } as unknown as import("vscode").Uri,
    ]);
    // The file contains "activate" on line 5
    mockFs.readFile.mockResolvedValueOnce(
      new TextEncoder().encode("line1\nline2\nline3\nline4\nactivate(context);\n")
    );

    const tool = new GrepCodebaseTool();
    const result = await tool.execute(params({ pattern: "activate" }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.count).toBeGreaterThan(0);
    expect(parsed.matches[0].line).toBe(5);
  });
});
