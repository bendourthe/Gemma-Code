/**
 * Rule: no-committed-console-log
 *
 * Flag `console.log(` invocations outside test files. Production code
 * almost never wants console.log -- the project's eslint config blocks
 * `no-console` already; this rule catches the same leak in `.mjs` / `.js`
 * files that ESLint does not lint, and serves as a portable check for
 * users running gemma-check against codebases without ESLint.
 *
 * Severity: warning. Allowlist: test files; lines marked with a
 * `gemma-check-allow` comment (see helpers.isAllowed).
 */

import {
  finding,
  isAllowed,
  isInComment,
  isTestFile,
  offsetToPosition,
} from "./helpers.mjs";

const PATTERN = /\bconsole\.log\s*\(/g;

export const id = "no-committed-console-log";
export const severity = "warning";

export function scan(filePath, contents) {
  if (isTestFile(filePath)) return [];
  const findings = [];
  for (const match of contents.matchAll(PATTERN)) {
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
        message: "console.log left in committed source; remove or replace with a structured logger",
      }),
    );
  }
  return findings;
}
