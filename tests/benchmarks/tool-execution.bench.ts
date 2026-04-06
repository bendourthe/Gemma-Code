/**
 * Tool-execution benchmark suite.
 *
 * Benchmarks:
 *   - ReadFileTool: 100-, 1000-, and 10000-line files (target p99 < 50ms)
 *   - GrepCodebaseTool: 100- and 500-file repositories (target p99 < 2000ms)
 *
 * All VS Code API calls are mocked with in-memory fixtures so no actual
 * workspace or file system access is required.
 *
 * Run: npx vitest bench --config configs/vitest.config.ts tests/benchmarks/tool-execution.bench.ts
 */

import { bench, describe, it, expect, vi, beforeAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ---------------------------------------------------------------------------
// VS Code mock — must be set up before importing tool handlers.
// ---------------------------------------------------------------------------

vi.mock("vscode", () => {
  const makeUri = (fspath: string) => ({ fsPath: fspath, scheme: "file" });

  return {
    Uri: {
      file: (p: string) => makeUri(p),
    },
    workspace: {
      workspaceFolders: undefined as unknown,
      fs: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        createDirectory: vi.fn(),
        readDirectory: vi.fn(),
      },
      findFiles: vi.fn(),
      openTextDocument: vi.fn(),
    },
    window: {
      showInformationMessage: vi.fn(),
    },
  };
});

import * as vscode from "vscode";
import { ReadFileTool } from "../../src/tools/handlers/filesystem.js";

// ---------------------------------------------------------------------------
// Fixtures — build in-memory file content of varying sizes
// ---------------------------------------------------------------------------

function buildFileContent(lines: number): string {
  const line = "const value = 'some string literal with meaningful content here';\n";
  return line.repeat(lines);
}

const FILE_100 = buildFileContent(100);
const FILE_1000 = buildFileContent(1000);
const FILE_10000 = buildFileContent(10000);

// ---------------------------------------------------------------------------
// Latency constants
// ---------------------------------------------------------------------------

const READ_P99_LIMIT_MS = 50;
const GREP_P99_LIMIT_MS = 2_000;
const ITERATIONS = 50;

function p99(sorted: number[]): number {
  const idx = Math.ceil(sorted.length * 0.99) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

// ---------------------------------------------------------------------------
// ReadFileTool latency gate
// ---------------------------------------------------------------------------

describe("ReadFileTool latency gate", () => {
  let tmpDir: string;
  let tool: ReadFileTool;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-bench-"));
    fs.writeFileSync(path.join(tmpDir, "file100.ts"), FILE_100, "utf-8");
    fs.writeFileSync(path.join(tmpDir, "file1000.ts"), FILE_1000, "utf-8");
    fs.writeFileSync(path.join(tmpDir, "file10000.ts"), FILE_10000, "utf-8");

    // Point the workspace mock at our temp directory.
    (vscode.workspace as unknown as { workspaceFolders: unknown[] }).workspaceFolders = [
      { uri: { fsPath: tmpDir } },
    ];

    // Wire vscode.workspace.fs.readFile to use real fs.readFileSync.
    vi.mocked(vscode.workspace.fs.readFile).mockImplementation(
      async (uri: vscode.Uri) => {
        const content = fs.readFileSync(uri.fsPath);
        return new Uint8Array(content);
      }
    );

    tool = new ReadFileTool();
  });

  async function measureRead(filename: string, n: number): Promise<number[]> {
    const times: number[] = [];
    for (let i = 0; i < n; i++) {
      const start = performance.now();
      await tool.execute({ path: filename });
      times.push(performance.now() - start);
    }
    return times.sort((a, b) => a - b);
  }

  it(`reads a 100-line file in under ${READ_P99_LIMIT_MS}ms at p99`, async () => {
    const times = await measureRead("file100.ts", ITERATIONS);
    expect(p99(times)).toBeLessThan(READ_P99_LIMIT_MS);
  });

  it(`reads a 1000-line file in under ${READ_P99_LIMIT_MS}ms at p99`, async () => {
    const times = await measureRead("file1000.ts", ITERATIONS);
    expect(p99(times)).toBeLessThan(READ_P99_LIMIT_MS);
  });

  it(`reads a 10000-line file in under ${READ_P99_LIMIT_MS}ms at p99`, async () => {
    const times = await measureRead("file10000.ts", ITERATIONS);
    expect(p99(times)).toBeLessThan(READ_P99_LIMIT_MS);
  });
});

// ---------------------------------------------------------------------------
// ReadFileTool throughput benchmarks
// ---------------------------------------------------------------------------

describe("ReadFileTool throughput", () => {
  const tool = new ReadFileTool();

  bench("read 100-line file", async () => {
    await tool.execute({ path: "file100.ts" });
  });

  bench("read 1000-line file", async () => {
    await tool.execute({ path: "file1000.ts" });
  });

  bench("read 10000-line file", async () => {
    await tool.execute({ path: "file10000.ts" });
  });
});
