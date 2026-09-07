// v1.7.0 -- diffusion runtime selection for the desktop sidecar.
//
// The Image Studio + Video Lab pillars route `diffusion.*` IPC methods through
// a `DiffusionRuntimeClient`. Production uses `ChildProcessDiffusionRuntime`,
// which lazily spawns the real Python runtime (`python -m runtimes.diffusion.main`,
// the Sana / img2img / inpaint / outpaint pipelines under `runtimes/diffusion/`).
// Tests and non-GPU dev set `NEXUS_DIFFUSION_INMEMORY=1` to use the mock so the
// IPC contract can be exercised without a Python interpreter, models, or a GPU.
//
// Env knobs:
//   NEXUS_DIFFUSION_INMEMORY  -> force the in-memory mock (tests / no-GPU dev)
//   NEXUS_DIFFUSION_PYTHON    -> python executable (default "python")
//   NEXUS_DIFFUSION_CWD       -> cwd from which `runtimes.diffusion.main` is importable

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  readRuntimeConfig,
  runtimeConfigPath,
  type RuntimeConfigFile,
} from "../runtimeConfig.js";

import {
  ChildProcessDiffusionRuntime,
  InMemoryDiffusionRuntime,
  type DiffusionEvent,
  type DiffusionRuntimeClient,
} from "./runtimeClient.js";

export interface DiffusionRuntimeFactoryOptions {
  /** Injectable spawn (tests). Forwarded to ChildProcessDiffusionRuntime. */
  readonly spawnFn?: typeof spawn;
  /** Injectable existence probe (tests). Defaults to fs.existsSync. */
  readonly existsFn?: (path: string) => boolean;
  /** Production passes the shared repair service for hot recovery. */
  readonly mediaRuntimeService?: MediaRuntimeService;
}

export type MediaRuntimeStateName = "ready" | "repairable" | "repairing" | "failed";

export interface MediaRuntimeState {
  readonly state: MediaRuntimeStateName;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly progress: number;
  readonly details?: string;
  readonly logPath: string;
}

export interface MediaRuntimeServiceOptions {
  readonly configPath?: string;
  readonly readConfig?: (path: string) => RuntimeConfigFile | null;
  readonly existsFn?: (path: string) => boolean;
  readonly spawnFn?: typeof spawn;
  readonly pidAliveFn?: (pid: number) => boolean;
}

const FAILURE_MESSAGES: Record<string, string> = {
  NOT_REQUESTED: "No image or video model was selected during installation.",
  MANIFEST_INVALID: "The pinned media-runtime manifest is missing or invalid.",
  UNSUPPORTED_GPU: "This GPU does not have a supported local media backend.",
  CUDA_UNAVAILABLE: "The installed PyTorch build cannot access the NVIDIA GPU.",
  MPS_UNAVAILABLE: "The installed PyTorch build cannot access Apple Metal.",
  PYTHON_NOT_FOUND: "The local media Python interpreter is missing.",
  PYTHON_ABI_UNAVAILABLE: "The local Python version could not be inspected.",
  PYTHON_ABI_UNSUPPORTED: "No verified PyTorch package matches this Python version.",
  ARTIFACT_DOWNLOAD_FAILED: "A verified media-runtime package could not be downloaded.",
  ARTIFACT_INTEGRITY_FAILED: "A downloaded media-runtime package failed integrity verification.",
  IMPORT_SMOKE_FAILED: "The installed media packages failed their import test.",
  ENCODER_UNAVAILABLE: "The local video encoder is missing.",
  REPAIR_BUSY: "Another process is repairing the media runtime.",
  TORCH_TOO_OLD:
    "The installed PyTorch is older than 2.4, which the video pipeline needs. Repair reinstalls the pinned media packages.",
};

/**
 * v2.4.8 Phase 8: the oldest torch the media runtime accepts. diffusers 0.36's
 * SANA-Video pipeline imports `torch.nn.RMSNorm` (torch 2.4+). The operator's
 * runtime.json read `ready` with torch 2.3.0+cu121 and the first video
 * generate failed with an AttributeError; a recorded version below this floor
 * is now a repairable state, and repair installs the lock's 2.5.1 stack.
 */
