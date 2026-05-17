// v0.9.0 Phase 5 sub-task 5.4 -- shared helpers for the review CLI.
//
// The review CLI is the imperative cousin of the autonomous
// `/ship-and-babysit` slash command (Phase 3.3). The two surfaces overlap
// deliberately: `review` lets a human drive each step explicitly (sync,
// review, fix, coverage, merge) while `ship-and-babysit` runs the same
// underlying gh / git operations in a polling loop. If usage converges on
// one of the two, the other should fold per ADR-0017's small-CLI
// preference.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const REPO_ROOT = resolve(__dirname, "..", "..");

export function parseReviewArgs(argv) {
  const out = {
    prNumber: null,
    agent: null,
    dryRun: false,
    mergeMode: null,
    positional: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--dry-run") { out.dryRun = true; continue; }
    if (token === "--squash") { out.mergeMode = "squash"; continue; }
    if (token === "--merge") { out.mergeMode = "merge"; continue; }
    if (token === "--rebase") { out.mergeMode = "rebase"; continue; }
    if (token === "--agent") { out.agent = argv[++i] ?? null; continue; }
    if (token.startsWith("--agent=")) { out.agent = token.slice("--agent=".length); continue; }
    out.positional.push(token);
  }
  if (out.positional.length > 0 && /^\d+$/.test(out.positional[0])) {
    out.prNumber = Number.parseInt(out.positional[0], 10);
  }
  return out;
}

export function runGit(args, { cwd } = {}, runner = spawnSync) {
  const r = runner("git", args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    cwd: cwd ?? REPO_ROOT,
  });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

export function tryGit(args, { cwd } = {}, runner = spawnSync) {
  const r = runner("git", args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    cwd: cwd ?? REPO_ROOT,
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function isWorkingTreeDirty(runner = spawnSync) {
  const r = runner("git", ["status", "--porcelain"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    cwd: REPO_ROOT,
  });
  if (r.status !== 0) return false;
  return (r.stdout ?? "").trim().length > 0;
}

export function runGh(args, runner = spawnSync) {
  const r = runner("gh", args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    cwd: REPO_ROOT,
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// Parses `gh pr checks` text output (one row per check) into a structured
// list. We tolerate the most common formats: `name\tstatus\tconclusion`
// columns, then optional duration. The decision is based on `conclusion`
// when present (else `status`). The verdicts are passed straight through;
// classifying which conclusion values count as "green" is the caller's job
// so we can be permissive when GitHub changes wording.
export function parseGhPrChecks(stdout) {
  if (!stdout) return [];
  const lines = stdout.split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.length === 0) continue;
    const cols = t.split(/\s+/);
    if (cols.length < 2) continue;
    const name = cols[0];
    // Try to identify a verdict among the trailing tokens.
    let verdict = "";
    for (const c of cols.slice(1)) {
      const lower = c.toLowerCase();
      if (["pass", "fail", "skipping", "pending", "queued", "in_progress", "completed", "success", "failure", "cancelled", "neutral", "action_required", "timed_out"].includes(lower)) {
        verdict = lower;
      }
    }
    rows.push({ name, raw: t, verdict });
  }
  return rows;
}

export function summarizeChecks(rows) {
  const failing = rows.filter((r) =>
    ["fail", "failure", "cancelled", "timed_out", "action_required"].includes(r.verdict),
  );
  const pending = rows.filter((r) =>
    ["pending", "queued", "in_progress"].includes(r.verdict),
  );
  return { total: rows.length, failing, pending };
}
