// v0.9.0 Phase 5 sub-task 5.1 -- deep-work status / list sub-command.
//
// Lists all git worktrees rooted at the repository, including the primary
// checkout, with branch / HEAD / dirty flags. Reads `git worktree list
// --porcelain`; the parser lives in `shared.mjs` so tests do not need a
// real git repo.

import { existsSync } from "node:fs";
import { gitWorktrees, isWorktreeDirty } from "./shared.mjs";

export function formatWorktreeTable(rows) {
  if (rows.length === 0) return "no worktrees.\n";
  const header = ["path", "branch", "head", "dirty"];
  const data = rows.map((r) => [
    r.path ?? "",
    r.branch ? r.branch.replace(/^refs\/heads\//, "") : (r.detached ? "(detached)" : ""),
    (r.head ?? "").slice(0, 7),
    r.dirty ? "yes" : "no",
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...data.map((row) => String(row[i]).length)),
  );
  const fmt = (cells) =>
    cells.map((c, i) => String(c).padEnd(widths[i], " ")).join("  ");
  const lines = [fmt(header), fmt(widths.map((w) => "-".repeat(w)))];
  for (const row of data) lines.push(fmt(row));
  return lines.join("\n") + "\n";
}

export async function statusCommand() {
  let worktrees;
  try {
    worktrees = gitWorktrees();
  } catch (e) {
    process.stderr.write(`[deep-work status] ${e.message}\n`);
    return 1;
  }
  const enriched = worktrees.map((w) => ({
    ...w,
    dirty: w.path && existsSync(w.path) ? isWorktreeDirty(w.path) : false,
  }));
  process.stdout.write(formatWorktreeTable(enriched));
  return 0;
}
