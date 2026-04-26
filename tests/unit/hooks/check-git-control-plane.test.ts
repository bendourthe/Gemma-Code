/**
 * Unit tests for `scripts/hooks/check-git-control-plane.mjs`.
 *
 * Each test creates a throw-away git repo via `fs.mkdtempSync` + `git init`,
 * arranges the desired branch/dirty state, and invokes the hook with that
 * repo as the workspace root.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const HOOK_PATH = path.resolve(
  __dirname,
  "../../../scripts/hooks/check-git-control-plane.mjs",
);

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runHook(workspaceRoot: string, env: NodeJS.ProcessEnv = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        GEMMA_HOOK_WORKSPACE_ROOT: workspaceRoot,
        ...env,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ exitCode: code, stdout, stderr }));
    child.stdin.end();
  });
}

function git(args: string[], cwd: string): void {
  execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function makeRepo(initialBranch: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-git-hook-"));
  git(["init", "-q", "--initial-branch", initialBranch], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "Test"], dir);
  fs.writeFileSync(path.join(dir, "seed.txt"), "seed", "utf-8");
  git(["add", "seed.txt"], dir);
  git(["commit", "-q", "-m", "seed"], dir);
  return dir;
}

describe("check-git-control-plane hook", () => {
  let gitAvailable = true;
  beforeAll(() => {
    try {
      execFileSync("git", ["--version"], { stdio: "ignore" });
    } catch {
      gitAvailable = false;
    }
  });

  it("blocks when on main branch", async () => {
    if (!gitAvailable) return;
    const repo = makeRepo("main");
    try {
      const result = await runHook(repo);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/protected branch/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("blocks when on master branch", async () => {
    if (!gitAvailable) return;
    const repo = makeRepo("master");
    try {
      const result = await runHook(repo);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/protected branch/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("allows on a feature branch with a clean working tree", async () => {
    if (!gitAvailable) return;
    const repo = makeRepo("main");
    try {
      git(["checkout", "-q", "-b", "feature/test"], repo);
      const result = await runHook(repo);
      expect(result.exitCode).toBe(0);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("blocks when too many files are dirty", async () => {
    if (!gitAvailable) return;
    const repo = makeRepo("main");
    try {
      git(["checkout", "-q", "-b", "feature/dirty"], repo);
      for (let i = 0; i < 5; i++) {
        fs.writeFileSync(path.join(repo, `dirty-${i}.txt`), String(i), "utf-8");
      }
      const result = await runHook(repo, { GEMMA_HOOK_DIRTY_LIMIT: "2" });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/blast radius too large/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("warns and exits 0 when the workspace is not a git repo", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-not-git-"));
    try {
      const result = await runHook(tmp);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toMatch(/not a git repository/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
