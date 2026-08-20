export type BuiltinToolName =
  | "read_file"
  | "write_file"
  | "edit_file"
  | "create_file"
  | "delete_file"
  | "list_directory"
  | "grep_codebase"
  | "run_terminal"
  | "web_search"
  | "fetch_page"
  | "tail_output"
  | "grep_output"
  | "compress_range"
  | "compress_message"
  | "update_todos"
  | "codegraph_search"
  | "codegraph_context"
  | "codegraph_trace"
  | "codegraph_callers"
  | "codegraph_callees"
  | "codegraph_impact"
  | "codegraph_node"
  | "codegraph_explore"
  | "codegraph_files"
  | "lsp_definition"
  | "lsp_references"
  // v1.16.0 Phase 4 (adoption item A6) -- document OCR into agent context.
  | "parse_document"
  // v1.19.1 Phase 2.8 -- read-only fs observation / integrity.
  | "watch_path"
  | "hash_file";

/** Namespaced MCP tool name: `mcp:serverName/toolName`. */
export type McpToolName = `mcp:${string}`;

/** Any tool name: either a built-in tool or an MCP-sourced tool. */
export type ToolName = BuiltinToolName | McpToolName;

export const BUILTIN_TOOL_NAMES: readonly BuiltinToolName[] = [
  "read_file",
  "write_file",
  "edit_file",
  "create_file",
  "delete_file",
  "list_directory",
  "grep_codebase",
  "run_terminal",
  "web_search",
  "fetch_page",
  "tail_output",
  "grep_output",
  "compress_range",
  "compress_message",
  "update_todos",
  "codegraph_search",
  "codegraph_context",
  "codegraph_trace",
  "codegraph_callers",
  "codegraph_callees",
  "codegraph_impact",
  "codegraph_node",
  "codegraph_explore",
  "codegraph_files",
  "lsp_definition",
  "lsp_references",
  "parse_document",
  "watch_path",
  "hash_file",
];

/** @deprecated Use BUILTIN_TOOL_NAMES instead. */
export const TOOL_NAMES: readonly BuiltinToolName[] = BUILTIN_TOOL_NAMES;

/**
 * Where the tool call originates. Used by ConfirmationGate to attribute the
 * confirmation prompt to the correct peer so a user can distinguish a local
 * agent action from an external MCP-driven request. Closes pen-test F-004.
 */
export type ToolCallSource = "local-agent" | "sub-agent" | "mcp";

export interface ToolCall {
  readonly tool: ToolName;
  readonly id: string;
  readonly parameters: Record<string, unknown>;
  readonly source?: ToolCallSource;
}

/**
 * Provenance class for a tool result (v1.19.1 Phase 2.6). `browser_snapshot`
 * is reserved for the v2.0.0 browser tool surface. `stt_transcript` labels
 * Chat STT output (v2.0.0 Phase 1).
 */
export type ToolResultOrigin =
  | "user"
  | "workspace_file"
  | "terminal"
  | "web_fetch"
  | "mcp_tool"
  | "browser_snapshot"
  | "stt_transcript";

export interface ToolResult {
  readonly id: string;
  readonly success: boolean;
  readonly output: string;
  readonly error?: string;
  readonly origin?: ToolResultOrigin;
}

export interface ToolHandler {
  execute(parameters: Record<string, unknown>): Promise<ToolResult>;
}

export type ConfirmationMode = "always" | "ask" | "never";

/** Controls how file edits are applied by the file tool handlers. */
export type EditMode = "auto" | "ask" | "plan";

// ---------------------------------------------------------------------------
// Typed parameter shapes (used internally by each handler for validation)
// ---------------------------------------------------------------------------

export interface ReadFileParams {
  path: string;
  allow_secrets?: boolean;
  /** Inclusive start offset in bytes for paginated reads. */
  range_start?: number;
  /** Exclusive end offset in bytes for paginated reads (max window 1 MB). */
  range_end?: number;
  /**
   * When `true`, bypass the persistent tool-output cache and always return the
   * full file content (escape hatch when the agent needs the entire file even
   * after a previous read).
   */
  full?: boolean;
}

export interface WriteFileParams {
  path: string;
  content: string;
}

export interface EditFileParams {
  path: string;
  old_string: string;
  new_string: string;
}

export interface CreateFileParams {
  path: string;
  content?: string;
}

export interface DeleteFileParams {
  path: string;
  /**
   * When `true`, returns the file's size and SHA-256 (over the first 1 MB) without
   * unlinking the file. Use this to verify the deletion target before re-running
   * with `dry_run=false`.
   */
  dry_run?: boolean;
}

export interface ListDirectoryParams {
  path?: string;
  recursive?: boolean;
  allow_secrets?: boolean;
  /**
   * `'text'` (default) preserves the existing JSON-stringified `{entries, count}` output.
   * `'json'` returns RFC-8259 valid JSON with `path` and structured per-entry metadata.
   */
  format?: "text" | "json";
}

export interface GrepCodebaseParams {
  pattern: string;
  glob?: string;
  max_results?: number;
  allow_secrets?: boolean;
  case_insensitive?: boolean;
  /** Opaque base64-encoded cursor for paginating through additional matches. */
  next_offset?: string;
  /**
   * `'text'` (default) preserves the existing JSON-stringified payload.
   * `'json'` returns RFC-8259 valid JSON with `pattern` and per-match `file_path`/`line_number`/`line` fields.
   */
  format?: "text" | "json";
}

export interface RunTerminalParams {
  command: string;
  cwd?: string;
  /**
   * When `true`, returns a textual preview of the parsed tokens, resolved cwd,
   * and safety-check results without spawning a subprocess. Use this to
   * pre-flight-check before re-running with `dry_run=false`.
   */
  dry_run?: boolean;
}

export interface WebSearchParams {
  query: string;
  max_results?: number;
}

export interface FetchPageParams {
  url: string;
}

export interface TailOutputParams {
  path: string;
  lines?: number;
}

export interface GrepOutputParams {
  path: string;
  pattern: string;
  max_results?: number;
}

export interface CompressRangeParams {
  topic: string;
  ranges: Array<{ startId: string; endId: string; summary: string }>;
}

export interface CompressMessageParams {
  topic?: string;
  compressions: Array<{ messageId: string; summary: string }>;
}
