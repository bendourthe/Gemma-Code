import type { ToolName } from "./types.js";

export interface ToolParameterSchema {
  readonly type: string;
  readonly description: string;
  readonly required?: boolean;
}

export interface ToolMetadata {
  readonly name: ToolName;
  readonly description: string;
  readonly parameters: Record<string, ToolParameterSchema>;
}

export type ToolCategory = "builtin" | "mcp";

/** Extended metadata with source tracking and priority for conditional activation. */
export interface DynamicToolMetadata extends ToolMetadata {
  readonly source: ToolCategory;
  /** Lower number = higher priority. Built-in tools use 0; MCP tools default to 100. */
  readonly priority: number;
}

/** Wrap a static catalog entry as a DynamicToolMetadata with builtin source and priority 0. */
export function toDynamicMetadata(tool: ToolMetadata): DynamicToolMetadata {
  return { ...tool, source: "builtin", priority: 0 };
}

/**
 * Static metadata catalog for every registered tool. Used by PromptBuilder
 * to generate tool declarations in the system prompt and by the Ollama API
 * layer to build the `tools` request field.
 */
export const TOOL_CATALOG: readonly ToolMetadata[] = [
  {
    name: "read_file",
    description:
      "Read a file's content (up to 500 lines by default). Use range_start/range_end to fetch a byte sub-window of large files. " +
      "Subsequent reads of an unchanged file return a short cached-marker; subsequent reads of a modified file return a unified diff. " +
      "Pass full=true to bypass the cache and always return the full content. " +
      "Example: read_file(path='src/extension.ts', range_start=0, range_end=4096).",
    parameters: {
      path: { type: "string", description: "Relative file path", required: true },
      range_start: {
        type: "number",
        description: "Inclusive byte offset for paginated reads (>= 0).",
      },
      range_end: {
        type: "number",
        description:
          "Exclusive byte offset for paginated reads. Must be > range_start; window <= 1 MB.",
      },
      max_bytes: {
        type: "number",
        description:
          "Override the universal 64 KB output cap for this call (ceiling: 1 MB).",
      },
      full: {
        type: "boolean",
        description:
          "Bypass the persistent tool-output cache and always return the full file content. Default: false.",
      },
    },
  },
  {
    name: "write_file",
    description: "Write or overwrite a file.",
    parameters: {
      path: { type: "string", description: "Relative file path", required: true },
      content: { type: "string", description: "File content to write", required: true },
    },
  },
  {
    name: "edit_file",
    description: "Replace an exact string in a file. old_string must appear exactly once.",
    parameters: {
      path: { type: "string", description: "Relative file path", required: true },
      old_string: { type: "string", description: "Exact text to find", required: true },
      new_string: { type: "string", description: "Replacement text", required: true },
    },
  },
  {
    name: "create_file",
    description: "Create a new file (fails if it already exists).",
    parameters: {
      path: { type: "string", description: "Relative file path", required: true },
      content: { type: "string", description: "Optional initial content" },
    },
  },
  {
    name: "delete_file",
    description: "Delete a file.",
    parameters: {
      path: { type: "string", description: "Relative file path", required: true },
    },
  },
  {
    name: "list_directory",
    description: "List directory contents (3 levels deep max).",
    parameters: {
      path: { type: "string", description: "Relative directory path" },
      recursive: { type: "boolean", description: "List recursively up to 3 levels" },
    },
  },
  {
    name: "grep_codebase",
    description:
      "Search files with a regex pattern. Use max_results to bound the page size and next_offset (returned by a prior call) to continue paging. " +
      "Example: grep_codebase(pattern='TODO', max_results=50, next_offset='<cursor>').",
    parameters: {
      pattern: { type: "string", description: "Regex search pattern", required: true },
      glob: { type: "string", description: "File glob filter (e.g. '*.ts')" },
      max_results: {
        type: "number",
        description:
          "Maximum number of results in this page (default 50, ceiling 500).",
      },
      next_offset: {
        type: "string",
        description:
          "Opaque base64 cursor returned by a prior grep_codebase call. Pass verbatim to fetch the next page.",
      },
      max_bytes: {
        type: "number",
        description:
          "Override the universal 64 KB output cap for this call (ceiling: 1 MB).",
      },
    },
  },
  {
    name: "run_terminal",
    description: "Execute a shell command (requires user confirmation).",
    parameters: {
      command: { type: "string", description: "Shell command to run", required: true },
      cwd: { type: "string", description: "Working directory" },
    },
  },
  {
    name: "web_search",
    description: "Search the web via DuckDuckGo (privacy-preserving).",
    parameters: {
      query: { type: "string", description: "Search query", required: true },
      max_results: { type: "number", description: "Maximum number of results" },
    },
  },
  {
    name: "fetch_page",
    description: "Fetch and read a web page as plain text (up to 2000 chars).",
    parameters: {
      url: { type: "string", description: "URL to fetch", required: true },
    },
  },
];
