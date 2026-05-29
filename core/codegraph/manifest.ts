/**
 * v1.2.0 Phase 3.1 -- module manifest for the code-graph subsystem.
 *
 * Declares the semver of the on-disk store schema, the supported language
 * list, and the 8 MCP tool names. The Coding pillar consults the
 * `codegraphToolNames` constant when building its system prompt so the
 * authoritative tool list lives next to the implementation, not in a
 * scattered set of string literals.
 */

import type { CodeGraphLanguage } from "./types.js";

/** On-disk store schema version. Bump when the SQLite schema changes. */
export const CODEGRAPH_SCHEMA_VERSION = "1.0.0" as const;

/** Languages the regex-based scanner currently parses. */
export const CODEGRAPH_SUPPORTED_LANGUAGES: readonly CodeGraphLanguage[] = [
  "typescript",
  "python",
  "rust",
  "go",
];

/** Default per-file size cap (in bytes) for the scanner. */
export const CODEGRAPH_DEFAULT_MAX_FILE_BYTES = 1024 * 1024;

/** Default exclusion globs applied on top of `.gitignore` / `.nexusignore`. */
export const CODEGRAPH_DEFAULT_EXCLUDES: readonly string[] = [
  "node_modules",
  ".git",
  "out",
  "dist",
  "build",
  "target",
  "coverage",
  ".nyc_output",
  "__pycache__",
  ".venv",
  "venv",
];

/** Authoritative ordered list of the 8 MCP tool names exposed by this module. */
export const CODEGRAPH_TOOL_NAMES = [
  "codegraph_search",
  "codegraph_context",
  "codegraph_trace",
  "codegraph_callers",
  "codegraph_callees",
  "codegraph_impact",
  "codegraph_node",
  "codegraph_explore",
  "codegraph_files",
] as const;

export type CodeGraphToolName = (typeof CODEGRAPH_TOOL_NAMES)[number];

export interface CodeGraphManifest {
  readonly schemaVersion: typeof CODEGRAPH_SCHEMA_VERSION;
  readonly languages: typeof CODEGRAPH_SUPPORTED_LANGUAGES;
  readonly tools: typeof CODEGRAPH_TOOL_NAMES;
}

export const CODEGRAPH_MANIFEST: CodeGraphManifest = Object.freeze({
  schemaVersion: CODEGRAPH_SCHEMA_VERSION,
  languages: CODEGRAPH_SUPPORTED_LANGUAGES,
  tools: CODEGRAPH_TOOL_NAMES,
});
