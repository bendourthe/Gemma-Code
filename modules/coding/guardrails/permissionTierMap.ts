/**
 * v1.16.0 Phase 4 (adoption item A6) -- the canonical permission-tier data,
 * extracted from `PermissionTiers.ts` so it is importable WITHOUT `vscode`.
 *
 * `PermissionTiers.ts` reaches `vscode` transitively (via `utils/logger` and
 * `src/tools/handlers/terminal`), so a plain-Node host -- the desktop sidecar's
 * headless tool surface, the `nexus` CLI -- cannot import it. Before v1.16.0
 * that did not matter because the headless surface had no tier enforcement at
 * all; adding it meant the two surfaces had to share ONE map rather than keep
 * two that can drift.
 *
 * This file therefore holds the enum + the map and nothing else: no imports that
 * can pull a host binding in, and no behavior. `PermissionTiers.ts` re-exports
 * both so every existing importer is unchanged.
 *
 * `scripts/generate-tool-permission-table.mjs` parses `TOOL_PERMISSION_MAP`
 * FROM THIS FILE and is the source of the generated `[permissions]` block in
 * `nexus.security.toml` plus the architecture doc table. The parser is a regex
 * over the map body, so every entry must stay a plain literal: a lowercase
 * underscore key, a colon, then a `PermissionTier` member. No quoted keys, no
 * computed keys, and no example entries written inside comments -- the regex
 * cannot tell a comment from code.
 */

import type { BuiltinToolName } from "../../../src/tools/types.js";

export enum PermissionTier {
  AUTO_APPROVE = 0,
  CONFIRM = 1,
  DANGEROUS = 2,
}

export const TOOL_PERMISSION_MAP: Record<BuiltinToolName, PermissionTier> = {
  read_file: PermissionTier.AUTO_APPROVE,
  list_directory: PermissionTier.AUTO_APPROVE,
  grep_codebase: PermissionTier.AUTO_APPROVE,
  tail_output: PermissionTier.AUTO_APPROVE,
  grep_output: PermissionTier.AUTO_APPROVE,
  write_file: PermissionTier.CONFIRM,
  edit_file: PermissionTier.CONFIRM,
  create_file: PermissionTier.CONFIRM,
  delete_file: PermissionTier.CONFIRM,
  run_terminal: PermissionTier.DANGEROUS,
  web_search: PermissionTier.DANGEROUS,
  fetch_page: PermissionTier.DANGEROUS,
  compress_range: PermissionTier.AUTO_APPROVE,
  compress_message: PermissionTier.AUTO_APPROVE,
  update_todos: PermissionTier.AUTO_APPROVE,
  codegraph_search: PermissionTier.AUTO_APPROVE,
  codegraph_context: PermissionTier.AUTO_APPROVE,
  codegraph_trace: PermissionTier.AUTO_APPROVE,
  codegraph_callers: PermissionTier.AUTO_APPROVE,
  codegraph_callees: PermissionTier.AUTO_APPROVE,
  codegraph_impact: PermissionTier.AUTO_APPROVE,
  codegraph_node: PermissionTier.AUTO_APPROVE,
  codegraph_explore: PermissionTier.AUTO_APPROVE,
  codegraph_files: PermissionTier.AUTO_APPROVE,
  lsp_definition: PermissionTier.AUTO_APPROVE,
  lsp_references: PermissionTier.AUTO_APPROVE,
  // v1.16.0 Phase 4 (A6): reads a workspace file AND runs a model in a
  // subprocess (one engine executes pinned repo code), so it is not a pure
  // local read like read_file. CONFIRM, matching write_file / fetch_page.
  parse_document: PermissionTier.CONFIRM,
  watch_path: PermissionTier.AUTO_APPROVE,
  hash_file: PermissionTier.AUTO_APPROVE,
};
