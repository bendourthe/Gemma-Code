#!/usr/bin/env node
/**
 * gemma-check: standalone deterministic checks CLI.
 *
 * Runs a small, hand-curated rule set (currently 4 rules) against a file or
 * directory and prints findings. The rules live under `lib/checks/`; see
 * each file's header for severity and allowlist semantics. The CLI is
 * intentionally LLM-free so it can run in CI, in pre-commit hooks, and on
 * air-gapped machines.
 *
 * Usage:
 *   gemma-check [path]              walk path recursively (default: cwd)
 *   gemma-check --json              emit JSON instead of human-readable
 *   gemma-check --rule <id>         restrict to a single rule (repeatable)
 *   gemma-check --list-rules        print rule ids and exit
 *   gemma-check --help              print usage and exit
 *
 * Exit codes:
 *   0  -- no errors (warnings and info findings are allowed; CI does not gate on them)
 *   1  -- one or more error-severity findings
 *   2  -- invalid invocation or I/O error
 *
 * v0.8.0 Phase 7 (CI gate alignment): warnings and info findings emit to
 * stdout for visibility but do not flip exit to non-zero. CI fails only when
 * an error-severity rule fires, matching the convention used by ESLint,
 * ruff, and dependency-cruiser. The `--strict` flag restores the legacy
 * "any finding fails" behaviour for callers that need the older contract.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { RULES, RULE_BY_ID } from "../lib/checks/index.mjs";

/**
 * v0.7.0 Phase 6: the walker originally limited itself to JS/TS source files
 * because every shipped rule operated on code. v0.8.0 Phase 5 sub-task 5.9
 * added markdown-targeted prompt / skill rules. To avoid scanning the entire
 * documentation tree, .md files are walked only when at least one rule with
 * an `appliesTo` predicate is selected; the predicate then narrows the file
 * set per rule.
 */
const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

const MARKDOWN_EXTENSIONS = new Set([".md"]);

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "out",
  "dist",
  "coverage",
  ".vscode-test",
  ".stryker-tmp",
  ".husky",
  ".cache",
  ".turbo",
]);

const HELP = `gemma-check -- standalone deterministic source-code checks

Usage:
  gemma-check [path]              walk path recursively (default: cwd)
  gemma-check --json              emit JSON instead of human-readable
  gemma-check --rule <id>         restrict to a single rule (repeatable)
  gemma-check --list-rules        print rule ids and exit
  gemma-check --strict            exit 1 on any finding (legacy behaviour)
  gemma-check --help              print usage and exit

Exit codes:
  0  no error-severity findings (warnings + info allowed)
  1  one or more error-severity findings (or any finding with --strict)
  2  invalid invocation or I/O error
`;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = {
    paths: [],
    json: false,
    rules: [],
    listRules: false,
    strict: false,
    help: false,
    unknown: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--json") args.json = true;
    else if (a === "--list-rules") args.listRules = true;
    else if (a === "--strict") args.strict = true;
    else if (a === "--rule") {
      const next = argv[++i];
      if (!next) {
        args.unknown.push("--rule requires a value");
      } else {
        args.rules.push(next);
      }
    } else if (a.startsWith("--")) {
      args.unknown.push(a);
    } else {
      args.paths.push(a);
    }
  }
  if (args.paths.length === 0) args.paths.push(".");
  return args;
}

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------

/**
 * Yield every scan-eligible file under `root`. Skips directories from
 * SKIPPED_DIRECTORIES and files whose extension is not in
 * SCANNED_EXTENSIONS. Symlinks are not followed (avoids cycles and reads
 * outside the target tree).
 */
export function* walk(root, { includeMarkdown = false } = {}) {
  let stats;
  try {
    stats = statSync(root);
  } catch {
    return;
  }
  if (stats.isFile()) {
    if (isScannable(root, includeMarkdown)) yield root;
    return;
  }
  if (!stats.isDirectory()) return;

  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        stack.push(full);
        continue;
      }
      if (entry.isFile() && isScannable(full, includeMarkdown)) yield full;
    }
  }
}

