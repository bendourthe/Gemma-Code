/**
 * Rule: no-disabled-ci-check
 *
 * Test-tampering family (A2; reimplements the "Beagle" guardrail behaviour as
 * a deterministic, LLM-free nexus-check rule -- NOT a Go port).
 *
 * A CI check can be disabled to hide a red result: `continue-on-error: true`
 * makes a failing step pass, and `if: false` (or `if: ${{ false }}`) stops a
 * job/step from ever running. Both are legitimate for a known-flaky or
 * visibility-only job, but only with a recorded reason -- without one they are
 * a tampering vector. Fires when neither an adjacent justification (see
 * helpers.hasJustification) nor a `nexus-check-allow` marker is present.
 *
 * Scope: GitHub Actions workflow YAML (`.github/workflows/*.yml`) only. The
 * walker does not scan YAML by default, so this rule declares
 * `scannedExtensions` to opt those files in (bin/nexus-check.mjs unions every
 * selected rule's extra extensions). Warning severity -- it informs the
 * pre-push / CI tampering gate without blocking an emergency hotfix.
 */

import {
  finding,
  hasJustification,
  isAllowed,
  offsetToPosition,
} from "./helpers.mjs";

const PATTERNS = [
  /continue-on-error:\s*true\b/g,
  /^\s*if:\s*(?:false|\$\{\{\s*false\s*\}\})\s*$/gm,
];

export const id = "no-disabled-ci-check";
export const severity = "warning";

// Opt the YAML workflow files into the file walker (code + markdown only by
// default). The `appliesTo` predicate then narrows the scan to workflows.
export const scannedExtensions = [".yml", ".yaml"];

export function appliesTo(filePath) {
  return isWorkflowFile(filePath);
}

export function scan(filePath, contents) {
  if (!isWorkflowFile(filePath)) return [];
  const findings = [];
  for (const pattern of PATTERNS) {
    for (const match of contents.matchAll(pattern)) {
      const idx = match.index ?? 0;
      if (isAllowed(contents, idx, id)) continue;
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
            "CI check disabled (`continue-on-error: true` / `if: false`) without an adjacent justification; explain why (reason / issue / URL) or remove it",
        }),
      );
    }
  }
  return findings;
}

function isWorkflowFile(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  return /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i.test(normalized);
}
