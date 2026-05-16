import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCANNER = path.join(REPO_ROOT, "scripts", "cleanup-scanner.mjs");

function runScanner(args: string[], cwd: string) {
  return spawnSync(process.execPath, [SCANNER, ...args], {
    cwd,
    encoding: "utf8",
  });
}

describe("scripts/cleanup-scanner.mjs", () => {
  let tmp: string;
  let workspace: string;
  let memoryDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-cleanup-"));
    workspace = path.join(tmp, "workspace");
    memoryDir = path.join(tmp, "memory");
    fs.mkdirSync(workspace);
    fs.mkdirSync(memoryDir);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("emits valid JSON with the expected shape on an empty workspace", () => {
    const result = runScanner(
      ["--format=json", "--workspace", workspace, "--memory-dir", memoryDir],
      workspace,
    );
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      workspace,
      memoryDir,
      findings: {
        staleCacheFiles: [],
        deletedPathReferences: [],
        orphanMemoryRows: [],
        orphanFtsRows: [],
        danglingEmbeddings: [],
      },
      summary: { totalFindings: 0 },
    });
  });

  it("reports a stale cache file older than 30 days", () => {
    const cacheDir = path.join(workspace, ".gemma-code", "cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    const stalePath = path.join(cacheDir, "old-token-output.json");
    fs.writeFileSync(stalePath, '{"hint":"old"}');
    const oldTime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    fs.utimesSync(stalePath, oldTime, oldTime);

    const result = runScanner(
      ["--format=json", "--workspace", workspace, "--memory-dir", memoryDir],
      workspace,
    );
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.findings.staleCacheFiles).toHaveLength(1);
    expect(report.findings.staleCacheFiles[0].path).toContain("old-token-output.json");
    expect(report.findings.staleCacheFiles[0].ageDays).toBeGreaterThanOrEqual(30);
  });

  it("reports deleted-path references in Memory.md", () => {
    const wsId = "workspace-deadbeef00";
    const wsMemoryDir = path.join(memoryDir, wsId);
    fs.mkdirSync(wsMemoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(wsMemoryDir, "Memory.md"),
      "# Memory\n\n## Patterns\n\n- See src/no-such/file.ts for the pattern.\n",
    );

    const result = runScanner(
      ["--format=json", "--workspace", workspace, "--memory-dir", memoryDir],
      workspace,
    );
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.findings.deletedPathReferences).toHaveLength(1);
    expect(report.findings.deletedPathReferences[0]).toMatchObject({
      kind: "deleted-path-reference",
      referencedPath: "src/no-such/file.ts",
    });
  });

  it("emits human-readable text when --format=text", () => {
    const result = runScanner(
      ["--format=text", "--workspace", workspace, "--memory-dir", memoryDir],
      workspace,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[cleanup-scanner] scanned");
    expect(result.stdout).toContain("Total findings: 0");
  });

  it("rejects unknown --format values", () => {
    const result = runScanner(["--format=xml"], workspace);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("unknown --format");
  });
});
