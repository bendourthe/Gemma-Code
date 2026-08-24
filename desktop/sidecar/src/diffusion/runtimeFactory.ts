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

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

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
