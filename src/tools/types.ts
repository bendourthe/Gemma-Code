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
  | "fetch_page";

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
];

/** @deprecated Use BUILTIN_TOOL_NAMES instead. */
export const TOOL_NAMES: readonly BuiltinToolName[] = BUILTIN_TOOL_NAMES;

export interface ToolCall {
  readonly tool: ToolName;
  readonly id: string;
  readonly parameters: Record<string, unknown>;
}

export interface ToolResult {
  readonly id: string;
  readonly success: boolean;
  readonly output: string;
  readonly error?: string;
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
}

export interface ListDirectoryParams {
  path?: string;
  recursive?: boolean;
}

export interface GrepCodebaseParams {
  pattern: string;
  glob?: string;
  max_results?: number;
}

export interface RunTerminalParams {
  command: string;
  cwd?: string;
}

export interface WebSearchParams {
  query: string;
  max_results?: number;
}

export interface FetchPageParams {
  url: string;
}
