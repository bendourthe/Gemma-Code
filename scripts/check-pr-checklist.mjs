#!/usr/bin/env node
// v0.9.0 Phase 5 sub-task 5.2 -- PR Submission Checklist gate.
//
// Reads either `process.env.PR_BODY` (preferred -- the workflow injects
// the PR body) or shells out to `gh pr view <num> --json body --jq .body`
// to obtain the body. For every line under the `## Submission Checklist`
// header (case-insensitive), the line passes if:
//
//   - it is checked (`- [x]` / `- [X]`), OR
//   - it explicitly opts out by starting (after the unchecked box) with
//     `N/A:` followed by a free-text reason.
//
// Any unchecked, non-`N/A:` box fails the gate. The script never reaches
// out to a third-party service; `gh` is the only external CLI invoked.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HELP = `gemma-code PR checklist gate

Usage:
  node scripts/check-pr-checklist.mjs [<pr-number>]

Inputs (one of):
  PR_BODY env var   The PR body (preferred; the workflow injects this).
  <pr-number>       Falls back to \`gh pr view <pr> --json body --jq .body\`.

Behaviour:
  Scans the body's "## Submission Checklist" section. Every line that begins
  with "- [ ]" or "- [x]" / "- [X]" is a checklist item. A line passes if it
  is checked OR if the unchecked box is followed by an "N/A: <reason>" tag.
  Any failing line prints a diagnostic and the script exits non-zero.

Exit codes:
  0   all checklist items pass.
  1   one or more items fail.
  2   no Submission Checklist section, or no PR body at all.
`;

const CHECKLIST_HEADER_RE = /^##+\s+submission\s+checklist\b/i;
const NEXT_HEADER_RE = /^##+\s+/;
const ITEM_RE = /^\s*-\s*\[(?<state>[ xX])\]\s*(?<rest>.*)$/;
const NA_RE = /^N\/?A\s*:\s*\S/i;

export function extractChecklistLines(body) {
  if (typeof body !== "string" || body.length === 0) return null;
  const lines = body.split(/\r?\n/);
  let inSection = false;
  const out = [];
  for (const line of lines) {
    if (!inSection) {
      if (CHECKLIST_HEADER_RE.test(line)) {
        inSection = true;
        continue;
      }
      continue;
    }
    // We are in the Submission Checklist section. Stop at the next `## ...`.
    if (NEXT_HEADER_RE.test(line)) {
      break;
    }
    out.push(line);
  }
  return inSection ? out : null;
}

export function evaluateChecklistLines(checklistLines) {
  const items = [];
  for (const line of checklistLines) {
    const m = line.match(ITEM_RE);
    if (!m || !m.groups) continue;
    const state = m.groups.state;
    const rest = (m.groups.rest ?? "").trim();
    let pass = false;
    let reason = "";
    if (state === "x" || state === "X") {
      pass = true;
      reason = "checked";
    } else if (NA_RE.test(rest)) {
      pass = true;
      reason = "n/a";
    } else {
      pass = false;
      reason = "unchecked";
    }
    items.push({ line, state, rest, pass, reason });
  }
  return items;
}

export function checkBody(body) {
  const section = extractChecklistLines(body);
  if (section === null) {
    return {
      ok: false,
      kind: "missing-section",
      items: [],
      message: "No `## Submission Checklist` section found in the PR body.",
    };
  }
  const items = evaluateChecklistLines(section);
  if (items.length === 0) {
    return {
      ok: false,
      kind: "missing-section",
      items,
      message: "Submission Checklist section is present but contains no `- [ ]` items.",
    };
  }
  const failing = items.filter((i) => !i.pass);
  return {
    ok: failing.length === 0,
    kind: failing.length === 0 ? "ok" : "failing",
    items,
    message: failing.length === 0
      ? `All ${items.length} checklist item(s) pass.`
      : `${failing.length} of ${items.length} checklist item(s) failing.`,
  };
}

function ghFetchBody(prNumber) {
  const r = spawnSync(
    "gh",
    ["pr", "view", String(prNumber), "--json", "body", "--jq", ".body"],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  if (r.status !== 0) {
    throw new Error(`gh pr view ${prNumber} failed:\n${r.stderr || r.stdout}`);
  }
  return r.stdout ?? "";
}

export async function main(argv) {
  const args = argv.slice(2);
  if (args[0] === "-h" || args[0] === "--help") {
    process.stdout.write(HELP);
    return 0;
  }
  let body = process.env.PR_BODY ?? "";
  if (body.length === 0 && args.length > 0 && /^\d+$/.test(args[0])) {
    try {
      body = ghFetchBody(args[0]);
    } catch (e) {
      process.stderr.write(`[check-pr-checklist] ${e.message}\n`);
      return 2;
    }
  }
  if (body.length === 0) {
    process.stderr.write(
      "[check-pr-checklist] no PR body: set PR_BODY or pass a PR number\n",
    );
    return 2;
  }

  const result = checkBody(body);
  if (result.kind === "missing-section") {
    process.stderr.write(`[check-pr-checklist] ${result.message}\n`);
    return 2;
  }

  for (const item of result.items) {
    const mark = item.pass ? "ok " : "FAIL";
    process.stdout.write(`[${mark}] ${item.line.trim()}\n`);
  }
  process.stdout.write(`[check-pr-checklist] ${result.message}\n`);
  return result.ok ? 0 : 1;
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
