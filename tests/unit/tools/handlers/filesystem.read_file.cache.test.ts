import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ReadFileTool } from "../../../../src/tools/handlers/filesystem.js";
import { ToolOutputCache } from "../../../../src/storage/ToolOutputCache.js";
import { mockFs } from "../../../setup.js";

/**
 * Phase 4 (v0.5.0) -- ReadFileTool cache-path tests.
 *
 * The cache keys on real on-disk file stat (mtime + size), so each test runs
 * against a tmpdir-backed workspace root. `mockFs.readFile` reads the real
 * file via `fs.readFileSync` so the content stays consistent with stat.
 */
describe("ReadFileTool — diff-based cache", () => {
  let tmpdir: string;
  let cache: ToolOutputCache;
  const workspaceFoldersDescriptor = Object.getOwnPropertyDescriptor(
    vscode.workspace,
    "workspaceFolders",
  );

  beforeEach(() => {
    vi.clearAllMocks();

    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "read-file-cache-"));

    // Repoint the workspace mock at the real tmpdir for this test.
    Object.defineProperty(vscode.workspace, "workspaceFolders", {
      configurable: true,
      get: () => [{ uri: { fsPath: tmpdir }, name: "ws", index: 0 }],
    });

    // Have the mocked fs.readFile read from disk so the content matches what
    // the cache's fs.statSync (which hits real disk) sees.
    mockFs.readFile.mockImplementation(async ({ fsPath }: { fsPath: string }) => {
      return new Uint8Array(fs.readFileSync(fsPath));
    });

    cache = new ToolOutputCache({ capacity: 50 });
    cache.open(":memory:");
  });

  afterEach(() => {
    cache.close();
    try {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
    if (workspaceFoldersDescriptor) {
      Object.defineProperty(
        vscode.workspace,
        "workspaceFolders",
        workspaceFoldersDescriptor,
      );
    }
  });

  function writeFixture(name: string, content: string): void {
    fs.writeFileSync(path.join(tmpdir, name), content);
  }

  function call(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { _callId: "call_cache", path: "fixture.txt", ...extra };
  }

  // -------------------------------------------------------------------------

  it("first read returns the full file content (cache miss)", async () => {
    writeFixture("fixture.txt", "line1\nline2\nline3");

    const tool = new ReadFileTool(null, [], cache);
    const result = await tool.execute(call());

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.content).toBe("line1\nline2\nline3");
    expect(parsed.lines).toBe(3);
    expect(parsed.cached).toBeUndefined();
  });

  it("second read of an unchanged file returns the cached-marker (no diff)", async () => {
    writeFixture("fixture.txt", "alpha\nbeta\ngamma");

    const tool = new ReadFileTool(null, [], cache);
    await tool.execute(call()); // warm cache
    const result = await tool.execute(call());

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.cached).toBe(true);
    expect(parsed.changed).toBe(false);
    expect(parsed.marker).toContain("file unchanged");
  });

  it("second read of a modified file returns a unified diff with both - and + lines", async () => {
    writeFixture("fixture.txt", "alpha\nbeta\ngamma");

    const tool = new ReadFileTool(null, [], cache);
    await tool.execute(call()); // warm cache

    // Modify on disk: change one line and force a different mtime.
    await new Promise((r) => setTimeout(r, 20));
    fs.writeFileSync(path.join(tmpdir, "fixture.txt"), "alpha\nBETA\ngamma");

    const result = await tool.execute(call());

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.cached).toBe(true);
    expect(parsed.changed).toBe(true);
    expect(parsed.diff).toContain("-beta");
    expect(parsed.diff).toContain("+BETA");
    expect(parsed.diff).toContain("=== diff vs. cached read");
  });

  it("full=true bypasses the cache and always returns the full content", async () => {
    writeFixture("fixture.txt", "alpha\nbeta\ngamma");

    const tool = new ReadFileTool(null, [], cache);
    await tool.execute(call()); // warm cache

    const result = await tool.execute(call({ full: true }));
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.cached).toBeUndefined();
    expect(parsed.content).toBe("alpha\nbeta\ngamma");
    expect(parsed.lines).toBe(3);
  });

  it("does not cache a path on the secret-path denylist (.env)", async () => {
    writeFixture(".env", "API_KEY=hunter2");

    const tool = new ReadFileTool(null, [], cache);
    await tool.execute({ _callId: "x", path: ".env", allow_secrets: true });

    expect(cache.size()).toBe(0);
  });

  it("survives a cache failure (lookup throws) without breaking read_file", async () => {
    writeFixture("fixture.txt", "abc");

    // Force lookup to throw the next time it is called.
    const stub = vi
      .spyOn(cache, "lookup")
      .mockImplementation(() => {
        throw new Error("boom");
      });

    const tool = new ReadFileTool(null, [], cache);
    const result = await tool.execute(call());

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.content).toBe("abc");

    stub.mockRestore();
  });
});
