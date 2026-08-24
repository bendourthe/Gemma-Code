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

const DARWIN_FIRMLINK_PREFIXES = ["/var", "/tmp", "/etc"] as const;

/**
 * Paths Seatbelt / Landlock should treat as the same root. On macOS, `/var`
 * is a firmlink to `/private/var` (same for `/tmp` and `/etc`). A profile
 * that only lists the realpath denies writes whose cwd is the public path
 * (sandbox-exec exit 65 on GitHub-hosted macOS runners).
 */
export function pathAliases(p: string): string[] {
  const resolved = path.resolve(p);
  const real = realOrSelf(p);
  const out = new Set<string>([p, resolved, real]);
  if (process.platform === "darwin") {
    for (const current of [...out]) {
      const posix = current.replace(/\\/g, "/");
      if (posix.startsWith("/private/")) {
        out.add(posix.slice("/private".length));
      } else {
        for (const prefix of DARWIN_FIRMLINK_PREFIXES) {
          if (posix === prefix || posix.startsWith(`${prefix}/`)) {
            out.add(`/private${posix}`);
          }
        }
      }
    }
  }
  return [...out];
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
  const homeDir = realOrSelf(options.homeDir ?? os.homedir());
  const extraWritable = (options.extraWritableRoots ?? []).flatMap((root) => {
    const real = realOrSelf(root);
    if (!isDirectory(real) && !isDirectory(root)) return [];
    return pathAliases(root);
  });
  const writable = unique([
    ...pathAliases(workspaceRoot),
    ...pathAliases(options.tmpDir ?? os.tmpdir()),
    ...extraWritable,
  ]);

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
