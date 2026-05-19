import { execFile } from "child_process";
import { getLogger } from "../../modules/coding/utils/logger.js";

export interface GitCheckpoint {
  readonly headSha: string;
  readonly stashCreated: boolean;
  readonly timestamp: number;
}

const GIT_TIMEOUT_MS = 10_000;

/**
 * Git-based safety net that creates checkpoints before agent runs and
 * can roll back changes if needed. All operations are fault-tolerant:
 * errors are caught and logged, never thrown.
 */
export class GitSafetyNet {
  constructor(private readonly _workspaceRoot: string) {}

  /** Check whether the workspace is inside a git repository. */
  async isGitRepo(): Promise<boolean> {
    const result = await this._git(["rev-parse", "--is-inside-work-tree"]);
    return result !== null && result.trim() === "true";
  }

  /**
   * Create a pre-run checkpoint by recording the current HEAD SHA and
   * optionally stashing uncommitted changes.
   * Returns null if the workspace is not a git repo.
   */
  async createCheckpoint(message?: string): Promise<GitCheckpoint | null> {
    if (!(await this.isGitRepo())) return null;

    const headSha = await this._git(["rev-parse", "HEAD"]);
    if (headSha === null) return null;

    // Check for dirty working tree.
    const status = await this._git(["status", "--porcelain"]);
    let stashCreated = false;

    if (status !== null && status.trim().length > 0) {
      const stashMsg = message ?? "[gemma-code] auto-stash before agent run";
      const stashResult = await this._git(["stash", "push", "-m", stashMsg]);
      stashCreated = stashResult !== null && !stashResult.includes("No local changes");
    }

    return {
      headSha: headSha.trim(),
      stashCreated,
      timestamp: Date.now(),
    };
  }

  /**
   * Commit agent-modified files with a [gemma-code] prefixed message.
   * Returns the new commit SHA, or null on failure.
   */
  async commitAgentChanges(files: readonly string[], message: string): Promise<string | null> {
    if (files.length === 0) return null;

    const addResult = await this._git(["add", "--", ...files]);
    if (addResult === null) return null;

    // Check if there is anything staged to commit.
    const diff = await this._git(["diff", "--cached", "--quiet"]);
    // git diff --quiet exits 1 if there are differences (staged changes exist).
    // Our _git helper returns null on non-zero exit, so null means changes exist.
    if (diff !== null) return null; // nothing staged

    const commitResult = await this._git([
      "commit",
      "-m",
      `[gemma-code] ${message}`,
      "--no-verify",
    ]);
    if (commitResult === null) return null;

    const sha = await this._git(["rev-parse", "HEAD"]);
    return sha?.trim() ?? null;
  }

  /**
   * Roll back to a previously created checkpoint.
   * Performs a hard reset to the checkpoint SHA and pops the stash if one was created.
   */
  async rollback(checkpoint: GitCheckpoint): Promise<boolean> {
    const resetResult = await this._git(["reset", "--hard", checkpoint.headSha]);
    if (resetResult === null) return false;

    if (checkpoint.stashCreated) {
      await this._git(["stash", "pop"]);
    }

    return true;
  }

  /**
   * Run a git command in the workspace directory.
   * Returns stdout on success (exit 0), null on any failure.
   */
  private _git(args: readonly string[]): Promise<string | null> {
    return new Promise((resolve) => {
      execFile(
        "git",
        args as string[],
        { cwd: this._workspaceRoot, timeout: GIT_TIMEOUT_MS },
        (error, stdout) => {
          if (error) {
            getLogger().debug(`[GitSafetyNet] git ${args[0]} failed:`, error.message);
            resolve(null);
            return;
          }
          resolve(stdout);
        },
      );
    });
  }
}
