import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getLogger } from "../utils/logger.js";

const GIT_TIMEOUT_MS = 20_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

/** Handle to an isolated git worktree owned by the manager. */
export interface WorktreeHandle {
  /** Absolute path to the isolated worktree checkout. */
  readonly path: string;
  /** Sanitized label the worktree was created under (for diagnostics). */
  readonly label: string;
}

/**
 * Runs a single git subcommand in `cwd` and resolves stdout on success
 * (exit 0) or null on any failure. Mirrors the fault-tolerant contract of
 * `GitSafetyNet._git`: errors are swallowed and surfaced as null so a missing
 * git binary or a non-repo working directory never throws into the agent
 * dispatch path. Injectable so unit tests can drive the lifecycle logic
 * without a real repository.
 */
export type GitRunner = (args: readonly string[], cwd: string) => Promise<string | null>;

function defaultGitRunner(args: readonly string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args as string[],
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER },
      (error, stdout) => {
        if (error) {
          getLogger().debug(`[WorktreeManager] git ${args[0]} failed:`, error.message);
          resolve(null);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/**
 * v1.4.0 Phase 6 (A10, re-partial) -- optional git-worktree isolation for
 * concurrently-dispatched sub-agents.
 *
 * Each isolated sub-agent runs its file-mutating tool calls (`run_terminal` is
 * the sole mutation surface across every sub-agent tool scope -- see ADR-0004:
 * verification / research / planning all lack write_file / edit_file /
 * create_file / delete_file) inside a dedicated detached worktree checked out
 * from HEAD. Two parallel write-capable sub-agents therefore mutate two
 * distinct working trees and cannot collide on the shared workspace.
 *
 * Lifecycle: `create()` adds a detached worktree; `cleanupIfUnchanged()`
 * removes it on completion only when it is left clean. A worktree the sub-agent
 * modified is retained so its work is available for inspection or merge.
 *
 * Fault-tolerant by contract (mirrors `GitSafetyNet`): every operation resolves
 * to null/false rather than throwing, so a non-git or git-less environment
 * simply disables isolation instead of breaking dispatch. The full
 * Breezing-style Planner/Critic/Worker team-orchestration layer is deferred.
 */
export class WorktreeManager {
  private _counter = 0;

  constructor(
    private readonly _workspaceRoot: string,
    private readonly _git: GitRunner = defaultGitRunner,
    private readonly _baseDir: string = path.join(os.tmpdir(), "nexus-worktrees"),
  ) {}

  /** True when the workspace root is inside a git work tree. */
  async isAvailable(): Promise<boolean> {
    const out = await this._git(["rev-parse", "--is-inside-work-tree"], this._workspaceRoot);
    return out !== null && out.trim() === "true";
  }

  /**
   * Create a detached worktree checked out from HEAD under the base directory.
   * The directory name is unique per process + manager instance so two
   * concurrent `create()` calls never target the same path. Returns a handle,
   * or null if the worktree could not be created (not a repo, git unavailable,
   * disk error).
   */
  async create(label: string): Promise<WorktreeHandle | null> {
    const safe = label.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "agent";
    const dir = path.join(this._baseDir, `${safe}-${process.pid}-${++this._counter}`);

    try {
      fs.mkdirSync(this._baseDir, { recursive: true });
    } catch (err) {
      getLogger().debug(`[WorktreeManager] mkdir base failed:`, (err as Error).message);
      return null;
    }

    const added = await this._git(
      ["worktree", "add", "--detach", dir, "HEAD"],
      this._workspaceRoot,
    );
    if (added === null) return null;
    return { path: dir, label: safe };
  }

  /**
   * Remove the worktree if and only if it is unchanged (a clean
   * `git status --porcelain`). Returns true when the worktree was removed,
   * false when it was retained -- because it was modified, or because the
   * status / remove command failed. A retained worktree preserves the
   * sub-agent's work; the caller decides what to do with it.
   */
  async cleanupIfUnchanged(handle: WorktreeHandle): Promise<boolean> {
    const status = await this._git(["status", "--porcelain"], handle.path);
    if (status === null) return false;
    if (status.trim().length > 0) return false;
    const removed = await this._git(
      ["worktree", "remove", "--force", handle.path],
      this._workspaceRoot,
    );
    return removed !== null;
  }
}
