#!/usr/bin/env node
/**
 * SessionStart hook: gate agent sessions on the git control-plane state.
 * Refuses to start a session if:
 *   - The current branch is `main` or `master` (protected branches).
 *   - The working tree has more than `GEMMA_HOOK_DIRTY_LIMIT` modified or
 *     untracked files (default 50).
 *
 * Exit codes:
 *   0  - allowed
 *   2  - blocked (with `BLOCKED: <reason>` on stderr)
 *
 * Workspace-not-a-git-repo is a no-op (exit 0 with a single stderr warning).
 *
 * Budget: < 50 ms p99. `git rev-parse` and `git status --porcelain` are both
 * sub-10 ms on a sane repo.
 */

import {
  isGitRepo,
  currentBranch,
  dirtyFileCount,
  isProtectedBranch,
  PROTECTED_BRANCH_NAMES,
} from "./lib/git-control.mjs";

const WORKSPACE_ROOT = process.env["GEMMA_HOOK_WORKSPACE_ROOT"] ?? process.cwd();
const DIRTY_LIMIT = (() => {
  const raw = process.env["GEMMA_HOOK_DIRTY_LIMIT"];
  if (raw === undefined) return 50;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 50;
})();

function block(reason) {
  process.stderr.write(`BLOCKED: ${reason}\n`);
  process.exit(2);
}

function warn(message) {
  process.stderr.write(`WARN: ${message}\n`);
}

function main() {
  // Drain stdin best-effort but do not require any specific payload shape.
  // SessionStart events are informational; the hook decides purely from
  // local git state.

  if (!isGitRepo(WORKSPACE_ROOT)) {
    warn("workspace is not a git repository; skipping git control-plane check");
    process.exit(0);
    return;
  }

  const branch = currentBranch(WORKSPACE_ROOT);
  if (branch !== null && isProtectedBranch(branch)) {
    block(
      `agent session may not start on a protected branch ` +
        `(current: ${branch}, protected: ${PROTECTED_BRANCH_NAMES.join(", ")}); ` +
        `checkout a feature branch first`,
    );
  }

  const dirty = dirtyFileCount(WORKSPACE_ROOT);
  if (dirty < 0) {
    warn("git status failed; skipping dirty-file check");
  } else if (dirty > DIRTY_LIMIT) {
    block(
      `working tree has ${dirty} modified-or-untracked files ` +
        `(limit: ${DIRTY_LIMIT}); blast radius too large for a fresh session. ` +
        `Commit or stash first, or override with GEMMA_HOOK_DIRTY_LIMIT=N`,
    );
  }

  process.exit(0);
}

main();
