// v2.2.0 Phase 1 (1.3) -- reader for the installer-written runtime contract.
//
// The installer's RuntimeProvisioner records the provisioned runtime facts in
// `~/.nexus/runtime.json` (nodePath, diffusionPython, diffusionCwd,
// modelsRoot, ollama). The Rust shell reads `nodePath` to spawn this sidecar;
// this module lets the sidecar itself pick up the diffusion + models fields at
// boot by populating the env knobs the existing factories already honor
// (`NEXUS_DIFFUSION_PYTHON`, `NEXUS_DIFFUSION_CWD`, `NEXUS_MODELS_ROOT`).
//
// Explicit env vars always win: values are applied only when the variable is
// unset, so dev overrides and tests keep full control. A missing or corrupt
// runtime.json is a logged no-op, never a crash -- dev checkouts have no such
// file and must boot identically to before.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RuntimeConfigFile {
  schemaVersion?: number;
  nodePath?: string | null;
  diffusionPython?: string | null;
  diffusionCwd?: string | null;
  modelsRoot?: string | null;
  ollama?: { url?: string | null } | null;
}

/** `~/.nexus/runtime.json` -- must match the installer + Rust shell paths. */
export function runtimeConfigPath(home: string = homedir()): string {
  return join(home, ".nexus", "runtime.json");
}

/** Tolerant read: null when the file is absent, unreadable, or not JSON. */
export function readRuntimeConfig(
  path: string = runtimeConfigPath(),
): RuntimeConfigFile | null {
  try {
    const body = readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(body);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as RuntimeConfigFile;
  } catch {
    return null;
  }
}

/**
 * Populate the env knobs from the runtime config, without overriding values
 * that are already set. Returns the keys that were applied (for boot logging).
 */
export function applyRuntimeConfigEnv(
  env: NodeJS.ProcessEnv = process.env,
  config: RuntimeConfigFile | null = readRuntimeConfig(),
): string[] {
  if (!config) return [];
  const applied: string[] = [];
  const mappings: Array<[key: string, value: string | null | undefined]> = [
    ["NEXUS_DIFFUSION_PYTHON", config.diffusionPython],
    ["NEXUS_DIFFUSION_CWD", config.diffusionCwd],
    ["NEXUS_MODELS_ROOT", config.modelsRoot],
  ];
  for (const [key, value] of mappings) {
    if (typeof value === "string" && value.length > 0 && !env[key]) {
      env[key] = value;
      applied.push(key);
    }
  }
  return applied;
}
