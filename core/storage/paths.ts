/**
 * v1.0.0 Phase 2.2 -- Canonical storage paths for Nexus.
 *
 * `nexusHome()` returns the per-user data root used by every Nexus module
 * (memory, plans, skills, hooks, metrics, mcp.json, etc.). The post-migration
 * canonical path is `~/.nexus/`. Until `StorageMigration` has run, callers
 * may still encounter `~/.gemma-code/` populated from a prior Gemma Code
 * install; the migration copies its contents into `~/.nexus/` on first
 * launch in v1.0.0 and is removed in v1.1.0.
 *
 * Keep this module *pure*: no filesystem reads. Callers compose `nexusHome()`
 * with `path.join(...)` and the consumer's own fs operations.
 */

import * as os from "node:os";
import * as path from "node:path";

const NEXUS_DIRNAME = ".nexus";
const LEGACY_GEMMA_DIRNAME = ".gemma-code";

/**
 * Canonical Nexus per-user data root. Equivalent to `~/.nexus/`.
 *
 * @param homeDirFn injected for tests; defaults to `os.homedir`
 */
export function nexusHome(homeDirFn: () => string = os.homedir): string {
  return path.join(homeDirFn(), NEXUS_DIRNAME);
}

/**
 * Legacy Gemma Code per-user data root. Used by `StorageMigration` to detect
 * a pre-v1.0.0 install and by the POSIX symlink fallback. NOT used by
 * runtime code paths beyond the migration itself.
 */
export function legacyGemmaHome(homeDirFn: () => string = os.homedir): string {
  return path.join(homeDirFn(), LEGACY_GEMMA_DIRNAME);
}

export const STORAGE_DIRNAME = NEXUS_DIRNAME;
export const LEGACY_STORAGE_DIRNAME = LEGACY_GEMMA_DIRNAME;
