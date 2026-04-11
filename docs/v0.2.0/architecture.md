# Architecture -- Gemma Code v0.2.0

## Overview

Gemma Code is a VS Code extension that provides a local, agentic coding assistant powered by Google's Gemma 4 via Ollama. All inference runs on the user's machine. No data is sent to external servers.

v0.2.0 adds six major subsystems to the v0.1.0 foundation: Gemma 4 native tool protocol, dynamic prompt assembly, multi-strategy context compaction, persistent cross-session memory, MCP interoperability, and sub-agent orchestration.

The system has three main runtime components:

1. **TypeScript extension** -- runs in the VS Code Extension Host process (Node.js)
2. **Python FastAPI backend** -- a child process spawned by the extension on activation (port 11435)
3. **Ollama server** -- a separately installed model runtime (port 11434)

---

## System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│  VS Code                                                                │
│                                                                         │
│  ┌──────────────────────────────────┐  postMessage  ┌────────────────┐ │
│  │  Extension Host (Node.js)        │ ◄────────────► │  Webview       │ │
│  │                                  │                │  (HTML/CSS/JS) │ │
│  │  extension.ts                    │                │                │ │
│  │  GemmaCodePanel                  │                │  Badges:       │ │
│  │  ConversationManager             │                │  PLAN, THINK,  │ │
│  │  StreamingPipeline               │                │  MEM, MCP      │ │
│  │  AgentLoop                       │                │                │ │
│  │  ToolRegistry                    │                │  Sub-agent     │ │
│  │  ToolActivationRules             │                │  spinner       │ │
│  │  Gemma4ToolFormat                │                └────────────────┘ │
│  │  PromptBuilder + PromptBudget    │                                   │
│  │  CompactionPipeline              │                                   │
│  │  MemoryStore (SQLite FTS5)       │    ┌──────────────────────┐      │
│  │  EmbeddingClient                 │    │  External MCP        │      │
│  │  SubAgentManager                 │◄──►│  Servers (optional)  │      │
│  │  McpManager                      │    └──────────────────────┘      │
│  │  ChatHistoryStore (SQLite)       │                                   │
│  │  BackendManager                  │                                   │
│  └──────────────┬───────────────────┘                                  │
│                 │ HTTP (SSE / REST)                                      │
└─────────────────┼──────────────────────────────────────────────────────┘
                  │
       ┌──────────┴──────────┐
       │                     │
       v                     v
┌──────────────┐    ┌─────────────────────────┐
│  Python      │    │  Ollama                  │
│  FastAPI     │───>│  (local model runtime)   │
│  Backend     │    │  gemma4:e4b              │
│  :11435      │    │  :11434                  │
└──────────────┘    └─────────────────────────┘
```

The extension prefers routing inference through the Python backend (for chat template formatting and compaction). If the backend is unavailable, it falls back to calling Ollama directly.

---

## Component Descriptions

### Core Components (v0.1.0, updated)

#### `src/extension.ts` -- Extension Entry Point

Activates on VS Code startup. Initializes all services:
- Creates `OllamaClient`, `ChatHistoryStore`, `MemoryStore`, `McpManager`
- Registers `GemmaCodePanel` as a webview view provider
- Starts the Python backend via `BackendManager`
- Sets up the Ollama health poller and `unhandledRejection` handler

Deactivation disposes all services: `McpManager`, `MemoryStore`, `BackendManager`.

#### `src/ollama/client.ts` -- Ollama HTTP Client

HTTP client for the Ollama REST API. Key methods:
- `streamChat()` -- streaming chat completion via `/api/chat` (SSE). Now passes `tools` parameter for native tool calling.
- `checkHealth()` -- health check via `/api/tags`
- `listModels()` -- model listing
- `embed()` -- embedding generation via `/api/embed` (used by `EmbeddingClient`)

#### `src/chat/ConversationManager.ts` -- Message History

Manages the ordered message list for a conversation session.
- Accepts a `systemPrompt: string` in the constructor (no longer uses a static constant)
- `rebuildSystemPrompt(prompt)` for mid-session system prompt updates
- `replaceMessages(messages)` for atomic message array replacement by the compaction pipeline
- `addUserMessage()`, `addAssistantMessage()`, `addToolMessage()`
- `onDidChange` event for UI updates

#### `src/chat/StreamingPipeline.ts` -- Token Relay

Relays streaming tokens from Ollama to the webview. Handles retry on stream failure within the first 3 tokens. Posts `token` messages during streaming and `messageComplete` with rendered HTML on completion.

#### `src/tools/AgentLoop.ts` -- Tool Execution Loop

Multi-turn tool execution loop. Parses model output for `<|tool_call>` tokens, dispatches to `ToolRegistry`, injects `<|tool_result>` messages, and re-prompts until the model produces a final response or `maxAgentIterations` is reached.

v0.2.0 additions:
- File edit counter tracking for auto-verification trigger
- Triggers `SubAgentManager.run("verification")` after `verificationThreshold` file edits
- Uses `Gemma4ToolFormat` for parsing and formatting (replaces XML)

#### `src/tools/ToolRegistry.ts` -- Tool Dispatch

Maps tool names to `ToolHandler` implementations. v0.2.0 additions:
- `setEnabled(name, enabled)` / `isEnabled(name)` for conditional activation
- `getEnabledNames()` / `getEnabledToolMetadata()` for prompt building
- Supports both `BuiltinToolName` and `McpToolName` (`mcp:${string}`) types

#### `src/panels/GemmaCodePanel.ts` -- Webview Orchestrator

Central orchestrator connecting all services to the webview UI. Handles:
- Bidirectional `postMessage` protocol with the webview
- Slash command routing via `CommandRouter`
- Memory retrieval before each prompt
- Sub-agent status updates to the webview
- v0.2.0 status indicators: `_postMemoryStatus()`, `_postMcpStatus()`, `_postThinkingModeStatus()`

#### `src/chat/ContextCompactor.ts` -- Compaction Orchestrator

Triggers compaction when estimated tokens exceed 80% of the context window. Runs the `CompactionPipeline` with a pre-compaction hook for memory extraction.

#### `src/storage/ChatHistoryStore.ts` -- Session Persistence

SQLite-backed session storage with WAL mode. FTS5 virtual table on messages for full-text search via `searchFts()`.

---

### v0.2.0 Components

#### `src/tools/Gemma4ToolFormat.ts` -- Gemma 4 Native Protocol

Handles Gemma 4's native tool calling format:
- `serializeToolDefinitions()` -- converts tool metadata to `<|tool>...<tool|>` blocks
- `parseToolCall()` -- extracts tool name and arguments from `<|tool_call>...<tool_call|>` blocks
- `formatToolResult()` -- wraps results in `<|tool_result>...<tool_result|>` blocks
- Handles `<|"|>` string delimiters and code fence exclusion

