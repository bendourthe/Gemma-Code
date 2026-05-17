// v0.9.0 Phase 5 sub-task 5.4 -- review sync sub-command.
//
// Checks out the PR via `gh pr checkout <pr>`, fetches origin/main, and
// merges main without opening an editor. Refuses if the working tree is
// dirty (a hard refusal -- we do not stash silently because that has
// surprised contributors in the past).

import {
  isWorkingTreeDirty,
  parseReviewArgs,
  runGit,
  runGh,
} from "./shared.mjs";

export async function syncCommand(rest) {
  const args = parseReviewArgs(rest);
  if (args.prNumber === null) {
    process.stderr.write("[review sync] expected a PR number\n");
    return 2;
  }

  if (isWorkingTreeDirty()) {
    process.stderr.write(
      "[review sync] working tree is dirty; commit or stash before syncing\n",
    );
    return 1;
  }

  if (args.dryRun) {
    process.stdout.write(
      `[review sync] (dry-run) would: gh pr checkout ${args.prNumber}, git fetch origin main, git merge --no-edit origin/main\n`,
    );
    return 0;
  }

  const checkout = runGh(["pr", "checkout", String(args.prNumber)]);
  if (checkout.status !== 0) {
    process.stderr.write(`[review sync] gh pr checkout failed:\n${checkout.stderr || checkout.stdout}\n`);
    return 1;
  }

  try {
    runGit(["fetch", "origin", "main"]);
    runGit(["merge", "--no-edit", "origin/main"]);
  } catch (e) {
    process.stderr.write(`[review sync] ${e.message}\n`);
    return 1;
  }
  process.stdout.write(`[review sync] synced PR #${args.prNumber} with origin/main\n`);
  return 0;
}
