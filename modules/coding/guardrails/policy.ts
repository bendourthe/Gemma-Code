/**
 * Command-level hard denials: shapes that are rejected unconditionally
 * before the allowlist, before confirmation, and in every security posture.
 *
 * The list is strictly subtractive: it can only block, never permit. Phase 2.5
 * postures compose over this file as a shared invariant. Keep `BLOCKED_PATTERNS`
 * derived from the declaration so ActionClassifier / commandBlocklist stay in
 * lockstep with the data.
 *
 * Matcher (commandBlocklist.ts): case-insensitive substring after whitespace
 * collapse. Put more specific patterns first so `findBlockedPattern` reports
 * the tightest match (tests pin `rm -rf /` over the broader `rm -rf `).
 *
 * Boundary: vscode-free. No I/O.
 */

export type HardDenialFamily =
  | "catastrophic-os"
  | "recursive-delete"
  | "git-history"
  | "destructive-sql";

export interface HardDenial {
  readonly id: string;
  readonly family: HardDenialFamily;
  readonly pattern: string;
  readonly reason: string;
}

export const HARD_DENIALS: readonly HardDenial[] = [
  // Catastrophic OS (v0 blocklist). Do not reorder the first group: dry-run
  // reports and unit tests pin the exact first-match substring.
  {
    id: "rm-rf-root",
    family: "catastrophic-os",
    pattern: "rm -rf /",
    reason: "Recursive delete of the filesystem root.",
  },
  {
    id: "rm-rf-root-glob",
    family: "catastrophic-os",
    pattern: "rm -rf /*",
    reason: "Recursive delete of every entry under the filesystem root.",
  },
  {
    id: "rm-rf-home",
    family: "catastrophic-os",
    pattern: "rm -rf ~",
    reason: "Recursive delete of the user home directory.",
  },
  {
    id: "format-c",
    family: "catastrophic-os",
    pattern: "format c:",
    reason: "Formats the C: volume.",
  },
  {
    id: "format-d",
    family: "catastrophic-os",
    pattern: "format d:",
    reason: "Formats the D: volume.",
  },
  {
    id: "shutdown",
    family: "catastrophic-os",
    pattern: "shutdown",
    reason: "Halts or reboots the host.",
  },
  {
    id: "halt",
    family: "catastrophic-os",
    pattern: "halt",
    reason: "Halts the host.",
  },
  {
    id: "init-0",
    family: "catastrophic-os",
    pattern: "init 0",
    reason: "SysV shutdown to runlevel 0.",
  },
  {
    id: "del-c-root",
    family: "catastrophic-os",
    pattern: "del /f /s /q c:\\",
    reason: "Recursive forced delete of the C: volume.",
  },
  {
    id: "del-c-root-slash",
    family: "catastrophic-os",
    pattern: "del /f /s /q c:/",
    reason: "Recursive forced delete of the C: volume (slash form).",
  },
  {
    id: "rd-c-root",
    family: "catastrophic-os",
    pattern: "rd /s /q c:\\",
    reason: "Recursive remove of the C: volume.",
  },
  {
    id: "mkfs",
    family: "catastrophic-os",
    pattern: "mkfs",
    reason: "Creates a filesystem, destroying existing data.",
  },
  {
    id: "dd-zero",
    family: "catastrophic-os",
    pattern: "dd if=/dev/zero",
    reason: "Overwrites a block device with zeros.",
  },
  {
    id: "redirect-sda",
    family: "catastrophic-os",
    pattern: "> /dev/sda",
    reason: "Redirects output onto a raw block device.",
  },

  // Recursive deletes of arbitrary targets (QM A3). Trailing space on Unix
  // flags so `rm -rf./x` (concatenated) is not a false positive, while
  // `rm -rf ./tmp` and `rm -rf /` still match.
  {
    id: "rm-rf-any",
    family: "recursive-delete",
    pattern: "rm -rf ",
    reason: "Recursive force-delete of an arbitrary path.",
  },
  {
    id: "rm-fr-any",
    family: "recursive-delete",
    pattern: "rm -fr ",
    reason: "Recursive force-delete of an arbitrary path (flag swap).",
  },
  {
    id: "rm-r-any",
    family: "recursive-delete",
    pattern: "rm -r ",
    reason: "Recursive delete of an arbitrary path.",
  },
  {
    id: "rmdir-s",
    family: "recursive-delete",
    pattern: "rmdir /s",
    reason: "Windows recursive directory delete.",
  },
  {
    id: "rd-s",
    family: "recursive-delete",
    pattern: "rd /s",
    reason: "Windows recursive directory delete (rd).",
  },
  {
    id: "remove-item-recurse",
    family: "recursive-delete",
    pattern: "remove-item -recurse",
    reason: "PowerShell recursive delete.",
  },

  // Git history rewrites. `git reset` without --hard stays DESTRUCTIVE (not
  // BLOCKED) so mixed-in-index resets still go through confirmation.
  {
    id: "git-reset-hard",
    family: "git-history",
    pattern: "git reset --hard",
    reason: "Discards uncommitted work and moves HEAD.",
  },
  {
    id: "git-push-force-long",
    family: "git-history",
    pattern: "git push --force",
    reason: "Force-push rewrites remote history (includes --force-with-lease).",
  },
  {
    id: "git-push-force-short",
    family: "git-history",
    pattern: "git push -f",
    reason: "Force-push rewrites remote history.",
  },
  {
    id: "git-filter-branch",
    family: "git-history",
    pattern: "git filter-branch",
    reason: "Rewrites published commit history.",
  },
  {
    id: "git-filter-repo",
    family: "git-history",
    pattern: "git filter-repo",
    reason: "Rewrites published commit history.",
  },
  {
    id: "git-rebase-interactive",
    family: "git-history",
    pattern: "git rebase -i",
    reason: "Interactive rebase rewrites commit history.",
  },

  // Destructive SQL. DELETE FROM stays DESTRUCTIVE (confirm) because it is
  // common in application code; DROP/TRUNCATE are the hard-denied shapes.
  {
    id: "drop-table",
    family: "destructive-sql",
    pattern: "drop table",
    reason: "Drops a database table.",
  },
  {
    id: "drop-database",
    family: "destructive-sql",
    pattern: "drop database",
    reason: "Drops a database.",
  },
  {
    id: "truncate-table",
    family: "destructive-sql",
    pattern: "truncate table",
    reason: "Truncates a database table.",
  },
];

/** Substring list consumed by commandBlocklist.isBlocked / findBlockedPattern. */
export const BLOCKED_PATTERNS: readonly string[] = HARD_DENIALS.map((d) => d.pattern);

export function findHardDenial(pattern: string): HardDenial | undefined {
  return HARD_DENIALS.find((d) => d.pattern === pattern);
}
