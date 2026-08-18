/**
 * v1.18.0 Phase 4 (OW-A2) -- vscode-free GitSafetyNet checkpoint for scheduled
 * runs. GitSafetyNet itself imports the vscode OutputChannel logger, which
 * the sidecar bundle cannot load. Semantics match createCheckpoint: record
 * HEAD, stash a dirty tree, never throw.
 */

import { execFile } from "node:child_process";

export interface ScheduledGitCheckpoint {
  readonly headSha: string;
  readonly stashCreated: boolean;
  readonly timestamp: number;
}

const GIT_TIMEOUT_MS = 10_000;

function git(cwd: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", [...args], { cwd, timeout: GIT_TIMEOUT_MS }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Pre-run checkpoint equivalent to GitSafetyNet.createCheckpoint. Returns
 * null when the workspace is not a git repo or git fails.
 */
export async function createScheduledGitCheckpoint(
  workspaceRoot: string,
  message = "[nexus] auto-stash before scheduled agent run",
): Promise<ScheduledGitCheckpoint | null> {
  const inside = await git(workspaceRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (inside === null || inside.trim() !== "true") return null;

  const headSha = await git(workspaceRoot, ["rev-parse", "HEAD"]);
  if (headSha === null) return null;

  const status = await git(workspaceRoot, ["status", "--porcelain"]);
  let stashCreated = false;
  if (status !== null && status.trim().length > 0) {
    const stashResult = await git(workspaceRoot, ["stash", "push", "-m", message]);
    stashCreated = stashResult !== null && !stashResult.includes("No local changes");
  }

  return {
    headSha: headSha.trim(),
    stashCreated,
    timestamp: Date.now(),
  };
}
