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

/**
 * Static metadata catalog for every registered tool. Used by PromptBuilder
 * to generate tool declarations in the system prompt and by the Ollama API
 * layer to build the `tools` request field.
 */
export const TOOL_CATALOG: readonly ToolMetadata[] = [
  {
    name: "read_file",
    description: "Read a file's content (up to 500 lines).",
    parameters: {
      path: { type: "string", description: "Relative file path", required: true },
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
    description: "Search files with a regex pattern.",
    parameters: {
      pattern: { type: "string", description: "Regex search pattern", required: true },
      glob: { type: "string", description: "File glob filter (e.g. '*.ts')" },
      max_results: { type: "number", description: "Maximum number of results" },
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
