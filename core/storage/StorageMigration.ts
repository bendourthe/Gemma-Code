/**
 * v1.0.0 Phase 2.2 -- One-shot storage migration from `~/.gemma-code/` ->
 * `~/.nexus/`.
 *
 * Run once at app launch. Idempotent under every branch:
 *  - `~/.nexus/` already exists -> no-op, returns `"already-migrated"`.
 *  - Neither directory exists -> create empty `~/.nexus/`, return
 *    `"fresh-install"`.
 *  - `~/.gemma-code/` exists, `~/.nexus/` does not -> recursive copy,
 *    preserving mtimes, skipping `.DS_Store` and `*.lock` files; write a
 *    `migrated-from-gemma-code.txt` marker; on POSIX create a symlink
 *    `~/.gemma-code/` -> `~/.nexus/`; on Windows leave the legacy directory
 *    in place with a `MOVED-TO-NEXUS.txt` README. Returns `"migrated"`.
 *
 * The migration is intentionally synchronous (small directory, runs once)
 * so the desktop shell startup hook does not have to await a promise chain.
 *
 * Removed in v1.1.0.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { legacyGemmaHome, nexusHome } from "./paths.js";

export type MigrationStatus =
  | "already-migrated"
  | "fresh-install"
  | "migrated";

export interface MigrationResult {
  status: MigrationStatus;
  nexusPath: string;
  filesCopied: number;
  /** True when the legacy `~/.gemma-code/` was preserved (Windows or symlink failure). */
  legacyPreserved: boolean;
  /** True when a POSIX symlink was created at the legacy path. */
  legacySymlinked: boolean;
}

export interface MigrationDeps {
  fsApi?: typeof fs;
  homeDirFn?: () => string;
  platform?: NodeJS.Platform;
  /** Optional informational logger; defaults to no-op. */
  logger?: (msg: string) => void;
}

const SKIP_FILES = new Set([".DS_Store"]);
const SKIP_SUFFIXES = [".lock"];
const MARKER_FILE = "migrated-from-gemma-code.txt";
const LEGACY_README = "MOVED-TO-NEXUS.txt";

export function runStorageMigration(deps: MigrationDeps = {}): MigrationResult {
  const fsApi = deps.fsApi ?? fs;
  const homeDirFn = deps.homeDirFn ?? os.homedir;
  const platform = deps.platform ?? process.platform;
  const log = deps.logger ?? (() => {});

  const newRoot = nexusHome(homeDirFn);
  const oldRoot = legacyGemmaHome(homeDirFn);

  if (fsApi.existsSync(newRoot)) {
    log(`[nexus] storage migration: ${newRoot} already present, skipping`);
    return {
      status: "already-migrated",
      nexusPath: newRoot,
      filesCopied: 0,
      legacyPreserved: fsApi.existsSync(oldRoot),
      legacySymlinked: false,
    };
  }

  if (!fsApi.existsSync(oldRoot)) {
    fsApi.mkdirSync(newRoot, { recursive: true });
    log(`[nexus] storage migration: fresh install, created ${newRoot}`);
    return {
      status: "fresh-install",
      nexusPath: newRoot,
      filesCopied: 0,
      legacyPreserved: false,
      legacySymlinked: false,
    };
  }

  // Real migration path.
  fsApi.mkdirSync(newRoot, { recursive: true });
  const filesCopied = copyDirectoryRecursively(fsApi, oldRoot, newRoot);

  fsApi.writeFileSync(
    path.join(newRoot, MARKER_FILE),
    [
      "This directory was migrated from ~/.gemma-code/ by Nexus v1.0.0.",
      `Migrated at: ${new Date().toISOString()}`,
      `Files copied: ${filesCopied}`,
      "",
      "The legacy directory is preserved alongside this one for one cycle.",
      "It will stop being read in v1.1.0. Delete it after verifying Nexus",
      "works correctly with your data.",
      "",
    ].join("\n"),
    "utf8",
  );

  let legacySymlinked = false;
  let legacyPreserved = true;
  if (platform !== "win32") {
    // POSIX: replace the directory with a symlink so any out-of-process
    // tooling still pointing at ~/.gemma-code/ keeps working.
    try {
      fsApi.rmSync(oldRoot, { recursive: true, force: true });
      fsApi.symlinkSync(newRoot, oldRoot, "dir");
      legacySymlinked = true;
      legacyPreserved = false;
      log(`[nexus] storage migration: ${oldRoot} -> ${newRoot} (symlink)`);
    } catch (err) {
      // Symlink might fail in sandboxes; leave the legacy directory in place
      // and write the README.
      log(
        `[nexus] storage migration: symlink failed, preserving ${oldRoot}: ${
          (err as Error).message
        }`,
      );
      legacyPreserved = true;
    }
  }

  if (legacyPreserved) {
    // Windows or POSIX-symlink-failure path: leave a breadcrumb in the legacy
    // dir so a future support session can quickly explain what happened.
    try {
      fsApi.writeFileSync(
        path.join(oldRoot, LEGACY_README),
        [
          "Nexus has moved its data root to ~/.nexus/.",
          "This folder is preserved for backwards compatibility and will stop being read in v1.1.0.",
          `Migrated at: ${new Date().toISOString()}`,
          "",
        ].join("\n"),
        "utf8",
      );
    } catch {
      // If we cannot write the README, fall through; data is already copied.
    }
  }

  log(`[nexus] storage migration: copied ${filesCopied} files into ${newRoot}`);

  return {
    status: "migrated",
    nexusPath: newRoot,
    filesCopied,
    legacyPreserved,
    legacySymlinked,
  };
}

function copyDirectoryRecursively(
  fsApi: typeof fs,
  src: string,
  dst: string,
): number {
  let count = 0;
  const entries = fsApi.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_FILES.has(entry.name)) continue;
    if (SKIP_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isSymbolicLink()) {
      const target = fsApi.readlinkSync(srcPath);
      try {
        fsApi.symlinkSync(target, dstPath);
      } catch {
        // Best-effort; fall through.
      }
      continue;
    }
    if (entry.isDirectory()) {
      fsApi.mkdirSync(dstPath, { recursive: true });
      count += copyDirectoryRecursively(fsApi, srcPath, dstPath);
      // Preserve directory mtime.
      const stat = fsApi.statSync(srcPath);
      try {
        fsApi.utimesSync(dstPath, stat.atime, stat.mtime);
      } catch {
        // Some filesystems disallow utimes on dirs; non-fatal.
      }
      continue;
    }
    if (entry.isFile()) {
      fsApi.copyFileSync(srcPath, dstPath);
      const stat = fsApi.statSync(srcPath);
      try {
        fsApi.utimesSync(dstPath, stat.atime, stat.mtime);
      } catch {
        // Non-fatal: timestamps are best-effort.
      }
      count += 1;
    }
  }
  return count;
}
