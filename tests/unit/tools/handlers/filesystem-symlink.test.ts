/**
 * Phase 1, sub-task 1.1 (v0.6.0) -- Symlink-escape regression for every
 * filesystem tool handler.
 *
 * Builds a real workspace on disk with a symlink `inner` that resolves to a
 * directory outside the workspace, then asserts that each filesystem tool
 * refuses any path that traverses the symlink to land outside the root.
 *
 * Closes pen-test F-001 / Attack Path A symlink leg.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  CreateFileTool,
  DeleteFileTool,
  ListDirectoryTool,
  GrepCodebaseTool,
} from "../../../../src/tools/handlers/filesystem.js";
import { mockFs } from "../../../setup.js";

// File symlinks on Windows require admin or Developer Mode. Junctions
// (directory-only) work without elevation. CI runs on Linux where both
// symlink types are unconditional. The probe + test paths use the
// directory-symlink-or-junction approach so the suite runs on stock Windows.
type SymlinkKind = "symlink" | "junction" | null;

function detectSymlinkKind(): SymlinkKind {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-symlink-probe-"));
  const probeTargetDir = path.join(probeDir, "target");
  const probeLink = path.join(probeDir, "link");
  try {
    fs.mkdirSync(probeTargetDir);
    try {
      fs.symlinkSync(probeTargetDir, probeLink, "dir");
      return "symlink";
    } catch {
      // dir symlink not permitted; fall back to junction (Windows only).
    }
    try {
      fs.symlinkSync(probeTargetDir, probeLink, "junction");
      return "junction";
    } catch {
      return null;
    }
  } finally {
    try {
      fs.rmSync(probeDir, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
  }
}

const SYMLINK_KIND = detectSymlinkKind();
const SYMLINKS_AVAILABLE = SYMLINK_KIND !== null;

describe.skipIf(!SYMLINKS_AVAILABLE)("filesystem tools refuse workspace-internal symlinks that escape the root", () => {
  let workspaceRoot: string;
  let outsideRoot: string;

  const wsDescriptor = Object.getOwnPropertyDescriptor(
    vscode.workspace,
    "workspaceFolders",
  );

  beforeAll(() => {
    workspaceRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "gemma-ws-")),
    );
    outsideRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "gemma-outside-")),
    );

    // The escape vector: a symlink inside the workspace whose target is the
    // outside directory. Any tool that follows the link and resolves through
    // realpath should land outside the workspace and refuse the operation.
    fs.symlinkSync(
      outsideRoot,
      path.join(workspaceRoot, "inner"),
      SYMLINK_KIND === "junction" ? "junction" : "dir",
    );

    // Pre-populate the outside target so reads have a file to follow.
    fs.writeFileSync(path.join(outsideRoot, "secret.txt"), "outside data");

    Object.defineProperty(vscode.workspace, "workspaceFolders", {
      configurable: true,
      get: () => [{ uri: { fsPath: workspaceRoot }, name: "ws", index: 0 }],
    });
  });

  afterAll(() => {
    if (workspaceRoot) {
      try {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      } catch {
        /* swallow */
      }
    }
    if (outsideRoot) {
      try {
        fs.rmSync(outsideRoot, { recursive: true, force: true });
      } catch {
        /* swallow */
      }
    }
    if (wsDescriptor) {
      Object.defineProperty(vscode.workspace, "workspaceFolders", wsDescriptor);
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Wire vscode.workspace.fs to the real disk so the path-guard runs against
    // an actual filesystem with the symlink in place.
    mockFs.readFile.mockImplementation(async ({ fsPath }: { fsPath: string }) => {
      return new Uint8Array(fs.readFileSync(fsPath));
    });
    mockFs.writeFile.mockImplementation(async ({ fsPath }: { fsPath: string }, data: Uint8Array) => {
      fs.writeFileSync(fsPath, data);
    });
    mockFs.createDirectory.mockImplementation(async ({ fsPath }: { fsPath: string }) => {
      fs.mkdirSync(fsPath, { recursive: true });
    });
    mockFs.delete.mockImplementation(async ({ fsPath }: { fsPath: string }) => {
      fs.unlinkSync(fsPath);
    });
    mockFs.stat.mockImplementation(async ({ fsPath }: { fsPath: string }) => {
      const stat = fs.statSync(fsPath);
      return { type: stat.isDirectory() ? 2 : 1, size: stat.size };
    });
    mockFs.readDirectory.mockImplementation(async ({ fsPath }: { fsPath: string }) => {
      const names = fs.readdirSync(fsPath);
      return names.map((n) => {
        const child = path.join(fsPath, n);
        const st = fs.lstatSync(child);
        const type = st.isDirectory() ? 2 : st.isSymbolicLink() ? 64 : 1;
        return [n, type] as [string, number];
      });
    });
  });

  it("read_file refuses to read through a workspace-internal symlink", async () => {
    const tool = new ReadFileTool();
    const result = await tool.execute({ _callId: "r1", path: "inner/secret.txt" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/resolves outside the workspace/i);
  });

  it("write_file refuses to write through a workspace-internal symlink", async () => {
    const tool = new WriteFileTool();
    const result = await tool.execute({
      _callId: "w1",
      path: "inner/escape.txt",
      content: "should not land here",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/resolves outside the workspace/i);
  });

  it("edit_file refuses to edit through a workspace-internal symlink", async () => {
    const tool = new EditFileTool();
    const result = await tool.execute({
      _callId: "e1",
      path: "inner/secret.txt",
      old_string: "outside",
      new_string: "captured",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/resolves outside the workspace/i);
  });

  it("create_file refuses to create through a workspace-internal symlink", async () => {
    const tool = new CreateFileTool();
    const result = await tool.execute({
      _callId: "c1",
      path: "inner/new.txt",
      content: "smuggled",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/resolves outside the workspace/i);
  });

  it("delete_file refuses to delete through a workspace-internal symlink", async () => {
    const tool = new DeleteFileTool();
    const result = await tool.execute({ _callId: "d1", path: "inner/secret.txt" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/resolves outside the workspace/i);
  });

  it("list_directory refuses to list through a workspace-internal symlink", async () => {
    const tool = new ListDirectoryTool();
    const result = await tool.execute({ _callId: "l1", path: "inner" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/resolves outside the workspace/i);
  });

  it("grep_codebase respects the unified workspace boundary on its search root", async () => {
    // grep_codebase resolves the search root through workspaceRoot(); the
    // unified guard short-circuits any attempt to drive grep at an
    // outside-workspace target. We assert the indirect behavior: grep does
    // not surface content from `inner/secret.txt` (outside the realpath root)
    // even though the symlink is inside the workspace tree.
    const tool = new GrepCodebaseTool();
    const result = await tool.execute({
      _callId: "g1",
      pattern: "outside data",
      glob: "inner/**",
    });
    // Either the call fails outright, or it returns zero matches -- both
    // outcomes prove the guard prevented the symlink leak.
    if (result.success) {
      const parsed = JSON.parse(result.output);
      const matches = Array.isArray(parsed) ? parsed : (parsed.matches ?? []);
      expect(matches.length).toBe(0);
    } else {
      expect(result.error).toBeTruthy();
    }
  });
});
