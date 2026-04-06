# Architecture — Gemma Code v0.1.0

## Overview

Gemma Code is a VS Code extension that provides a local, agentic coding assistant powered by the Gemma language model via Ollama. All inference runs on the user's machine. No data is sent to external servers.

The system has three main runtime components:

1. **TypeScript extension** — runs in the VS Code Extension Host process
2. **Python FastAPI backend** — a child process spawned by the extension on activation
3. **Ollama server** — a separately installed model runtime the extension talks to via HTTP

---

## System Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  VS Code                                                            │
│                                                                     │
│  ┌─────────────────────────────┐    postMessage    ┌────────────┐  │
│  │  Extension Host (Node.js)   │ ◄────────────────► │  Webview   │  │
│  │                             │                    │  (HTML/JS) │  │
│  │  extension.ts               │                    └────────────┘  │
│  │  GemmaCodePanel             │                                    │
│  │  ConversationManager        │                                    │
│  │  StreamingPipeline          │                                    │
│  │  AgentLoop                  │                                    │
│  │  ToolRegistry               │                                    │
│  │  ContextCompactor           │                                    │
│  │  ChatHistoryStore (SQLite)  │                                    │
│  └────────────┬────────────────┘                                   │
│               │ HTTP (SSE / REST)                                   │
└───────────────┼────────────────────────────────────────────────────┘
                │
     ┌──────────┴──────────┐
     │                     │
     ▼                     ▼
┌──────────────┐    ┌─────────────────────────┐
│  Python      │    │  Ollama                  │
│  FastAPI     │───►│  (local model runtime)   │
│  Backend     │    │                          │
│  :11435      │    │  :11434                  │
└──────────────┘    └─────────────────────────┘
```

The extension prefers routing inference through the Python backend (for chat template formatting). If the backend is unavailable, it falls back to calling Ollama directly.

---

## Component Descriptions

### `src/extension.ts` — Entry Point

Registers the VS Code extension lifecycle: `activate()` and `deactivate()`.

Responsibilities:
- Creates the Output channel and logs all diagnostic messages
- Spawns the Python backend via `BackendManager`
- Registers the `gemma-code.ping` command
- Instantiates `GemmaCodePanel` and registers it as a webview view provider
- Registers a global `unhandledRejection` handler that logs to the Output channel
- Starts the Ollama availability poller (polls every 5 seconds; surfaces errors and recoveries in the webview)
- Runs an initial Ollama health check and posts an actionable error if Ollama is not reachable

### `src/ollama/client.ts` — Ollama HTTP Client

Wraps the Ollama REST API (`http://localhost:11434`).

Key methods:
- `streamChat(request)` — streaming generator that yields chunks from `/api/chat`
- `checkHealth()` — HEAD request to `/api/tags`; returns `boolean`
- `listModels()` — GET `/api/tags`; returns model metadata

### `src/chat/ConversationManager.ts` — Message History

Maintains the ordered list of `Message` objects for the current session.

- Integrates with `ChatHistoryStore` to persist messages to SQLite
- Provides `addUserMessage`, `addAssistantMessage`, `addSystemMessage`
- Provides `trimToContextLimit(maxTokens)` using a 4 chars/token heuristic
- Emits `onDidChange` events for reactive updates

### `src/chat/StreamingPipeline.ts` — Streaming Coordinator

Coordinates a single user message through the agent loop and relays tokens to the webview.

Flow:
1. Add user message to `ConversationManager`
2. Post `status: "thinking"` to webview
3. Call `AgentLoop.run()` which handles tool-use iterations
4. On each token: post `{ type: "token", content }` to webview
5. On done: add complete assistant message, post `messageComplete`
6. On error: post `{ type: "error" }` and reset status
7. Always post `status: "idle"` in a finally block

### `src/tools/AgentLoop.ts` — Agentic Tool-Use Loop

Wraps the streaming pipeline with multi-turn tool execution.

Algorithm:
1. Stream model response
2. If the accumulated response contains a `<tool_call>` block: parse, execute via `ToolRegistry`, inject `<tool_result>`, and stream the next model response
3. Repeat up to `maxAgentIterations` (default 20)
4. On iteration limit: inject a stop instruction and complete

### `src/tools/ToolRegistry.ts` — Tool Registry

Maps tool names to `ToolHandler` instances. Validates parameters before calling handlers and wraps exceptions into typed `ToolResult` objects.

Registered tools: `read_file`, `write_file`, `create_file`, `delete_file`, `edit_file`, `list_directory`, `grep_codebase`, `run_terminal`, `web_search`, `fetch_page`.

### `src/tools/handlers/` — Tool Handlers

| Handler | File | Description |
|---|---|---|
| `ReadFileTool` | `filesystem.ts` | Reads a file, caps at 500 lines, rejects paths outside workspace |
| `WriteFileTool` | `filesystem.ts` | Writes a file, respects edit mode (auto/ask/manual) |
| `CreateFileTool` | `filesystem.ts` | Creates a file including parent directories |
| `DeleteFileTool` | `filesystem.ts` | Deletes a file |
| `EditFileTool` | `filesystem.ts` | Replaces a unique string in a file; generates unified diff |
| `ListDirectoryTool` | `filesystem.ts` | Lists directory contents, up to 3 levels deep |
| `GrepCodebaseTool` | `filesystem.ts` | Searches workspace files for a pattern, up to 50 matches |
| `RunTerminalTool` | `terminal.ts` | Runs a shell command with timeout and blocklist |
| `WebSearchTool` | `webSearch.ts` | DuckDuckGo HTML search, no API key |
| `FetchPageTool` | `webSearch.ts` | Fetches and strips a URL; SSRF-protected |

