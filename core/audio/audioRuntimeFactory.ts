/**
 * v2.0.0 Phase 1 -- STT/TTS runtime selection for the sidecar.
 *
 * Production spawns `python -m runtimes.audio.main`. Tests and hosts without
 * Python set `NEXUS_AUDIO_INMEMORY=1` so the IPC contract runs with no
 * interpreter and no weights.
 *
 * Env knobs:
 *   NEXUS_AUDIO_INMEMORY -> force the in-memory mock
 *   NEXUS_AUDIO_PYTHON   -> python executable (default "python")
 *   NEXUS_AUDIO_CWD      -> cwd from which `runtimes.audio.main` is importable
 */

import { spawn } from "node:child_process";

import {
  ChildProcessAudioRuntime,
  InMemoryAudioRuntime,
  type AudioRuntimeClient,
} from "./AudioRuntimeClient.js";

export interface AudioRuntimeFactoryOptions {
  readonly spawnFn?: typeof spawn;
}

export function createAudioRuntime(
  env: NodeJS.ProcessEnv = process.env,
  options: AudioRuntimeFactoryOptions = {},
): AudioRuntimeClient {
  if (env["NEXUS_AUDIO_INMEMORY"]) {
    return new InMemoryAudioRuntime();
  }
  const cwd = env["NEXUS_AUDIO_CWD"];
  return new ChildProcessAudioRuntime({
    command: env["NEXUS_AUDIO_PYTHON"] || "python",
    ...(cwd ? { cwd } : {}),
    env,
    ...(options.spawnFn ? { spawnFn: options.spawnFn } : {}),
  });
}

export type AudioRuntime = AudioRuntimeClient;
