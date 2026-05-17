// v0.9.0 Phase 5 sub-task 5.3 -- agent-batch launch sub-command.
//
// Topological-sorts the tasks by `dependsOn`, then dispatches each "ready"
// task via `scripts/deep-work/start.mjs` (worktree + branch + prompt). The
// actual agent spawn is delegated to the user: this command only prepares
// the worktree environment and prints what each task is responsible for.
//
// Defaults to dry-run: tasks are listed without creating worktrees. Pass
// `--apply` to actually call `startCommand`. The default keeps `npm test`
// safe to invoke without side effects.

import { resolve } from "node:path";
import { existsSync, readdirSync } from "node:fs";

import { safeParseSpec } from "./schema.mjs";
import { loadSpecFile } from "./validate.mjs";
import { analyzeOverlap } from "./overlap.mjs";

export function topologicalOrder(tasks) {
  const indegree = new Map();
  const adj = new Map();
  for (const t of tasks) {
    indegree.set(t.issue, 0);
    adj.set(t.issue, []);
  }
  for (const t of tasks) {
    for (const dep of t.dependsOn ?? []) {
      if (adj.has(dep)) {
        adj.get(dep).push(t.issue);
        indegree.set(t.issue, (indegree.get(t.issue) ?? 0) + 1);
      }
    }
  }
  const queue = [];
  for (const [issue, deg] of indegree) {
    if (deg === 0) queue.push(issue);
  }
  queue.sort((a, b) => a - b);
  const order = [];
  while (queue.length > 0) {
    const node = queue.shift();
    order.push(node);
    for (const next of adj.get(node) ?? []) {
      const nextDeg = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextDeg);
      if (nextDeg === 0) {
        // insert keeping sorted
        let i = 0;
        while (i < queue.length && queue[i] < next) i++;
        queue.splice(i, 0, next);
      }
    }
  }
  return order;
}

export function buildDispatchTable(spec) {
  const order = topologicalOrder(spec.tasks);
  const byIssue = new Map(spec.tasks.map((t) => [t.issue, t]));
  return order
    .map((iss) => byIssue.get(iss))
    .filter(Boolean);
}

export function formatDispatchTable(spec, rows) {
  const header = ["batchId", "issue", "agent", "dependsOn", "extraPrompt"];
  const data = rows.map((t) => [
    spec.batchId,
    `#${t.issue}`,
    t.agent,
    (t.dependsOn ?? []).map((n) => `#${n}`).join(",") || "-",
    t.extraPrompt ? "yes" : "no",
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

export async function launchCommand(rest) {
  const apply = rest.includes("--apply");
  const filtered = rest.filter((t) => t !== "--apply");
  if (filtered.length === 0) {
    process.stderr.write("[agent-batch launch] expected a spec file path\n");
    return 2;
  }

  let raw;
  try {
    raw = loadSpecFile(filtered[0]);
  } catch (e) {
    process.stderr.write(`[agent-batch launch] ${e.message}\n`);
    return 2;
  }

  const parsed = safeParseSpec(raw);
  if (!parsed.success) {
    process.stderr.write(
      "[agent-batch launch] spec failed schema validation; run `validate` first\n",
    );
    return 1;
  }
  const spec = parsed.data;

  const overlap = analyzeOverlap(spec);
  if (overlap.duplicates.length > 0 || overlap.missingDependencies.length > 0 || overlap.cycles.length > 0) {
    process.stderr.write(
      "[agent-batch launch] overlap problems detected; run `overlap` for details\n",
    );
    return 1;
  }

  const dispatchOrder = buildDispatchTable(spec);
  process.stdout.write(formatDispatchTable(spec, dispatchOrder));

  if (!apply) {
    process.stdout.write("[agent-batch launch] dry-run (pass --apply to create worktrees)\n");
    return 0;
  }

  // --apply path: dispatch each task via deep-work/start (worktree + prompt).
  const { startCommand } = await import("../deep-work/start.mjs");
  let lastCode = 0;
  for (const task of dispatchOrder) {
    process.stdout.write(`[agent-batch launch] dispatching #${task.issue} -> ${task.agent}\n`);
    const code = await startCommand([String(task.issue)]);
    if (code !== 0) {
      process.stderr.write(`[agent-batch launch] start #${task.issue} returned ${code}\n`);
      lastCode = code;
    }
  }
  return lastCode;
}

// Used by status to resolve the worktree root from a spec.
export function expectedWorktreeRoot(repoRoot) {
  return resolve(repoRoot, "worktrees");
}

export function worktreesExistFor(repoRoot, issueNumber) {
  const root = expectedWorktreeRoot(repoRoot);
  if (!existsSync(root)) return false;
  const prefix = `issue-${issueNumber}-`;
  try {
    const entries = readdirSync(root);
    return entries.some((name) => name.startsWith(prefix));
  } catch {
    return false;
  }
}