### `src/panels/GemmaCodePanel.ts` — Webview Panel

VS Code `WebviewViewProvider` that hosts the chat UI. Wires together all subsystems.

Message protocol:
- Extension → Webview: `token`, `messageComplete`, `history`, `error`, `status`, `tokenCount`, `planReady`, `planModeToggled`, `editModeChanged`, `commandList`, `sessionList`, `confirmationRequest`
- Webview → Extension: `sendMessage`, `clearChat`, `cancelStream`, `ready`, `confirmationResponse`, `approveStep`, `loadSession`, `setEditMode`, `requestCommandList`

### `src/chat/ContextCompactor.ts` — Auto-Compact

Monitors estimated token count after each response. When the count exceeds 80% of `maxTokens`, it sends a compaction request to the model, receives a summary, and replaces the history with the summary plus the most recent 4 messages.

Token estimation: `chars / 4 * (1.3 if code blocks present)`.

### `src/storage/ChatHistoryStore.ts` — SQLite Persistence

Stores sessions and messages in a SQLite database at the VS Code global storage path. Provides create, save, list, search, and delete operations.

### `src/skills/SkillLoader.ts` — Skill Loader

Loads SKILL.md files from the built-in catalog (`src/skills/catalog/`) and user directory (`~/.gemma-code/skills/`). Hot-reloads user skills via `fs.watch`.

### `src/backend/BackendManager.ts` — Python Backend Manager

Spawns the Python FastAPI process as a child process, monitors its health, and shuts it down on extension deactivation.

### `src/backend/` — Python FastAPI Backend

A separate Python package (`pyproject.toml` at `src/backend/`).

Endpoints:
- `GET /health` — Ollama reachability check
- `GET /models` — list available models
- `POST /chat/stream` — SSE streaming response with Gemma chat template applied

---

## Data Flow — Streaming Pipeline

```
User types message
        │
        ▼
GemmaCodePanel._handleSendMessage()
        │
        ├── CommandRouter.route()  ─── slash command? → _handleBuiltinCommand()
        │                                              → SkillLoader.getSkill()
        │
        ▼
StreamingPipeline.send()
        │
        ▼
AgentLoop.run()
        │
  ┌─────┴──────────────────────────────────┐
  │  Loop (up to maxAgentIterations)        │
  │                                         │
  │  OllamaClient.streamChat()              │
  │         │                               │
  │  stream tokens ──► webview "token" msgs │
  │         │                               │
  │  ToolCallParser.parseToolCall()         │
  │         │                               │
  │  tool call found?                       │
  │    Yes ──► ToolRegistry.execute()       │
  │            ConfirmationGate (if ask)    │
  │            inject <tool_result>         │
  │    No  ──► break                        │
  └─────────────────────────────────────────┘
        │
        ▼
ConversationManager.addAssistantMessage()
ChatHistoryStore.saveMessage()
ContextCompactor.shouldCompact()  ──► compact if needed
        │
        ▼
webview "messageComplete" + rendered HTML
```

---

## Data Flow — Tool Execution

```
AgentLoop detects <tool_call> in response
        │
        ▼
ToolCallParser.parseToolCall()
        │ ToolCall { tool, id, parameters }
        ▼
ToolRegistry.execute(call)
        │
        ├── Validate parameters
        ├── ConfirmationGate.request() if mode requires it
        │         │
        │   webview "confirmationRequest"
        │   user clicks Approve/Reject
        │   webview "confirmationResponse"
        │         │
        ├── ToolHandler.execute(parameters)
        │
        ▼
ToolResult { id, success, output, error }
        │
        ▼
ToolCallParser.formatToolResult(id, result)
        │ "<tool_result id="...">...</tool_result>"
        ▼
ConversationManager.addUserMessage(toolResult)
        │
        ▼
Next AgentLoop iteration
```

---

## Extension Lifecycle

```
VS Code activates extension
        │
        ▼
activate()
  ├── create OutputChannel "Gemma Code"
  ├── register unhandledRejection handler
  ├── BackendManager.start() [async, non-blocking]
  ├── register gemma-code.ping command
  ├── instantiate GemmaCodePanel
  ├── registerWebviewViewProvider
  ├── start Ollama availability poller
  └── initial Ollama health check [async]

User opens sidebar
        │
        ▼
GemmaCodePanel.resolveWebviewView()
  ├── configure webview options and CSP
  └── inject HTML + nonce

Webview sends "ready"
        │
        ▼
GemmaCodePanel._handleMessage({ type: "ready" })
  ├── _postHistory()
  ├── post planModeToggled
  ├── post editModeChanged
  └── _postTokenCount()

VS Code deactivates extension
        │
        ▼
deactivate()
  ├── clearInterval(ollamaPoller)
  └── BackendManager.stop()
```
