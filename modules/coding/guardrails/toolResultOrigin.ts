/**
 * Provenance labels on tool results (v1.19.1 Phase 2.6).
 *
 * Taxonomy is closed: add members only when a new origin class ships. The
 * `browser_snapshot` member is reserved for the v2.0.0 browser tool surface
 * and must not be assigned by any v1.19 handler -- ARIA snapshots plug in
 * without a schema change.
 *
 * Screening: web_fetch, mcp_tool, and browser_snapshot are always screened
 * (never off). Other origins follow the security-posture dial.
 *
 * Boundary: vscode-free.
 */

export const TOOL_RESULT_ORIGINS = [
  "user",
  "workspace_file",
  "terminal",
  "web_fetch",
  "mcp_tool",
  "browser_snapshot",
] as const;

export type ToolResultOrigin = (typeof TOOL_RESULT_ORIGINS)[number];

const BY_TOOL: Readonly<Record<string, ToolResultOrigin>> = {
  read_file: "workspace_file",
  write_file: "workspace_file",
  edit_file: "workspace_file",
  create_file: "workspace_file",
  delete_file: "workspace_file",
  list_directory: "workspace_file",
  grep_codebase: "workspace_file",
  watch_path: "workspace_file",
  hash_file: "workspace_file",
  parse_document: "workspace_file",
  run_terminal: "terminal",
  tail_output: "terminal",
  grep_output: "terminal",
  web_search: "web_fetch",
  fetch_page: "web_fetch",
  compress_range: "user",
  compress_message: "user",
  update_todos: "user",
  codegraph_search: "workspace_file",
  codegraph_context: "workspace_file",
  codegraph_trace: "workspace_file",
  codegraph_callers: "workspace_file",
  codegraph_callees: "workspace_file",
  codegraph_impact: "workspace_file",
  codegraph_node: "workspace_file",
  codegraph_explore: "workspace_file",
  codegraph_files: "workspace_file",
  lsp_definition: "workspace_file",
  lsp_references: "workspace_file",
};

export function originForTool(toolName: string): ToolResultOrigin {
  if (toolName.startsWith("mcp:")) return "mcp_tool";
  return BY_TOOL[toolName] ?? "workspace_file";
}

export function isReservedBrowserOrigin(origin: ToolResultOrigin): boolean {
  return origin === "browser_snapshot";
}
