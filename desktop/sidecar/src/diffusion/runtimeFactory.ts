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

import {
  ChildProcessDiffusionRuntime,
  InMemoryDiffusionRuntime,
  type DiffusionRuntimeClient,
} from "./runtimeClient.js";

export interface DiffusionRuntimeFactoryOptions {
  /** Injectable spawn (tests). Forwarded to ChildProcessDiffusionRuntime. */
  readonly spawnFn?: typeof spawn;
}

/**
 * Select the diffusion runtime from the environment. Defaults to the real
 * child-process (Python) runtime; falls back to the in-memory mock only when
 * `NEXUS_DIFFUSION_INMEMORY` is set.
 */
export function createDiffusionRuntime(
  env: NodeJS.ProcessEnv = process.env,
  options: DiffusionRuntimeFactoryOptions = {},
): DiffusionRuntimeClient {
  if (env["NEXUS_DIFFUSION_INMEMORY"]) {
    return new InMemoryDiffusionRuntime();
  }
  const cwd = env["NEXUS_DIFFUSION_CWD"];
  return new ChildProcessDiffusionRuntime({
    command: env["NEXUS_DIFFUSION_PYTHON"] || "python",
    ...(cwd ? { cwd } : {}),
    env,
    ...(options.spawnFn ? { spawnFn: options.spawnFn } : {}),
  });
}
