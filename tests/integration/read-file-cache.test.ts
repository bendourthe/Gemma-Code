/**
 * Integration: Phase 4 (v0.5.0) -- diff-based read_file via ToolOutputCache.
 *
 * Asserts the agent-loop-relevant contract: re-reading the same unchanged
 * file produces a far smaller `ToolResult` payload than the first read,
 * because the second response is just a cached-marker rather than the
 * full content.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ReadFileTool } from "../../src/tools/handlers/filesystem.js";
import { ToolOutputCache } from "../../src/storage/ToolOutputCache.js";
import { mockFs } from "../setup.js";

describe("read_file cache (integration)", () => {
  let tmpdir: string;
  let cache: ToolOutputCache;
  const wsDescriptor = Object.getOwnPropertyDescriptor(
    vscode.workspace,
    "workspaceFolders",
  );

  beforeEach(() => {
    vi.clearAllMocks();
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "read-file-cache-int-"));

    Object.defineProperty(vscode.workspace, "workspaceFolders", {
      configurable: true,
      get: () => [{ uri: { fsPath: tmpdir }, name: "ws", index: 0 }],
    });

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
    if (wsDescriptor) {
      Object.defineProperty(vscode.workspace, "workspaceFolders", wsDescriptor);
    }
  });

  it("second tool result for an unchanged file is < 200 bytes", async () => {
    // Build a realistic ~3 KB code-shaped fixture so the first read is large
    // and the second is provably much smaller.
    const block =
      "export function step(value: number): number {\n" +
      "  const total = value + 1;\n" +
      "  return total * 2;\n" +
      "}\n";
    const content = block.repeat(40);
    fs.writeFileSync(path.join(tmpdir, "fixture.ts"), content);

    const tool = new ReadFileTool(null, [], cache);

    const first = await tool.execute({
      _callId: "first",
      path: "fixture.ts",
    });
    expect(first.success).toBe(true);
    const firstSize = Buffer.byteLength(first.output, "utf8");
    expect(firstSize).toBeGreaterThan(2_000);

    const second = await tool.execute({
      _callId: "second",
      path: "fixture.ts",
    });
    expect(second.success).toBe(true);
    const secondSize = Buffer.byteLength(second.output, "utf8");
    expect(secondSize).toBeLessThan(200);

    const parsed = JSON.parse(second.output);
    expect(parsed.cached).toBe(true);
    expect(parsed.changed).toBe(false);
  });

  it("cache hit followed by file modification yields a diff with both sides", async () => {
    fs.writeFileSync(
      path.join(tmpdir, "fixture.ts"),
      "const value = 1;\nconst other = 2;\n",
    );
    const tool = new ReadFileTool(null, [], cache);

    await tool.execute({ _callId: "warm", path: "fixture.ts" });

    await new Promise((r) => setTimeout(r, 20));
    fs.writeFileSync(
      path.join(tmpdir, "fixture.ts"),
      "const value = 99;\nconst other = 2;\n",
    );

    const result = await tool.execute({
      _callId: "diff",
      path: "fixture.ts",
    });
    const parsed = JSON.parse(result.output);
    expect(parsed.cached).toBe(true);
    expect(parsed.changed).toBe(true);
    expect(parsed.diff).toContain("-const value = 1;");
    expect(parsed.diff).toContain("+const value = 99;");
  });
});
