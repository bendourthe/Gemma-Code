/**
 * Rule: no-focused-tests
 *
 * Test-tampering family (A2; reimplements the behaviour of the
 * claude-code-harness "Beagle" guardrail T01-T12 family as a deterministic,
 * LLM-free nexus-check rule -- NOT a port of its Go engine).
 *
 * A focused test silently disables every OTHER test in the file: `.only`
 * (vitest / jest / mocha) and the Jasmine `fdescribe` / `fit` / `ftest`
 * shorthands all narrow the run to just the focused case, so a committed
 * focus marker masks the rest of the suite from CI. There is no legitimate
 * reason to commit one -- it is the canonical "make the suite look green"
 * move -- so this fires at error severity (gates the build).
 *
 * Scope: test files only (see helpers.isTestFile). Allowlist: lines marked
 * with a `nexus-check-allow` comment (see helpers.isAllowed); matches inside
 * a comment or string literal are skipped (helpers.isInComment / isQuoted).
 */

import {
  finding,
  isAllowed,
  isInComment,
  isQuoted,
  isTestFile,
  offsetToPosition,
} from "./helpers.mjs";

const PATTERNS = [
  /\b(?:describe|context|suite|it|test|bench)\.only\s*\(/g,
  /\bf(?:describe|it|test)\s*\(/g,
];

export const id = "no-focused-tests";
export const severity = "error";

export function scan(filePath, contents) {
  if (!isTestFile(filePath)) return [];
  const findings = [];
  for (const pattern of PATTERNS) {
    for (const match of contents.matchAll(pattern)) {
      const idx = match.index ?? 0;
      if (isAllowed(contents, idx, id)) continue;
      if (isInComment(contents, idx)) continue;
      if (isQuoted(contents, idx)) continue;
      const { line, column } = offsetToPosition(contents, idx);
      findings.push(
        finding({
          ruleId: id,
          severity,
          filePath,
          line,
          column,
          message:
            "focused test (`.only` / `fdescribe` / `fit`) silently skips the rest of the suite; remove the focus marker before committing",
        }),
      );
    }
  }
  return findings;
}
