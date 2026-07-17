// ---------------------------------------------------------------------------
// Pure, vscode-free shell-command blocklist policy.
//
// Extracted from `handlers/terminal.ts` (which eagerly imports `vscode`) so that
// the command-blocklist check can be consumed by vscode-FREE code paths -- the
// skill-optimizer guardrail (`ActionClassifier`) and its plain-Node composition
// roots (the `nexus skills optimize`/`frontier` CLI and the desktop sidecar,
// v1.12.0 EM.P2.A). `terminal.ts` re-exports these so its existing consumers are
// unchanged; only the source of truth moved. No behavior change.
//
// Depends only on the vscode-free `BLOCKED_PATTERNS`. Boundary: pure, no I/O.
// ---------------------------------------------------------------------------

import { BLOCKED_PATTERNS } from "../../modules/coding/guardrails/policy.js";

/**
 * Split a shell command string on metacharacters that can chain sub-commands
 * (`;`, `&&`, `||`, `|`, newlines) and return all individual segments.
 */
export function shellSegments(command: string): string[] {
  return command.split(/;|&&|\|\||[\n|]/).map((s) => s.trim()).filter(Boolean);
}

/** True if any segment of the command matches a blocked destructive pattern. */
export function isBlocked(command: string): boolean {
  const segments = [command, ...shellSegments(command)];
  return segments.some((seg) => {
    // Normalize multiple whitespace into single spaces to catch patterns like `rm  -rf /`.
    const normalized = seg.toLowerCase().trim().replace(/\s+/g, " ");
    return BLOCKED_PATTERNS.some((pattern) => normalized.includes(pattern));
  });
}

/**
 * Return the first blocked-pattern substring matched by any segment of `command`,
 * or `null` when the command is safe. Used for the dry-run report so the agent
 * knows *which* destructive pattern triggered the match.
 */
export function findBlockedPattern(command: string): string | null {
  const segments = [command, ...shellSegments(command)];
  for (const seg of segments) {
    const normalized = seg.toLowerCase().trim().replace(/\s+/g, " ");
    for (const pattern of BLOCKED_PATTERNS) {
      if (normalized.includes(pattern)) return pattern;
    }
  }
  return null;
}
