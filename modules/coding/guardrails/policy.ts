/**
 * Hard blocklist: commands matching these patterns are rejected unconditionally
 * as a defense-in-depth layer. Kept advisory (not the primary safety mechanism)
 * after the allowlist transition.
 *
 * The allowlist lives in `src/tools/handlers/terminal.ts` because it is tightly
 * coupled to how commands are parsed at the tool boundary. This file holds the
 * portable blocklist that any guardrail can reuse.
 */
export const BLOCKED_PATTERNS: readonly string[] = [
  "rm -rf /",
  "rm -rf /*",
  "rm -rf ~",
  "format c:",
  "format d:",
  "shutdown",
  "halt",
  "init 0",
  "del /f /s /q c:\\",
  "del /f /s /q c:/",
  "rd /s /q c:\\",
  "mkfs",
  "dd if=/dev/zero",
  "> /dev/sda",
];
