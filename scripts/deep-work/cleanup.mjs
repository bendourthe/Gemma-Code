// v0.9.0 Phase 5 sub-task 5.1 -- deep-work cleanup sub-command.
//
// Removes a worktree by issue number. Refuses if the working tree has
// uncommitted changes unless `--force` is passed. Refuses without `--yes`
// unless STDIN is interactive; in non-TTY contexts we require `--yes` so
// CI accidents do not silently delete in-flight work.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  REPO_ROOT,
  deriveWorktreePath,
  ghIssueView,
  gitWorktrees,
  isWorktreeDirty,
  parseFlagArgs,
  runGit,
} from "./shared.mjs";

function findWorktreeForIssue(issueNumber) {
  // Try title-driven path first.
  try {
    const issue = ghIssueView(issueNumber);
    const relPath = deriveWorktreePath(issueNumber, issue.title);
    const absPath = resolve(REPO_ROOT, relPath);
    if (existsSync(absPath)) {
      return { path: absPath, rel: relPath, source: "title" };
    }
  } catch {
    // ignore
  }
  // Fall back: scan `git worktree list` for a path containing the issue tag.
  const trees = gitWorktrees();
  const tag = `issue-${issueNumber}-`;
  const match = trees.find((t) => (t.path ?? "").includes(tag));
  if (match) {
    return { path: match.path, rel: match.path, source: "list" };
  }
  return null;
}

export async function cleanupCommand(rest) {
  const args = parseFlagArgs(rest);
  const issueArg = args.positional[0];
  if (!issueArg || !/^\d+$/.test(issueArg)) {
    process.stderr.write("[deep-work cleanup] expected an issue number\n");
    return 2;
  }
  const issueNumber = Number.parseInt(issueArg, 10);

  const target = findWorktreeForIssue(issueNumber);
  if (!target) {
    process.stderr.write(`[deep-work cleanup] no worktree found for #${issueNumber}\n`);
    return 1;
  }

  const dirty = isWorktreeDirty(target.path);
  if (dirty && !args.force) {
    process.stderr.write(
      `[deep-work cleanup] worktree has uncommitted changes: ${target.rel}\n` +
      "[deep-work cleanup] re-run with --force to remove anyway\n",
    );
    return 1;
  }

  // Non-interactive contexts must pass --yes (or --force) to confirm.
  const interactive = Boolean(process.stdin && process.stdin.isTTY);
  if (!args.yes && !args.force && !interactive) {
    process.stderr.write(
      `[deep-work cleanup] about to remove ${target.rel}; pass --yes to confirm\n`,
    );
    return 1;
  }

  const removeArgs = args.force
    ? ["worktree", "remove", "--force", target.path]
    : ["worktree", "remove", target.path];
  try {
    runGit(removeArgs);
  } catch (e) {
    process.stderr.write(`[deep-work cleanup] ${e.message}\n`);
    return 1;
  }
  process.stdout.write(`[deep-work cleanup] removed ${target.rel}\n`);
  return 0;
}
