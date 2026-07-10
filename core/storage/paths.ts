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

// ---------------------------------------------------------------------------
// v1.10.0 -- Nexus-Hub catalog root + layout resolver.
//
// Nexus-AI consumes the Nexus-Hub catalog from a single standardized subtree,
// `~/.nexus-ai/catalog/`, read the same way Claude Code reads `~/.claude/`. The
// catalog lives in its own subtree so a catalog refresh can never touch app
// data; `NexusHubSyncer`'s destructive refresh is scoped to `catalogRoot(...)`.
//
// Subdir names come from the `layout` map in `nexus-hub-version.json` when
// present (read via `core/storage/hubVersionManifest.ts`), falling back per-key
// to `HUB_LAYOUT`. These helpers stay pure -- the manifest read/write that
// resolves the on-disk `layout` lives in that sibling fs-touching module.
//
// The end-state single-home consolidation (`~/.nexus/*` -> `~/.nexus-ai/*` for
// app data) is a separate, tested plan; this module intentionally leaves
// `nexusHome()` untouched. A `NEXUS_AI_HOME` override, like `NEXUS_HOME`, is
// applied at the CLI/composition layer (not here) so this module stays pure.
// ---------------------------------------------------------------------------

const NEXUS_AI_DIRNAME = ".nexus-ai";
const CATALOG_DIRNAME = "catalog";
const HUB_VERSION_MANIFEST_FILENAME = "nexus-hub-version.json";

/**
 * Canonical Nexus AI Studio home. Equivalent to `~/.nexus-ai/`.
 *
 * @param homeDirFn injected for tests; defaults to `os.homedir`
 */
export function nexusAiHome(homeDirFn: () => string = os.homedir): string {
  return path.join(homeDirFn(), NEXUS_AI_DIRNAME);
}

/**
 * The isolated Nexus-Hub catalog subtree, `~/.nexus-ai/catalog/`. Pass an
 * explicit `nexusAiRoot` in tests; defaults to `nexusAiHome()`.
 */
export function catalogRoot(nexusAiRoot: string = nexusAiHome()): string {
  return path.join(nexusAiRoot, CATALOG_DIRNAME);
}

/** Keys of the `layout` map in `nexus-hub-version.json`. */
export type HubLayoutKey =
  | "skills"
  | "commands"
  | "agents"
  | "rules"
  | "hooks"
  | "mcp_configs"
  | "templates"
  | "instructions";

export type HubLayout = Record<HubLayoutKey, string>;

/**
 * Default catalog layout. The `instructions` entry is a file (`NEXUS_AI.md`);
 * every other entry is a directory relative to `catalogRoot`.
 */
export const HUB_LAYOUT: HubLayout = Object.freeze({
  skills: "skills",
  commands: "commands",
  agents: "agents",
  rules: "rules",
  hooks: "hooks",
  mcp_configs: "mcp-configs",
  templates: "templates",
  instructions: "NEXUS_AI.md",
});

/**
 * Resolve a catalog subdir/file inside `catalogRootDir` for `key`, using the
 * manifest-provided `layout` when supplied and falling back per-key to
 * `HUB_LAYOUT`. Tolerant of a partial `layout` (each missing key uses its
 * default), so a pre-coordination or partially-populated bundle still resolves.
 */
export function hubLayoutDir(
  catalogRootDir: string,
  key: HubLayoutKey,
  layout: Partial<HubLayout> = {},
): string {
  return path.join(catalogRootDir, layout[key] ?? HUB_LAYOUT[key]);
}

/** Path to `~/.nexus-ai/catalog/nexus-hub-version.json`. */
export function hubVersionManifestPath(catalogRootDir: string): string {
  return path.join(catalogRootDir, HUB_VERSION_MANIFEST_FILENAME);
}

export const NEXUS_AI_STORAGE_DIRNAME = NEXUS_AI_DIRNAME;
export const CATALOG_STORAGE_DIRNAME = CATALOG_DIRNAME;
export const HUB_VERSION_MANIFEST_FILE = HUB_VERSION_MANIFEST_FILENAME;
