// v0.9.0 Phase 5 sub-task 5.1 -- deep-work pick sub-command.
//
// Lists open "good first issue" labelled issues (max 10) via `gh issue list`.
// When `--first` is passed, automatically calls into `startCommand` with the
// top issue number. Otherwise prints a numbered menu and instructs the user
// to re-invoke `npm run deep-work start <num>` -- avoiding an interactive
// `readline` prompt because the surface is hard to test cross-platform.

import { ghIssueList, parseFlagArgs } from "./shared.mjs";
import { startCommand } from "./start.mjs";

export function formatIssueMenu(issues) {
  if (issues.length === 0) {
    return "no open issues labelled `good first issue`.\n";
  }
  const lines = ["Open `good first issue` candidates (max 10):", ""];
  for (let i = 0; i < issues.length; i++) {
    const it = issues[i];
    const labels = Array.isArray(it.labels)
      ? it.labels.map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean).join(", ")
      : "";
    lines.push(`  ${String(i + 1).padStart(2, " ")}. #${it.number}  ${it.title}`);
    if (labels) lines.push(`        labels: ${labels}`);
  }
  lines.push("");
  lines.push("Pick one with: `npm run deep-work start <issue-number>`.");
  lines.push("Use `--first` to auto-start the top entry.");
  return lines.join("\n") + "\n";
}

export async function pickCommand(rest) {
  const args = parseFlagArgs(rest);

  let issues;
  try {
    issues = ghIssueList({ label: "good first issue", state: "open", limit: 10 });
  } catch (e) {
    process.stderr.write(`[deep-work pick] ${e.message}\n`);
    return 1;
  }

  if (args.first) {
    if (issues.length === 0) {
      process.stderr.write("[deep-work pick] no `good first issue` candidates open\n");
      return 1;
    }
    const top = issues[0];
    process.stdout.write(`[deep-work pick] --first selected #${top.number}: ${top.title}\n`);
    return startCommand([String(top.number)]);
  }

  process.stdout.write(formatIssueMenu(issues));
  return 0;
}