function isScannable(filePath, includeMarkdown) {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return false;
  const ext = filePath.slice(dot).toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) return true;
  if (includeMarkdown && MARKDOWN_EXTENSIONS.has(ext)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Rule application
// ---------------------------------------------------------------------------

export function selectRules(requestedIds) {
  if (requestedIds.length === 0) return RULES;
  const selected = [];
  for (const ruleId of requestedIds) {
    const rule = RULE_BY_ID[ruleId];
    if (!rule) throw new Error(`unknown rule: ${ruleId}`);
    selected.push(rule);
  }
  return selected;
}

export function scanPath(target, rules) {
  const findings = [];
  const includeMarkdown = rules.some((r) => typeof r.appliesTo === "function");
  for (const filePath of walk(target, { includeMarkdown })) {
    let contents;
    try {
      contents = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (typeof rule.appliesTo === "function" && !rule.appliesTo(filePath)) {
        continue;
      }
      findings.push(...rule.scan(filePath, contents));
    }
  }
  // v0.8.0 Phase 5 sub-task 5.9 (item G5): drain any cross-file rule state
  // (`skill-duplicate-name` is the seed example). `flush()` is optional;
  // a rule that does not expose it returns no extra findings here.
  for (const rule of rules) {
    if (typeof rule.flush === "function") {
      findings.push(...rule.flush());
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function relativizeFinding(finding, base) {
  return { ...finding, file: relative(base, finding.file).replace(/\\/g, "/") };
}

function reportHuman(findings) {
  if (findings.length === 0) {
    process.stdout.write("gemma-check: 0 findings\n");
    return;
  }
  const bySeverity = { error: 0, warning: 0, info: 0 };
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    process.stdout.write(
      `${f.file}:${f.line}:${f.column}  ${f.severity}  ${f.rule}  ${f.message}\n`,
    );
  }
  process.stdout.write(
    `\ngemma-check: ${findings.length} finding(s) -- ${bySeverity.error} error, ${bySeverity.warning} warning, ${bySeverity.info} info\n`,
  );
}

function reportJson(findings) {
  process.stdout.write(`${JSON.stringify({ findings }, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function main(argv) {
  const args = parseArgs(argv);

  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  if (args.unknown.length > 0) {
    process.stderr.write(`gemma-check: ${args.unknown.join("; ")}\n${HELP}`);
    return 2;
  }

  if (args.listRules) {
    for (const rule of RULES) {
      process.stdout.write(`${rule.id}\t${rule.severity}\n`);
    }
    return 0;
  }

  let rules;
  try {
    rules = selectRules(args.rules);
  } catch (err) {
    process.stderr.write(`gemma-check: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  const allFindings = [];
  for (const target of args.paths) {
    const resolved = resolve(target);
    if (!existsSync(resolved)) {
      process.stderr.write(`gemma-check: path not found: ${target}\n`);
      return 2;
    }
    const base = statSync(resolved).isFile() ? resolve(resolved, "..") : resolved;
    const findings = scanPath(resolved, rules).map((f) => relativizeFinding(f, base));
    allFindings.push(...findings);
  }

  if (args.json) reportJson(allFindings);
  else reportHuman(allFindings);

  if (args.strict) return allFindings.length > 0 ? 1 : 0;
  const hasError = allFindings.some((f) => f.severity === "error");
  return hasError ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const code = main(process.argv.slice(2));
  process.exit(code);
}

// Export helpers so tests can drive the CLI in-process without spawning a
// child. The main() entry above is the only side-effectful path.
// Re-export the legacy name alongside the new one so existing tests keep working.
export { CODE_EXTENSIONS as SCANNED_EXTENSIONS, CODE_EXTENSIONS, MARKDOWN_EXTENSIONS, SKIPPED_DIRECTORIES, HELP };
