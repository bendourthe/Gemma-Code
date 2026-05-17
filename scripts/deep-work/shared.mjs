// v0.9.0 Phase 5 sub-task 5.1 -- shared helpers for the deep-work CLI.
//
// Helpers are factored out of `cli.mjs` and each sub-command so the
// tests in tests/integration/scripts-deep-work.test.ts can exercise the
// pure logic without spawning real `gh` or `git` calls. The
// I/O wrappers (`ghIssueView`, `ghIssueList`, `runGit`, `gitWorktrees`)
// keep `shell: process.platform === "win32"` for parity with
// scripts/work.mjs and scripts/debug/cli.mjs.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const REPO_ROOT = resolve(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Slug / branch / worktree path derivation
// ---------------------------------------------------------------------------

const SLUG_MAX_LEN = 40;

export function slugify(raw) {
  if (raw === undefined || raw === null) return "issue";
  const lowered = String(raw).toLowerCase();
  const stripped = lowered
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (stripped.length === 0) return "issue";
  const cap = stripped.slice(0, SLUG_MAX_LEN);
  return cap.replace(/-+$/, "") || "issue";
}

export function deriveBranchName(issueNumber, title) {
  return `feat/issue-${issueNumber}-${slugify(title)}`;
}

export function deriveWorktreePath(issueNumber, title) {
  return `worktrees/issue-${issueNumber}-${slugify(title)}`;
}

// ---------------------------------------------------------------------------
// gh wrappers
// ---------------------------------------------------------------------------

export function ghIssueView(issueNumber, runner = spawnSync) {
  const fields = "number,title,body,labels,url,state,author";
  const result = runner(
    "gh",
    ["issue", "view", String(issueNumber), "--json", fields],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  if (result.status !== 0) {
    const err = result.stderr || result.stdout || "(no output)";
    throw new Error(`gh issue view ${issueNumber} failed:\n${err}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`gh returned non-JSON output:\n${result.stdout}`);
  }
}

export function ghIssueList({ label = "good first issue", state = "open", limit = 10 } = {}, runner = spawnSync) {
  const args = [
    "issue", "list",
    "--label", label,
    "--state", state,
    "--limit", String(limit),
    "--json", "number,title,labels,url,state",
  ];
  const result = runner("gh", args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    const err = result.stderr || result.stdout || "(no output)";
    throw new Error(`gh issue list failed:\n${err}`);
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error(`gh returned non-JSON output:\n${result.stdout}`);
  }
}

// ---------------------------------------------------------------------------
// git wrappers
// ---------------------------------------------------------------------------

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

// `git worktree list --porcelain` emits records separated by blank lines. Each
// record starts with `worktree <path>` and may include `HEAD <sha>` /
// `branch <ref>` / `bare` / `detached` lines. We expose a typed array so
// status/list/cleanup can render the same view.
export function parseWorktreeListPorcelain(stdout) {
  const rows = [];
  const blocks = stdout.split(/\r?\n\r?\n/).map((b) => b.trim()).filter(Boolean);
  for (const block of blocks) {
    const row = { path: null, head: null, branch: null, bare: false, detached: false };
    for (const line of block.split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith("worktree ")) row.path = t.slice("worktree ".length);
      else if (t.startsWith("HEAD ")) row.head = t.slice("HEAD ".length);
      else if (t.startsWith("branch ")) row.branch = t.slice("branch ".length);
      else if (t === "bare") row.bare = true;
      else if (t === "detached") row.detached = true;
    }
    if (row.path) rows.push(row);
  }
  return rows;
}

export function gitWorktrees(runner = spawnSync) {
  const r = runner("git", ["worktree", "list", "--porcelain"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    cwd: REPO_ROOT,
  });
  if (r.status !== 0) {
    throw new Error(`git worktree list failed:\n${r.stderr || r.stdout}`);
  }
  return parseWorktreeListPorcelain(r.stdout ?? "");
}

export function isWorktreeDirty(worktreePath, runner = spawnSync) {
  const r = runner("git", ["status", "--porcelain"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    cwd: worktreePath,
  });
  if (r.status !== 0) return false;
  return (r.stdout ?? "").trim().length > 0;
}

// ---------------------------------------------------------------------------
// Prompt assembly (sibling of work.mjs's CONVENTIONS to avoid an inter-script
// dependency between scripts/deep-work/ and scripts/work.mjs).
// ---------------------------------------------------------------------------

export const DEEP_WORK_CONVENTIONS = [
  "Gemma-Code conventions reminder:",
  "- Strict TypeScript: no `any`, no `console.*` (use src/utils/logger).",
  "- Zod schemas at all external boundaries (chat input, tool args, file IO).",
  "- Files stay under 500 lines; extract helpers when growing past that.",
  "- ASCII-only in commit messages and source comments.",
  "- Reference the relevant ADR (`docs/v*/adr/`) in code comments when the",
  "  change touches an architectural decision.",
  "- Add tests for every new behaviour (`tests/unit/**` or `tests/integration/**`).",
  "- Run `npm run lint && npm run build && npm test` before pushing.",
].join("\n");

export function buildDeepWorkPrompt({ issue, worktreePath, branchName }) {
  const labels = Array.isArray(issue?.labels)
    ? issue.labels.map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean)
    : [];
  const lines = [];
  lines.push(`Deep-work session for GitHub issue #${issue.number}: ${issue.title}`);
  lines.push("");
  lines.push(`Worktree: ${worktreePath}`);
  lines.push(`Branch:   ${branchName}`);
  lines.push(`Link:     ${issue.url ?? "(unknown)"}`);
  if (issue.state) lines.push(`State:    ${issue.state}`);
  if (labels.length > 0) lines.push(`Labels:   ${labels.join(", ")}`);
  lines.push("");
  lines.push("Issue body:");
  lines.push("---");
  lines.push(String(issue.body ?? "(empty)"));
  lines.push("---");
  lines.push("");
  lines.push(DEEP_WORK_CONVENTIONS);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI helpers shared by the sub-commands
// ---------------------------------------------------------------------------

export function parseFlagArgs(argv) {
  const out = { positional: [], force: false, first: false, agent: null, dryRun: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--force") { out.force = true; continue; }
    if (token === "--first") { out.first = true; continue; }
    if (token === "--dry-run") { out.dryRun = true; continue; }
    if (token === "--yes" || token === "-y") { out.yes = true; continue; }
    if (token === "--agent") { out.agent = argv[++i] ?? null; continue; }
    if (token.startsWith("--agent=")) { out.agent = token.slice("--agent=".length); continue; }
    out.positional.push(token);
  }
  return out;
}
