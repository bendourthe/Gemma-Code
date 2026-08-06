/**
 * v1.0.0 Phase 3.3 -- desktop daemon discovery for the thin VS Code adapter.
 *
 * The VS Code extension is moving from a full in-process engine to a thin
 * adapter that proxies to the Nexus desktop daemon. On activation the
 * extension calls `discoverDesktopDaemon()`; the helper checks for a live
 * daemon by attempting a `ping` IPC against the platform-conventional
 * socket / named pipe path. If found, the extension proxies; if absent and
 * the user has opted into "extension-only mode", the engine falls back to
 * running in-process exactly as it did in v0.22.x.
 *
 * The full extension rewrite (replacing `src/extension.ts` and the panel
 * webview hosts with the proxy plumbing) is tracked in v1.0.0 known-gaps
 * and is the largest piece of Phase 3 follow-on work. This module ships the
 * discovery + fallback decision logic only, because that surface is what
 * every downstream consumer (extension activation, panel host, MCP bridge)
 * needs to import.
 */

import { existsSync } from "node:fs";
import { platform, homedir } from "node:os";
import { join } from "node:path";

export type DaemonMode = "proxy" | "extension-only";

export interface DaemonDiscoveryOptions {
  /**
   * Override the path probe. Tests pass a synthetic path; the helper does not
   * touch the filesystem when this is set.
   */
  readonly probePath?: string;
  /**
   * Override the existence check. Defaults to `fs.existsSync`.
   */
  readonly existsFn?: (path: string) => boolean;
  /**
   * `true` when the user has opted into extension-only mode in their
   * settings. Resolved by the extension activator before calling this
   * helper.
   */
  readonly extensionOnlyOptIn?: boolean;
  /** Override `process.platform` for unit tests. */
  readonly platformOverride?: NodeJS.Platform;
  /** Override `os.homedir()` for unit tests. */
  readonly homeDirOverride?: string;
}

export interface DaemonDiscoveryResult {
  readonly mode: DaemonMode;
  /** Resolved socket / pipe path that was probed. */
  readonly probedPath: string;
  /** Whether a live daemon was detected on that path. */
  readonly detected: boolean;
  /** Human-readable reason for the resolved mode (logged on activation). */
  readonly reason: string;
}

/**
 * Default daemon-socket path for a given platform.
 *
 *  - Windows: `\\.\pipe\nexus.<user>.sock` (named pipe).
 *  - macOS / Linux: `~/.nexus/run/nexus.sock` (UNIX domain socket).
 */
export function defaultDaemonPath(
  plat: NodeJS.Platform = platform(),
  home: string = homedir(),
): string {
  if (plat === "win32") {
    // Named pipe names are not file-system paths but the IPC layer parses them
    // identically; pinning to a per-user pipe avoids cross-user collisions on
    // shared machines.
    const user = process.env.USERNAME ?? "default";
    return `\\\\.\\pipe\\nexus.${user}.sock`;
  }
  return join(home, ".nexus", "run", "nexus.sock");
}

export function discoverDesktopDaemon(
  opts: DaemonDiscoveryOptions = {},
): DaemonDiscoveryResult {
  const plat = opts.platformOverride ?? platform();
  const home = opts.homeDirOverride ?? homedir();
  const path = opts.probePath ?? defaultDaemonPath(plat, home);
  const existsFn = opts.existsFn ?? existsSync;

  let detected: boolean;
  try {
    // v1.15.0 Phase 7 (Issue 6): this used to claim the extension layer performs
    // a live pipe `ping`. It does not -- `activate()` trusts this result
    // directly. On Windows a named pipe is NOT visible to `fs.existsSync`, so
    // the probe reliably returns false and the launch honestly resolves to
    // extension-only. That is the correct default (the in-process engine is the
    // supported Windows path today); the `existsFn` seam remains so a real
    // liveness probe can be injected when the pipe transport ships, and the
    // UNIX-socket path IS visible to `fs` and still detects a running daemon.
    detected = existsFn(path);
  } catch {
    detected = false;
  }

  if (detected) {
    return {
      mode: "proxy",
      probedPath: path,
      detected: true,
      reason: "Daemon socket present; the extension will proxy all calls.",
    };
  }
  if (opts.extensionOnlyOptIn) {
    return {
      mode: "extension-only",
      probedPath: path,
      detected: false,
      reason:
        "Daemon socket absent; user opted into extension-only fallback, running engine in-process.",
    };
  }
  return {
    mode: "extension-only",
    probedPath: path,
    detected: false,
    reason:
      "Daemon socket absent and no extension-only opt-in; defaulting to in-process engine with a one-time install hint.",
  };
}
