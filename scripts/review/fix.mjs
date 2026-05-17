// v0.9.0 Phase 5 sub-task 5.4 -- review fix sub-command.
//
// Fetches reviewer comments via `gh api repos/<owner>/<repo>/pulls/<n>/comments`
// (per-comment review threads) plus `gh pr view <n> --json comments` (issue
// comments), then prints a structured summary that the user can hand to the
// 3.2-style `pr-manager` subagent. The script never resolves threads
// itself; that mutation belongs to the subagent (or the imperative `gh
// api graphql` call documented in `.claude/agents/pr-manager.md`).

import { parseReviewArgs, runGh } from "./shared.mjs";

function ghJson(args) {
  const r = runGh(args);
  if (r.status !== 0) {
    throw new Error(`gh ${args.join(" ")} failed:\n${r.stderr || r.stdout}`);
  }
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Error(`gh returned non-JSON output:\n${r.stdout}`);
  }
}

export function summarizeReviewerComments({ reviewComments, issueComments }) {
  const lines = [];
  lines.push(`Review thread comments: ${reviewComments.length}`);
  for (const c of reviewComments) {
    const author = c.user?.login ?? "(unknown)";
    const file = c.path ?? "(general)";
    const line = c.line ?? c.original_line ?? "?";
    const head = (c.body ?? "").split(/\r?\n/, 1)[0] ?? "";
    lines.push(`  - ${author} on ${file}:${line}: ${head.slice(0, 100)}`);
  }
  lines.push("");
  lines.push(`PR issue comments: ${issueComments.length}`);
  for (const c of issueComments) {
    const author = c.author?.login ?? c.user?.login ?? "(unknown)";
    const head = (c.body ?? "").split(/\r?\n/, 1)[0] ?? "";
    lines.push(`  - ${author}: ${head.slice(0, 100)}`);
  }
  lines.push("");
  lines.push("Hand this off to the .claude/agents/pr-manager subagent, which");
  lines.push("will apply in-scope fixes, reply to out-of-scope ones, and");
  lines.push("resolve threads via `gh api graphql resolveReviewThread`.");
  return lines.join("\n") + "\n";
}

export async function fixCommand(rest) {
  const args = parseReviewArgs(rest);
  if (args.prNumber === null) {
    process.stderr.write("[review fix] expected a PR number\n");
    return 2;
  }

  if (args.dryRun) {
    process.stdout.write(`[review fix] (dry-run) would fetch comments for PR #${args.prNumber}\n`);
    return 0;
  }

  let reviewComments;
  try {
    reviewComments = ghJson([
      "api",
      `repos/{owner}/{repo}/pulls/${args.prNumber}/comments`,
    ]);
  } catch (e) {
    process.stderr.write(`[review fix] ${e.message}\n`);
    return 1;
  }

  let issueComments;
  try {
    const view = ghJson([
      "pr",
      "view",
      String(args.prNumber),
      "--json",
      "comments",
    ]);
    issueComments = Array.isArray(view?.comments) ? view.comments : [];
  } catch (e) {
    issueComments = [];
  }

  const summary = summarizeReviewerComments({ reviewComments, issueComments });
  process.stdout.write(summary);
  return 0;
}
