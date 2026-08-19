import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// These tests drive GrepCodebaseTool through the vscode.workspace.findFiles
// fallback. If ripgrep is on PATH, grepWithRipgrep searches MOCK_WORKSPACE_ROOT,
// finds nothing, and returns [] (exit 1 is "no matches", not "rg missing").
vi.mock("child_process", () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => child.emit("error", new Error("ENOENT")));
    return child;
  }),
}));

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
import { mockOf } from "../../../helpers/factories.js";

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
    expect(result.error).toMatch(/resolves outside the workspace/i);
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

  it("reports success-noop when the edit is already applied", async () => {
    mockFs.readFile.mockResolvedValueOnce(textToUint8("const x = 2;\n"));

    const tool = new EditFileTool(makeGate(), "ask");
    const result = await tool.execute(
      params({ path: "src/x.ts", old_string: "const x = 1;", new_string: "const x = 2;" }),
    );
    expect(result.success).toBe(true);
    expect(result.output).toMatch(/already present/i);
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
  async function mockFindFiles(uris: string[]): Promise<void> {
    const { findFiles } = await import("vscode").then((m) => m.workspace);
    vi.mocked(findFiles).mockResolvedValueOnce(
      uris.map((p) =>
        mockOf<import("vscode").Uri>({ fsPath: p, toString: () => p }),
      ),
    );
  }

  it("falls back to findFiles+readFile and returns matches", async () => {
    // ripgrep is not available in tests, so spawn will fail → falls through to findFiles
    await mockFindFiles([`${ROOT}/src/extension.ts`]);
    // The file contains "activate" on line 5
    mockFs.readFile.mockResolvedValueOnce(
      new TextEncoder().encode("line1\nline2\nline3\nline4\nactivate(context);\n")
    );

    const tool = new GrepCodebaseTool();
    const result = await tool.execute(params({ pattern: "activate" }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.count).toBe(1);
    expect(parsed.matches[0].line).toBe(5);
    expect(parsed.matches[0].content).toBe("activate(context);");
  });

  it("handles regex special characters in the pattern", async () => {
    await mockFindFiles([`${ROOT}/src/re.ts`]);
    mockFs.readFile.mockResolvedValueOnce(
      new TextEncoder().encode("foo(123)\nbar(456)\n"),
    );

    const tool = new GrepCodebaseTool();
    const result = await tool.execute(params({ pattern: "\\(\\d+\\)" }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.count).toBe(2);
  });

  it("rejects invalid regex patterns with a clear error", async () => {
    const tool = new GrepCodebaseTool();
    const result = await tool.execute(params({ pattern: "(unterminated" }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid regex/i);
  });

  it("rejects ReDoS-risky patterns before any filesystem work", async () => {
    const tool = new GrepCodebaseTool();
    const result = await tool.execute(params({ pattern: "(a+)+b" }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/catastrophic/i);
    // The tool must short-circuit before searching files.
    expect(mockFs.readFile).not.toHaveBeenCalled();
  });

  it("respects max_results by truncating the match list", async () => {
    await mockFindFiles([`${ROOT}/src/many.ts`]);
    const content = Array.from({ length: 20 }, (_, i) => `hit ${i}`).join("\n");
    mockFs.readFile.mockResolvedValueOnce(new TextEncoder().encode(content));

    const tool = new GrepCodebaseTool();
    const result = await tool.execute(params({ pattern: "hit", max_results: 3 }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.count).toBe(3);
    expect(parsed.matches).toHaveLength(3);
  });

  it("honors the include glob via vscode.workspace.findFiles", async () => {
    const { findFiles } = await import("vscode").then((m) => m.workspace);
    await mockFindFiles([`${ROOT}/src/inc.ts`]);
    mockFs.readFile.mockResolvedValueOnce(
      new TextEncoder().encode("match here\n"),
    );

    const tool = new GrepCodebaseTool();
    await tool.execute(params({ pattern: "match", glob: "**/*.ts" }));

    expect(vi.mocked(findFiles)).toHaveBeenCalledWith(
      "**/*.ts",
      expect.any(String),
      expect.any(Number),
    );
  });

  it("skips binary files without throwing", async () => {
    // Two files: one ascii, one binary-like (null bytes). The tool reads both
    // but only the ascii file should produce matches without errors.
    await mockFindFiles([`${ROOT}/src/a.ts`, `${ROOT}/src/b.bin`]);
    mockFs.readFile.mockResolvedValueOnce(
      new TextEncoder().encode("clean line\n"),
    );
    const binary = new Uint8Array([0x00, 0xff, 0x01, 0x02, 0x03]);
    mockFs.readFile.mockResolvedValueOnce(binary);

    const tool = new GrepCodebaseTool();
    const result = await tool.execute(params({ pattern: "clean" }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.count).toBe(1);
    expect(parsed.matches[0].file).toContain("a.ts");
  });

  it("returns near-miss probes when the exact pattern misses", async () => {
    await mockFindFiles([`${ROOT}/src/foo.ts`]);
    mockFs.readFile.mockResolvedValueOnce(textToUint8("function fooBar() {}\n"));
    await mockFindFiles([`${ROOT}/src/foo.ts`]);
    mockFs.readFile.mockResolvedValueOnce(textToUint8("function fooBar() {}\n"));

    const tool = new GrepCodebaseTool();
    const result = await tool.execute(params({ pattern: "fooBar\\d+" }));
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output) as {
      count: number;
      near_misses?: Array<{ content: string }>;
    };
    expect(parsed.count).toBe(0);
    expect(parsed.near_misses?.length).toBeGreaterThan(0);
    expect(parsed.near_misses?.[0]?.content).toContain("fooBar");
  });

  it("rejects unsafe glob targeting a secret path without allow_secrets", async () => {
    const tool = new GrepCodebaseTool();
    const result = await tool.execute(
      params({ pattern: "password", glob: "**/.env" }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/secret/i);
  });
});
