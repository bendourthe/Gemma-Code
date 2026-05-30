/**
 * Rule: no-commented-out-assertion
 *
 * Test-tampering family (A2; reimplements the "Beagle" guardrail behaviour as
 * a deterministic, LLM-free nexus-check rule -- NOT a Go port).
 *
 * A commented-out assertion is a silently weakened test: the check still
 * appears in the diff (so review reads as "the assertion is there") but it no
 * longer runs. Flags a comment line whose body IS a disabled assertion call:
 * `// expect(...)`, `// assert(...)`, `// await expect(`, or the JSDoc
 * continuation form ` * expect(`.
 *
 * Conservative by design: the assertion call must start immediately after the
 * comment marker, so prose that merely mentions "expect" (e.g.
 * `// we expect this to throw`) is not flagged. Warning severity -- a removed
 * assertion is worth a second look but the author may be mid-refactor.
 *
 * Scope: test files only. Allowlist: `nexus-check-allow` markers.
 */

import { finding, isAllowed, isTestFile, offsetToPosition } from "./helpers.mjs";

// `^` + the `m` flag anchors to each line start; `\/\/` (line comment) or `\*`
// (block-comment continuation) followed by an assertion call. The match index
// lands on the line's leading whitespace, which offsetToPosition maps to the
// correct line number.
const PATTERN = /^[ \t]*(?:\/\/|\*)[ \t]*(?:await\s+)?(?:expect|assert)\s*[(.]/gm;

export const id = "no-commented-out-assertion";
export const severity = "warning";

export function scan(filePath, contents) {
  if (!isTestFile(filePath)) return [];
  const findings = [];
  for (const match of contents.matchAll(PATTERN)) {
    const idx = match.index ?? 0;
    if (isAllowed(contents, idx, id)) continue;
    const { line, column } = offsetToPosition(contents, idx);
    findings.push(
      finding({
        ruleId: id,
        severity,
        filePath,
        line,
        column,
        message:
          "commented-out assertion still shows in the diff but never runs; restore the check or delete it with a recorded reason",
      }),
    );
  }
  return findings;
}
