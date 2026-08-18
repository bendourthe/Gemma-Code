/**
 * Windows policy enforcement matrix for the v1.18.0 OS sandbox.
 *
 * Job objects and restricted tokens are first-class on this platform. They do
 * not implement a filesystem or network allow-list comparable to Seatbelt or
 * Landlock. AppContainer is not applied this cycle (capability SIDs break
 * typical coding CLIs). Partial confinement is therefore the honest mode:
 * never reported as "confined".
 */

import type { SandboxDimension } from "./types.js";

export interface WindowsEnforcementRow {
  readonly dimension: SandboxDimension;
  readonly enforced: boolean;
  readonly mechanism: string;
  readonly notes: string;
}

export const WINDOWS_ENFORCEMENT_MATRIX: readonly WindowsEnforcementRow[] = [
  {
    dimension: "process-limits",
    enforced: true,
    mechanism: "Job object (KILL_ON_JOB_CLOSE, ACTIVE_PROCESS, JOB_MEMORY)",
    notes: "Child and its descendants are assigned to the job when CreateProcess is used with CREATE_SUSPENDED then AssignProcessToJobObject before ResumeThread.",
  },
  {
    dimension: "restricted-token",
    enforced: true,
    mechanism: "CreateRestrictedToken(DISABLE_MAX_PRIVILEGE) + CreateProcessWithTokenW",
    notes: "Best-effort. If the host lacks SeAssignPrimaryToken / SeImpersonate, the backend falls back to the current token inside the job and records restricted-token as unenforced for that spawn.",
  },
  {
    dimension: "filesystem",
    enforced: false,
    mechanism: "none (AppContainer not applied)",
    notes: "Job objects do not restrict path writes. Writable-root policy is NOT kernel-enforced on Windows. The secret-path and touched-path denylists still apply at the tool layer.",
  },
  {
    dimension: "network",
    enforced: false,
    mechanism: "none",
    notes: "Job objects do not block sockets. Network deny is NOT kernel-enforced on Windows. The SSRF denylist still applies only to Nexus's own fetch, not to spawned commands.",
  },
];

export const WINDOWS_ENFORCED_DIMENSIONS: readonly SandboxDimension[] =
  WINDOWS_ENFORCEMENT_MATRIX.filter((row) => row.enforced).map((row) => row.dimension);

export const WINDOWS_UNENFORCED_DIMENSIONS: readonly SandboxDimension[] =
  WINDOWS_ENFORCEMENT_MATRIX.filter((row) => !row.enforced).map((row) => row.dimension);

export function formatWindowsMatrixMarkdown(): string {
  const header =
    "| Dimension | Enforced | Mechanism | Notes |\n|---|---|---|---|";
  const rows = WINDOWS_ENFORCEMENT_MATRIX.map(
    (row) =>
      `| ${row.dimension} | ${row.enforced ? "yes" : "NO"} | ${row.mechanism} | ${row.notes} |`,
  );
  return [header, ...rows].join("\n");
}