#### `src/chat/PromptBuilder.ts` -- Dynamic Prompt Assembly

Assembles the system prompt from sections by priority within a token budget:
- Always-include sections first (base instructions, tool declarations)
- Conditional sections by ascending priority (plan mode, thinking mode, skill injection, memory injection, sub-agent directives)
- Greedy packing: adds sections until the budget is exhausted
- `build(context: PromptContext): string` -- main entry point
- `buildForSubAgent(type, context): string` -- stripped-down prompt for sub-agents

Types defined in `src/chat/PromptBuilder.types.ts`: `PromptContext`, `PromptSection`, `PromptStyle`.

#### `src/config/PromptBudget.ts` -- Token Budget Calculator

Divides the context window into allocation buckets:

| Section | Budget % | Example (128K) |
|---------|----------|----------------|
| System prompt | 10% | 12.8K tokens |
| Memory injection | 3% | 3.9K tokens |
| Skill injection | 2% | 2.6K tokens |
| Conversation | 65% | 84.5K tokens |
| Response reserve | 20% | 26.2K tokens |

Scales proportionally for larger context windows (256K for 26B/31B models).

#### `src/chat/CompactionStrategy.ts` -- Multi-Strategy Compaction

Implements `CompactionPipeline` orchestrating 5 strategies in cost order:

| # | Strategy | Cost | Description |
|---|----------|------|-------------|
| 1 | ToolResultClearing | Zero | Replace old `<\|tool_result>` blocks with one-line summaries |
| 2 | SlidingWindow | Zero | Drop middle messages, preserve first + last N + summaries |
| 3 | CodeBlockTruncation | Zero | Replace code blocks >80 lines with placeholders |
| 4 | LlmSummary | 1 LLM call | Structured summary preserving file paths, decisions, errors |
| 5 | EmergencyTrim | Zero | Hard clip oldest messages as last resort |

Each strategy implements `canApply(messages, budget): boolean` and `apply(messages, budget): Promise<Message[]>`.

#### `src/storage/MemoryStore.ts` -- Persistent Memory

Cross-session memory system backed by SQLite FTS5:
- 5 memory types: `decision`, `fact`, `preference`, `file_pattern`, `error_resolution`
- Keyword search via FTS5 virtual table
- Optional semantic search via Ollama embeddings (`nomic-embed-text`)
- Retrieval pipeline: keyword(20) + semantic(20) -> merge/dedup -> combined score -> token-budget pack
- Auto-extraction during compaction via `extractAndSave()` pre-compaction hook
- Types in `src/storage/MemoryStore.types.ts`

#### `src/storage/EmbeddingClient.ts` -- Embedding Interface

