#!/usr/bin/env node
/**
 * SessionStart hook: gate agent sessions on the git control-plane state.
 * Refuses to start a session if:
 *   - The current branch is `main` or `master` (protected branches).
 *   - The working tree has more than `GEMMA_HOOK_DIRTY_LIMIT` modified or
 *     untracked files (default 50).
 *
 * v0.8.0 Phase 5 sub-task 5.6 (item G6) -- this hook also speaks the new
 * stdin-JSON / stdout-decision protocol. When stdin contains a JSON payload
 * with an `"event"` field, the hook writes `{"decision":"allow"|"block",...}`
 * to stdout and exits 0; otherwise it falls back to the legacy exit-code
 * contract (0 = allow, 2 = block).
 *
 * Workspace-not-a-git-repo is a no-op (exit 0 with a single stderr warning).
 *
 * Budget: < 50 ms p99. `git rev-parse` and `git status --porcelain` are both
 * sub-10 ms on a sane repo.
 */

import { readFileSync } from "node:fs";
import {
  isGitRepo,
  currentBranch,
  dirtyFileCount,
  isProtectedBranch,
  PROTECTED_BRANCH_NAMES,
} from "./lib/git-control.mjs";

function readStdinSync() {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

function detectProtocol(raw) {
  if (!raw || raw.trim() === "") return "exit-code";
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && typeof obj["event"] === "string") {
      return "stdin-decision";
    }
  } catch {
    // not JSON - legacy
  }
  return "exit-code";
}

let _protocol = "exit-code";

const WORKSPACE_ROOT = process.env["GEMMA_HOOK_WORKSPACE_ROOT"] ?? process.cwd();
const DIRTY_LIMIT = (() => {
  const raw = process.env["GEMMA_HOOK_DIRTY_LIMIT"];
  if (raw === undefined) return 50;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 50;
})();

function block(reason) {
  if (_protocol === "stdin-decision") {
    process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
    process.exit(0);
  }
  process.stderr.write(`BLOCKED: ${reason}\n`);
  process.exit(2);
}

function allow() {
  if (_protocol === "stdin-decision") {
    process.stdout.write(`${JSON.stringify({ decision: "allow" })}\n`);
  }
  process.exit(0);
}

function warn(message) {
  process.stderr.write(`WARN: ${message}\n`);
}

function main() {
  // Drain stdin and detect the protocol. SessionStart events under the new
  // protocol still don't carry any data we need to consult; we just record
  // which response format the harness expects.
  const raw = readStdinSync();
  _protocol = detectProtocol(raw);

  if (!isGitRepo(WORKSPACE_ROOT)) {
    warn("workspace is not a git repository; skipping git control-plane check");
    allow();
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

  allow();
}

main();
