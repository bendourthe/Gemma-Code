#!/usr/bin/env node
// v0.9.0 Phase 4 sub-task 4.4 -- `npm run work <issue>` issue-to-branch
// dispatcher.
//
// Reverse-engineered from OpenHuman's `scripts/shortcuts/work/cli.sh` into
// cross-platform Node so Windows contributors do not need bash. The script:
//
//   1. Fetches the GitHub issue via `gh issue view <num> --json ...`.
//   2. Derives a branch name `feat/issue-<num>-<slug>`.
//   3. Unless `--no-checkout`, fetches main and creates the branch.
//   4. Builds an agent prompt containing the issue title/body/link/labels
//      and the Gemma-Code conventions reminder.
//   5. Prints the prompt to stdout AND copies it to the clipboard via
//      `clip` (Windows), `pbcopy` (macOS), or `xclip -selection clipboard`
//      (Linux, if present).
//   6. Optionally spawns an agent CLI when `--agent <name>` is given AND
//      the CLI is present on PATH.
//
// Usage:
//   npm run work <issue-number> [extra-prompt] [--agent claude|codex|cursor] [--no-checkout]
//
// The script never calls a non-GitHub API; `gh` is the user's already-
// authenticated CLI talking to GitHub for the user's own repo (the
// intrinsic data destination -- see AGENTS.md MCP-Registry Policy).