Wraps Ollama `/api/embed` endpoint:
- Graceful degradation: returns `null` if the embedding model is unavailable
- Used by `MemoryStore` for semantic search ranking

#### `src/tools/ToolActivationRules.ts` -- Conditional Activation

Pure function `computeToolActivation()` that disables tools based on context:
- Ollama reachability (disable web tools if offline)
- Network availability
- Read-only session mode
- Sub-agent type (scoped tool access)
- 15-tool cap (drops lowest-priority tools when exceeded)

#### `src/mcp/` -- MCP Support

| File | Purpose |
|------|---------|
| `McpManager.ts` | Lifecycle management, config from `~/.gemma-code/mcp.json` |
| `McpClient.ts` | Connects to external MCP servers via stdio transport |
| `McpServer.ts` | Exposes built-in tools via MCP stdio protocol |
| `McpToolHandler.ts` | Wraps MCP tool calls as `ToolHandler` for the registry |
| `McpTypes.ts` | Shared type definitions |

MCP is disabled by default. When enabled, `McpManager` reads server configurations from `~/.gemma-code/mcp.json`, connects to configured servers, and registers discovered tools with the `ToolRegistry`.

Dependency: `@modelcontextprotocol/sdk` (loaded via dynamic import for ESM/CJS compatibility).

#### `src/agents/` -- Sub-Agent Orchestration

| File | Purpose |
|------|---------|
| `SubAgentManager.ts` | Creates isolated sub-agents with scoped tools |
| `SubAgentPrompts.ts` | Type-specific prompt templates and context builders |
| `types.ts` | `SubAgentType`, `SubAgentConfig`, `SubAgentResult` |

Three sub-agent types:

| Type | Trigger | Tools | Purpose |
|------|---------|-------|---------|
| verification | Auto (3+ file edits) or `/verify` | read_file, grep_codebase, list_directory, run_terminal | Review changes for bugs and run relevant tests |
| research | `/research <query>` | read_file, grep_codebase, list_directory, web_search, fetch_page | Gather information and synthesize findings |
| planning | Internal | read_file, grep_codebase, list_directory | Decompose tasks into implementation steps |

Each sub-agent gets a fresh `ToolRegistry`, isolated `ConversationManager`, and ephemeral `AgentLoop`. Conversations are discarded after the run. Results are injected into the main conversation as advisory messages.

---

## Data Flow -- Streaming Pipeline

```
User sends message
  -> CommandRouter (checks for slash commands)
  -> MemoryStore.retrieve(userMessage, memoryBudget)
  -> PromptBuilder.build(context with memories)
  -> ConversationManager.rebuildSystemPrompt(prompt)
  -> StreamingPipeline.send(userMessage)
    -> BackendManager (or direct OllamaClient)
    -> Ollama /api/chat (streaming)
    -> Token relay to webview
    -> AgentLoop (if <|tool_call> detected)
      -> ToolRegistry.execute(toolName, args)
      -> <|tool_result> injection
      -> Re-prompt Ollama
      -> (repeat until no tool calls or max iterations)
    -> MessageComplete to webview
  -> ContextCompactor.shouldCompact() check
  -> _postTokenCount() update
```

## Data Flow -- Compaction Pipeline

```
ContextCompactor.estimateTokens() > 80% of maxTokens
  -> Pre-compaction hook: MemoryStore.extractAndSave(messages)
  -> CompactionPipeline.run(messages, conversationBudget)
    -> Strategy 1: ToolResultClearing (regex replacement)
    -> Strategy 2: SlidingWindow (keep anchors + recent N)
    -> Strategy 3: CodeBlockTruncation (>80 line blocks)
    -> Strategy 4: LlmSummary (1 LLM call, if still over budget)
    -> Strategy 5: EmergencyTrim (hard clip)
  -> ConversationManager.replaceMessages(compacted)
  -> Webview: compactionStatus banner
```

## Data Flow -- Sub-Agent Execution

```
AgentLoop detects threshold (3+ file edits)
  -> SubAgentManager.run(verification, config)
    -> Fresh ToolRegistry with scoped tools (read_file, grep, list_dir, terminal)
    -> Fresh ConversationManager (ephemeral)
    -> PromptBuilder.buildForSubAgent("verification", context)
    -> Fresh AgentLoop.run()
    -> Extract final assistant message as output
    -> Post SubAgentStatus to webview (running -> complete/error)
  -> Result injected into main conversation
  -> Main AgentLoop resumes
```

## Data Flow -- Memory Retrieval

```
User sends message
  -> MemoryStore.retrieve(queryText, tokenBudget)
    -> FTS5 keyword search (top 20)
    -> Semantic search via EmbeddingClient (top 20, if embeddings available)
    -> Merge results, deduplicate by ID
    -> Combined score ranking
    -> Greedy pack within token budget
  -> PromptBuilder.build(context with memoryContext)
    -> Memory section injected into system prompt
```

