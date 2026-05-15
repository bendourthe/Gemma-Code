/**
 * Rule: no-env-file-leakage
 *
 * Flag literal `.env` references inside non-test, non-example files.
 * Hardcoding a path to a `.env` file in production source usually means
 * the loader is bypassing the env-var pipeline -- the project's pattern
 * is `process.env.NAME` directly, with the actual `.env` parsing handled
 * once at the harness boundary.
 *
 * Severity: warning. Allowlist: test files; example / fixture / docs
 * files; the literal string `.env.example` (used by tooling).
 */

import {
  finding,
  isAllowed,
  isExampleFile,
  isInComment,
  isTestFile,
  offsetToPosition,
} from "./helpers.mjs";

// Match `.env` as a file-path token, not a property accessor.
// The negative lookbehind `(?<![A-Za-z0-9_$])` rejects `process.env`,
// `vscode.env.openExternal`, `_config.env`, etc. The trailing lookahead
// rejects `.environment`, `.envoy`, and other coincidental matches while
// still accepting the `.env.local` / `.env.production` family.
// gemma-check-allow-next-line: no-env-file-leakage
const PATTERN = /(?<![A-Za-z0-9_$])\.env(?:\.[A-Za-z0-9_-]+)?(?![A-Za-z0-9])/g;

export const id = "no-env-file-leakage";
export const severity = "warning";

export function scan(filePath, contents) {
  if (isTestFile(filePath) || isExampleFile(filePath)) return [];
  const findings = [];
  for (const match of contents.matchAll(PATTERN)) {
    const matchText = match[0];
    if (matchText === ".env.example") continue;
    const idx = match.index ?? 0;
    if (isAllowed(contents, idx, id)) continue;
    if (isInComment(contents, idx)) continue;
    const { line, column } = offsetToPosition(contents, idx);
    findings.push(
      finding({
        ruleId: id,
        severity,
        filePath,
        line,
        column,
        message: `literal "${matchText}" reference in production code; load via process.env at the harness boundary instead`,
      }),
    );
  }
  return findings;
}
