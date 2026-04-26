/**
 * Shared git-control helpers used by the SessionStart harness hook. Wraps a
 * minimal set of git plumbing commands with timeouts, cwd control, and
 * fault-tolerant error handling. Mirrors the policy encoded by
 * `src/guardrails/GitSafetyNet.ts` without duplicating the full safety-net
 * surface — the hook is a control-plane gate, not a checkpoint manager.
 */

import { execFileSync } from "node:child_process";

const GIT_TIMEOUT_MS = 5_000;

/**
 * Run a git subcommand. Returns { ok, stdout, stderr, exitCode }.
 * Never throws; caller decides how to react to failure.
 */
export function runGit(args, cwd) {
  try {
    const stdout = execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    const e = /** @type {{ status?: number; stderr?: Buffer | string; stdout?: Buffer | string }} */ (err);
    const stdout = typeof e.stdout === "string" ? e.stdout : e.stdout?.toString("utf-8") ?? "";
    const stderr = typeof e.stderr === "string" ? e.stderr : e.stderr?.toString("utf-8") ?? "";
    return { ok: false, stdout, stderr, exitCode: e.status ?? 1 };
  }
}

/** Check whether `cwd` is inside a git working tree. */
export function isGitRepo(cwd) {
  const result = runGit(["rev-parse", "--is-inside-work-tree"], cwd);
  return result.ok && result.stdout.trim() === "true";
}

/** Return the current branch name, or null on detached HEAD / failure. */
export function currentBranch(cwd) {
  const result = runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  if (!result.ok) return null;
  const name = result.stdout.trim();
  if (name === "" || name === "HEAD") return null;
  return name;
}

/**
 * Count modified-or-untracked files via `git status --porcelain`. Each
 * non-empty line counts as one entry. Returns -1 on failure.
 */
export function dirtyFileCount(cwd) {
  const result = runGit(["status", "--porcelain"], cwd);
  if (!result.ok) return -1;
  const lines = result.stdout.split(/\r?\n/).filter((l) => l.length > 0);
  return lines.length;
}

/** Names commonly used for protected branches. */
export const PROTECTED_BRANCH_NAMES = Object.freeze(["main", "master"]);

/** Return true if the branch name is one of the protected names. */
export function isProtectedBranch(name) {
  if (typeof name !== "string") return false;
  return PROTECTED_BRANCH_NAMES.includes(name);
}
