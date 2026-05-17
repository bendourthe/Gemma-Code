// v0.9.0 Phase 5 sub-task 5.3 -- agent-batch status sub-command.
//
// For each task in the spec: report `pending` / `running` / `done` / `failed`
// based on a coarse worktree inspection:
//
//   - `pending`: no worktree on disk at worktrees/issue-<n>-*.
//   - `running`: worktree present but no commit on the feature branch
//     beyond the origin/main starting point (i.e. `git log` returns 0
//     non-main commits).
//   - `done`: worktree present AND at least one commit on the feature
//     branch.
//   - `failed`: cannot be detected reliably from git state alone, so we
//     never emit this status; it is reserved for future hooks (e.g. a
//     `STATUS=failed` marker file the agents can drop).
//
// The status reader never spawns gh or network calls; it inspects the
// local repository state only.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { safeParseSpec } from "./schema.mjs";
import { loadSpecFile } from "./validate.mjs";
import { expectedWorktreeRoot, worktreesExistFor } from "./launch.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");

export function classifyTaskStatus(repoRoot, issueNumber, runner = spawnSync) {
  if (!worktreesExistFor(repoRoot, issueNumber)) return "pending";
  // We do not pre-resolve the slug; the worktree name was derived from the
  // issue title at start time. Use `git worktree list` to find the matching
  // path so we can probe the branch.
  const wt = runner("git", ["worktree", "list", "--porcelain"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    cwd: repoRoot,
  });
  if (wt.status !== 0) return "pending";
  const records = (wt.stdout ?? "").split(/\r?\n\r?\n/);
  const prefix = `issue-${issueNumber}-`;
  let worktreePath = null;
  let branch = null;
  for (const block of records) {
    const lines = block.split(/\r?\n/);
    let wPath = null;
    let bRef = null;
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith("worktree ")) wPath = t.slice("worktree ".length);
      else if (t.startsWith("branch ")) bRef = t.slice("branch ".length);
    }
    if (wPath && wPath.includes(prefix)) {
      worktreePath = wPath;
      branch = bRef;
      break;
    }
  }
  if (!worktreePath || !existsSync(worktreePath)) return "pending";
  if (!branch) return "running";
  const ref = branch.replace(/^refs\/heads\//, "");
  const log = runner(
    "git",
    ["log", "--oneline", `origin/main..${ref}`],
    {
      encoding: "utf8",
      shell: process.platform === "win32",
      cwd: worktreePath,
    },
  );
  if (log.status !== 0) return "running";
  const commits = (log.stdout ?? "").trim();
  return commits.length > 0 ? "done" : "running";
}

export function formatStatusTable(spec, statuses) {
  const header = ["batchId", "issue", "agent", "status"];
  const data = spec.tasks.map((t) => [
    spec.batchId,
    `#${t.issue}`,
    t.agent,
    statuses.get(t.issue) ?? "pending",
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

export async function statusCommand(rest) {
  if (rest.length === 0) {
    process.stderr.write("[agent-batch status] expected a spec file path\n");
    return 2;
  }
  let raw;
  try {
    raw = loadSpecFile(rest[0]);
  } catch (e) {
    process.stderr.write(`[agent-batch status] ${e.message}\n`);
    return 2;
  }
  const parsed = safeParseSpec(raw);
  if (!parsed.success) {
    process.stderr.write(
      "[agent-batch status] spec failed schema validation; run `validate` for details\n",
    );
    return 1;
  }
  const spec = parsed.data;
  const statuses = new Map();
  for (const t of spec.tasks) {
    statuses.set(t.issue, classifyTaskStatus(REPO_ROOT, t.issue));
  }
  process.stdout.write(formatStatusTable(spec, statuses));
  return 0;
}
