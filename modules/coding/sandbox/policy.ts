/**
 * Default sandbox policy: writable roots = workspace + OS temp; network deny;
 * deny-read of well-known secret directories outside the workspace so the OS
 * sandbox and the secret-path denylist agree on those paths.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { SandboxNetworkPolicy, SandboxPolicy } from "./types.js";

/** Home-relative secret directories the OS sandbox should not read. */
export const DEFAULT_SECRET_DIR_NAMES: readonly string[] = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".netrc",
  ".pki",
];

const DEFAULT_MAX_PROCESSES = 64;
const DEFAULT_MAX_MEMORY_BYTES = 1_073_741_824;

function realOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function isInside(root: string, candidate: string): boolean {
  const a = realOrSelf(root);
  const b = realOrSelf(candidate);
  return b === a || b.startsWith(a + path.sep);
}

export interface DerivePolicyOptions {
  readonly tmpDir?: string;
  readonly homeDir?: string;
  readonly network?: SandboxNetworkPolicy;
  readonly extraWritableRoots?: readonly string[];
  readonly extraDenyReadRoots?: readonly string[];
  readonly maxProcesses?: number;
  readonly maxMemoryBytes?: number;
}

/**
 * Build the default per-run policy from the session project root.
 * Writable roots never include the user home or `~/.nexus` (parent-process
 * tees stay in the unconfined host). Temp is always included so compilers
 * and test runners can use scratch space.
 */
export function deriveDefaultPolicy(
  workspaceRoot: string,
  options: DerivePolicyOptions = {},
): SandboxPolicy {
  const workspace = realOrSelf(workspaceRoot);
  const tmpDir = realOrSelf(options.tmpDir ?? os.tmpdir());
  const homeDir = realOrSelf(options.homeDir ?? os.homedir());
  const extraWritable = (options.extraWritableRoots ?? [])
    .map(realOrSelf)
    .filter(isDirectory);
  const writable = unique([workspace, tmpDir, ...extraWritable]);

  const denyRead: string[] = [];
  for (const name of DEFAULT_SECRET_DIR_NAMES) {
    const abs = path.join(homeDir, name);
    if (isInside(workspace, abs)) continue;
    denyRead.push(abs);
  }
  for (const extra of options.extraDenyReadRoots ?? []) {
    const abs = realOrSelf(extra);
    if (isInside(workspace, abs)) continue;
    denyRead.push(abs);
  }

  return {
    writableRoots: writable,
    readableRoots: [],
    denyReadRoots: unique(denyRead),
    network: options.network ?? "deny",
    maxProcesses: options.maxProcesses ?? DEFAULT_MAX_PROCESSES,
    maxMemoryBytes: options.maxMemoryBytes ?? DEFAULT_MAX_MEMORY_BYTES,
    workspaceRoot: workspace,
  };
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = process.platform === "win32" ? v.toLowerCase() : v;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
