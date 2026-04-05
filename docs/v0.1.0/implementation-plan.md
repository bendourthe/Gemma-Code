# Gemma Code v0.1.0 — Implementation Plan

> **Goal**: Deliver a Windows `.exe` installer that installs the Gemma Code VS Code extension, sets up all dependencies, pulls the Gemma 4 model locally via Ollama, and provides a fully agentic, Claude Code-style coding assistant that runs entirely offline.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Phase 1 — Extension Skeleton & Ollama Client](#phase-1--extension-skeleton--ollama-client)
3. [Phase 2 — Chat Engine & Streaming UI](#phase-2--chat-engine--streaming-ui)
4. [Phase 3 — Agentic Tool Layer](#phase-3--agentic-tool-layer)
5. [Phase 4 — Skills, Commands & DevAI-Hub Integration](#phase-4--skills-commands--devai-hub-integration)
6. [Phase 5 — Advanced UX Features](#phase-5--advanced-ux-features)
7. [Phase 6 — Python Backend & Inference Optimisation](#phase-6--python-backend--inference-optimisation)
8. [Phase 7 — Installer & Distribution](#phase-7--installer--distribution)
9. [Phase 8 — Hardening, CI/CD & Release](#phase-8--hardening-cicd--release)
10. [Cross-Cutting Concerns](#cross-cutting-concerns)
11. [Dependency Map](#dependency-map)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│                  VS Code Extension               │
│  ┌────────────┐  ┌───────────────────────────┐   │
│  │  Sidebar   │  │  WebviewPanel (Chat UI)   │   │
│  │  TreeView  │  │  React + Tailwind CSS     │   │
│  └────────────┘  └───────────────────────────┘   │
│  ┌────────────────────────────────────────────┐  │
│  │ Extension Host (Node.js)                   │  │
│  │  • ConversationManager                     │  │
│  │  • ToolRegistry (edit / terminal / search) │  │
│  │  • SkillLoader (DevAI-Hub format)          │  │
│  │  • ContextCompactor                        │  │
│  │  • ChatHistoryStore (SQLite / JSON)        │  │
│  └───────────────────┬────────────────────────┘  │
└──────────────────────┼───────────────────────────┘
                       │ HTTP/SSE
┌──────────────────────▼───────────────────────────┐
│             Ollama Local Server                  │
│       POST /api/chat  (streaming NDJSON)         │
│      Model: gemma4 (pulled at install time)      │
└──────────────────────────────────────────────────┘
```

**Key design decisions:**
- All LLM calls go through Ollama's `/api/chat` endpoint with `stream: true`
- The extension host is the authoritative owner of conversation state
- The webview is a pure rendering surface communicating via VS Code message-passing
- Tools are implemented as typed TypeScript handlers; the model uses a structured JSON tool-call protocol
- Skills are loaded at startup from `~/.gemma-code/skills/` (and the bundled DevAI-Hub catalog)
- Chat history is persisted in a local SQLite database in the extension's global storage path

---

## Phase 1 — Extension Skeleton & Ollama Client

**Goal**: A working VS Code extension that can connect to Ollama, send a message, and stream the response to the developer console. No UI yet.

### Phase 1 Success Criteria

- `npm run build` succeeds with zero TypeScript errors
- Extension activates in VS Code with a registered command `gemma-code.ping`
- Running the command sends a test message to Ollama and logs the streamed response to the Output channel
- Unit tests pass; Ollama client is covered by mocked HTTP tests
- No regressions on lint and type-check

---

### Sub-task 1.1 — Bootstrap Extension Package

**Prompt:**
```
Bootstrap the Gemma Code VS Code extension package.

Create the following files in the repo root (TypeScript extension):

1. `package.json` — VS Code extension manifest:
   - name: "gemma-code"
   - displayName: "Gemma Code"
   - description: "Local agentic coding assistant powered by Gemma 4 via Ollama"
   - version: "0.1.0"
   - engines: { "vscode": "^1.90.0" }
   - categories: ["AI", "Programming Languages", "Other"]
   - activationEvents: ["onStartupFinished"]
   - main: "./out/extension.js"
   - contributes:
     - commands: [{ command: "gemma-code.ping", title: "Gemma Code: Ping Ollama" }]
   - scripts: build (tsc), watch (tsc -w), test (vitest run), lint (eslint src), package (vsce package)
   - devDependencies: typescript, @types/vscode, @types/node, eslint, vitest, vsce
   - dependencies: (none yet)

2. `tsconfig.json` — strict TypeScript config:
   - target: ES2022, module: Node16, moduleResolution: node16
   - strict: true, noUncheckedIndexedAccess: true
   - outDir: ./out, rootDir: ./src

3. `configs/eslint.config.mjs` — ESLint flat config with TypeScript rules

4. `src/extension.ts` — extension entry point:
   - export activate(context: vscode.ExtensionContext)
   - Register the gemma-code.ping command (stub that logs "pong" to an Output channel)
   - export deactivate()

5. `.vscodeignore` — exclude node_modules, src, tsconfig, test files from packaged VSIX

Install dependencies with `npm install`.
Run `npm run build` and verify it succeeds before finishing.
```

---

### Sub-task 1.2 — Ollama HTTP Client

**Prompt:**
```
Implement a typed Ollama HTTP client in `src/ollama/client.ts`.

Requirements:
- Base URL configurable (default: "http://localhost:11434")
- Method: `streamChat(request: OllamaChatRequest): AsyncGenerator<OllamaChatChunk>`
  - POST to /api/chat with stream: true
  - Parse response as newline-delimited JSON (NDJSON)
  - Yield each parsed OllamaChatChunk as it arrives
  - Throw a typed OllamaError if the HTTP status is not 2xx
- Method: `checkHealth(): Promise<boolean>`
  - GET /api/tags and return true if status 200, false otherwise
- Method: `listModels(): Promise<OllamaModel[]>`
  - GET /api/tags and return the parsed model list

Types to define in `src/ollama/types.ts`:
- OllamaChatRequest: { model: string; messages: OllamaMessage[]; stream: boolean; options?: OllamaOptions }
- OllamaMessage: { role: "system" | "user" | "assistant"; content: string }
- OllamaOptions: { temperature?: number; top_p?: number; num_ctx?: number }
- OllamaChatChunk: { message: { role: string; content: string }; done: boolean }
- OllamaModel: { name: string; modified_at: string; size: number }
- OllamaError: extends Error with statusCode: number

Implementation notes:
- Use Node.js built-in `fetch` (available in Node 18+)
- Do NOT use axios or any HTTP library; keep dependencies minimal
- Use an AbortController so callers can cancel in-flight requests
- Export a singleton factory `createOllamaClient(baseUrl?: string): OllamaClient`

Update `src/extension.ts` ping command to call checkHealth() and stream a test message,
printing each chunk token to the "Gemma Code" Output channel.
```

---

### Sub-task 1.3 — Configuration Management

**Prompt:**
```
Add VS Code configuration contributions and a typed settings module.

In `package.json`, add to contributes.configuration:
- gemma-code.ollamaUrl: string (default "http://localhost:11434") — Ollama server URL
- gemma-code.modelName: string (default "gemma3:27b") — model to use for inference
- gemma-code.maxTokens: number (default 8192) — maximum context tokens
- gemma-code.temperature: number (default 0.2) — sampling temperature
- gemma-code.requestTimeout: number (default 60000) — HTTP timeout in milliseconds

Create `src/config/settings.ts`:
- Export interface GemmaCodeSettings with typed fields for each config key
- Export function getSettings(): GemmaCodeSettings that reads from vscode.workspace.getConfiguration("gemma-code")
- Export function onSettingsChange(callback: (settings: GemmaCodeSettings) => void): vscode.Disposable
  that listens to onDidChangeConfiguration and calls back with updated values

Update the OllamaClient to read baseUrl and timeout from getSettings() rather than hard-coded defaults.
```

---

### Sub-task 1.4 — Phase 1 Tests

**Prompt:**
```
Write comprehensive tests for Phase 1 deliverables using Vitest.

Test files to create:
1. `tests/unit/ollama/client.test.ts`:
   - Mock global fetch using vi.stubGlobal('fetch', ...)
   - Test checkHealth() returns true on 200, false on non-200
   - Test listModels() parses the Ollama /api/tags response correctly
   - Test streamChat() yields correct chunks from a mocked NDJSON stream
   - Test streamChat() throws OllamaError on non-2xx responses
   - Test that AbortController cancellation stops the generator

2. `tests/unit/config/settings.test.ts`:
   - Mock vscode.workspace.getConfiguration using vi.mock
   - Test getSettings() returns correctly typed defaults
   - Test onSettingsChange() calls the callback when configuration changes

3. `tests/unit/extension.test.ts`:
   - Test that activate() registers the gemma-code.ping command
   - Test that deactivate() disposes all registered disposables

Run the tests with `npm run test` and ensure 100% pass rate.
Add a `configs/vitest.config.ts` that sets up the test environment correctly (environment: "node",
globals: true, coverage enabled for src/ with threshold 80%).

Also add an integration smoke test in `tests/integration/ollama-health.test.ts` that:
- Skips if OLLAMA_URL is not set in the environment
- Calls checkHealth() against a real Ollama server
- Verifies a model named "gemma3" or "gemma4" appears in listModels()
Tag this test with @integration so it only runs when explicitly enabled.

At the end, run `npm run lint && npm run test` and fix any issues until both pass cleanly.
```

---

### Phase 1 Wrap-Up

At the end of Phase 1, run `/generate-session-history` to document all work completed in this phase, including what was built, what tests pass, any deviations from the plan, and next-phase prerequisites.

---

## Phase 2 — Chat Engine & Streaming UI

**Goal**: A fully functional chat panel in VS Code with streaming responses, a conversation manager, and a polished React-based webview UI.

### Phase 2 Success Criteria

- The sidebar shows a Gemma Code panel with a chat input and response area
- Sending a message streams tokens from Ollama into the UI in real time
- Conversation history is maintained in the session (not yet persisted)
- The UI handles loading states, error states, and empty states gracefully
- Unit tests cover the conversation manager; webview component tests verify rendering

---

### Sub-task 2.1 — Conversation Manager

**Prompt:**
```
Implement a ConversationManager in `src/chat/ConversationManager.ts`.

Responsibilities:
- Maintain an ordered list of Message objects for the current session
- Provide addUserMessage(content: string): void
- Provide addAssistantMessage(content: string): void
- Provide addSystemMessage(content: string): void
- Provide getHistory(): Message[] — returns all messages
- Provide clearHistory(): void
- Provide trimToContextLimit(maxTokens: number): void — removes oldest non-system messages
  until estimated token count is below maxTokens (use a 4 chars-per-token heuristic)
- Expose an onDidChange: vscode.EventEmitter<Message[]> for reactive updates

Types in `src/chat/types.ts`:
- Message: { id: string; role: "system" | "user" | "assistant"; content: string; timestamp: number }
- ConversationSession: { id: string; title: string; messages: Message[]; createdAt: number; updatedAt: number }

The manager should include a system prompt that:
1. Describes Gemma Code's role as an agentic coding assistant
2. Specifies the tool-call JSON protocol (to be expanded in Phase 3)
3. Instructs the model to respond concisely and in Markdown

Export a singleton createConversationManager() factory.
```

---

### Sub-task 2.2 — Webview Chat Panel

**Prompt:**
```
Create the VS Code sidebar panel and webview for the chat UI.

Architecture:
- `src/panels/GemmaCodePanel.ts`: VS Code WebviewViewProvider that registers the "gemma-code.chatView" viewType
- The webview HTML is built from a template in `src/panels/webview/` and injected at runtime
- Message protocol between extension host and webview uses postMessage with typed discriminated unions

Message types to define in `src/panels/messages.ts`:
- ExtensionToWebview: 
  | { type: "token"; content: string }         — streaming token
  | { type: "messageComplete"; id: string }    — stream finished
  | { type: "history"; messages: Message[] }   — full history sync
  | { type: "error"; message: string }         — error to display
  | { type: "status"; state: "idle" | "streaming" | "thinking" }
- WebviewToExtension:
  | { type: "sendMessage"; content: string }   — user submitted message
  | { type: "clearChat" }
  | { type: "cancelStream" }
  | { type: "ready" }                          — webview finished loading

Webview UI (build as a self-contained HTML/JS bundle):
- Use vanilla TypeScript compiled separately (NOT React for now — keep it simple in Phase 2)
- Layout: sticky header (model name + status badge), scrollable message list, sticky footer (textarea + send button)
- Message bubbles: user messages right-aligned, assistant messages left-aligned with Markdown rendering
  (use marked.js bundled inline — no CDN links, all assets must be embedded or served via extensionUri)
- Streaming: append token text character by character to the current assistant bubble; auto-scroll to bottom
- Show a pulsing "thinking" indicator while status is "streaming"
- Input: textarea that submits on Enter (Shift+Enter for newline); disable while streaming

Register the view in package.json:
- contributes.views.gemma-code-sidebar: [{ id: "gemma-code.chatView", name: "Chat", type: "webview" }]
- contributes.viewsContainers.activitybar: [{ id: "gemma-code-sidebar", title: "Gemma Code", icon: "assets/icon.svg" }]

Wire GemmaCodePanel to ConversationManager:
- On "sendMessage": add user message to manager, stream from OllamaClient, relay tokens to webview
- On "clearChat": clear manager history, sync webview
- On "cancelStream": call abort on the in-flight OllamaClient request
```

---

### Sub-task 2.3 — Streaming Pipeline

**Prompt:**
```
Implement the full streaming pipeline connecting the conversation manager to the webview.

Create `src/chat/StreamingPipeline.ts`:

class StreamingPipeline {
  constructor(
    private client: OllamaClient,
    private manager: ConversationManager,
    private panel: GemmaCodePanel
  ) {}

  async sendMessage(userContent: string): Promise<void> {
    // 1. Add user message to manager
    // 2. Post status "thinking" to webview
    // 3. Build the Ollama request from manager.getHistory()
    // 4. Start streaming; accumulate full assistant response
    // 5. On each chunk: post { type: "token", content } to webview
    // 6. On done: add complete assistant message to manager, post "messageComplete"
    // 7. On error: post { type: "error", message } and reset status to "idle"
    // 8. Always post status "idle" in a finally block
  }

  cancel(): void {
    // Abort the in-flight stream via AbortController
  }
}

Error handling requirements:
- If Ollama is unreachable: post a user-friendly error with a "Start Ollama" link (vscode.env.openExternal)
- If the model is not found: post an error with instructions to run `ollama pull gemma3:27b`
- Network timeout: cancel and show timeout message

Include retry logic: if a stream fails within the first 3 tokens, retry once automatically.
```

---

### Sub-task 2.4 — Phase 2 Tests

**Prompt:**
```
Write tests for Phase 2 deliverables.

1. `tests/unit/chat/ConversationManager.test.ts`:
   - Test addUserMessage / addAssistantMessage / addSystemMessage
   - Test getHistory() returns messages in insertion order
   - Test clearHistory() empties the list
   - Test trimToContextLimit() removes oldest non-system messages until under limit
   - Test onDidChange fires after each mutation

2. `tests/unit/chat/StreamingPipeline.test.ts`:
   - Mock OllamaClient.streamChat to yield a sequence of chunks
   - Verify that each chunk posts a "token" message to the panel
   - Verify that a "messageComplete" message is posted after the stream ends
   - Verify that errors post an "error" message
   - Verify that cancel() aborts the stream

3. `tests/unit/panels/GemmaCodePanel.test.ts`:
   - Test that incoming "sendMessage" triggers StreamingPipeline.sendMessage
   - Test that incoming "clearChat" calls ConversationManager.clearHistory
   - Test that incoming "cancelStream" calls StreamingPipeline.cancel
   - Test that panel posts full "history" on "ready" message from webview

4. Webview UI smoke test (HTML/JS):
   - Write a jsdom-based test that loads the compiled webview JS
   - Simulate receiving a sequence of "token" messages
   - Assert that the assistant bubble text matches the concatenated tokens
   - Assert that auto-scroll was triggered

Target 80%+ coverage on all Phase 2 source files.
Run `npm run test` and fix all failures before marking complete.
```

---

### Phase 2 Wrap-Up

Run `/generate-session-history` to document Phase 2.

---

## Phase 3 — Agentic Tool Layer

**Goal**: The model can use structured tools: read files, edit files, run terminal commands, search the web, and list/grep the codebase. The extension validates and executes tool calls, showing progress in the UI.

### Phase 3 Success Criteria

- Model can request a tool call using a defined JSON protocol
- Extension parses, validates, and executes tool calls
- Results are fed back to the model for multi-turn tool loops
- Edit tool shows a diff and asks for confirmation before writing (default mode)
- Terminal tool executes commands in the VS Code integrated terminal
- Web search tool returns summarised results via a local search proxy
- Tests cover every tool handler with both success and error paths

---

### Sub-task 3.1 — Tool Protocol Design

**Prompt:**
```
Define and document the tool-call protocol between Gemma Code and the Gemma 4 model.

Create `docs/v0.1.0/tool-protocol.md` with the full specification, then implement it.

Protocol:
The model signals a tool call by emitting a JSON block inside its response, delimited by
XML-like tags that the extension detects in the streaming output:

<tool_call>
{
  "tool": "read_file",
  "id": "call_abc123",
  "parameters": {
    "path": "src/extension.ts"
  }
}
</tool_call>

After the extension executes the tool, it injects a tool result message into the conversation:
{ role: "user", content: "<tool_result id=\"call_abc123\">\n{...result JSON}\n</tool_result>" }

The model then continues its response.

Tools to define (types in `src/tools/types.ts`):
- read_file: { path: string } → { content: string; lines: number }
- write_file: { path: string; content: string } → { success: boolean }
- edit_file: { path: string; old_string: string; new_string: string } → { success: boolean; diff: string }
- list_directory: { path: string; recursive?: boolean } → { entries: FileEntry[] }
- grep_codebase: { pattern: string; glob?: string } → { matches: GrepMatch[] }
- run_terminal: { command: string; cwd?: string } → { stdout: string; stderr: string; exitCode: number }
- web_search: { query: string; maxResults?: number } → { results: SearchResult[] }
- create_file: { path: string; content: string } → { success: boolean }
- delete_file: { path: string } → { success: boolean }

Implement `src/tools/ToolCallParser.ts`:
- parseToolCall(text: string): ToolCall | null — extracts and parses the <tool_call> block
- formatToolResult(id: string, result: unknown): string — formats <tool_result> block

Update the system prompt in ConversationManager to include the full tool protocol description
and a list of available tools with their parameter schemas.
```

---

### Sub-task 3.2 — File System Tools

**Prompt:**
```
Implement the file system tool handlers in `src/tools/handlers/filesystem.ts`.

Implement these handlers using the VS Code API (vscode.workspace.fs) where possible:

1. ReadFileTool:
   - Resolve path relative to the workspace root
   - Read file content as UTF-8
   - Return { content, lines: lineCount }
   - Reject paths outside the workspace root (path traversal protection)
   - Cap response at 500 lines; if longer, return the first 500 with a truncation notice

2. WriteFileTool (used by create_file):
   - Write content to the given path, creating parent directories if needed
   - Return { success: true }

3. EditFileTool:
   - Read the current file content
   - Verify old_string appears exactly once (reject if 0 or >1 matches)
   - Replace old_string with new_string
   - Generate a unified diff using the `diff` npm package
   - In "ask before edit" mode: show the diff in a VS Code diff editor and ask for confirmation
   - In "auto edit" mode: apply immediately
   - Return { success, diff }

4. ListDirectoryTool:
   - Use vscode.workspace.fs.readDirectory
   - If recursive: walk subdirectories up to 3 levels deep
   - Exclude node_modules, .git, out, dist, __pycache__ automatically
   - Return entries with name, type ("file" | "directory"), and size

5. GrepCodebaseTool:
   - Use VS Code's workspace.findFiles + TextDocument search
   - Alternatively, shell out to ripgrep if available on PATH
   - Return up to 50 matches with file path, line number, and matched line content
   - Support glob pattern filtering

All handlers must:
- Validate inputs strictly (reject missing required fields, invalid paths)
- Return typed error objects on failure rather than throwing
- Log tool invocations to the Gemma Code Output channel
```

---

### Sub-task 3.3 — Terminal Tool

**Prompt:**
```
Implement the terminal tool handler in `src/tools/handlers/terminal.ts`.

Requirements:
- Create a dedicated "Gemma Code" VS Code terminal (reuse across calls in the session)
- Execute the command using vscode.window.createTerminal with shellPath from settings
- Capture stdout and stderr by writing to a temp file and reading after execution
  (VS Code terminal does not expose a programmatic stdout capture API directly)
  Alternative approach: use Node.js child_process.spawn with the workspace root as cwd;
  stream stdout/stderr; enforce a timeout (default 30s, configurable)
- Show the command and its output in the Gemma Code Output channel
- Return { stdout, stderr, exitCode }
- Hard-coded command blocklist: rm -rf /, format C:, shutdown, etc. — reject with an error message
- Before executing any command, post a confirmation request to the webview in "ask before run" mode
  showing the command and awaiting user approval/rejection

Implement `src/tools/handlers/terminal.ts` with class RunTerminalTool.
Create a shared `src/tools/ConfirmationGate.ts` that:
- Posts a { type: "confirmationRequest", id, description } message to the webview
- Returns a Promise that resolves when the webview posts { type: "confirmationResponse", id, approved: boolean }
- Times out after 60 seconds and rejects

Wire ConfirmationGate into EditFileTool and RunTerminalTool.
```

---

### Sub-task 3.4 — Web Search Tool

**Prompt:**
```
Implement a local web search tool in `src/tools/handlers/webSearch.ts`.

Implementation strategy (no external API key required):
1. Use the DuckDuckGo HTML endpoint: https://html.duckduckgo.com/html/?q=<encoded_query>
2. Fetch the HTML response using Node.js fetch
3. Parse the result snippets using a lightweight HTML parser (use `node-html-parser` npm package)
4. Extract up to maxResults (default 5) results with { title, url, snippet }
5. Return { results: SearchResult[] }

Additionally, implement a `fetchPage(url: string): Promise<string>` helper that:
- Fetches the page at the given URL (with a 10s timeout)
- Strips HTML tags to return plain text
- Truncates to 2000 characters with a "... (truncated)" suffix

Add a web_search tool and a fetch_page tool to the tool registry.

Privacy note: DuckDuckGo does not track users, which aligns with Gemma Code's privacy-first goal.
Document this in a comment in the implementation.

Update the system prompt to tell the model it can use web_search to find documentation,
and fetch_page to read a specific URL.
```

---

### Sub-task 3.5 — Tool Registry & Execution Loop

**Prompt:**
```
Implement the central tool registry and the agentic execution loop.

`src/tools/ToolRegistry.ts`:
- Maintains a map of tool name → handler
- Provides register(name: string, handler: ToolHandler): void
- Provides execute(call: ToolCall): Promise<ToolResult>
- On execution: validate parameters against the tool's schema, call the handler, catch errors

`src/tools/AgentLoop.ts`:
- Wraps the streaming pipeline with tool execution logic
- Algorithm:
  1. Send user message; stream model response
  2. While the accumulated response contains a <tool_call> block:
     a. Parse the tool call
     b. Execute it via ToolRegistry
     c. Inject the tool result as a user message
     d. Continue streaming the model's next response
  3. When response has no tool call: complete
  4. Enforce a max_iterations limit (default 20) to prevent infinite loops
  5. On max_iterations exceeded: inject a system message telling the model to summarise and stop

Update StreamingPipeline to use AgentLoop instead of a single model call.
Update the webview to show tool call progress:
- When a tool is executing, show a "Using tool: <name>" indicator in the chat
- When a tool completes, show a collapsible "Tool result" block with the result summary

Wire the ToolRegistry in `src/extension.ts` activate() and register all implemented tools.
```

---

### Sub-task 3.6 — Phase 3 Tests

**Prompt:**
```
Write comprehensive tests for Phase 3 deliverables.

1. `tests/unit/tools/ToolCallParser.test.ts`:
   - Test parseToolCall with valid XML-wrapped JSON — returns correct ToolCall
   - Test parseToolCall with no tool call in text — returns null
   - Test parseToolCall with malformed JSON — returns null and logs warning
   - Test formatToolResult produces correct XML structure

2. `tests/unit/tools/handlers/filesystem.test.ts`:
   - Mock vscode.workspace.fs for all tests
   - ReadFileTool: test success, file-not-found error, path-traversal rejection, >500 line truncation
   - EditFileTool: test success with diff, old_string-not-found error, multiple-matches error
   - ListDirectoryTool: test flat listing, recursive listing, exclusion of node_modules
   - GrepCodebaseTool: test returns matches in expected format

3. `tests/unit/tools/handlers/terminal.test.ts`:
   - Mock child_process.spawn
   - Test successful command execution returns { stdout, stderr, exitCode: 0 }
   - Test timeout triggers and returns error
   - Test blocklisted command is rejected before execution
   - Test ConfirmationGate is called when mode is "ask"

4. `tests/unit/tools/handlers/webSearch.test.ts`:
   - Mock fetch globally
   - Test that search results are parsed from mocked DuckDuckGo HTML
   - Test that fetchPage strips HTML and truncates to 2000 chars
   - Test that a failed fetch returns a typed error result

5. `tests/unit/tools/AgentLoop.test.ts`:
   - Test single-turn (no tool call) completes normally
   - Test single tool call: model response → tool execution → model continues
   - Test multi-turn tool calls up to max_iterations
   - Test max_iterations exceeded sends stop signal and completes

Target 80%+ coverage. Run `npm run test` and fix all failures.
```

---

### Phase 3 Wrap-Up

Run `/generate-session-history` to document Phase 3.

---

## Phase 4 — Skills, Commands & DevAI-Hub Integration

**Goal**: Support `/command` slash commands, load skills from the DevAI-Hub catalog, and allow users to add custom skills from `~/.gemma-code/skills/`.

### Phase 4 Success Criteria

- `/help` shows a list of all available commands and skills
- `/commit`, `/review-pr`, and other DevAI-Hub skills execute correctly
- Users can add custom skills to `~/.gemma-code/skills/` and they are auto-loaded
- Command auto-complete appears in the chat input as the user types `/`
- Built-in commands (plan, compact, history) work correctly

---

### Sub-task 4.1 — Skill Loader

**Prompt:**
```
Implement the skill loading system in `src/skills/SkillLoader.ts`.

Skill format (DevAI-Hub compatible):
Each skill lives in its own directory with a `SKILL.md` file:
```
~/.gemma-code/skills/
  commit/
    SKILL.md
  review-pr/
    SKILL.md
```

`SKILL.md` structure:
```markdown
---
name: commit
description: Generate a commit message from staged changes
argument-hint: "[--all] [message]"
---

System prompt extension and instructions here.
$ARGUMENTS will be replaced with the arguments the user passed.
```

SkillLoader responsibilities:
- Load built-in skills from `src/skills/catalog/` (bundled with the extension)
- Load user skills from `~/.gemma-code/skills/` (created if it doesn't exist)
- Parse YAML frontmatter from SKILL.md using `js-yaml`
- Build a Skill object: { name, description, argumentHint, prompt }
- Watch `~/.gemma-code/skills/` for changes and hot-reload
- Provide getSkill(name: string): Skill | undefined
- Provide listSkills(): Skill[]

Bundle the following DevAI-Hub skills from https://github.com/bendourthe/DevAI-Hub as built-in catalog:
- commit (generate commit message)
- review-pr (review a PR or current diff)
- generate-readme (create/update README.md)
- generate-changelog (create CHANGELOG.md from git history)
- generate-tests (generate comprehensive test suite)
- analyze-codebase (produce structured codebase analysis)
- setup-project (bootstrap project structure)

For each skill, create a simplified SKILL.md in `src/skills/catalog/<name>/SKILL.md` that
captures the core prompt logic. Reference the DevAI-Hub repository at
https://github.com/bendourthe/DevAI-Hub for the authoritative skill content.
```

---

### Sub-task 4.2 — Command Parser & Router

**Prompt:**
```
Implement the command parsing and routing system in `src/commands/CommandRouter.ts`.

Built-in commands (hardcoded, not from skill files):

/help [command]
  → List all available skills and built-in commands; if command specified, show its description

/clear
  → Clear the current conversation (calls ConversationManager.clearHistory)

/history
  → Open the chat history browser (Phase 5 feature; stub with "coming soon" in Phase 4)

/plan
  → Toggle plan mode on/off. In plan mode, the model must produce a numbered plan
    before taking any action, and each step requires user approval before execution.

/compact
  → Trigger manual context compaction (see Phase 5 auto-compact)

/model [name]
  → Switch the active model (calls OllamaClient.listModels, presents a quick-pick)

/<skill-name> [arguments]
  → Load the skill, substitute $ARGUMENTS, prepend the skill prompt to the next user message,
    and send to the agent loop

CommandRouter.route(input: string): Command | null
- Returns null if input does not start with "/"
- Returns a Command object: { type: "builtin" | "skill"; name: string; args: string }

Update the webview chat input to:
- Detect when the user types "/" at the start of a message
- Fetch the skill/command list from the extension host
- Show an inline autocomplete popup (CSS-only dropdown) with matching commands
- On selection, fill in the command name and position cursor after it

Update the message handler in GemmaCodePanel to route / commands before sending to AgentLoop.
```

---

### Sub-task 4.3 — Plan Mode

**Prompt:**
```
Implement plan mode in `src/modes/PlanMode.ts`.

Plan mode behaviour:
1. When active, the system prompt gains an additional instruction:
   "You are in PLAN MODE. Before taking any action, produce a numbered plan with each step
   clearly described. Wait for the user to approve the plan step by step. Mark each approved
   step with [DONE] as you complete it."

2. The agent loop is modified:
   - After the model produces a plan (detected by the presence of numbered list items),
     pause execution and post a { type: "planReady", steps: string[] } message to the webview
   - The webview renders each step with an "Approve" button
   - Clicking "Approve" on step N sends { type: "approveStep", step: N } back to the extension
   - The extension resumes the agent loop for that step only

3. PlanModeState: { active: boolean; currentPlan: PlanStep[]; currentStep: number }
   PlanStep: { index: number; description: string; status: "pending" | "approved" | "done" }

4. Add plan mode indicator to the webview header (e.g., "PLAN MODE" badge when active)

5. The /plan command toggles plan mode and informs the user of the new state.

Implement plan step detection heuristic:
- Look for lines matching /^\d+\.\s+/ in the model's response
- If ≥2 such lines are found within the first 500 characters of the response, treat it as a plan
```

---

### Sub-task 4.4 — Phase 4 Tests

**Prompt:**
```
Write tests for Phase 4 deliverables.

1. `tests/unit/skills/SkillLoader.test.ts`:
   - Mock the file system (use tmp directories from os.tmpdir())
   - Test that built-in catalog skills load correctly
   - Test that a valid SKILL.md is parsed into the correct Skill object
   - Test that a SKILL.md with missing frontmatter fields is rejected with a warning
   - Test that listSkills() includes both built-in and user skills
   - Test that getSkill("nonexistent") returns undefined
   - Test that hot-reload fires when a new skill is added to the watch directory

2. `tests/unit/commands/CommandRouter.test.ts`:
   - Test route("/help") returns { type: "builtin", name: "help", args: "" }
   - Test route("/commit fix login bug") returns { type: "skill", name: "commit", args: "fix login bug" }
   - Test route("regular message") returns null
   - Test route("/nonexistent-skill") returns null with a warning

3. `tests/unit/modes/PlanMode.test.ts`:
   - Test that plan mode adds the plan instruction to the system prompt
   - Test plan step detection with a mock model response containing numbered steps
   - Test that the agent loop pauses after plan detection
   - Test that approveStep() advances to the next step

4. Integration test `tests/integration/commands/skill-execution.test.ts`:
   - Load the built-in "commit" skill
   - Verify the prompt contains the expected instruction text
   - Verify $ARGUMENTS substitution works correctly

Run `npm run test` and fix all failures before marking Phase 4 complete.
```

---

### Phase 4 Wrap-Up

Run `/generate-session-history` to document Phase 4.

---

## Phase 5 — Advanced UX Features

**Goal**: Persistent chat history, auto-compact (context window management), edit modes, and a polished overall UX.

### Phase 5 Success Criteria

- Chat sessions are saved to and loaded from local storage (SQLite)
- The chat history panel in the sidebar shows past sessions and allows resuming them
- Auto-compact triggers automatically when the context approaches the token limit
- Three edit modes work correctly: auto (apply immediately), ask (show diff + confirm), manual (never edit)
- The UI is visually polished with proper Markdown rendering including code highlighting

---

### Sub-task 5.1 — Persistent Chat History (SQLite)

**Prompt:**
```
Implement persistent chat history storage using SQLite.

Install `better-sqlite3` and `@types/better-sqlite3` as dependencies.

Create `src/storage/ChatHistoryStore.ts`:

Schema (SQL):
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant')),
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );
  CREATE INDEX idx_messages_session ON messages(session_id, timestamp);

ChatHistoryStore methods:
- constructor(dbPath: string) — opens/creates the database at the extension global storage path
- createSession(title: string): ConversationSession
- saveMessage(sessionId: string, message: Message): void
- getSession(sessionId: string): ConversationSession | null
- listSessions(limit?: number): ConversationSession[] — most recent first, default limit 50
- deleteSession(sessionId: string): void
- searchSessions(query: string): ConversationSession[] — full-text search on message content
- close(): void

Integrate with ConversationManager:
- On activate: create or resume the most recent session
- On every message: save to ChatHistoryStore
- On clearHistory: start a new session (keep old one in history)
- Auto-generate session title from the first user message (first 60 chars)

Add a /history command that opens a "Chat History" sidebar view (simple HTML list of sessions
rendered in the webview) with the ability to click a session to load it.
```

---

### Sub-task 5.2 — Auto-Compact

**Prompt:**
```
Implement automatic context compaction in `src/chat/ContextCompactor.ts`.

Behaviour:
- After each completed model response, check the estimated token count of the conversation
- If the estimated token count exceeds 80% of gemma-code.maxTokens (from settings):
  1. Post a status message to the webview: "Context window approaching limit — compacting..."
  2. Send a compaction request to the model:
     System: "Summarise the conversation so far in a single concise paragraph, preserving all
     technical decisions, file paths, and action items. Output ONLY the summary."
  3. Receive the summary
  4. Replace all messages except the original system prompt with:
     - One "assistant" message: "[Conversation summary]\n\n<summary text>"
     - The most recent 4 user+assistant messages (to preserve immediate context)
  5. Post a status message: "Context compacted. Continuing..."

- The /compact command triggers this immediately regardless of token count

Token estimation:
- Use the 4 chars-per-token heuristic for English text
- Apply a 1.3x multiplier for code content (detect by presence of ``` blocks)

Add a token count indicator to the webview header that updates after each message,
showing "X / Y tokens (Z%)" with a colour gradient (green → yellow → red).

ContextCompactor must be wired into AgentLoop so compaction can happen mid-session
without user intervention.
```

---

### Sub-task 5.3 — Edit Modes

**Prompt:**
```
Implement the three edit mode settings and wire them through the tool layer.

Modes (stored in gemma-code.editMode setting: "auto" | "ask" | "manual"):

1. "auto" (default): EditFileTool applies changes immediately without asking
2. "ask": EditFileTool:
   a. Opens the file in VS Code's diff editor (vscode.commands.executeCommand("vscode.diff", ...))
   b. Posts a confirmation request to the webview with the diff
   c. Waits for user approval via ConfirmationGate
   d. On approval: writes the file; on rejection: skips the edit and notifies the model
3. "manual": EditFileTool does NOT write the file; instead it posts the diff to the webview
   and instructs the model that the edit was shown but not applied

Add a mode selector to the webview header (a segmented button: Auto | Ask | Manual).
Clicking a mode sends { type: "setEditMode", mode } to the extension, which updates the setting.

Also implement:
- A visual diff renderer in the webview for "ask" mode: render old/new lines with red/green
  background colours and line numbers
- A "✓ Apply" and "✗ Skip" button pair in the webview confirmation UI
- An activity indicator showing the file path being edited

Wire the edit mode into create_file and write_file as well (they should also respect "ask" mode).
```

---

### Sub-task 5.4 — UI Polish: Markdown & Code Highlighting

**Prompt:**
```
Polish the webview UI with proper Markdown rendering and syntax highlighting.

Replace the current plain-text rendering with:
1. Markdown parsing using `marked` (v12+) bundled with the extension (NOT loaded from CDN)
2. Syntax highlighting for code blocks using `highlight.js` (bundled, core + common languages only)
3. Custom CSS theme that matches VS Code's dark/light theme using VS Code CSS variables
   (--vscode-editor-background, --vscode-editor-foreground, etc.)

Specific rendering requirements:
- Code blocks: syntax-highlighted with language label and a "Copy" button in the top-right corner
- Inline code: styled with a distinct background
- Links: open in the system browser via vscode.env.openExternal (not in webview)
- Tool call blocks: rendered as a collapsible "<tool-name> ▶" component with the result inside
- Images in responses: not rendered (replace with "[image]" placeholder)

Performance:
- Render incrementally during streaming: append token text as-is while streaming,
  then re-parse and re-render the full Markdown once the stream completes
- Avoid re-rendering the entire message list on each token (only the current streaming bubble)

Accessibility:
- All interactive elements must have aria-labels
- Focus management: after submitting a message, keep focus on the textarea
- Support keyboard navigation through messages (arrow keys)
```

---

### Sub-task 5.5 — Phase 5 Tests

**Prompt:**
```
Write tests for Phase 5 deliverables.

1. `tests/unit/storage/ChatHistoryStore.test.ts`:
   - Use an in-memory SQLite database (":memory:") for all tests
   - Test createSession() creates a session with a generated ID and timestamps
   - Test saveMessage() persists a message linked to the session
   - Test getSession() retrieves session with all messages in timestamp order
   - Test listSessions() returns sessions sorted by updated_at descending
   - Test deleteSession() cascade-deletes associated messages
   - Test searchSessions() returns sessions containing the query term in message content

2. `tests/unit/chat/ContextCompactor.test.ts`:
   - Test that compaction is not triggered when token count < 80% of limit
   - Test that compaction IS triggered when token count >= 80% of limit
   - Test the compaction message sequence: compaction request → summary received → history replaced
   - Test that system messages are preserved after compaction
   - Test that the most recent 4 messages are preserved after compaction
   - Test /compact command triggers compaction regardless of token count

3. `tests/unit/modes/EditMode.test.ts`:
   - Test "auto" mode: EditFileTool writes without calling ConfirmationGate
   - Test "ask" mode: EditFileTool calls ConfirmationGate; writes on approval, skips on rejection
   - Test "manual" mode: EditFileTool never writes, posts diff to webview

4. Performance benchmark `tests/benchmarks/rendering.bench.ts`:
   - Benchmark Markdown rendering time for messages of 100, 500, 2000 tokens
   - Assert p99 render time < 50ms for messages up to 2000 tokens

Run `npm run test` and `npm run bench`. Fix all failures.
```

---

### Phase 5 Wrap-Up

Run `/generate-session-history` to document Phase 5.

---

## Phase 6 — Python Backend & Inference Optimisation

**Goal**: A Python FastAPI backend that handles inference preprocessing (prompt assembly, context management, model-specific prompt formatting) and provides a richer interface than raw Ollama for future extensibility.

### Phase 6 Success Criteria

- The Python backend starts automatically when the extension activates
- The TypeScript extension can optionally route requests through the Python backend instead of Ollama directly
- Gemma 4's chat template is correctly applied by the backend
- Benchmarks show latency within 10% of direct Ollama calls
- The backend can be disabled via setting (fall back to direct Ollama)

---

### Sub-task 6.1 — Python FastAPI Backend

**Prompt:**
```
Create a Python FastAPI backend in `src/backend/` (separate from the TypeScript extension).

Project setup:
- Use `uv` as the package manager with `pyproject.toml`
- Dependencies: fastapi, uvicorn[standard], httpx, pydantic>=2, python-multipart
- Dev dependencies: pytest, pytest-asyncio, httpx (test client), ruff, mypy

File structure:
  src/backend/
    pyproject.toml
    src/
      backend/
        __init__.py
        main.py          # FastAPI app, startup/shutdown
        config.py        # Settings via pydantic-settings
        routers/
          chat.py        # /chat/stream endpoint
          models.py      # /models endpoint
          health.py      # /health endpoint
        services/
          ollama.py      # Async Ollama client using httpx
          prompt.py      # Prompt assembly and Gemma 4 chat template
        models/
          schemas.py     # Pydantic request/response models

Key endpoints:
- GET /health → { status: "ok", ollama_reachable: bool, model: string }
- GET /models → { models: [{ name, size, modified_at }] }
- POST /chat/stream → StreamingResponse (SSE)
  Request body: { messages: Message[], model?: string, options?: dict }
  Response: server-sent events with data: {"token": "..."} and data: {"done": true}

Gemma 4 prompt template:
Gemma uses a specific chat template. The backend must format messages using:
  <start_of_turn>user\n{content}<end_of_turn>\n<start_of_turn>model\n
Apply this template when the model name contains "gemma".

The TypeScript extension should:
- Try to start the backend process on activate (using child_process.spawn with the Python binary)
- If the backend starts successfully, route all inference through it
- Fall back to direct Ollama if the backend fails to start
- Shut down the backend process on deactivate
```

---

### Sub-task 6.2 — Backend Tests & Benchmarks

**Prompt:**
```
Write tests and benchmarks for the Python backend.

Test structure:
  src/backend/tests/
    unit/
      test_prompt.py         # Prompt assembly and Gemma template formatting
      test_ollama_service.py # Async Ollama client (mock httpx)
    integration/
      test_chat_endpoint.py  # Full /chat/stream endpoint (mock Ollama)
      test_health_endpoint.py
    benchmarks/
      bench_prompt.py        # Prompt assembly throughput

Unit tests (`pytest` + `pytest-asyncio`):
1. test_prompt.py:
   - Test Gemma 4 chat template is correctly applied to a multi-turn conversation
   - Test that system messages are handled correctly (Gemma places system context in the first user turn)
   - Test that overly long histories are trimmed before sending to Ollama

2. test_ollama_service.py:
   - Mock httpx.AsyncClient
   - Test stream_chat yields correct chunks from NDJSON response
   - Test error handling (connection refused → OllamaUnavailableError)
   - Test list_models parses /api/tags correctly

3. test_chat_endpoint.py:
   - Use httpx.AsyncClient(app=app, base_url="http://test") as test client
   - Test POST /chat/stream returns SSE events with token content
   - Test error response when Ollama is unreachable

Benchmarks (use pytest-benchmark):
- Measure prompt assembly time for 10, 50, 100 message histories
- Assert median assembly time < 5ms for 100-message histories

Run: `uv run pytest tests/unit tests/integration -q` and fix all failures.
Run: `uv run ruff check . && uv run ruff format --check .` — fix lint issues.
```

---

### Phase 6 Wrap-Up

Run `/generate-session-history` to document Phase 6.

---

## Phase 7 — Installer & Distribution

**Goal**: A single Windows `.exe` installer that installs everything a user needs: the VS Code extension, Ollama (if not present), the Gemma 4 model, and the Python backend dependencies.

### Phase 7 Success Criteria

- `setup.exe` runs on Windows 10/11 and installs all components silently
- After installation, launching VS Code and opening the Gemma Code panel works without additional setup
- The installer handles the case where Ollama is already installed (skips re-installation)
- The installer creates a Start Menu shortcut and an uninstaller
- The build pipeline produces the installer as a CI artifact

---

### Sub-task 7.1 — VSIX Build Pipeline

**Prompt:**
```
Set up the VSIX build pipeline for the extension.

Steps to implement in `scripts/build-vsix.sh` (or `scripts/build-vsix.ps1` for Windows):

1. Install dependencies: `npm ci`
2. Run lint: `npm run lint`
3. Run tests: `npm run test`
4. Compile TypeScript: `npm run build`
5. Bundle the webview assets (Markdown renderer, highlight.js, CSS) into `out/webview/`
6. Bundle the Python backend source into `out/backend/`
7. Copy the built-in skills catalog into `out/skills/`
8. Package the VSIX: `npx vsce package --no-dependencies`
9. Output: `gemma-code-0.1.0.vsix`

Update `.vscodeignore` to exclude:
- src/, tests/, configs/, *.ts, tsconfig.json, node_modules
- Everything not needed at runtime

Verify the VSIX installs correctly by running:
  `code --install-extension gemma-code-0.1.0.vsix`
and checking that the extension activates.

Add a `package.json` script: "package": "sh scripts/build-vsix.sh"
```

---

### Sub-task 7.2 — NSIS Installer Script

**Prompt:**
```
Create an NSIS installer script at `scripts/installer/setup.nsi`.

The installer must perform these steps in order:

1. Check prerequisites:
   - Verify Windows 10 version 1903 or later (minimum OS requirement)
   - Check if VS Code is installed (check HKLM/HKCU registry for Code.exe path)
   - If VS Code not found: show error dialog with download link and abort

2. Install Ollama (if not already installed):
   - Check if `ollama` exists on PATH or at default install path
   - If not present: download OllamaSetup.exe from https://ollama.com/download/OllamaSetup.exe
     (embed the download in the installer OR download at runtime — use runtime download to keep installer small)
   - Run OllamaSetup.exe silently: OllamaSetup.exe /SILENT
   - Wait for completion and verify ollama is on PATH

3. Install the VS Code extension:
   - Extract gemma-code-0.1.0.vsix to a temp directory
   - Run: `code --install-extension <path-to-vsix>`
   - Verify exit code 0

4. Set up Python virtual environment for the backend:
   - Check if Python 3.11+ is installed (try py -3.11, py -3, python3, python in order)
   - If not found: download Python 3.12 installer from python.org and install silently
   - Create a venv at: %LOCALAPPDATA%\GemmaCode\venv
   - Install backend dependencies: `<venv>\Scripts\pip install -r backend-requirements.txt`

5. Pull the Gemma model:
   - Run: `ollama pull gemma3:27b` in a visible progress window
   - Show download progress using NSIS progress macros
   - This step is skippable (checkbox: "Download Gemma 4 model now (15 GB)")

6. Create shortcuts and registry entries:
   - Start Menu shortcut: "Gemma Code → Open in VS Code"
   - Add to Add/Remove Programs

7. Uninstaller:
   - Remove the venv directory
   - Uninstall the VS Code extension: `code --uninstall-extension gemma-code.gemma-code`
   - Leave Ollama and models in place (they may be used by other tools)

NSIS settings:
- RequestExecutionLevel: admin (needed for Ollama install; venv can be user-level)
- InstallDir: $PROGRAMFILES64\GemmaCode
- Compression: lzma (solid block)

Create `scripts/installer/build-installer.ps1` that:
1. Builds the VSIX
2. Exports backend requirements: `uv export > scripts/installer/backend-requirements.txt`
3. Compiles the NSIS script: `makensis setup.nsi`
4. Signs the output with a self-signed certificate (for development builds)
```

---

### Sub-task 7.3 — CI/CD Pipeline

**Prompt:**
```
Create a GitHub Actions CI/CD pipeline in `.github/workflows/`.

1. `ci.yml` — runs on every push and PR:
   jobs:
   - lint-ts: npm run lint
   - test-ts: npm run test (with coverage report uploaded as artifact)
   - build-ts: npm run build
   - lint-py: uv run ruff check . && uv run mypy src/
   - test-py: uv run pytest tests/unit tests/integration -q --cov=src/backend --cov-report=xml
   - coverage-gate: fail if TypeScript coverage < 80% or Python coverage < 80%

2. `release.yml` — runs on push to main with a version tag (v*.*.*):
   jobs:
   - build-vsix:
     - runs-on: ubuntu-latest
     - Builds and uploads the VSIX as a release artifact
   - build-installer:
     - runs-on: windows-latest
     - Installs NSIS
     - Runs scripts/installer/build-installer.ps1
     - Uploads setup.exe as a release artifact
   - create-release:
     - Creates a GitHub Release with the VSIX and setup.exe attached
     - Generates release notes from CHANGELOG.md

3. `nightly.yml` — runs daily at 02:00 UTC:
   - Runs the full integration test suite (including Ollama health checks)
   - Runs performance benchmarks and uploads results as artifacts
   - Sends a Slack/email notification on failure (configurable via repository secrets)

Add branch protection rules documentation in `docs/v0.1.0/ci-setup.md`:
- Require status checks to pass before merging
- Required checks: lint-ts, test-ts, build-ts, lint-py, test-py, coverage-gate
```

---

### Sub-task 7.4 — Installer Tests

**Prompt:**
```
Write tests that validate the installer logic and the installation outcome.

1. `tests/integration/installer/test-install-sequence.ps1`:
   PowerShell integration test that:
   - Runs in a Windows Sandbox or Docker container (document the setup requirement)
   - Simulates running each installer step in sequence
   - Verifies after step 3 that `gemma-code.gemma-code` appears in VS Code extension list
   - Verifies after step 4 that the venv exists and has the expected packages
   - Verifies the uninstaller removes the venv and extension cleanly

2. `tests/unit/installer/nsis-logic.test.ps1`:
   - Test the prerequisite checks for VS Code (mock registry reads)
   - Test the Ollama detection logic
   - Test the Python detection logic (multiple fallback candidates)

3. E2E smoke test `tests/e2e/extension-load.test.ts` (Playwright + VS Code Extension Tester):
   - Launch VS Code with the extension installed
   - Open the Gemma Code sidebar
   - Verify the chat panel renders (even without Ollama running — shows "Ollama unreachable" state)
   - Verify the /help command is recognized

Document in `docs/v0.1.0/testing.md` how to run the installer tests locally.
```

---

### Phase 7 Wrap-Up

Run `/generate-session-history` to document Phase 7.

---

## Phase 8 — Hardening, CI/CD & Release

**Goal**: Final polish, security hardening, comprehensive E2E tests, performance benchmarks, and the first stable v0.1.0 release candidate.

### Phase 8 Success Criteria

- All unit, integration, and E2E tests pass on a clean machine
- No high/critical security findings from dependency audit
- Extension handles all error scenarios gracefully (no unhandled promise rejections)
- Performance benchmarks meet the defined thresholds
- CHANGELOG and README are complete and accurate
- The v0.1.0 tag triggers the full release pipeline

---

### Sub-task 8.1 — Security Audit

**Prompt:**
```
Perform a comprehensive security audit of the Gemma Code codebase.

Run the following checks and fix all high/critical findings:

1. Dependency audit:
   - npm: `npm audit --audit-level=high` — fix or document all high/critical issues
   - Python: `uv run pip-audit` — fix all findings
   - Generate an SBOM: `npx @cyclonedx/cyclonedx-npm --output-file sbom.json`

2. Static analysis:
   - Run `eslint src/ --rule '{"no-eval": "error"}'` — ensure no eval() usage
   - Check that all tool handlers validate path inputs against the workspace root
   - Verify that the web search tool cannot be used to make requests to localhost or internal IPs
   - Verify that the terminal tool blocklist covers common destructive commands

3. Secret scanning:
   - Run `git secret scan` or `trufflehog filesystem .` to check for accidentally committed secrets
   - Verify that API keys and tokens are never hardcoded (should be zero)

4. Command injection review:
   - Audit every call to child_process.spawn/exec
   - Ensure all shell arguments are passed as array elements, never string-interpolated
   - Verify the terminal tool does not allow command chaining that bypasses the blocklist

Document all findings and remediations in `docs/v0.1.0/security-audit.md`.
```

---

### Sub-task 8.2 — Performance Benchmarks

**Prompt:**
```
Define and run a full performance benchmark suite.

Benchmarks to implement in `tests/benchmarks/`:

1. `time-to-first-token.bench.ts`:
   - Measure time from sendMessage() call to first token arriving in the webview
   - Target: p50 < 2000ms, p99 < 5000ms (on a machine with Ollama running locally)
   - Run against a live Ollama instance; skip if OLLAMA_URL not set

2. `context-compaction.bench.ts`:
   - Measure compaction time for conversations of 50, 100, 200 messages
   - Target: p99 < 500ms for 200-message conversations

3. `tool-execution.bench.ts`:
   - Benchmark ReadFileTool on files of 100, 1000, 10000 lines
   - Benchmark GrepCodebaseTool on a repository of 100, 500 files
   - Target: ReadFileTool p99 < 50ms for 10000-line files; GrepCodebaseTool p99 < 2000ms for 500 files

4. `markdown-rendering.bench.ts`:
   - Benchmark webview Markdown rendering using jsdom
   - Target: p99 < 100ms for 5000-token responses

5. `skill-loading.bench.ts`:
   - Benchmark loading 10, 50, 100 skills from disk
   - Target: p99 < 200ms for 100 skills

Report results in `docs/v0.1.0/performance-benchmarks.md`.
Integrate benchmark runs into the nightly CI workflow.
```

---

### Sub-task 8.3 — Error Handling Hardening

**Prompt:**
```
Audit and harden error handling across the entire codebase.

Checklist to implement:

1. Global unhandled rejection handler in `src/extension.ts`:
   - Register process.on('unhandledRejection') and log to the Output channel
   - Never let unhandled rejections crash the extension host

2. Ollama unavailable state:
   - If Ollama is not reachable on activation, show a persistent warning in the sidebar
   - Include a "Retry" button and a link to Ollama installation instructions
   - Poll every 5 seconds for Ollama availability and auto-recover when it comes online

3. Model not found:
   - If the configured model is not in ollama list, show an actionable error:
     "Model 'gemma3:27b' not found. Run: ollama pull gemma3:27b"
   - Provide a "Pull model" quick action that runs the command in the integrated terminal

4. Stream interruption:
   - If the connection drops mid-stream, show "Connection interrupted" and offer a "Retry" button
   - Preserve the partial response in the conversation history

5. File system errors:
   - Wrap all vscode.workspace.fs calls in try/catch and return typed errors
   - Never let a file system error crash the agent loop; report it as a tool error and continue

6. Context overflow:
   - If a message exceeds the model's context window (detected via Ollama error response),
     trigger auto-compact and retry automatically (once)

7. Python backend crash:
   - If the backend process exits unexpectedly, log the stderr, fall back to direct Ollama,
     and show a notification "Backend process exited; using direct Ollama mode"

Write regression tests for each error scenario in `tests/unit/errors/`.
```

---

### Sub-task 8.4 — Documentation & Release

**Prompt:**
```
Prepare the documentation and release artifacts for v0.1.0.

1. Update `README.md` with:
   - Project overview and feature list
   - Installation instructions (installer path and manual VSIX path)
   - Quick start guide (first chat, first /commit, plan mode)
   - Configuration reference (all gemma-code.* settings with descriptions and defaults)
   - Troubleshooting section (Ollama not running, model not found, slow responses)
   - Contributing guide (development setup, test commands, PR process)

2. Update `CHANGELOG.md` for v0.1.0:
   - Use Keep a Changelog format
   - List all features added across Phases 1–8
   - Note any known limitations

3. Run `/generate-changelog` to produce a git-history-based CHANGELOG entry.

4. Create `docs/v0.1.0/architecture.md`:
   - System architecture diagram (ASCII or Mermaid)
   - Component descriptions
   - Data flow diagrams for the streaming pipeline and tool execution loop
   - Extension lifecycle description (activate → ready → in use → deactivate)

5. Tag the release:
   - Ensure all tests pass on main
   - Bump version to 0.1.0 in package.json and pyproject.toml
   - Commit: "chore: bump version to 0.1.0"
   - Tag: v0.1.0
   - Push the tag to trigger the release pipeline

6. Verify the release artifacts:
   - Download and install setup.exe on a clean Windows VM
   - Verify Gemma Code appears in VS Code
   - Send a test message and verify streaming works
   - Run /commit on a dummy repo and verify the output
```

---

### Phase 8 Wrap-Up

Run `/generate-session-history` to document Phase 8 and the full v0.1.0 release.

---

## Cross-Cutting Concerns

These topics span multiple phases and should be considered throughout development:

### Logging

- All components write to the "Gemma Code" VS Code Output channel (created in Phase 1)
- Log levels: DEBUG, INFO, WARN, ERROR — controlled by `gemma-code.logLevel` setting
- Structured logging: each entry includes timestamp, component name, and message
- Never log conversation content at INFO level or above (privacy)

### Telemetry

- No telemetry. Gemma Code is privacy-first. Zero outbound data except Ollama localhost calls and web searches the user explicitly requests.
- Remove any VS Code telemetry APIs if accidentally included.

### Accessibility

- All webview interactive elements must have aria-labels
- Keyboard-navigable message list and command palette
- High-contrast theme support via VS Code CSS variables

### Windows-Specific Considerations

- Use `path.win32` utilities when constructing paths for Windows
- The Python backend must handle Windows-style paths and line endings
- The terminal tool defaults to PowerShell on Windows (configurable)
- The installer targets Windows 10 1903+ (64-bit only)

---

## Dependency Map

```
Phase 1 (Skeleton)
    └── Phase 2 (Chat UI)
            └── Phase 3 (Tool Layer)
                    ├── Phase 4 (Skills & Commands)  [can overlap with Phase 5]
                    └── Phase 5 (Advanced UX)        [can overlap with Phase 4]
                            └── Phase 6 (Python Backend)
                                    └── Phase 7 (Installer)
                                            └── Phase 8 (Hardening & Release)
```

Phases 4 and 5 have no dependency on each other and can be developed in parallel by different contributors.
Phase 6 is optional for v0.1.0 (the extension functions correctly with direct Ollama) and can be deferred to v0.2.0 if timeline requires.

---

## Key Libraries & Versions

| Component | Library | Version |
|-----------|---------|---------|
| TypeScript | typescript | ^5.5 |
| VS Code Engine | @types/vscode | ^1.90 |
| Test runner | vitest | ^2.0 |
| Markdown | marked | ^12.0 |
| Syntax highlight | highlight.js | ^11.10 |
| HTML parser | node-html-parser | ^6.1 |
| SQLite | better-sqlite3 | ^11.0 |
| YAML parser | js-yaml | ^4.1 |
| Diff generator | diff | ^7.0 |
| Python runtime | Python | >=3.11 |
| Python web | fastapi + uvicorn | >=0.111, >=0.30 |
| Python HTTP | httpx | >=0.27 |
| Python validation | pydantic | >=2.7 |
| Local LLM | Ollama | latest |
| Model | gemma3:27b or gemma4 | latest via Ollama |
| Installer | NSIS | 3.x |

---

*Implementation plan for Gemma Code v0.1.0 — Generated 2026-04-05*
