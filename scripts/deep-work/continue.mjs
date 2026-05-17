// v0.9.0 Phase 5 sub-task 5.1 -- deep-work continue sub-command.
//
// Prints the worktree path for an existing issue. The caller `cd`s into it
// (or opens it in VS Code) themselves -- this script intentionally does
// NOT spawn a shell or editor.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  REPO_ROOT,
  deriveWorktreePath,
  ghIssueView,
  gitWorktrees,
  parseFlagArgs,
} from "./shared.mjs";

export async function continueCommand(rest) {
  const args = parseFlagArgs(rest);
  const issueArg = args.positional[0];

  // No issue number: print the first non-primary worktree we find under
  // worktrees/ so `deep-work continue` works as an interactive recall too.
  if (!issueArg) {
    let trees;
    try {
      trees = gitWorktrees();
    } catch (e) {
      process.stderr.write(`[deep-work continue] ${e.message}\n`);
      return 1;
    }
    const match = trees.find((t) => (t.path ?? "").includes("worktrees"));
    if (!match) {
      process.stderr.write("[deep-work continue] no deep-work worktrees found\n");
      return 1;
    }
    process.stdout.write(`${match.path}\n`);
    return 0;
  }

  if (!/^\d+$/.test(issueArg)) {
    process.stderr.write("[deep-work continue] expected an issue number\n");
    return 2;
  }
  const issueNumber = Number.parseInt(issueArg, 10);

  // Try title-driven path derivation first (no gh call required when the
  // worktree exists on disk under a guess-derived path).
  try {
    const issue = ghIssueView(issueNumber);
    const relPath = deriveWorktreePath(issueNumber, issue.title);
    const absPath = resolve(REPO_ROOT, relPath);
    if (existsSync(absPath)) {
      process.stdout.write(`${relPath}\n`);
      return 0;
    }
  } catch {
    // fall through to worktree-list scan
  }

  let trees;
  try {
    trees = gitWorktrees();
  } catch (e) {
    process.stderr.write(`[deep-work continue] ${e.message}\n`);
    return 1;
  }
  const tag = `issue-${issueNumber}-`;
  const match = trees.find((t) => (t.path ?? "").includes(tag));
  if (!match) {
    process.stderr.write(`[deep-work continue] no worktree for issue #${issueNumber}\n`);
    return 1;
  }
  process.stdout.write(`${match.path}\n`);
  return 0;
}
