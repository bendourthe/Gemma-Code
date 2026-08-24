/**
 * Facade around run_terminal spawn: prepare / spawn / teardown plus the
 * degraded-mode contract. When the setting is off or the backend is missing,
 * the child is launched with the historical spawn(shell:true) path and the
 * report states "unconfined". Execution is never silently unconfined.
 */

import type { ChildProcess } from "child_process";

import { createUnconfinedBackend } from "./backends/unconfined.js";
import { deriveDefaultPolicy } from "./policy.js";
import { inferSandboxMode, reportFromCapability } from "./report.js";
import { selectSandboxBackend } from "./selectBackend.js";
import type {
  SandboxBackend,
  SandboxLog,
  SandboxPolicy,
  SandboxPrepared,
  SandboxReport,
  SandboxSpawnRequest,
} from "./types.js";
import { UNCONFINED_TOKEN } from "./types.js";

const defaultLog: SandboxLog = {
  warn(message: string): void {
    process.stderr.write(`[nexus-sandbox] WARN ${message}\n`);
  },
  info(message: string): void {
    process.stderr.write(`[nexus-sandbox] INFO ${message}\n`);
  },
};

export interface SpawnSandboxedInput {
  readonly command: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly enabled: boolean;
  readonly policy?: SandboxPolicy;
  readonly backend?: SandboxBackend;
  readonly log?: SandboxLog;
}

export interface SpawnSandboxedResult {
  readonly child: ChildProcess;
  readonly report: SandboxReport;
}

function announce(report: SandboxReport, log: SandboxLog): void {
  if (report.mode === "confined") log.info(report.summary);
  else log.warn(report.summary);
}

function attachTeardown(child: ChildProcess, prepared: SandboxPrepared, backend: SandboxBackend): void {
  let done = false;
  const run = (): void => {
    if (done) return;
    done = true;
    backend.teardown(prepared);
  };
  child.once("close", run);
  child.once("error", run);
}

/**
 * Spawn a shell command under the selected OS backend, or unconfined when
 * that is the documented degraded path.
 */
export function spawnSandboxed(input: SpawnSandboxedInput): SpawnSandboxedResult {
  const log = input.log ?? defaultLog;
  const policy = input.policy ?? deriveDefaultPolicy(input.cwd);
  const osBackend = input.backend ?? selectSandboxBackend();
  const request: SandboxSpawnRequest = {
    command: input.command,
    cwd: input.cwd,
    env: input.env,
    signal: input.signal,
  };

  const capability = osBackend.probe();
  const useOsBackend = input.enabled && capability.available;
  const backend = useOsBackend ? osBackend : createUnconfinedBackend(capability);
  const prepared = backend.prepare(policy, input.enabled);
  const report = prepared.report;
  if (!report.summary.includes(UNCONFINED_TOKEN) && report.mode === "unconfined") {
    throw new Error("sandbox degraded-mode contract: unconfined report must contain the word unconfined");
  }
  announce(report, log);
  const child = backend.spawn(prepared, request);
  attachTeardown(child, prepared, backend);
  return { child, report };
}

/** Sync status for confirmation copy and the classifier. Does not spawn. */
export function describeSandbox(input: {
  readonly enabled: boolean;
  readonly cwd?: string;
  readonly backend?: SandboxBackend;
}): SandboxReport {
  const backend = input.backend ?? selectSandboxBackend();
  const capability = backend.probe();
  if (!input.enabled) {
    return reportFromCapability(false, capability);
  }
  if (!capability.available) {
    return reportFromCapability(true, capability);
  }
  return reportFromCapability(true, capability, inferSandboxMode(true, capability));
}

export function sandboxRequiresEnhancedConfirmation(report: SandboxReport): boolean {
  return report.enabled && report.mode !== "confined";
}
