// v1.16.0 Phase 3 (adoption item A5) -- OCR runtime selection for the sidecar.
//
// Mirrors `diffusion/runtimeFactory.ts`. Production spawns the real Python
// runtime (`python -m runtimes.ocr.main`); tests and hosts without a Python
// environment set `NEXUS_OCR_INMEMORY=1` to exercise the IPC contract with no
// interpreter, no model weights, and no GPU.
//
// Env knobs:
//   NEXUS_OCR_INMEMORY -> force the in-memory mock (tests / dev)
//   NEXUS_OCR_PYTHON   -> python executable (default "python")
//   NEXUS_OCR_CWD      -> cwd from which `runtimes.ocr.main` is importable

import { spawn } from "node:child_process";

import {
  ChildProcessOcrRuntime,
  InMemoryOcrRuntime,
  type OcrRuntimeClient,
} from "./OcrRuntimeClient.js";
import { OcrParseManager } from "./OcrParseManager.js";

export interface OcrRuntimeFactoryOptions {
  /** Injectable spawn (tests). Forwarded to ChildProcessOcrRuntime. */
  readonly spawnFn?: typeof spawn;
}

export function createOcrRuntime(
  env: NodeJS.ProcessEnv = process.env,
  options: OcrRuntimeFactoryOptions = {},
): OcrRuntimeClient {
  if (env["NEXUS_OCR_INMEMORY"]) {
    return new InMemoryOcrRuntime();
  }
  const cwd = env["NEXUS_OCR_CWD"];
  return new ChildProcessOcrRuntime({
    command: env["NEXUS_OCR_PYTHON"] || "python",
    ...(cwd ? { cwd } : {}),
    env,
    ...(options.spawnFn ? { spawnFn: options.spawnFn } : {}),
  });
}

/** The client + job manager pair the `ocr.*` handlers consume. */
export interface OcrRuntime {
  readonly client: OcrRuntimeClient;
  readonly parser: OcrParseManager;
}

export function createOcrRuntimeBundle(
  env: NodeJS.ProcessEnv = process.env,
  options: OcrRuntimeFactoryOptions = {},
): OcrRuntime {
  const client = createOcrRuntime(env, options);
  return { client, parser: new OcrParseManager(client) };
}
