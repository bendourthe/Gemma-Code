/**
 * v1.18.0 Phase 6 (OI-A1) -- OS process sandbox types.
 *
 * One policy object, three backends (macOS Seatbelt, Linux Landlock+seccomp,
 * Windows job object + restricted token). The sandbox is a net risk reduction
 * on top of confirmation, denylists, env scrub, and GitSafetyNet. It never
 * replaces those guardrails.
 */

import type { ChildProcess } from "child_process";

/** How loudly the spawn path is confined. Never implied: always stated. */
export type SandboxMode = "confined" | "partial" | "unconfined";

/** Policy dimensions a backend may or may not enforce. */
export type SandboxDimension =
  | "filesystem"
  | "network"
  | "process-limits"
  | "restricted-token";

export type SandboxNetworkPolicy = "deny" | "allow";

/**
 * Per-run confinement policy. Defaults are derived from the session project
 * root plus well-known secret directories so the OS sandbox and the
 * secret-path denylist agree on what is out of scope.
 */
export interface SandboxPolicy {
  /** Absolute directories the child may write (workspace + declared temp). */
  readonly writableRoots: readonly string[];
  /**
   * Absolute directories the child may read. Empty means "broad read"
   * (system + workspace) with extra deny-read roots applied when the backend
   * supports them.
   */
  readonly readableRoots: readonly string[];
  /** Absolute directories that must not be readable (e.g. ~/.ssh). */
  readonly denyReadRoots: readonly string[];
  readonly network: SandboxNetworkPolicy;
  /** Soft cap on processes in the job / cgroup. 0 means unspecified. */
  readonly maxProcesses: number;
  /** Soft memory cap in bytes. 0 means unspecified. */
  readonly maxMemoryBytes: number;
  /** Workspace root the command is scoped to (for reports and profiles). */
  readonly workspaceRoot: string;
}

export interface SandboxCapability {
  readonly platform: NodeJS.Platform;
  readonly backendId: string;
  /** True when this host can apply the backend's confinement. */
  readonly available: boolean;
  /** Human-readable probe result (kernel ABI, binary missing, etc.). */
  readonly detail: string;
  readonly enforced: readonly SandboxDimension[];
  readonly unenforced: readonly SandboxDimension[];
}

/**
 * Loud status attached to every `run_terminal` spawn. `mode` is the string
 * the UI and logs must print; "unconfined" is never silent.
 */
export interface SandboxReport {
  readonly mode: SandboxMode;
  readonly backendId: string;
  readonly enabled: boolean;
  /** One-line reason, including the literal word "unconfined" when applicable. */
  readonly summary: string;
  readonly enforced: readonly SandboxDimension[];
  readonly unenforced: readonly SandboxDimension[];
  readonly capability: SandboxCapability;
}

export interface SandboxPrepared {
  readonly policy: SandboxPolicy;
  readonly report: SandboxReport;
  /** Temp files the backend created (profile, helper script). */
  readonly artifacts: readonly string[];
  readonly extraEnv: NodeJS.ProcessEnv;
}

export interface SandboxSpawnRequest {
  readonly command: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
}

export interface SandboxBackend {
  readonly id: string;
  probe(): SandboxCapability;
  prepare(policy: SandboxPolicy, enabled: boolean): SandboxPrepared;
  spawn(prepared: SandboxPrepared, request: SandboxSpawnRequest): ChildProcess;
  teardown(prepared: SandboxPrepared): void;
}

export interface SandboxLog {
  warn(message: string): void;
  info(message: string): void;
}

export const SANDBOX_APPLY_FAILURE_EXIT = 125;

/** Exact token required in UI/logs when confinement is absent. */
export const UNCONFINED_TOKEN = "unconfined";
