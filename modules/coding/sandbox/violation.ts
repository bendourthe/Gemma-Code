/**
 * Classify OS-sandbox denials so run_terminal returns a tool error, not a crash.
 */

import { SANDBOX_APPLY_FAILURE_EXIT, type SandboxMode } from "./types.js";

const VIOLATION_MARKERS = [
  "nexus-sandbox:",
  "sandbox-exec",
  "operation not permitted",
  "permission denied",
  "eacces",
];

export function isSandboxViolation(input: {
  readonly mode: SandboxMode;
  readonly exitCode: number;
  readonly stderr: string;
}): boolean {
  if (input.mode === "unconfined") return false;
  if (input.exitCode === SANDBOX_APPLY_FAILURE_EXIT) return true;
  const text = input.stderr.toLowerCase();
  return VIOLATION_MARKERS.some((m) => text.includes(m));
}

export function formatSandboxViolationError(
  command: string,
  stderr: string,
  exitCode: number,
): string {
  const detail = stderr.trim() || `exit ${exitCode}`;
  return (
    `OS sandbox denied or failed to apply for command "${command}": ${detail}. ` +
    `Usage: keep writes inside the workspace (and declared temp dirs) and avoid network when the sandbox network policy is deny.`
  );
}
