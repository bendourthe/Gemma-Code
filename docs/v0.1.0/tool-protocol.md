# Gemma Code Tool Protocol

## Overview

Gemma Code uses an XML-delimited JSON protocol to let the Gemma 4 model invoke tools. The model emits a structured call in its response; the extension parses, validates, and executes it; then injects the result back into the conversation for the model to continue.

---

## Tool Call Format

The model signals a tool invocation by embedding a JSON object inside `<tool_call>` tags:

```
<tool_call>
{
  "tool": "<tool_name>",
  "id": "<unique_call_id>",
  "parameters": {
    "<param_name>": "<param_value>"
  }
}
</tool_call>
```

Rules:
- The JSON must be valid and complete within the tags.
- `tool` must be one of the known tool names listed below.
- `id` must be a non-empty string that uniquely identifies this call within the response.
- `parameters` must be a JSON object (even if empty `{}`).
- Tool calls inside triple-backtick code fences are ignored (treated as documentation).

---

## Tool Result Format

After execution the extension injects the result as a user message:

```
<tool_result id="<call_id>">
{
  "id": "<call_id>",
  "success": true | false,
  "output": "<result string or JSON string>",
  "error": "<error message if success is false>"
}
</tool_result>
```

---

## Agent Loop Flow

```
User message
    │
    ▼
Stream model response
    │
    ├─ No <tool_call> found? ──► Commit assistant message → Done
    │
    └─ <tool_call> found?
           │
           ▼
      Parse & validate tool call
           │
           ├─ Confirmation required? ──► Show dialog to user
           │        │
           │        ├─ Approved ──► Execute
           │        └─ Rejected ──► Return failure result
           │
           ▼
      Execute tool handler
           │
           ▼
      Inject <tool_result> as user message
           │
           ▼
      iteration++ → loop (max 20 iterations)
```

---

## Available Tools

### `read_file`

Read a file's content from the workspace.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `path` | string | yes | Path relative to workspace root |

**Result:** `{ content: string, lines: number, truncated: boolean }` (capped at 500 lines)

**Example:**
```
<tool_call>
{ "tool": "read_file", "id": "c1", "parameters": { "path": "src/extension.ts" } }
</tool_call>
```

---

### `write_file`

Write (or overwrite) a file. Creates parent directories automatically.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `path` | string | yes | Path relative to workspace root |
| `content` | string | yes | File content to write |

**Result:** `{ success: boolean, path: string }`

---

### `edit_file`

Replace an exact string in a file. Requires confirmation in "ask" mode.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `path` | string | yes | Path relative to workspace root |
| `old_string` | string | yes | The exact string to replace (must appear exactly once) |
| `new_string` | string | yes | The replacement string |

**Result:** `{ success: boolean, diff: string }`

**Errors:** Fails if `old_string` appears 0 or more than 1 time.

---

### `create_file`

Create a new file. Fails if the file already exists.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `path` | string | yes | Path relative to workspace root |
| `content` | string | no | Initial content (defaults to empty) |

**Result:** `{ success: boolean, path: string }`

---

### `delete_file`

Delete a file from the workspace.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `path` | string | yes | Path relative to workspace root |

**Result:** `{ success: boolean, path: string }`

---

### `list_directory`

List the contents of a directory (up to 3 levels deep).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `path` | string | no | Path relative to workspace root (defaults to `.`) |
| `recursive` | boolean | no | Whether to recurse into subdirectories (defaults to `true`) |

**Result:** `{ entries: Array<{ name: string, type: "file" | "directory" }>, count: number }`

Automatically excludes: `node_modules`, `.git`, `out`, `dist`, `__pycache__`.

---

### `grep_codebase`

Search the workspace for files matching a regex pattern.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `pattern` | string | yes | Regex pattern to search for |
| `glob` | string | no | Glob pattern to filter files (e.g. `"**/*.ts"`) |
| `max_results` | number | no | Maximum matches to return (default 50) |

**Result:** `{ matches: Array<{ file: string, line: number, content: string }>, count: number }`

Uses ripgrep if available on PATH, otherwise falls back to VS Code's built-in search.

---

### `run_terminal`

Execute a shell command in the workspace root. Requires user confirmation.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `command` | string | yes | The shell command to execute |
| `cwd` | string | no | Working directory (defaults to workspace root) |

**Result:** `{ stdout: string, stderr: string, exitCode: number }`

**Timeout:** 30 seconds (configurable via `gemma-code.requestTimeout`).

**Blocked commands (unconditional):** `rm -rf /`, `rm -rf /*`, `format c:`, `shutdown`, `halt`, `init 0`, `del /f /s /q c:\`.

---

### `web_search`

Search the web via DuckDuckGo (no API key required, privacy-preserving).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | string | yes | Search query |
| `max_results` | number | no | Maximum results to return (default 5, max 10) |

**Result:** `{ results: Array<{ title: string, url: string, snippet: string }>, count: number }`

---

### `fetch_page`

Fetch a web page and return its content as plain text.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `url` | string | yes | URL to fetch |

**Result:** `{ text: string, truncated: boolean }` (truncated at 2000 characters)

**Timeout:** 10 seconds.

---

## Confirmation Modes

The `gemma-code.toolConfirmationMode` setting controls when the user is prompted:

| Mode | Behavior |
|------|----------|
| `"always"` | Prompt before every tool execution |
| `"ask"` | Prompt before `edit_file` and `run_terminal` (default) |
| `"never"` | Never prompt; execute all tools automatically |

Confirmation requests appear as inline cards in the chat UI with Approve/Reject buttons. Unanswered requests time out after 60 seconds (treated as rejection).

---

## Error Format

When a tool fails, the result has `success: false` and an `error` field:

```json
{
  "id": "c1",
  "success": false,
  "output": "",
  "error": "File not found or unreadable: \"src/missing.ts\""
}
```

The model should acknowledge the error and either retry with corrected parameters or inform the user.

---

## Security Considerations

- **Path traversal protection:** All filesystem tools resolve paths against the workspace root and reject paths that escape it.
- **Command blocklist:** `run_terminal` unconditionally blocks destructive system commands regardless of confirmation mode.
- **Offline-first:** `web_search` and `fetch_page` use public endpoints; no API keys or user data are transmitted to Anthropic or Google.