---

## Extension Lifecycle

### Activation (`activate()`)

1. Create `OllamaClient` with configured URL
2. Open `ChatHistoryStore` (SQLite)
3. Initialize `MemoryStore` (SQLite FTS5) if `memoryEnabled`
4. Initialize `McpManager` if `mcpEnabled`
5. Create `PromptBuilder`, `ConversationManager`, `ContextCompactor`
6. Create `SubAgentManager` with references to shared services
7. Register `GemmaCodePanel` as webview view provider
8. Start Python backend via `BackendManager`
9. Start Ollama health poller

### Deactivation (`deactivate()`)

1. Cancel active streams
2. Dispose `McpManager` (disconnects all MCP servers)
3. Close `MemoryStore` (SQLite)
4. Close `ChatHistoryStore` (SQLite)
5. Stop Python backend

---

## Webview Message Protocol

### Extension to Webview

| Message Type | Purpose |
|-------------|---------|
| `token` | Streaming token during inference |
| `messageComplete` | Final rendered HTML for a message |
| `history` | Full message history with rendered HTML map |
| `error` | Error banner text |
| `status` | Status dot state (idle/thinking/streaming) |
| `toolUse` / `toolResult` | Tool execution progress |
| `confirmationRequest` | File edit or terminal command approval |
| `commandList` | Slash command autocomplete list |
| `planReady` / `planModeToggled` | Plan mode state |
| `compactionStatus` | Compaction progress banner |
| `tokenCount` | Token usage indicator update |
| `sessionList` | Chat history session list |
| `editModeChanged` | Edit mode selector sync |
| `diffPreview` | Diff preview for ask/manual edit modes |
| `subAgentStatus` | Sub-agent progress (running/complete/error) |
| `memoryStatus` | Memory badge state (enabled, entry count) |
| `mcpStatus` | MCP badge state (enabled, server/tool counts) |
| `thinkingModeStatus` | Thinking mode badge state |

### Webview to Extension

| Message Type | Purpose |
|-------------|---------|
| `sendMessage` | User chat message |
| `clearChat` | Clear conversation |
| `cancelStream` | Cancel active inference |
| `ready` | Webview initialized |
| `confirmationResponse` | Approve/deny tool execution |
| `requestCommandList` | Trigger autocomplete |
| `approveStep` | Approve plan step |
| `loadSession` | Resume a past session |
| `setEditMode` | Change edit mode |

---

## Configuration Reference

All settings use the `gemma-code.` prefix in VS Code.

### Ollama and Model

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ollamaUrl` | string | `http://localhost:11434` | Ollama server URL |
| `modelName` | string | `gemma4:e4b` | Model for inference |
| `maxTokens` | number | `131072` | Maximum context window tokens |
| `temperature` | number | `1.0` | Sampling temperature |
| `topP` | number | `0.95` | Nucleus sampling threshold |
| `topK` | number | `64` | Top-K sampling |
| `requestTimeout` | number | `60000` | Request timeout in milliseconds |

### Inference and Prompting

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `thinkingMode` | boolean | `true` | Enable `<\|think\|>` chain-of-thought |
| `promptStyle` | string | `concise` | Prompt style: concise, detailed, beginner |
| `systemPromptBudgetPercent` | number | `10` | System prompt budget (5-30%) |

### Agent and Tool Control

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `toolConfirmationMode` | string | `ask` | Tool approval: always, ask, never |
| `editMode` | string | `auto` | File edit mode: auto, ask, manual |
| `maxAgentIterations` | number | `20` | Maximum tool-use iterations |
| `subAgentMaxIterations` | number | `10` | Maximum sub-agent iterations |

### Context Compaction

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `compactionKeepRecent` | number | `10` | Messages to keep in sliding window |
| `compactionToolResultsKeep` | number | `8` | Recent tool results to preserve |

### Backend

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `useBackend` | boolean | `true` | Route through Python backend |
| `backendPort` | number | `11435` | Backend HTTP port |
| `pythonPath` | string | `python` | Python executable path |

### Memory

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `memoryEnabled` | boolean | `true` | Enable persistent memory |
| `embeddingModel` | string | `nomic-embed-text` | Ollama embedding model |
| `memoryAutoSaveInterval` | number | `15` | Auto-save interval (minutes) |
| `memoryMaxEntries` | number | `10000` | Maximum stored memories |

### MCP

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `mcpEnabled` | boolean | `false` | Enable MCP client/server |
| `mcpServerMode` | string | `off` | MCP server mode: stdio, off |

### Verification

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `verificationEnabled` | boolean | `true` | Enable auto-verification |
| `verificationThreshold` | number | `3` | File edits before verification triggers |
