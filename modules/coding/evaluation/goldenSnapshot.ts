// ---------------------------------------------------------------------------
// v1.7.0 Phase 1 (adoption-self-optimizing-skills S1 / SO001) -- worktree-
// isolated materialization of a golden-task snapshot.
//
// TS-native port of `tests/golden/framework/snapshot.py` (`prepare_worktree` +
// `init_git_repo`). Each golden snapshot under `tests/golden/snapshots/<id>/`
// is a self-contained mini-project (NOT a committed nested git repo, so the
// v1.5.0 `WorktreeManager`'s `git worktree add HEAD` model does not apply
// here). The faithful isolation primitive is therefore: copy the snapshot into
// a throwaway temp directory and `git init` a fresh baseline so the agent
// mutates an isolated tree and `diff_matches` / `git diff` criteria have a
// clean reference point. The source snapshot is never mutated.
//
// Boundary: vscode-free. The git invocations go through an injected `GitRunner`
// (mirroring `WorktreeManager`'s fault-tolerant contract) so tests can drive
// the lifecycle without a real git binary, and a git-less environment simply
// skips repo initialization rather than throwing.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** A materialized, isolated copy of a golden-task snapshot. */
export interface SnapshotWorkspace {
  /** Absolute path to the throwaway working copy. */
  readonly path: string;
  /** The task id the workspace was materialized for. */
  readonly taskId: string;
  /** True when a fresh git baseline was initialized in the copy. */
  readonly gitInitialized: boolean;
}

/**
 * Runs a single git subcommand in `cwd`, resolving stdout on success (exit 0)
 * or null on any failure. Mirrors `WorktreeManager.GitRunner`: errors are
 * swallowed so a missing git binary never throws into snapshot setup.
 */
export type GitRunner = (args: readonly string[], cwd: string) => string | null;

const GIT_TIMEOUT_MS = 20_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

/** Directory basenames never copied into a snapshot working tree. */
const IGNORED_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".worktrees",
  "__pycache__",
  ".git",
]);

export function defaultGitRunner(args: readonly string[], cwd: string): string | null {
  const result = spawnSync("git", args as string[], {
    cwd,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  });
  if (result.error !== undefined || result.status !== 0) return null;
  return result.stdout ?? "";
}

export interface MaterializeOptions {
  /** Parent directory for the throwaway copy. Default: the OS temp dir. */
  readonly baseDir?: string;
  /** Initialize a fresh git baseline in the copy. Default: true. */
  readonly initGit?: boolean;
  /** Injected git runner (default shells out to a local git). */
  readonly gitRunner?: GitRunner;
}

function sanitizeLabel(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "task";
}

/**
 * Copy a golden snapshot into a fresh isolated working directory and
 * (optionally) initialize a clean git baseline. The caller owns the returned
 * workspace and MUST call {@link cleanupGoldenSnapshot} when done.
 *
 * @throws if `snapshotDir` is not an existing directory.
 */
export function materializeGoldenSnapshot(
  snapshotDir: string,
  taskId: string,
  options: MaterializeOptions = {},
): SnapshotWorkspace {
  if (!fs.existsSync(snapshotDir) || !fs.statSync(snapshotDir).isDirectory()) {
    throw new Error(`Golden snapshot not found: ${snapshotDir}`);
  }

  const baseDir = options.baseDir ?? os.tmpdir();
  fs.mkdirSync(baseDir, { recursive: true });
  const dest = fs.mkdtempSync(path.join(baseDir, `golden-${sanitizeLabel(taskId)}-`));

  // Copy the snapshot, skipping vendored / ephemeral / VCS directories. The
  // `filter` is called for every entry; returning false prunes the subtree.
  fs.cpSync(snapshotDir, dest, {
    recursive: true,
    filter: (src) => !IGNORED_DIRS.has(path.basename(src)),
  });

  const initGit = options.initGit ?? true;
  let gitInitialized = false;
  if (initGit) {
    gitInitialized = initGitBaseline(dest, options.gitRunner ?? defaultGitRunner);
  }

  return { path: dest, taskId, gitInitialized };
}

/**
 * Initialize a fresh git repo at `dir` with one baseline commit so `git diff`
 * criteria have a clean reference. Returns true on success; tolerates a
 * git-less environment (returns false without throwing). Uses a local identity
 * so the commit works in CI without global git config.
 */
function initGitBaseline(dir: string, git: GitRunner): boolean {
  if (git(["init", "-q"], dir) === null) return false;
  // Identity is best-effort; failures here do not abort the baseline.
  git(["config", "user.email", "golden-tasks@nexus.local"], dir);
  git(["config", "user.name", "Golden Tasks"], dir);
  if (git(["add", "-A"], dir) === null) return false;
  if (git(["commit", "-q", "-m", "golden snapshot baseline"], dir) === null) return false;
  return true;
}

/** Remove a materialized workspace. Safe to call on a missing path. */
export function cleanupGoldenSnapshot(workspace: SnapshotWorkspace): void {
  fs.rmSync(workspace.path, { recursive: true, force: true });
}
