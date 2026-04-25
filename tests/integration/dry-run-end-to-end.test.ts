/**
 * Integration: Phase 6 (v0.5.0) -- dry_run on delete_file.
 *
 * The agent loop pattern under test: an agent first calls
 * `delete_file(dry_run=true)` to verify the deletion target's identity (size +
 * SHA), then -- only after that confirms the right file -- calls
 * `delete_file(dry_run=false)` against the same path. The first call must NOT
 * unlink; the second must.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { DeleteFileTool } from "../../src/tools/handlers/filesystem.js";
import { mockFs } from "../setup.js";

describe("delete_file dry_run end-to-end (integration)", () => {
  let tmpdir: string;
  const wsDescriptor = Object.getOwnPropertyDescriptor(
    vscode.workspace,
    "workspaceFolders",
  );

  beforeEach(() => {
    vi.clearAllMocks();
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "dry-run-int-"));

    Object.defineProperty(vscode.workspace, "workspaceFolders", {
      configurable: true,
      get: () => [{ uri: { fsPath: tmpdir }, name: "ws", index: 0 }],
    });

    mockFs.stat.mockImplementation(async ({ fsPath }: { fsPath: string }) => {
      const stat = fs.statSync(fsPath);
      return { type: 1, size: stat.size };
    });
    mockFs.readFile.mockImplementation(async ({ fsPath }: { fsPath: string }) => {
      return new Uint8Array(fs.readFileSync(fsPath));
    });
    mockFs.delete.mockImplementation(async ({ fsPath }: { fsPath: string }) => {
      fs.unlinkSync(fsPath);
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

  it("dry_run preview followed by real delete: file survives the first call, vanishes on the second", async () => {
    const target = path.join(tmpdir, "doomed.txt");
    const content = "the file we're about to delete\n";
    fs.writeFileSync(target, content);

    const tool = new DeleteFileTool();

    const preview = await tool.execute({
      _callId: "preview",
      path: "doomed.txt",
      dry_run: true,
    });

    expect(preview.success).toBe(true);
    expect(preview.output).toContain("=== DRY RUN: no deletion occurred ===");
    expect(fs.existsSync(target)).toBe(true);

    const expectedHash = createHash("sha256")
      .update(Buffer.from(content, "utf-8"))
      .digest("hex");
    expect(preview.output).toContain(expectedHash);

    const real = await tool.execute({
      _callId: "real",
      path: "doomed.txt",
    });
    expect(real.success).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
  });
});
