/**
 * Rule: no-tautological-assertion
 *
 * Test-tampering family (A2; reimplements the "Beagle" guardrail behaviour as
 * a deterministic, LLM-free nexus-check rule -- NOT a Go port).
 *
 * An assertion that can never fail is a hardcoded pass: it makes a test
 * "green by construction" while exercising nothing. Catches the two shapes:
 *   1. literal tautologies   -- expect(true).toBe(true), expect(true).toBeTruthy(),
 *                               assert(true), assert.ok(1)
 *   2. identical-both-sides  -- expect(1).toBe(1), assert.equal("x", "x")
 *
 * Only fires when BOTH operands are literals (true/false/null/undefined, a
 * number, or a quoted string) AND, for the equality forms, identical. A real
 * assertion (`expect(arr.length).toBe(0)`) has a non-literal left operand and
 * is never flagged. Fires at error severity -- a hardcoded result is a
 * tampering signal, not a style nit.
 *
 * Scope: test files only. Allowlist: `nexus-check-allow` markers; matches in
 * comments / string literals are skipped.
 */

import {
  finding,
  isAllowed,
  isInComment,
  isQuoted,
  isTestFile,
  offsetToPosition,
} from "./helpers.mjs";

// A literal operand: boolean / nullish keyword, a (signed, optionally
// decimal) number, or a single/double/back-quoted string with no embedded
// newline. Bounded -- no nested quantifier over an alternation -- so it is
// ReDoS-resistant.
const LITERAL =
  "(?:true|false|null|undefined|-?\\d+(?:\\.\\d+)?|\"[^\"\\n]*\"|'[^'\\n]*'|`[^`\\n]*`)";

// Each entry: a regex plus an optional `sameSides` flag meaning "only a
// tautology when capture group 1 === group 2".
const MATCHERS = [
  {
    regex: new RegExp(
      `\\bexpect\\(\\s*(${LITERAL})\\s*\\)\\s*\\.\\s*(?:toBe|toEqual|toStrictEqual)\\(\\s*(${LITERAL})\\s*\\)`,
      "g",
    ),
    sameSides: true,
  },
  { regex: /\bexpect\(\s*true\s*\)\s*\.\s*toBeTruthy\(\s*\)/g },
  { regex: /\bexpect\(\s*false\s*\)\s*\.\s*toBeFalsy\(\s*\)/g },
  { regex: /\bassert(?:\.ok)?\(\s*(?:true|1)\s*\)/g },
  {
    regex: new RegExp(
      `\\bassert\\.(?:equal|strictEqual|deepEqual|deepStrictEqual)\\(\\s*(${LITERAL})\\s*,\\s*(${LITERAL})\\s*\\)`,
      "g",
    ),
    sameSides: true,
  },
];

export const id = "no-tautological-assertion";
export const severity = "error";

export function scan(filePath, contents) {
  if (!isTestFile(filePath)) return [];
  const findings = [];
  for (const { regex, sameSides } of MATCHERS) {
    for (const match of contents.matchAll(regex)) {
      if (sameSides && match[1] !== match[2]) continue;
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
            "tautological assertion can never fail (a hardcoded pass); assert against the real value under test",
        }),
      );
    }
  }
  return findings;
}
