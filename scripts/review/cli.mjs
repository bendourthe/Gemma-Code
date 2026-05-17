#!/usr/bin/env node
// v0.9.0 Phase 5 sub-task 5.4 -- `npm run review` PR-lifecycle CLI.
//
// Overlap note (explicitly tracked per plan): this CLI is the imperative,
// per-step cousin of the autonomous `/ship-and-babysit` slash command
// (Phase 3.3). If usage converges on one of the two surfaces, the other
// should fold. Until then, the differences are:
//
//   - `/ship-and-babysit` runs sync -> push -> open PR -> poll CI in an
//     autonomous loop with a hard 12-tick cap.
//   - `npm run review <step>` lets a human drive each step (sync, review,
//     fix, coverage, merge) explicitly. No polling. No babysitting.
//
// Both surfaces use the same `gh` + `git` operations under the hood; no
// third-party review-as-service is called.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HELP = `gemma-code PR review runner

Usage:
  npm run review <subcmd> <pr-number> [--agent <tool>] [--dry-run] [--squash|--merge|--rebase]

Sub-commands:
  sync <pr>          gh pr checkout + fetch + merge origin/main (refuses on dirty tree).
  review <pr>        Invoke the Phase 3.1-style review (delegate to agent CLI if present).
  fix <pr>           Fetch reviewer comments and hand off to .claude/agents/pr-manager.
  coverage <pr>      Download coverage-diff artifact + suggest tests for uncovered lines.
  merge <pr>         Refuse if gh pr checks shows red/pending; otherwise gh pr merge.

Options:
  --agent <name>     review: claude / codex / cursor binary to spawn (else print prompt).
  --dry-run          Print intended actions without executing them.
  --squash           merge: use --squash (default).
  --merge            merge: use --merge.
  --rebase           merge: use --rebase.

Overlap: see /ship-and-babysit slash command (autonomous loop variant).
`;

const SUB_COMMANDS = new Set(["sync", "review", "fix", "coverage", "merge"]);

export async function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    process.stdout.write(HELP);
    return 0;
  }
  const cmd = args[0];
  const rest = args.slice(1);

  if (!SUB_COMMANDS.has(cmd)) {
    process.stderr.write(`[review] unknown command: ${cmd}\n`);
    process.stderr.write(HELP);
    return 2;
  }

  if (cmd === "sync") {
    const { syncCommand } = await import("./sync.mjs");
    return syncCommand(rest);
  }
  if (cmd === "review") {
    const { reviewCommand } = await import("./review.mjs");
    return reviewCommand(rest);
  }
  if (cmd === "fix") {
    const { fixCommand } = await import("./fix.mjs");
    return fixCommand(rest);
  }
  if (cmd === "coverage") {
    const { coverageCommand } = await import("./coverage.mjs");
    return coverageCommand(rest);
  }
  if (cmd === "merge") {
    const { mergeCommand } = await import("./merge.mjs");
    return mergeCommand(rest);
  }
  return 2;
}

const invokedDirectly = (() => {
  try {
    return resolve(process.argv[1] ?? "") === __filename;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main(process.argv).then((code) => process.exit(code ?? 0));
}
