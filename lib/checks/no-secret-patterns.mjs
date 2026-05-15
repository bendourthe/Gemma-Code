/**
 * Rule: no-secret-patterns
 *
 * Flag committed secrets that match the gitleaks-derived patterns shared
 * with `scripts/hooks/check-prompt-policy.mjs`. Catches AWS access keys,
 * GitHub personal-access tokens, JWT triplets, and PEM private-key block
 * headers. All patterns use bounded quantifiers (no nested `+` / `*` over
 * alternations) so the rule is ReDoS-resistant by construction.
 *
 * Severity: error. No allowlist beyond the file walker's defaults (e.g.,
 * the runner already skips node_modules and the existing prompt-policy
 * hook fixture).
 */

import {
  finding,
  isAllowed,
  isInComment,
  offsetToPosition,
} from "./helpers.mjs";

const PATTERNS = [
  { name: "AWS access key", regex: /AKIA[0-9A-Z]{16}/g },
  { name: "GitHub PAT", regex: /ghp_[A-Za-z0-9]{36}/g },
  {
    name: "JWT",
    regex: /eyJ[A-Za-z0-9_-]{10,400}\.eyJ[A-Za-z0-9_-]{10,800}\.[A-Za-z0-9_-]{10,400}/g,
  },
  {
    name: "SSH private key header",
    regex: /-----BEGIN (?:RSA|OPENSSH|EC) PRIVATE KEY-----/g,
  },
  // gemma-check-allow-next-line: no-secret-patterns
  { name: "PEM private key", regex: /-----BEGIN PRIVATE KEY-----/g },
];

export const id = "no-secret-patterns";
export const severity = "error";

export function scan(filePath, contents) {
  const findings = [];
  for (const { name, regex } of PATTERNS) {
    for (const match of contents.matchAll(regex)) {
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
          message: `${name} matched in committed file; rotate the credential and remove from source`,
        }),
      );
    }
  }
  return findings;
}