import { spawn, spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const HELP = `gemma-code work runner

Usage:
  npm run work <issue-number> [extra-prompt] [--agent <name>] [--no-checkout]

Arguments:
  <issue-number>   GitHub issue number (required).
  [extra-prompt]   Optional extra context appended to the agent prompt.

Options:
  --agent <name>   One of: claude, codex, cursor. Spawns the CLI with the prompt
                   piped in if the binary is present.
  --no-checkout    Skip the git fetch + checkout step (useful from a worktree).
  -h, --help       Print this help.

Examples:
  npm run work 42
  npm run work 42 "focus on the memory path"
  npm run work 42 --agent claude --no-checkout
`;

export function parseArgs(argv) {
  const out = {
    issue: null,
    extraPrompt: "",
    agent: null,
    noCheckout: false,
    help: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "-h" || token === "--help") {
      out.help = true;
      continue;
    }
    if (token === "--no-checkout") {
      out.noCheckout = true;
      continue;
    }
    if (token === "--agent") {
      out.agent = (argv[++i] ?? "").trim() || null;
      continue;
    }
    if (token.startsWith("--agent=")) {
      out.agent = token.slice("--agent=".length).trim() || null;
      continue;
    }
    positional.push(token);
  }
  if (positional.length > 0) {
    const first = positional[0];
    if (/^\d+$/.test(first)) {
      out.issue = Number.parseInt(first, 10);
      if (positional.length > 1) {
        out.extraPrompt = positional.slice(1).join(" ");
      }
    } else {
      out.extraPrompt = positional.join(" ");
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Slug derivation
// ---------------------------------------------------------------------------

const SLUG_MAX_LEN = 40;

export function deriveBranchName(issueNumber, title) {
  const slug = slugify(title);
  return `feat/issue-${issueNumber}-${slug}`;
}

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

// ---------------------------------------------------------------------------
// gh wrapper
// ---------------------------------------------------------------------------

function ghIssueView(issueNumber) {
  const fields = "number,title,body,labels,url,state,author";
  const result = spawnSync(
    "gh",
    ["issue", "view", String(issueNumber), "--json", fields],
    {
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );
  if (result.status !== 0) {
    const err = result.stderr || result.stdout || "(no output)";
    throw new Error(`gh issue view ${issueNumber} failed:\n${err}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (e) {
    throw new Error(`gh returned non-JSON output:\n${result.stdout}`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

const CONVENTIONS = [
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

export function buildAgentPrompt({ issue, extraPrompt }) {
  const labels = Array.isArray(issue.labels)
    ? issue.labels.map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean)
    : [];
  const lines = [];
  lines.push(`Work on GitHub issue #${issue.number}: ${issue.title}`);
  lines.push("");
  lines.push(`Link: ${issue.url ?? "(unknown)"}`);
  if (issue.state) lines.push(`State: ${issue.state}`);
  if (labels.length > 0) lines.push(`Labels: ${labels.join(", ")}`);
  lines.push("");
  lines.push("Issue body:");
  lines.push("---");
  lines.push(String(issue.body ?? "(empty)"));
  lines.push("---");
  if (extraPrompt && extraPrompt.trim().length > 0) {
    lines.push("");
    lines.push("Additional context:");
    lines.push(extraPrompt.trim());
  }
  lines.push("");
  lines.push(CONVENTIONS);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

function clipboardCommand() {
  if (process.platform === "win32") return ["clip", []];
  if (process.platform === "darwin") return ["pbcopy", []];
  // Try xclip on Linux; the caller is expected to handle ENOENT silently.
  return ["xclip", ["-selection", "clipboard"]];
}

export function copyToClipboard(text) {
  const [cmd, args] = clipboardCommand();
  try {
    const child = spawnSync(cmd, args, {
      input: text,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    return child.status === 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Git branch setup
// ---------------------------------------------------------------------------

function runGit(args) {
  const r = spawnSync("git", args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

function branchExists(name) {
  const r = spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return r.status === 0;
}

function checkoutBranch(branchName) {
  runGit(["fetch", "origin", "main"]);
  if (branchExists(branchName)) {
    runGit(["checkout", branchName]);
  } else {
    runGit(["checkout", "-b", branchName, "origin/main"]);
  }
}

// ---------------------------------------------------------------------------
// Agent spawn
// ---------------------------------------------------------------------------

const AGENT_BINARIES = {
  claude: "claude",
  codex: "codex",
  cursor: "cursor",
};

function spawnAgent(agentName, prompt) {
  const bin = AGENT_BINARIES[agentName];
  if (!bin) {
    process.stderr.write(`[work] unknown agent: ${agentName}\n`);
    return 2;
  }
  const child = spawn(bin, [], {
    stdio: ["pipe", "inherit", "inherit"],
    shell: process.platform === "win32",
  });
  child.stdin.write(prompt);
  child.stdin.end();
  return new Promise((res) => {
    child.on("exit", (code) => res(code ?? 1));
    child.on("error", () => res(1));
  });
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export async function main(argv) {
  const args = parseArgs(argv.slice(2));
  if (args.help || args.issue === null) {
    process.stdout.write(HELP);
    return args.issue === null && !args.help ? 2 : 0;
  }

  let issue;
  try {
    issue = ghIssueView(args.issue);
  } catch (e) {
    process.stderr.write(`[work] ${e.message}\n`);
    return 1;
  }

  const branchName = deriveBranchName(issue.number, issue.title);
  const prompt = buildAgentPrompt({ issue, extraPrompt: args.extraPrompt });

  if (!args.noCheckout) {
    try {
      checkoutBranch(branchName);
      process.stdout.write(`[work] checked out branch: ${branchName}\n`);
    } catch (e) {
      process.stderr.write(`[work] ${e.message}\n`);
      return 1;
    }
  } else {
    process.stdout.write(`[work] branch (skipped): ${branchName}\n`);
  }

  process.stdout.write("\n----- agent prompt -----\n");
  process.stdout.write(prompt);
  process.stdout.write("\n------------------------\n");

  const clipboardOk = copyToClipboard(prompt);
  if (clipboardOk) {
    process.stdout.write("[work] prompt copied to clipboard\n");
  } else {
    process.stdout.write(
      "[work] clipboard tool not present (clip / pbcopy / xclip); prompt printed above\n",
    );
  }

  if (args.agent) {
    return spawnAgent(args.agent, prompt);
  }
  return 0;
}

const invokedDirectly = (() => {
  try {
    const arg1 = process.argv[1] ?? "";
    return arg1.endsWith("work.mjs");
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main(process.argv).then((code) => process.exit(code ?? 0));
}
