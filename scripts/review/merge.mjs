// v0.9.0 Phase 5 sub-task 5.4 -- review merge sub-command.
//
// Refuses to merge if `gh pr checks` shows any failing or in-progress check
// (the `gh pr merge` command itself enforces required-status policies, but
// this script's job is to be conservatively stricter than GitHub's gate).
// Default merge mode is `--squash`; `--merge` and `--rebase` are accepted.

import {
  parseGhPrChecks,
  parseReviewArgs,
  runGh,
  runGit,
  summarizeChecks,
} from "./shared.mjs";

export function checksAreGreen(rows) {
  const { failing, pending } = summarizeChecks(rows);
  return failing.length === 0 && pending.length === 0;
}

export async function mergeCommand(rest) {
  const args = parseReviewArgs(rest);
  if (args.prNumber === null) {
    process.stderr.write("[review merge] expected a PR number\n");
    return 2;
  }

  if (args.dryRun) {
    process.stdout.write(`[review merge] (dry-run) would check + merge PR #${args.prNumber} via --${args.mergeMode ?? "squash"}\n`);
    return 0;
  }

  const checks = runGh(["pr", "checks", String(args.prNumber)]);
  if (checks.status !== 0) {
    process.stderr.write(`[review merge] gh pr checks failed:\n${checks.stderr || checks.stdout}\n`);
    return 1;
  }
  const rows = parseGhPrChecks(checks.stdout);
  const { failing, pending } = summarizeChecks(rows);
  if (failing.length > 0 || pending.length > 0) {
    process.stderr.write(
      `[review merge] refusing: ${failing.length} failing, ${pending.length} pending check(s)\n`,
    );
    for (const r of [...failing, ...pending]) {
      process.stderr.write(`  - ${r.raw}\n`);
    }
    return 1;
  }

  const mode = args.mergeMode ?? "squash";
  const flag = `--${mode}`;
  const m = runGh(["pr", "merge", String(args.prNumber), flag]);
  if (m.status !== 0) {
    process.stderr.write(`[review merge] gh pr merge failed:\n${m.stderr || m.stdout}\n`);
    return 1;
  }
  process.stdout.write(`[review merge] PR #${args.prNumber} merged (${mode})\n`);

  // Post-merge cleanup: checkout main, pull, delete head branch (locally + on
  // remote). We do not fail the command if cleanup encounters a non-zero exit
  // because the merge itself has already landed.
  try {
    runGit(["checkout", "main"]);
    runGit(["pull", "--ff-only"]);
  } catch (e) {
    process.stderr.write(`[review merge] post-merge checkout/pull warning: ${e.message}\n`);
  }
  return 0;
}