export const MIN_TORCH_VERSION: readonly [number, number] = [2, 4];

export function torchTooOld(version: string | undefined): boolean {
  const core = (version ?? "").split("+", 1)[0]?.trim() ?? "";
  if (!core) return false;
  const [major, minor = "0"] = core.split(".");
  const maj = Number(major);
  const min = Number(minor);
  if (!Number.isInteger(maj) || !Number.isInteger(min)) return false;
  return maj < MIN_TORCH_VERSION[0] || (maj === MIN_TORCH_VERSION[0] && min < MIN_TORCH_VERSION[1]);
}

function failureMessage(code: string): string {
  return FAILURE_MESSAGES[code] ?? `Media runtime readiness failed (${code}).`;
}

/** Shared Image Studio / Video Lab readiness and bounded repair coordinator. */
export class MediaRuntimeService {
  private readonly configPath: string;
  private readonly readConfigFn: (path: string) => RuntimeConfigFile | null;
  private readonly exists: (path: string) => boolean;
  private readonly spawnFn: typeof spawn;
  private readonly pidAlive: (pid: number) => boolean;
  private child: ChildProcessWithoutNullStreams | null = null;
  private liveState: MediaRuntimeState | null = null;

  constructor(options: MediaRuntimeServiceOptions = {}) {
    this.configPath = options.configPath ?? runtimeConfigPath();
    this.readConfigFn = options.readConfig ?? readRuntimeConfig;
    this.exists = options.existsFn ?? existsSync;
    this.spawnFn = options.spawnFn ?? spawn;
    this.pidAlive = options.pidAliveFn ?? ((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
  }

  config(): RuntimeConfigFile | null {
    return this.readConfigFn(this.configPath);
  }

  status(): MediaRuntimeState {
    if (this.child && this.liveState) return this.liveState;
    const config = this.config();
    const logPath = join(dirname(this.configPath), "logs", "media-runtime-repair.log");
    if (!config) {
      return { state: "failed", code: "CONTRACT_MISSING", message: "The media-runtime installation record is missing.", retryable: false, progress: 0, logPath };
    }
    const readiness = config.diffusion;
    const staleTorch = readiness?.status === "ready" && torchTooOld(readiness.torch_version);
    const code = staleTorch ? "TORCH_TOO_OLD" : readiness?.failure_code || "RUNTIME_NOT_READY";
    const python = config.diffusionPython || "";
    const cwd = config.diffusionCwd || "";
    const repairModule = cwd ? join(cwd, "runtimes", "diffusion", "repair.py") : "";
    const repairLock = cwd ? join(cwd, "runtimes", "diffusion", "runtime-lock.json") : "";
    const executableReady = Boolean(python && cwd && this.exists(python) && this.exists(cwd));
    if (readiness?.status === "ready" && executableReady && !staleTorch) {
      return { state: "ready", code: "READY", message: "Image and video generation is ready.", retryable: false, progress: 1, logPath };
    }
    const repairable = Boolean(executableReady && this.exists(repairModule) && this.exists(repairLock));
    const recordedRepair = config.repairAttempt;
    if (
      recordedRepair?.status === "repairing" &&
      typeof recordedRepair.ownerPid === "number" &&
      this.pidAlive(recordedRepair.ownerPid)
    ) {
      return {
        state: "repairing",
        code: "REPAIR_BUSY",
        message: "Another Nexus process is repairing the local media runtime.",
        retryable: false,
        progress: 0,
        details: "The studios will become available after that repair finishes.",
        logPath,
      };
    }
    return {
      state: repairable ? "repairable" : "failed",
      code: recordedRepair?.status === "repairing" ? "INTERRUPTED_REPAIR" : code,
      message: recordedRepair?.status === "repairing"
        ? "The previous media repair was interrupted and can be resumed."
        : failureMessage(code),
      retryable: repairable,
      progress: 0,
      details: repairable
        ? "Nexus can reinstall the pinned media packages in place. Your prompt and attachments will be preserved."
        : "Run the latest Nexus installer because a required interpreter or repair manifest is absent.",
      logPath,
    };
  }

  startRepair(): MediaRuntimeState {
    if (this.child) return this.status();
    const current = this.status();
    if (current.state !== "repairable") return current;
    const config = this.config();
    const command = config?.diffusionPython;
    const cwd = config?.diffusionCwd;
    if (!command || !cwd) return current;
    this.liveState = { ...current, state: "repairing", code: "REPAIRING", message: "Repairing the local media runtime...", progress: 0.01 };
    const child = this.spawnFn(command, ["-m", "runtimes.diffusion.repair", "--runtime-config", this.configPath], {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    this.child = child;
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as { kind?: string; progress?: number; message?: string; code?: string };
          if (event.kind === "progress") {
            this.liveState = {
              ...(this.liveState ?? current),
              state: "repairing",
              code: "REPAIRING",
              progress: Math.min(1, Math.max(0, Number(event.progress) || 0)),
              message: event.message || "Repairing the local media runtime...",
            };
          }
        } catch {
          // Non-JSON diagnostic output is retained in stderr/details only.
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr = `${stderr}${String(chunk)}`.slice(-2000);
    });
    child.once("error", (error) => {
      this.child = null;
      this.liveState = { ...current, state: "failed", code: "REPAIR_START_FAILED", message: "The media repair process could not start.", retryable: true, details: error.message };
    });
    child.once("exit", (exitCode) => {
      this.child = null;
      const reconciled = this.status();
      this.liveState = reconciled.state === "ready"
        ? reconciled
        : { ...reconciled, details: stderr.trim() || reconciled.details, retryable: reconciled.state === "repairable" };
      if (exitCode === 0 && reconciled.state !== "ready") {
        this.liveState = { ...reconciled, state: "failed", code: "REPAIR_CONTRACT_INVALID", message: "Repair finished without a valid ready contract." };
      }
    });
    return this.liveState;
  }

  cancelRepair(): MediaRuntimeState {
    if (this.child) {
      this.child.kill();
      this.child = null;
      this.liveState = null;
    }
    return this.status();
  }

  openLogLocation(): { opened: boolean } {
    const directory = dirname(this.status().logPath);
    const [command, args] = process.platform === "win32"
      ? ["explorer.exe", [directory]]
      : process.platform === "darwin"
        ? ["open", [directory]]
        : ["xdg-open", [directory]];
    try {
      const child = this.spawnFn(command, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      return { opened: true };
    } catch {
      return { opened: false };
    }
  }
}

class RepairAwareDiffusionRuntime implements DiffusionRuntimeClient {
  private delegate: DiffusionRuntimeClient | null = null;

  constructor(
    private readonly service: MediaRuntimeService,
    private readonly env: NodeJS.ProcessEnv,
    private readonly options: DiffusionRuntimeFactoryOptions,
  ) {}

  private readyDelegate(): DiffusionRuntimeClient {
    const state = this.service.status();
    if (state.state !== "ready") {
      throw new Error(`runtime-unavailable: ${state.message}`);
    }
    if (!this.delegate) {
      const config = this.service.config();
      this.delegate = new ChildProcessDiffusionRuntime({
        command: config?.diffusionPython || this.env["NEXUS_DIFFUSION_PYTHON"] || "python",
        ...(config?.diffusionCwd ? { cwd: config.diffusionCwd } : {}),
        env: this.env,
        ...(this.options.spawnFn ? { spawnFn: this.options.spawnFn } : {}),
      });
    }
    return this.delegate;
  }

  call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    try {
      return this.readyDelegate().call<T>(method, params);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  drainEvents(jobId: string): readonly DiffusionEvent[] {
    return this.delegate?.drainEvents(jobId) ?? [];
  }

  async shutdown(): Promise<void> {
    await this.delegate?.shutdown();
    this.delegate = null;
  }
}

/**
 * v2.2.0 Phase 1 (1.3): typed stand-in when the configured diffusion Python is
 * absent (venv renamed/removed, or provisioning skipped). Every call rejects
 * with a `runtime-unavailable: ...` error the studios can render with a
 * provision hint -- a deterministic failure instead of a spawn crash or hang.
 */
export class UnavailableDiffusionRuntime implements DiffusionRuntimeClient {
  readonly reason: string;

  constructor(reason: string) {
    this.reason = reason;
  }

  call<T = unknown>(): Promise<T> {
    return Promise.reject(new Error(`runtime-unavailable: ${this.reason}`));
  }

  drainEvents(): readonly DiffusionEvent[] {
    return [];
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Select the diffusion runtime from the environment. Defaults to the real
 * child-process (Python) runtime; falls back to the in-memory mock only when
 * `NEXUS_DIFFUSION_INMEMORY` is set. An explicitly configured
 * `NEXUS_DIFFUSION_PYTHON` that does not exist on disk yields the typed
 * `UnavailableDiffusionRuntime` (never a silent bare-`python` fallback).
 */
export function createDiffusionRuntime(
  env: NodeJS.ProcessEnv = process.env,
  options: DiffusionRuntimeFactoryOptions = {},
): DiffusionRuntimeClient {
  if (env["NEXUS_DIFFUSION_INMEMORY"]) {
    return new InMemoryDiffusionRuntime();
  }
  if (options.mediaRuntimeService) {
    return new RepairAwareDiffusionRuntime(options.mediaRuntimeService, env, options);
  }
  const notReady = env["NEXUS_DIFFUSION_NOT_READY"];
  if (notReady) {
    const reasons: Record<string, string> = {
      NOT_REQUESTED: "no image or video model was selected during installation",
      MANIFEST_INVALID: "the pinned runtime manifest is missing or invalid",
      UNSUPPORTED_GPU: "the detected GPU does not have a supported diffusion backend",
      CUDA_UNAVAILABLE: "the installed torch build cannot access CUDA",
      MPS_UNAVAILABLE: "the installed torch build cannot access Apple Metal",
      PYTHON_NOT_FOUND: "a supported local Python interpreter was not found",
      PYTHON_ABI_UNAVAILABLE: "the selected Python interpreter could not be inspected",
      PYTHON_ABI_UNSUPPORTED: "no verified PyTorch artifact matches the selected Python interpreter",
      ARTIFACT_DOWNLOAD_FAILED: "a pinned runtime artifact could not be downloaded",
      ARTIFACT_SIZE_MISMATCH: "a downloaded runtime artifact had an unexpected size",
      ARTIFACT_CHECKSUM_MISMATCH: "a downloaded runtime artifact failed integrity verification",
      DOWNLOAD_CANCELLED: "runtime setup was cancelled before it completed",
      IMPORT_SMOKE_FAILED: "the installed diffusion packages failed their import smoke test",
      SMOKE_TIMEOUT: "the diffusion readiness test timed out",
      REPAIR_BUSY: "another installer process is repairing the diffusion runtime",
    };
    return new UnavailableDiffusionRuntime(
      `${reasons[notReady] ?? `runtime readiness failed (${notReady})`}; ` +
        "re-run the installer to repair image and video generation",
    );
  }
  const exists = options.existsFn ?? existsSync;
  const configuredPython = env["NEXUS_DIFFUSION_PYTHON"];
  // Guard only concrete paths (the runtime.json contract writes absolute
  // paths); a bare command name like "python3" resolves via PATH at spawn.
  const looksLikePath =
    typeof configuredPython === "string" &&
    (configuredPython.includes("/") || configuredPython.includes("\\"));
  if (configuredPython && looksLikePath && !exists(configuredPython)) {
    return new UnavailableDiffusionRuntime(
      `diffusion python not found at ${configuredPython}; ` +
        "re-run the installer to provision the diffusion environment",
    );
  }
  const cwd = env["NEXUS_DIFFUSION_CWD"];
  return new ChildProcessDiffusionRuntime({
    command: configuredPython || "python",
    ...(cwd ? { cwd } : {}),
    env,
    ...(options.spawnFn ? { spawnFn: options.spawnFn } : {}),
  });
}
