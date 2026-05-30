/**
 * Rule: no-skipped-tests-without-reason
 *
 * Test-tampering family (A2; reimplements the "Beagle" guardrail behaviour as
 * a deterministic, LLM-free nexus-check rule -- NOT a Go port).
 *
 * Skipping a test is legitimate (a known-flaky case, a missing-env gate) but
 * ONLY with a recorded reason -- otherwise an unjustified `.skip` is how a
 * failing test quietly leaves CI. This generalises the repo's existing
 * convention (`tests/unit/test-discipline.test.ts` requires an adjacent
 * `TODO(harness-bug)` / `TODO(missing_env)`) to any nearby justification:
 * a TODO/FIXME reference, a "reason:" phrase, an issue ref, or a URL (see
 * helpers.hasJustification, which uses the same +/-2 line window so the two
 * checks never disagree).
 *
 * Detects `.skip` (vitest / jest / mocha), the Jasmine `xit` / `xdescribe` /
 * `xtest` pending shorthands, and `.todo`. `.skipIf(...)` (the conditional
 * form) is intentionally NOT matched -- it is the sanctioned way to gate a
 * test on an env probe. Warning severity: skips are common and the gate
 * should inform, not block.
 *
 * Scope: test files only. Allowlist: `nexus-check-allow` markers; matches in
 * comments / string literals are skipped.
 */

import {
  finding,
  hasJustification,
  isAllowed,
  isInComment,
  isQuoted,
  isTestFile,
  offsetToPosition,
} from "./helpers.mjs";

const PATTERNS = [
  /\b(?:describe|context|suite|it|test|bench)\.skip\s*\(/g,
  /\bx(?:describe|it|test)\s*\(/g,
  /\b(?:it|test|describe)\.todo\s*\(/g,
];

export const id = "no-skipped-tests-without-reason";
export const severity = "warning";

export function scan(filePath, contents) {
  if (!isTestFile(filePath)) return [];
  const findings = [];
  for (const pattern of PATTERNS) {
    for (const match of contents.matchAll(pattern)) {
      const idx = match.index ?? 0;
      if (isAllowed(contents, idx, id)) continue;
      if (isInComment(contents, idx)) continue;
      if (isQuoted(contents, idx)) continue;
      if (hasJustification(contents, idx)) continue;
      const { line, column } = offsetToPosition(contents, idx);
      findings.push(
        finding({
          ruleId: id,
          severity,
          filePath,
          line,
          column,
          message:
            "skipped/disabled test has no adjacent justification (TODO(...), reason:, issue ref, or URL); record why it is skipped or remove it",
        }),
      );
    }
  }
  return findings;
}
