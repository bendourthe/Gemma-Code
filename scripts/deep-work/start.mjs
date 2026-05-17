// v0.9.0 Phase 5 sub-task 5.1 -- deep-work start sub-command.
//
// Creates a worktree at `worktrees/issue-<num>-<slug>` on a fresh branch
// `feat/issue-<num>-<slug>` cut from `origin/main`, then prints (and
// copies if a clipboard tool is present) the agent prompt. The user `cd`s
// into the worktree (or opens it in VS Code) themselves.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  REPO_ROOT,
  ghIssueView,
  deriveBranchName,
  deriveWorktreePath,
  buildDeepWorkPrompt,
  parseFlagArgs,
  runGit,
  tryGit,
} from "./shared.mjs";

function copyToClipboard(text) {
  let cmd, args;
  if (process.platform === "win32") {
    cmd = "clip"; args = [];
  } else if (process.platform === "darwin") {
    cmd = "pbcopy"; args = [];
  } else {
    cmd = "xclip"; args = ["-selection", "clipboard"];
  }
  try {
    const child = spawnSync(cmd, args, {
      input: text,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    return child.status === 0;
  } catch {
    return false;
  }
}

export function ensureWorktreesGitignored() {
  // The Phase 5 step also requires `worktrees/` in .gitignore; the actual
  // .gitignore patch is committed alongside this file (the helper here is a
  // belt-and-braces no-op when invoked, since rewriting .gitignore at start
  // time would be surprising). Kept as an export for symmetry.
}

export async function startCommand(rest) {
  const args = parseFlagArgs(rest);
  const issueArg = args.positional[0];
  if (!issueArg || !/^\d+$/.test(issueArg)) {
    process.stderr.write("[deep-work start] expected an issue number\n");
    return 2;
  }
  const issueNumber = Number.parseInt(issueArg, 10);

  let issue;
  try {
    issue = ghIssueView(issueNumber);
  } catch (e) {
    process.stderr.write(`[deep-work start] ${e.message}\n`);
    return 1;
  }

  const branchName = deriveBranchName(issue.number, issue.title);
  const relPath = deriveWorktreePath(issue.number, issue.title);
  const absPath = resolve(REPO_ROOT, relPath);

  if (existsSync(absPath)) {
    process.stderr.write(`[deep-work start] worktree already exists: ${relPath}\n`);
    process.stderr.write("[deep-work start] use `npm run deep-work continue ${issue}` to print the path again\n".replace("${issue}", String(issueNumber)));
    return 1;
  }

  // Fetch main quietly so the worktree branches off the latest origin/main.
  try {
    runGit(["fetch", "origin", "main"]);
  } catch (e) {
    process.stderr.write(`[deep-work start] ${e.message}\n`);
    return 1;
  }

  // Reuse an existing local branch if present, otherwise cut a fresh one.
  const branchProbe = tryGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branchName}`]);
  let worktreeArgs;
  if (branchProbe.status === 0) {
    worktreeArgs = ["worktree", "add", relPath, branchName];
  } else {
    worktreeArgs = ["worktree", "add", relPath, "-b", branchName, "origin/main"];
  }
  try {
    runGit(worktreeArgs);
  } catch (e) {
    process.stderr.write(`[deep-work start] ${e.message}\n`);
    return 1;
  }

  const prompt = buildDeepWorkPrompt({ issue, worktreePath: relPath, branchName });
  process.stdout.write(`[deep-work start] worktree created at ${relPath}\n`);
  process.stdout.write(`[deep-work start] branch:   ${branchName}\n`);
  process.stdout.write(`[deep-work start] cd into the worktree (or open it in VS Code) to begin.\n`);
  process.stdout.write("\n----- agent prompt -----\n");
  process.stdout.write(prompt);
  process.stdout.write("\n------------------------\n");

  if (copyToClipboard(prompt)) {
    process.stdout.write("[deep-work start] prompt copied to clipboard\n");
  }
  return 0;
}
