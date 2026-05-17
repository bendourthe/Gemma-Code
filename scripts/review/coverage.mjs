// v0.9.0 Phase 5 sub-task 5.4 -- review coverage sub-command.
//
// Downloads the `diff-coverage.md` artifact produced by
// `.github/workflows/coverage-diff.yml` for the named PR, prints the
// markdown summary, and suggests test files for any uncovered lines that
// appear in the report. The download path uses `gh run download` (the
// artifact name is `diff-coverage`).

import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parseReviewArgs, runGh } from "./shared.mjs";

export function extractUncoveredFromMarkdown(md) {
  if (typeof md !== "string") return [];
  const out = [];
  // diff-cover's markdown report lists files under "## <file>" sub-sections
  // and mentions "Missing line(s)" / "Lines not covered" with comma-separated
  // ranges. We grep for both shapes for resilience.
  const fileRe = /^##\s+(\S.+\.(?:ts|tsx|mts|mjs|js|jsx|py|go|rs))\s*$/gm;
  const matches = [...md.matchAll(fileRe)];
  for (const m of matches) {
    const path = m[1];
    const startIdx = m.index ?? 0;
    const nextHeader = md.slice(startIdx + 1).search(/^##\s+/m);
    const section = nextHeader >= 0 ? md.slice(startIdx, startIdx + 1 + nextHeader) : md.slice(startIdx);
    const missingMatch = section.match(/(?:Missing line|Lines not covered)[^\n]*?:?\s*([\d,\-\s]+)/i);
    out.push({ path, missing: missingMatch ? missingMatch[1].trim() : "" });
  }
  return out;
}

export function suggestTestFiles(uncovered) {
  return uncovered.map((entry) => {
    const path = entry.path;
    let suggestion = "";
    if (path.startsWith("src/")) {
      const rel = path.slice("src/".length);
      suggestion = `tests/unit/${rel}`.replace(/\.(ts|tsx|mts|mjs|js|jsx)$/, ".test.$1");
    } else if (path.startsWith("scripts/")) {
      suggestion = `tests/unit/${path}`.replace(/\.(mjs|js)$/, ".test.ts");
    } else {
      suggestion = `tests/unit/${path}.test.ts`;
    }
    return { ...entry, suggestion };
  });
}

export function formatCoverageReport(md, uncovered) {
  const lines = [];
  lines.push(md.trim());
  if (uncovered.length > 0) {
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("Suggested test files for uncovered lines:");
    for (const entry of uncovered) {
      lines.push(`  - ${entry.path} (missing: ${entry.missing || "?"})`);
      lines.push(`    -> ${entry.suggestion}`);
    }
  }
  return lines.join("\n") + "\n";
}

export async function coverageCommand(rest) {
  const args = parseReviewArgs(rest);
  if (args.prNumber === null) {
    process.stderr.write("[review coverage] expected a PR number\n");
    return 2;
  }

  if (args.dryRun) {
    process.stdout.write(`[review coverage] (dry-run) would download diff-coverage artifact for PR #${args.prNumber}\n`);
    return 0;
  }

  // Resolve the most-recent coverage-diff run for the PR's head branch.
  const prInfo = runGh([
    "pr",
    "view",
    String(args.prNumber),
    "--json",
    "headRefName",
  ]);
  if (prInfo.status !== 0) {
    process.stderr.write(`[review coverage] gh pr view failed:\n${prInfo.stderr || prInfo.stdout}\n`);
    return 1;
  }
  let headRef = "";
  try {
    const parsed = JSON.parse(prInfo.stdout);
    headRef = parsed?.headRefName ?? "";
  } catch {
    // ignore -- gh return shape change
  }

  // Look up the most-recent `pull_request` workflow run on the PR head branch
  // named "Coverage Diff" (matches the workflow `name:` field).
  const runs = runGh([
    "run",
    "list",
    "--workflow", "Coverage Diff",
    "--branch", headRef || "main",
    "--limit", "1",
    "--json", "databaseId,conclusion,headBranch",
  ]);
  if (runs.status !== 0) {
    process.stderr.write(`[review coverage] gh run list failed:\n${runs.stderr || runs.stdout}\n`);
    return 1;
  }

  let runId;
  try {
    const parsed = JSON.parse(runs.stdout);
    runId = Array.isArray(parsed) && parsed[0] ? parsed[0].databaseId : null;
  } catch {
    runId = null;
  }
  if (!runId) {
    process.stdout.write("[review coverage] no coverage-diff run found for the PR head branch yet\n");
    return 0;
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), "gemma-review-coverage-"));
  const dl = runGh([
    "run",
    "download",
    String(runId),
    "--name", "diff-coverage",
    "--dir", tmpRoot,
  ]);
  if (dl.status !== 0) {
    process.stderr.write(`[review coverage] gh run download failed:\n${dl.stderr || dl.stdout}\n`);
    return 1;
  }

  const mdPath = join(tmpRoot, "diff-coverage.md");
  if (!existsSync(mdPath)) {
    process.stderr.write("[review coverage] artifact did not contain diff-coverage.md\n");
    return 1;
  }
  const md = readFileSync(mdPath, "utf8");
  const uncovered = extractUncoveredFromMarkdown(md);
  const enriched = suggestTestFiles(uncovered);
  process.stdout.write(formatCoverageReport(md, enriched));
  return 0;
}
