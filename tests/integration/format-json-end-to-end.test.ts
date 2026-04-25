/**
 * Integration: Phase 6 (v0.5.0) -- format='json' on list_directory and
 * grep_codebase.
 *
 * The agent loop pattern under test: an agent issues a tool call with
 * format='json' and the next turn parses the structured result via JSON.parse.
 * Both the list and grep tools must emit RFC-8259 valid JSON, and round-tripping
 * through JSON.parse must yield the documented field names.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  ListDirectoryTool,
  GrepCodebaseTool,
} from "../../src/tools/handlers/filesystem.js";
import { mockFs } from "../setup.js";

describe("format='json' end-to-end (integration)", () => {
  let tmpdir: string;
  const wsDescriptor = Object.getOwnPropertyDescriptor(
    vscode.workspace,
    "workspaceFolders",
  );

  beforeEach(() => {
    vi.clearAllMocks();
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "format-json-int-"));

    Object.defineProperty(vscode.workspace, "workspaceFolders", {
      configurable: true,
      get: () => [{ uri: { fsPath: tmpdir }, name: "ws", index: 0 }],
    });

    mockFs.readDirectory.mockImplementation(
      async ({ fsPath }: { fsPath: string }) => {
        const items = fs.readdirSync(fsPath, { withFileTypes: true });
        return items.map((d): [string, number] => [
          d.name,
          d.isDirectory() ? 2 : 1,
        ]);
      },
    );
    mockFs.stat.mockImplementation(async ({ fsPath }: { fsPath: string }) => {
      const stat = fs.statSync(fsPath);
      return { type: stat.isDirectory() ? 2 : 1, size: stat.size };
    });
    mockFs.readFile.mockImplementation(async ({ fsPath }: { fsPath: string }) => {
      return new Uint8Array(fs.readFileSync(fsPath));
    });
    vi.mocked(vscode.workspace.findFiles).mockImplementation(async () => {
      const items = fs.readdirSync(tmpdir);
      return items.map((name) => {
        const fp = path.join(tmpdir, name);
        return {
          fsPath: fp,
          toString: () => fp,
        } as unknown as vscode.Uri;
      });
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
    if (wsDescriptor) {
      Object.defineProperty(vscode.workspace, "workspaceFolders", wsDescriptor);
    }
  });

  it("list_directory format='json' produces a parseable structured payload", async () => {
    fs.writeFileSync(path.join(tmpdir, "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(tmpdir, "b.ts"), "export const b = 2;\n");
    fs.mkdirSync(path.join(tmpdir, "sub"));

    const tool = new ListDirectoryTool();
    const result = await tool.execute({
      _callId: "list",
      path: ".",
      recursive: false,
      format: "json",
    });

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output) as {
      path: string;
      entries: Array<{ name: string; type: string; size_bytes?: number }>;
    };
    expect(parsed.path).toBeTypeOf("string");
    expect(parsed.entries.some((e) => e.name === "a.ts" && e.type === "file")).toBe(true);
    expect(parsed.entries.some((e) => e.name === "sub" && e.type === "directory")).toBe(true);
    const aEntry = parsed.entries.find((e) => e.name === "a.ts");
    expect(aEntry?.size_bytes).toBeGreaterThan(0);
  });

  it("grep_codebase format='json' produces parseable matches with documented field names", async () => {
    fs.writeFileSync(
      path.join(tmpdir, "hits.ts"),
      "line one\nNEEDLE here\nline three\nNEEDLE again\n",
    );

    const tool = new GrepCodebaseTool();
    const result = await tool.execute({
      _callId: "grep",
      pattern: "NEEDLE",
      format: "json",
    });

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output) as {
      pattern: string;
      matches: Array<{ file_path: string; line_number: number; line: string }>;
    };
    expect(parsed.pattern).toBe("NEEDLE");
    expect(parsed.matches.length).toBe(2);
    expect(parsed.matches[0]).toMatchObject({
      file_path: expect.stringContaining("hits.ts"),
      line_number: 2,
    });
    expect(parsed.matches[0].line).toContain("NEEDLE");
  });
});
