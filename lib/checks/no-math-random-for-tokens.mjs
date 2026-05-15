/**
 * Rule: no-math-random-for-tokens
 *
 * Flag `Math.random()` invocations in files whose name suggests a
 * security-sensitive role (auth, token, crypto, secret, password, jwt,
 * session). Math.random is not cryptographically secure -- crypto-grade
 * RNGs (`crypto.randomBytes`, `crypto.getRandomValues`) must be used
 * instead.
 *
 * Severity: error. No allowlist (test files included -- a test that uses
 * Math.random to generate a token in a sensitive-named module almost
 * always indicates the production code is doing the same).
 */

import {
  finding,
  isAllowed,
  isInComment,
  isSecuritySensitiveFile,
  offsetToPosition,
} from "./helpers.mjs";

const PATTERN = /\bMath\.random\s*\(/g;

export const id = "no-math-random-for-tokens";
export const severity = "error";

export function scan(filePath, contents) {
  if (!isSecuritySensitiveFile(filePath)) return [];
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
          // gemma-check-allow-next-line: no-math-random-for-tokens
          "Math.random() is not cryptographically secure; use crypto.randomBytes / crypto.getRandomValues for tokens or secrets",
      }),
    );
  }
  return findings;
}
