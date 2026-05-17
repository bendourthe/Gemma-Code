#!/usr/bin/env node
// v0.9.0 Phase 5 sub-task 5.3 -- `npm run agent-batch` multi-agent dispatcher.
//
// Cross-platform port. Sub-commands:
//
//   validate <spec>   Run the JSON spec through the Zod schema.
//   overlap  <spec>   Detect duplicate issues, missing deps, and cycles.
//   launch   <spec>   Print the dispatch table (dry-run); pass --apply to
//                     actually create worktrees via scripts/deep-work/start.
//   status   <spec>   Tabulate per-task status by inspecting local worktrees.
//
// Spec schema (full source in `schema.mjs`):
//
//   {
//     "batchId": "<id>",
//     "tasks": [
//       { "issue": 1, "agent": "claude" | "codex" | "cursor",
//         "extraPrompt"?: "...", "dependsOn"?: [<issue>, ...] }
//     ]
//   }
//
// The launch command never starts third-party services -- it only invokes
// `scripts/deep-work/start.mjs` (which uses `git` + `gh`). The status
// command inspects the local repository only; no network calls.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HELP = `gemma-code agent-batch runner

Usage:
  npm run agent-batch <command> <spec.json> [options]

Commands:
  validate <spec.json>         Run the spec through the Zod schema.
  overlap  <spec.json>         Detect duplicate issues / missing deps / cycles.
  launch   <spec.json> [--apply]
                               Dry-run dispatch table (default). With --apply,
                               creates worktrees via deep-work/start.
  status   <spec.json>         Report per-task status from local worktrees.

Spec shape (Zod-validated):
  {
    "batchId": "<id>",
    "tasks": [
      { "issue": 1, "agent": "claude" | "codex" | "cursor",
        "extraPrompt"?: "...", "dependsOn"?: [<issue>, ...] }
    ]
  }

Example: see examples/agent-batch.spec.json.
`;

const SUB_COMMANDS = new Set(["validate", "overlap", "launch", "status"]);

export async function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    process.stdout.write(HELP);
    return 0;
  }
  const cmd = args[0];
  const rest = args.slice(1);

  if (!SUB_COMMANDS.has(cmd)) {
    process.stderr.write(`[agent-batch] unknown command: ${cmd}\n`);
    process.stderr.write(HELP);
    return 2;
  }

  if (cmd === "validate") {
    const { validateCommand } = await import("./validate.mjs");
    return validateCommand(rest);
  }
  if (cmd === "overlap") {
    const { overlapCommand } = await import("./overlap.mjs");
    return overlapCommand(rest);
  }
  if (cmd === "launch") {
    const { launchCommand } = await import("./launch.mjs");
    return launchCommand(rest);
  }
  if (cmd === "status") {
    const { statusCommand } = await import("./status.mjs");
    return statusCommand(rest);
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
