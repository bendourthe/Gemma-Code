/**
 * Rule: no-bare-promise-rejection
 *
 * Flag `.catch()` invocations that pass no handler argument. A bare
 * `.catch()` silently swallows the rejection -- the promise is no longer
 * "unhandled" (so `unhandledRejection` does not fire and the process does
 * not warn) but the error is also never observed by code, never logged,
 * and never re-thrown. Code that genuinely wants to discard a rejection
 * should still pass an explicit handler -- at minimum `() => {}` or
 * `(err) => logger.debug(err)` -- so the intent is searchable.
 *
 * Severity: warning. Allowlist: test files; lines marked with a
 * `gemma-check-allow` comment (see helpers.isAllowed).
 *
 * Pattern: `.catch(` immediately followed by whitespace + `)`. This
 * deliberately ignores method-reference style (`.catch(handler)`),
 * inline-arrow style (`.catch(() => ...)`), and any catch with a
 * positional argument. False-positives are limited to genuinely empty
 * argument lists.
 *
 * Fix suggestion: add a handler that at minimum logs the error.
 *
 * v0.8.0 Phase 7.A (closes v0.7.0 known-gaps 10.O.8).
 */

import {
  finding,
  isAllowed,
  isInComment,
  isTestFile,
  offsetToPosition,
} from "./helpers.mjs";

const PATTERN = /\.catch\s*\(\s*\)/g;

export const id = "no-bare-promise-rejection";
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
        message:
          "bare .catch() swallows the rejection silently; add a handler that at minimum logs the error",
      }),
    );
  }
  return findings;
}
