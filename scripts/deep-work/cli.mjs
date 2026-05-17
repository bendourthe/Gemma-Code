#!/usr/bin/env node
// v0.9.0 Phase 5 sub-task 5.1 -- `npm run deep-work` worktree dispatcher.
//
// Reverse-engineered into pure Node so Windows contributors do not need
// bash. The dispatcher itself is a thin switch over sub-command modules;
// each sibling file under `scripts/deep-work/` owns one verb.
//
// Sub-commands:
//   start <issue>      Create worktree at worktrees/issue-<num>-<slug> and
//                      branch feat/issue-<num>-<slug>; print agent prompt.
//   pick [--first]     List `good first issue` candidates; --first picks
//                      the top entry and dispatches to `start`.
//   continue [issue]   Print the worktree path for an issue (or the first
//                      active deep-work worktree if no issue given).
//   status / list      Tabulate every git worktree with branch / HEAD /
//                      dirty flag.
//   cleanup <issue>    Remove the worktree (refuses on dirty without
//                      --force; refuses without --yes when non-interactive).
//
// `gh` is the only external command beyond `git`; it talks to GitHub for
// the user's own repo (intrinsic data destination, per AGENTS.md MCP-
// Registry Policy). No remote MCP, no third-party PR-as-service.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HELP = `gemma-code deep-work runner

Usage:
  npm run deep-work <command> [args...]

Commands:
  start <issue>              Create worktree + branch + print prompt.
  pick [--first]             List good-first-issue candidates; --first auto-starts.
  continue [issue]           Print the worktree path (cd / open in editor yourself).
  status                     Tabulate all worktrees (branch / HEAD / dirty).
  list                       Alias for status.
  cleanup <issue> [--force] [--yes]
                             Remove the worktree (refuses on dirty without --force).

Options:
  --first                    pick: dispatch directly to start with the top issue.
  --force                    cleanup: remove even if worktree is dirty.
  --yes, -y                  cleanup: skip confirmation in non-interactive contexts.
  -h, --help                 Print this help.

Notes:
  Worktrees live at worktrees/issue-<num>-<slug>/ (gitignored). The branch
  is feat/issue-<num>-<slug>. \`gh\` is the only external CLI invoked beyond
  \`git\`; both talk only to GitHub for the user's own repo.
`;

const SUB_COMMANDS = new Set([
  "start", "pick", "continue", "status", "list", "cleanup",
]);

export async function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    process.stdout.write(HELP);
    return 0;
  }
  const cmd = args[0];
  const rest = args.slice(1);

  if (!SUB_COMMANDS.has(cmd)) {
    process.stderr.write(`[deep-work] unknown command: ${cmd}\n`);
    process.stderr.write(HELP);
    return 2;
  }

  if (cmd === "start") {
    const { startCommand } = await import("./start.mjs");
    return startCommand(rest);
  }
  if (cmd === "pick") {
    const { pickCommand } = await import("./pick.mjs");
    return pickCommand(rest);
  }
  if (cmd === "continue") {
    const { continueCommand } = await import("./continue.mjs");
    return continueCommand(rest);
  }
  if (cmd === "status" || cmd === "list") {
    const { statusCommand } = await import("./status.mjs");
    return statusCommand();
  }
  if (cmd === "cleanup") {
    const { cleanupCommand } = await import("./cleanup.mjs");
    return cleanupCommand(rest);
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
