// v0.9.0 Phase 5 sub-task 5.4 -- review review sub-command.
//
// Invokes the Phase 3.1-style review against a PR. If the configured agent
// CLI (claude / codex / cursor) is present on PATH, the script pipes the
// review prompt to it via stdin; otherwise it prints the prompt to stdout
// so the user can paste it into their agent of choice.

import { spawn, spawnSync } from "node:child_process";
import { parseReviewArgs, runGh } from "./shared.mjs";

const REVIEW_PROMPT_TEMPLATE = `Please run the gemma-code \`review-pr\` SKILL against PR #__PR__.

Steps:
  1. Read .claude/skills/review-pr/SKILL.md for the walkthrough + per-file
     analysis + severity-x-confidence rubric.
  2. \`gh pr view __PR__\` for the summary; \`gh pr diff __PR__\` for changes.
  3. Produce a structured review (Summary / Per-file findings /
     Severity-x-confidence table / Recommended actions).
  4. Do NOT call any third-party review-as-service. The review is the
     agent's own analysis, run locally.

Output: paste the review back into the PR as a comment.
`;

function commandExists(binary) {
  const which = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(which, [binary], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return r.status === 0;
}

export async function reviewCommand(rest) {
  const args = parseReviewArgs(rest);
  if (args.prNumber === null) {
    process.stderr.write("[review review] expected a PR number\n");
    return 2;
  }

  // Sanity-check the PR exists.
  const probe = runGh(["pr", "view", String(args.prNumber), "--json", "number"]);
  if (probe.status !== 0) {
    process.stderr.write(`[review review] gh pr view failed:\n${probe.stderr || probe.stdout}\n`);
    return 1;
  }

  const prompt = REVIEW_PROMPT_TEMPLATE.replaceAll("__PR__", String(args.prNumber));

  if (args.dryRun) {
    process.stdout.write("[review review] (dry-run) prompt:\n");
    process.stdout.write(prompt);
    return 0;
  }

  const agent = args.agent;
  if (agent && commandExists(agent)) {
    process.stdout.write(`[review review] dispatching to \`${agent}\` ...\n`);
    return new Promise((res) => {
      const child = spawn(agent, [], {
        stdio: ["pipe", "inherit", "inherit"],
        shell: process.platform === "win32",
      });
      child.stdin.write(prompt);
      child.stdin.end();
      child.on("exit", (code) => res(code ?? 1));
      child.on("error", () => res(1));
    });
  }

  process.stdout.write("[review review] no agent CLI configured / installed; prompt follows:\n");
  process.stdout.write(prompt);
  return 0;
}
