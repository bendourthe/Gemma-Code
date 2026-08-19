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
  {
    name: "update_todos",
    description:
      "Publish a structured to-do list to the chat panel. Use for any non-trivial multi-step task " +
      "so the user can see progress in real time. Each todo is an object with `content` (imperative " +
      "form, e.g. \"Add tests\"), `activeForm` (present-continuous form shown while in_progress, e.g. " +
      "\"Adding tests\"), and `status` (\"pending\" | \"in_progress\" | \"completed\"). Submit the FULL " +
      "list every time -- the renderer diffs against the previous publish to show transitions. Permission " +
      "tier 0: no file, terminal, or network side effects.",
    parameters: {
      todos: {
        type: "array",
        description:
          "Array of {content, activeForm, status} objects. Submit the full list on every call.",
        required: true,
      },
    },
  },
  {
    name: "codegraph_search",
    description:
      "Full-text search across indexed code symbols (functions, classes, methods) and their signatures. " +
      "Prefer this over `grep_codebase` when the question is about a symbol -- it returns precise matches with file paths and line ranges in one call.",
    parameters: {
      query: { type: "string", description: "FTS query; bareword tokens get prefix matching.", required: true },
      limit: { type: "number", description: "Max hits (default 50, ceiling 500)." },
    },
  },
  {
    name: "codegraph_context",
    description:
      "Resolve a symbol by name and return its location plus its direct callers and callees. One call replaces 3-5 grep invocations.",
    parameters: {
      symbolName: { type: "string", description: "Symbol name to resolve.", required: true },
    },
  },
  {
    name: "codegraph_trace",
    description:
      "Find a call-path from one symbol to another (bounded by maxDepth). Returns the chain of intermediate symbols.",
    parameters: {
      fromSymbol: { type: "string", description: "Starting symbol name.", required: true },
      toSymbol: { type: "string", description: "Target symbol name.", required: true },
      maxDepth: { type: "number", description: "Search depth cap (default 5)." },
    },
  },
  {
    name: "codegraph_callers",
    description:
      "List every symbol that calls the named target. Prefer over `grep` for caller-of queries.",
    parameters: {
      symbolName: { type: "string", description: "Target symbol name.", required: true },
    },
  },
  {
    name: "codegraph_callees",
    description: "List every symbol called from the named source.",
    parameters: {
      symbolName: { type: "string", description: "Source symbol name.", required: true },
    },
  },
  {
    name: "codegraph_impact",
    description:
      "Compute the transitive caller closure for a symbol. Use before changing a signature to see the impact radius in one call.",
    parameters: {
      symbolName: { type: "string", description: "Target symbol name.", required: true },
      maxDepth: { type: "number", description: "Transitive closure depth (default 3)." },
    },
  },
  {
    name: "codegraph_node",
    description: "Return raw metadata for a named symbol (file path, line range, signature).",
    parameters: {
      symbolName: { type: "string", description: "Symbol name to resolve.", required: true },
    },
  },
  {
    name: "codegraph_explore",
    description:
      "Bulk-resolve context bundles for an array of symbol names. Use when you need callers + callees for multiple symbols at once.",
    parameters: {
      symbolNames: {
        type: "array",
        description: "Array of symbol-name strings.",
        required: true,
      },
    },
  },
  {
    name: "codegraph_files",
    description:
      "List every file currently in the code graph (path + language + last-indexed timestamp).",
    parameters: {
      // codegraph_files takes no arguments; the placeholder keeps the
      // catalog invariant ("every entry has at least one parameter")
      // intact and signals via its description that no input is expected.
      _noop: {
        type: "boolean",
        description: "Unused. Pass nothing; this tool ignores all arguments.",
      },
    },
  },
  // v1.2.0 Phase 6.2 -- LSP-backed symbol queries. Prefer these over
  // `grep_codebase` (text matches) for TS / Python / Rust when symbol-precise
  // results matter; the LSP server understands renames, imports, and scopes.
  // The two tools degrade to a structured "lsp server missing" error when
  // the language server is not installed (installer-smoke logs the warning).
  {
    name: "lsp_definition",
    description:
      "Resolve the definition of the symbol at (line, column) in the given file via a Language Server Protocol query. Returns symbol-precise location(s), not text matches. Use when grep would return false positives across overloaded names.",
    parameters: {
      language: {
        type: "string",
        description: "One of 'typescript', 'python', 'rust'.",
        required: true,
      },
      filePath: {
        type: "string",
        description: "Absolute path to the source file on disk.",
        required: true,
      },
      line: {
        type: "number",
        description: "Zero-based line index of the symbol use.",
        required: true,
      },
      column: {
        type: "number",
        description: "Zero-based column index of the symbol use.",
        required: true,
      },
      fileContents: {
        type: "string",
        description: "Current contents of the file (used for LSP didOpen).",
        required: true,
      },
    },
  },
  {
    // v1.16.0 Phase 4 (adoption item A6) -- document OCR into agent context.
    name: "parse_document",
    description:
      "Read a PDF or image in the workspace as text using the local document-OCR model. Output is treated as untrusted external content: it is secret-redacted and screened for prompt injection before entering context. Requires a document model (Settings > Models).",
    parameters: {
      path: {
        type: "string",
        description: "Workspace-relative path to a PDF or image file.",
        required: true,
      },
      max_pages: {
        type: "number",
        description: "Maximum pages to read (default and cap: 50).",
        required: false,
      },
      allow_secrets: {
        type: "boolean",
        description:
          "Set true to request user confirmation for a path on the secret-path denylist.",
        required: false,
      },
    },
  },
  {
    name: "watch_path",
    description:
      "Watch a workspace path for filesystem events for a bounded interval (default 8s). Read-only. Rejects paths outside the workspace root. Example: watch_path(path='src', timeout_ms=5000).",
    parameters: {
      path: { type: "string", description: "Workspace-relative path to watch.", required: true },
      timeout_ms: {
        type: "number",
        description: "How long to wait for events (50..30000 ms, default 8000).",
      },
    },
  },
  {
    name: "hash_file",
    description:
      "SHA-256 of a workspace file for integrity or change detection. Read-only. Example: hash_file(path='src/extension.ts').",
    parameters: {
      path: { type: "string", description: "Workspace-relative file path.", required: true },
    },
  },
  {
    name: "lsp_references",
    description:
      "List references to the symbol at (line, column). Symbol-precise -- excludes text matches that share a name but resolve to a different declaration.",
    parameters: {
      language: {
        type: "string",
        description: "One of 'typescript', 'python', 'rust'.",
        required: true,
      },
      filePath: {
        type: "string",
        description: "Absolute path to the source file on disk.",
        required: true,
      },
      line: {
        type: "number",
        description: "Zero-based line index of the symbol use.",
        required: true,
      },
      column: {
        type: "number",
        description: "Zero-based column index of the symbol use.",
        required: true,
      },
      fileContents: {
        type: "string",
        description: "Current contents of the file (used for LSP didOpen).",
        required: true,
      },
      includeDeclaration: {
        type: "boolean",
        description: "If true, include the declaration site in the result list.",
      },
    },
  },
];
