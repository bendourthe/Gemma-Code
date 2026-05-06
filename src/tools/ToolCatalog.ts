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
    description:
      "Delete a file. Pass dry_run=true to preview the deletion target (size + SHA-256) without unlinking; verify the SHA before re-running with dry_run=false.",
    parameters: {
      path: { type: "string", description: "Relative file path", required: true },
      dry_run: {
        type: "boolean",
        description:
          "When true, the tool returns a preview without performing any side effect. Use this to verify the operation is safe before re-running with dry_run=false. Default: false.",
      },
    },
  },
  {
    name: "list_directory",
    description:
      "List directory contents (3 levels deep max). Pass format='json' for RFC-8259 structured output with absolute path and per-entry size_bytes; default format='text' is byte-equivalent to the legacy output.",
    parameters: {
      path: { type: "string", description: "Relative directory path" },
      recursive: { type: "boolean", description: "List recursively up to 3 levels" },
      format: {
        type: "string",
        description:
          "Output format: 'text' (default, byte-equivalent to legacy output) or 'json' (RFC-8259 structured: {path, entries:[{name,type,size_bytes?}], _truncation?}).",
      },
    },
  },
  {
    name: "grep_codebase",
    description:
      "Search files with a regex pattern. Use max_results to bound the page size and next_offset (returned by a prior call) to continue paging. " +
      "Pass format='json' for RFC-8259 structured output with per-match {file_path,line_number,line}; default format='text' is byte-equivalent to the legacy output. " +
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
      format: {
        type: "string",
        description:
          "Output format: 'text' (default, byte-equivalent to legacy output) or 'json' (RFC-8259 structured: {pattern, matches:[{file_path,line_number,line}], next_offset?, _truncation?}).",
      },
    },
  },
  {
    name: "run_terminal",
    description:
      "Execute a shell command (requires user confirmation). Pass dry_run=true to preview the parsed tokens, resolved cwd, and safety-check results without spawning a subprocess.",
    parameters: {
      command: { type: "string", description: "Shell command to run", required: true },
      cwd: { type: "string", description: "Working directory" },
      dry_run: {
        type: "boolean",
        description:
          "When true, the tool returns a preview without performing any side effect. Use this to verify the operation is safe before re-running with dry_run=false. Default: false.",
      },
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
  {
    name: "compress_range",
    description:
      "Replace a contiguous span of conversation messages with a single technical summary block. " +
      "Use this proactively after a sub-task completes to free context tokens BEFORE hitting the limit. " +
      "Pass a 'topic' (3-5 word label) and a 'ranges' array of {startId, endId, summary}. " +
      "Stable IDs (m0001 / b1) refer to existing messages or prior compression blocks. " +
      "Permission tier 0: never touches files, terminal, or network. Reversible via /compact decompress.",
    parameters: {
      topic: { type: "string", description: "3-5 word label for the compression run.", required: true },
      ranges: {
        type: "array",
        description:
          "Array of {startId, endId, summary} objects. Each range is inclusive on both ends; ranges in a single call must NOT overlap each other.",
        required: true,
      },
    },
  },
  {
    name: "compress_message",
    description:
      "Experimental message-mode of the compress tool: replace one or more individual messages with their summaries. " +
      "Less surgical than compress_range -- more flexible but easier to fragment causally-linked tool sequences. " +
      "Gated behind 'gemma-code.compactExperimentalMessageMode'.",
    parameters: {
      topic: { type: "string", description: "3-5 word label (defaults to 'message-mode')." },
      compressions: {
        type: "array",
        description: "Array of {messageId, summary} objects. messageId is a stable mNNNN id.",
        required: true,
      },
    },
  },
];
