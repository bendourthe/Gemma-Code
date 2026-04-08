# Gemma Code v0.2.0 — Implementation Plan

> **Goal**: Transform Gemma Code from a basic chat+tools assistant into a local equivalent of Claude Code with dynamic context engineering, persistent cross-session memory, sub-agent orchestration, smart multi-strategy context management, native Gemma 4 tool calling, and MCP interoperability -- all running offline on a single GPU via Ollama.

---

## Context

### Why v0.2.0?

Gemma Code v0.1.0 shipped with a working agentic loop (10 tools, 20-iteration cap), streaming chat UI, SQLite persistence, and a Python FastAPI backend. However, it was built around Gemma 3 assumptions (8K context, no native tool calling, no system role). Three comparison reports identified the critical gaps preventing it from matching Claude Code's sophistication:

1. **"How Claude Code Builds a System Prompt"** revealed that Claude Code dynamically assembles 30+ prompt sections, selectively clears old tool results, uses conditional tool activation, injects skills per-turn, and runs verification sub-agents. Gemma Code has a static 900-token `SYSTEM_PROMPT` constant, no conditional assembly, and no verification.

2. **MemPalace** revealed that Gemma Code lacks cross-session memory entirely. No vector search, no knowledge graph, no pre-compaction save hooks. Each session is an independent silo with no retrieval over past work.

3. **Graphify** revealed the value of AST-aware code understanding (tree-sitter), MCP server/client support for interoperability, content-based caching, and structured code intelligence pipelines.

### Gemma 4: A Game-Changer for the Architecture

Google DeepMind released Gemma 4 on April 2, 2026. This fundamentally changes Gemma Code's architecture assumptions:

| Capability | Gemma 3 (v0.1.0 assumption) | Gemma 4 (v0.2.0 reality) |
|------------|------|------|
| Context window | 8,192 tokens | 128K (E2B/E4B), 256K (26B/31B) |
| System role | Not supported (prepend to first user turn) | Native `<\|turn>system` token |
| Tool calling | No native support (custom XML protocol) | Native `<\|tool_call>` / `<\|tool_result>` tokens |
| Thinking mode | Not available | Native `<\|think\|>` token for chain-of-thought |
| Agentic benchmarks | Not designed for agentic use | Tau2-bench: 76.9% (31B), 68.2% (26B MoE) |
| Multi-step planning | Prompt-engineered | Trained reasoning loop with sub-task decomposition |

**Model variants available locally via Ollama:**

| Variant | Effective Params | Download | VRAM Min | Context | Modalities |
|---------|-----------------|----------|----------|---------|------------|
| E2B | 2.3B | 5.1 GB | 4 GB | 128K | Text, Image, Audio |
| E4B (default) | 4.5B | 8 GB | 6 GB | 128K | Text, Image, Audio |
| 26B MoE | 3.8B active / 25.2B total | 18 GB | 8 GB | 256K | Text, Image |
| 31B Dense | 30.7B | 20 GB | 20 GB | 256K | Text, Image |

The 128K-256K context window eliminates the extreme token budgeting constraints that dominated the v0.1.0 design. Memory injection, skill injection, and sub-agent context can now be generous. The native tool calling tokens mean Gemma Code should migrate from its custom XML `<tool_call>` protocol to Gemma 4's native `<|tool_call>` format for reliability and performance.

**Recommended Gemma 4 sampling configuration:** Temperature 1.0, Top-p 0.95, Top-k 64.

### Sources

- [Gemma 4 Official Blog](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/)
- [Gemma 4 Model Card](https://ai.google.dev/gemma/docs/core/model_card_4)
- [Gemma 4 Function Calling Documentation](https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4)
- [Gemma 4 Prompt Formatting](https://ai.google.dev/gemma/docs/core/prompt-formatting-gemma4)
- [Gemma 4 on Ollama](https://ollama.com/library/gemma4)
- [Gemma 4 DeepMind Page](https://deepmind.google/models/gemma/gemma-4/)
- [Gemma 4 Agentic Skills Blog](https://developers.googleblog.com/bring-state-of-the-art-agentic-skills-to-the-edge-with-gemma-4/)
- [Build AI Agent with Gemma 4: Function Calling & MCP Guide](https://lushbinary.com/blog/build-ai-agent-gemma-4-function-calling-mcp-tool-use/)

---

## Phase 0 — Migrate to Gemma 4 Native Protocol

**What**: Migrate from the custom XML tool protocol and Gemma 3 chat template to Gemma 4's native special tokens for tool calling, system role, and thinking mode. Update context window defaults. This unlocks all subsequent phases.

**Source insights**: Gemma 4 model card (native tool calling, system role, thinking mode), Ollama Gemma 4 documentation (day-0 tool calling support via `/api/chat`).

### Gemma 4 Tool Calling Protocol

Gemma 4 uses three dedicated token pairs trained into the model:

```
Tool declaration (in system prompt):
<|tool>
{
  "name": "read_file",
  "description": "Read file content (500 lines max)",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {"type": "string", "description": "Relative file path"}
    },
    "required": ["path"]
  }
}
<tool|>

Model requests tool use:
<|tool_call>call:read_file{path:<|"|>src/extension.ts<|"|>}<tool_call|>

Application returns result:
<|tool_result>
{"name": "read_file", "response": {"content": "// file contents..."}}
<tool_result|>
```

The `<|"|>` string delimiter token wraps all string values to prevent parsing ambiguity.

### Gemma 4 Chat Template

```
<|turn>system
You are Gemma Code, a local agentic coding assistant...
<turn|>
<|turn>user
Help me refactor the auth module.
<turn|>
<|turn>model
I'll analyze the auth module structure first.
<|tool_call>call:read_file{path:<|"|>src/auth/index.ts<|"|>}<tool_call|>
<turn|>
```

### Thinking Mode

Adding `<|think|>` to the system prompt activates chain-of-thought reasoning. The model uses `<|channel>thought` / `<channel|>` tokens for internal reasoning blocks.

### Files to modify

| File | Change |
|------|--------|
| [ConversationManager.ts](src/chat/ConversationManager.ts) | Update `SYSTEM_PROMPT` to use Gemma 4 format. Remove the system-message-prepend workaround. Messages now use `system` role natively. |
| [ToolCallParser.ts](src/tools/ToolCallParser.ts) | Replace XML regex (`/<tool_call>([\s\S]*?)<\/tool_call>/g`) with Gemma 4 native token parsing: detect `<\|tool_call>call:TOOL_NAME{...}<tool_call\|>` pattern. Parse the Gemma 4 key-value format (with `<\|"\|>` string delimiters) into structured `ToolCall` objects. |
| [AgentLoop.ts](src/tools/AgentLoop.ts) | Update tool result injection format from XML `<tool_result>` to Gemma 4 native `<\|tool_result>...<tool_result\|>` with JSON `{"name": ..., "response": ...}` structure. |
| [settings.ts](src/config/settings.ts) | Change `maxTokens` default from 8192 to 131072 (128K). Change default model from `gemma3:27b` to `gemma4:e4b`. Add `thinkingMode: boolean` (default: true). Update `temperature` default from 0.2 to 1.0. Add `topP: number` (default: 0.95), `topK: number` (default: 64). |
| [prompt.py](src/backend/src/backend/services/prompt.py) | Remove the Gemma 3 workaround that prepends system messages to the first user turn. Use native system role. Update `assemble_prompt()` to emit Gemma 4 turn tokens. Update `trim_history()` token budget from 8192 to model-appropriate context window. |
| [config.py](src/backend/src/backend/config.py) | Update `model_name` default to `gemma4:e4b`. Update `request_timeout` for larger context. |
| [client.ts](src/ollama/client.ts) | Update `streamChat()` to pass `tools` parameter in the Ollama API request body (Ollama day-0 Gemma 4 tool calling support). |
| [types.ts](src/ollama/types.ts) | Add `tools` field to `ChatRequest` type. Add `ToolDefinition` type matching Ollama's tool schema format. |
| [GemmaCodePanel.ts](src/panels/GemmaCodePanel.ts) | Pass tool definitions to the Ollama API call alongside messages. |

### New files

| File | Purpose |
|------|---------|
| `src/tools/Gemma4ToolFormat.ts` | Gemma 4 tool definition serializer: converts internal `ToolMetadata` to the JSON schema format wrapped in `<\|tool>...<tool\|>` tokens. Gemma 4 tool call parser: extracts tool name and arguments from `<\|tool_call>call:NAME{...}<tool_call\|>` output. Tool result formatter: wraps execution results in `<\|tool_result>...<tool_result\|>` tokens. |

### Verification

- Unit: `Gemma4ToolFormat.parseToolCall()` correctly extracts tool name and arguments from native format
- Unit: `Gemma4ToolFormat.formatToolResult()` produces valid `<|tool_result>` blocks
- Unit: `Gemma4ToolFormat.serializeToolDefinitions()` produces valid `<|tool>` blocks
- Integration: Full tool-use loop works with Ollama Gemma 4 (read_file, edit_file round-trip)
- Regression: Existing tool handlers produce correct results regardless of protocol format

### Dependencies

None. Foundation phase that unblocks everything else.

---

## Phase 1 — Dynamic PromptBuilder with Token Budgeting

**What**: Replace the static `SYSTEM_PROMPT` constant with a `PromptBuilder` class that assembles prompt sections conditionally, respects a token budget, and reconfigures at runtime. This is the foundation for memory injection, skill injection, sub-agent prompts, and conditional tool activation.

**Source insights**: Claude Code comparison #1 (dynamic assembly), #2 (always vs. conditional sections), #4 (variation patterns), #11 (conditional tool activation), #12 (skill injection).

### Token budget context

With Gemma 4's 128K-256K context windows, the budget is generous but still finite. A well-structured budget prevents prompt bloat and preserves conversation capacity for long agentic sessions.

### Files to modify

| File | Change |
|------|--------|
| [ConversationManager.ts](src/chat/ConversationManager.ts) | Remove `SYSTEM_PROMPT` constant (lines 6-40). Accept `PromptBuilder` in constructor. Replace `_append("system", SYSTEM_PROMPT)` with `_append("system", this._promptBuilder.build(context))`. Add `rebuildSystemPrompt()` for mid-session reconfiguration (e.g., when a skill activates or tools change). |
| [GemmaCodePanel.ts](src/panels/GemmaCodePanel.ts) | Construct `PromptBuilder`, build `PromptContext` from runtime state (settings, active skill, plan mode, tool registry, session metadata), pass to `ConversationManager`. |
| [settings.ts](src/config/settings.ts) | Add `promptStyle: "concise" | "detailed" | "beginner"` (default: `"concise"`), `systemPromptBudgetPercent: number` (default: 10). |

### New files

| File | Purpose |
|------|---------|
| `src/chat/PromptBuilder.ts` | Core builder class. `build(context: PromptContext): string` assembles sections by priority within token budget. Sections: `buildBaseInstructions()` (always, ~200 tokens), `buildToolDeclarations(enabledTools)` (always, uses Gemma 4 `<\|tool>` format), `buildPlanModeSection()` (conditional), `buildThinkingModeSection()` (conditional), `buildSkillSection(prompt)` (conditional, token-capped), `buildMemorySection(memories)` (Phase 3), `buildSubAgentSection()` (Phase 5). Uses greedy packing by priority. |
| `src/chat/PromptBuilder.types.ts` | `PromptContext` (modelName, maxTokens, planModeActive, thinkingMode, activeSkill, enabledTools, isSubAgent, outputStyle, workspacePath, memoryContext), `PromptSection` (id, content, priority, alwaysInclude, estimatedTokens), `PromptStyle`. |
| `src/config/PromptBudget.ts` | Centralized budget calculator. Given `maxTokens`, returns: `systemPromptBudget` (10% = ~13K for 128K context), `memoryBudget` (3% = ~3.8K), `skillBudget` (2% = ~2.5K), `conversationBudget` (65% = ~83K), `responseReserve` (20% = ~25.6K). Auto-adjusts ratios based on model variant. |

### Token budget allocation (128K context, E4B default)

| Component | % | Tokens |
|-----------|---|--------|
| System prompt (base instructions + tool declarations) | 10% | ~12,800 |
| Memory injection | 3% | ~3,840 |
| Skill injection (when active) | 2% | ~2,560 |
| Conversation history | 65% | ~83,200 |
| Response reserve | 20% | ~25,600 |

For 256K context (26B/31B): same ratios scale proportionally, giving ~166K tokens for conversation history.

### Verification

- Unit: `PromptBuilder.build()` produces output under budget for all model variants
- Unit: Plan mode active includes plan section; inactive omits it
- Unit: Over-budget scenario drops lowest-priority sections first
- Unit: Tool declarations use Gemma 4 `<|tool>` format
- Regression: `build({})` with default context covers all current SYSTEM_PROMPT functionality
- Integration: Full chat flow works after refactor

### Dependencies

Phase 0 (Gemma 4 protocol migration). The tool declaration format in PromptBuilder uses Gemma 4 native tokens.

---

## Phase 2 — Multi-Strategy Context Compaction

**What**: Replace the single LLM-summary compaction with a strategy pipeline applying 5 methods in cost order (cheapest first). Add pre-compaction save hooks to preserve context before lossy operations.

**Source insights**: Claude Code comparison #7 (selective tool-result clearing), #10 (~12 compaction methods). MemPalace comparison #4 (pre-compaction hooks), #6 (auto-save).

### Context

Even with 128K-256K tokens, long agentic sessions with many tool calls will eventually exhaust the context. The v0.1.0 approach (single LLM summary at 80%) is too coarse. A multi-strategy pipeline applies cheap transformations first, deferring expensive LLM calls.

### Files to modify

| File | Change |
|------|--------|
| [ContextCompactor.ts](src/chat/ContextCompactor.ts) | Replace monolithic `compact()` with `CompactionPipeline` running strategies sequentially until context fits. Keep `estimateTokens()` and `shouldCompact()`. Add `compactWithStrategies()`. |
| [ConversationManager.ts](src/chat/ConversationManager.ts) | Add `replaceMessages(messages: Message[])` so strategies can operate on the message list directly. |
| [AgentLoop.ts](src/tools/AgentLoop.ts) | Call pre-compaction save hook before compaction triggers (wires to MemoryStore in Phase 3). |
| [settings.ts](src/config/settings.ts) | Add `compactionKeepRecent: number` (default: 10), `compactionToolResultsKeep: number` (default: 8). |

### New files

| File | Purpose |
|------|---------|
| `src/chat/CompactionStrategy.ts` | `CompactionStrategy` interface + 5 implementations. |

### Strategy pipeline (applied in order)

| # | Strategy | Cost | Description | Expected savings |
|---|----------|------|-------------|-----------------|
| 1 | **ToolResultClearing** | Zero (regex) | Strip `<\|tool_result>` blocks from older messages, keep N most recent. Replace with one-line summary: `[Tool result cleared: read_file("src/foo.ts") succeeded]`. | 30-60% of tool-heavy conversations |
| 2 | **SlidingWindow** | Zero | Drop messages from the middle, keep: first user message (intent), any `[Conversation summary]` messages, last N messages (default 10). | Variable |
| 3 | **CodeBlockTruncation** | Zero | Replace code blocks >80 lines with `[Code block: 150 lines, typescript, src/foo.ts]`. The code was already written to disk. | 10-30% of code-heavy conversations |
| 4 | **LlmSummary** | 1 LLM call | Improved version of current compact logic: structured summary prompt preserving file paths, decisions, errors, and tool call history. Uses thinking mode for better summaries. | High, but expensive |
| 5 | **EmergencyTrim** | Zero | Existing `trimToContextLimit()` as last resort. | Guaranteed to fit |

```typescript
interface CompactionStrategy {
  name: string;
  canApply(messages: readonly Message[], budgetTokens: number): boolean;
  apply(messages: readonly Message[], budgetTokens: number): Message[] | Promise<Message[]>;
}
```

### Verification

- Unit: Tool-result clearing strips old `<|tool_result>` blocks, preserves N most recent
- Unit: Sliding window preserves first message, summaries, and last N
- Unit: Code block truncation replaces large blocks with placeholders
- Unit: Pipeline applies strategies in order, stops when under budget
- Benchmark: Token reduction per strategy on synthetic conversations

### Dependencies

Phase 0 (tool result format uses Gemma 4 tokens). Phase 1 (system prompt budget feeds compaction budget). Can start in parallel with Phase 1 since CompactionStrategy is independent.

---

## Phase 3 — Persistent Memory System

**What**: Add cross-session memory using SQLite FTS5 (keyword search, zero new dependencies) and Ollama-generated embeddings in SQLite BLOB columns (semantic search, optional). Inject retrieved memories into the system prompt via PromptBuilder.

**Source insights**: MemPalace comparison #1 (persistent memory), #2 (vector search), #3 (knowledge graph), #4 (pre-compaction hooks), #5 (multi-layer retrieval), #6 (auto-save).

### Design decisions

- **No ChromaDB dependency**. Too heavy (~200MB onnxruntime). Use SQLite FTS5 (zero new dependencies, bundled with better-sqlite3) for keyword search + SQLite BLOB columns for vector embeddings.
- **Ollama embeddings**: `POST /api/embeddings` with `nomic-embed-text` (274MB, runs locally). Purely optional; falls back to FTS5-only if embedding model unavailable.
- **Token-budgeted injection**: Retrieved memories ranked by relevance, packed into `PromptBuilder.buildMemorySection()` up to budget (~3,840 tokens at 128K context). This is generous enough to inject 15-20 substantial memory entries.
- **Auto-extraction**: Before compaction, extract key decisions/facts from about-to-be-lost messages via a lightweight LLM prompt. Uses thinking mode for better extraction quality.

### Files to modify

| File | Change |
|------|--------|
| [ChatHistoryStore.ts](src/storage/ChatHistoryStore.ts) | Add FTS5 virtual table on `messages` table. Add sync triggers. Add `searchFts(query, limit)` method. |
| [PromptBuilder.ts](src/chat/PromptBuilder.ts) | Add `buildMemorySection(memories: MemoryEntry[]): PromptSection`. |
| [GemmaCodePanel.ts](src/panels/GemmaCodePanel.ts) | Before each `pipeline.send()`, query MemoryStore for relevant memories using the user's message as query, add to PromptContext. |
| [ContextCompactor.ts](src/chat/ContextCompactor.ts) | Add pre-compaction hook: call `MemoryStore.extractAndSave()` on messages about to be dropped. |
| [settings.ts](src/config/settings.ts) | Add `memoryEnabled: boolean` (default: true), `embeddingModel: string` (default: `"nomic-embed-text"`), `memoryTokenBudget: number` (auto-calculated from PromptBudget), `memoryAutoSaveInterval: number` (default: 15 messages), `memoryMaxEntries: number` (default: 10000). |
| [CommandRouter.ts](src/commands/CommandRouter.ts) | Register `/memory` command with subcommands. |

### New files

| File | Purpose |
|------|---------|
| `src/storage/MemoryStore.ts` | Core memory system. SQLite schema (see below). Methods: `save()`, `searchKeyword()`, `searchSemantic()`, `retrieve(query, tokenBudget)`, `extractAndSave(messages)`, `prune(maxEntries)`. |
| `src/storage/EmbeddingClient.ts` | Wraps Ollama `/api/embeddings`. `embed(text): Promise<number[] | null>` (null if model unavailable). `embedBatch(texts)`. Graceful degradation to keyword-only search. |
| `src/storage/MemoryStore.types.ts` | `MemoryEntry`, `MemoryType`, `MemorySearchResult` types. |

### SQLite schema

```sql
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  content TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('decision', 'fact', 'preference', 'file_pattern', 'error_resolution')),
  embedding BLOB,  -- float32 array, nullable (null if no embedding model)
  created_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL,
  access_count INTEGER DEFAULT 0,
  relevance_decay REAL DEFAULT 1.0
);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content, content=memories, content_rowid=rowid
);

-- Sync triggers to keep FTS5 in sync
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;
```

### Memory types

| Type | Description | Example |
|------|-------------|---------|
| `decision` | Architectural or design decision | "Chose SQLite FTS5 over ChromaDB for zero-dependency search" |
| `fact` | Project fact or convention | "The backend runs on port 11435" |
| `preference` | User preference or workflow pattern | "User prefers edit mode 'ask' for TypeScript files" |
| `file_pattern` | File structure or naming convention | "Test files mirror src/ structure in tests/unit/" |
| `error_resolution` | How a specific error was resolved | "ECONNREFUSED on :11434 means Ollama is not running; start with `ollama serve`" |

### Retrieval pipeline

1. **Keyword search** (FTS5): fast, zero LLM cost, good for exact terms
2. **Semantic search** (embedding cosine similarity): catches semantically related memories
3. **Merge and rank**: combine results, deduplicate, sort by combined relevance score
4. **Token-budget pack**: greedily pack highest-relevance memories until budget exhausted

### New slash commands

- `/memory search <query>` -- Search memories manually
- `/memory save <text>` -- Manually save a memory
- `/memory clear` -- Clear all memories (with confirmation)
- `/memory status` -- Show count, DB size, embedding model status

### Verification

- Unit: MemoryStore CRUD operations
- Unit: FTS5 search returns relevant results for keyword queries
- Unit: Token-budgeted retrieval respects budget
- Unit: `extractAndSave()` with mock LLM produces structured entries
- Integration: Memories from session A retrievable in session B
- Integration: Pre-compaction save preserves context before compaction loss

### Dependencies

Phase 1 (PromptBuilder for memory injection into system prompt). Phase 2 (pre-compaction hooks). MemoryStore itself is independent and can start early.

---

## Phase 4 — Conditional Tool Activation and MCP Support

**What**: Make tool availability context-dependent (fewer tools listed = cleaner prompt) and add Model Context Protocol (MCP) support for interoperability with the broader AI tooling ecosystem.

**Source insights**: Claude Code comparison #9 (conditional tools), #11 (conditional activation). MemPalace comparison #7 (MCP server). Graphify comparison #3 (MCP server). Gemma 4 recommendation: keep tool definitions under 10-15 for reliability.

### Files to modify

| File | Change |
|------|--------|
| [ToolRegistry.ts](src/tools/ToolRegistry.ts) | Add `_enabled: Map<ToolName, boolean>`, `setEnabled()`, `getEnabledTools()`, `isEnabled()`. `execute()` checks `isEnabled()` and returns error for disabled tools. Add `ToolMetadata` static property to each handler class. |
| [types.ts](src/tools/types.ts) | Add `ToolMetadata` interface (name, description, parameters JSON schema, category, requiresConfirmation). Extend `ToolName` to accept dynamic MCP tool names via union with string. |
| [PromptBuilder.ts](src/chat/PromptBuilder.ts) | `buildToolDeclarations()` only emits `<\|tool>` blocks for enabled tools. Appends MCP tool definitions within budget. |
| [ToolCallParser.ts](src/tools/ToolCallParser.ts) (or `Gemma4ToolFormat.ts`) | Accept dynamic tool names for MCP tools not in the static `TOOL_NAMES` set. |
| [GemmaCodePanel.ts](src/panels/GemmaCodePanel.ts) | Disable tools based on context (see rules below). |
| [settings.ts](src/config/settings.ts) | Add `mcpEnabled: boolean` (default: false), `mcpServerMode: "stdio" | "off"` (default: `"off"`). |
| [CommandRouter.ts](src/commands/CommandRouter.ts) | Register `/mcp` command with subcommands. |

### New files

| File | Purpose |
|------|---------|
| `src/mcp/McpServer.ts` | Exposes Gemma Code tools via MCP stdio protocol using `@modelcontextprotocol/sdk`. Maps registered tools to MCP definitions. Respects ConfirmationGate settings. |
| `src/mcp/McpClient.ts` | Connects to external MCP servers. Discovers tools, registers in ToolRegistry with `mcp` category, delegates execution via JSON-RPC. |
| `src/mcp/McpManager.ts` | Lifecycle management for MCP connections. Reads config from `~/.gemma-code/mcp.json` or `.gemma-code/mcp.json` in workspace. |
| `src/mcp/McpTypes.ts` | Type definitions for MCP protocol messages and tool definitions. |

### Context-dependent tool rules

| Condition | Tools disabled | Reason |
|-----------|---------------|--------|
| Ollama unreachable | All tools | Cannot process results without model |
| Network unavailable | `web_search`, `fetch_page` | No network access |
| Read-only session | `write_file`, `edit_file`, `create_file`, `delete_file`, `run_terminal` | Safety |
| Sub-agent: research | `write_file`, `edit_file`, `create_file`, `delete_file` | Read-only agent |
| Sub-agent: verification | `write_file`, `create_file`, `delete_file` | Can read + suggest fixes |
| >15 total tools (with MCP) | Lowest-priority MCP tools | Gemma 4 reliability drops beyond ~15 tools |

### MCP configuration (`~/.gemma-code/mcp.json`)

```json
{
  "servers": [
    { "name": "mempalace", "command": "mempalace", "args": ["serve"], "transport": "stdio" }
  ]
}
```

### New dependency

- `@modelcontextprotocol/sdk` (official TypeScript MCP SDK, Apache-2.0, works offline)

### New slash commands

- `/mcp status` -- Show connected servers and available tools
- `/mcp connect <name>` -- Connect to a configured server
- `/mcp disconnect <name>` -- Disconnect

### Verification

- Unit: `setEnabled()`/`getEnabledTools()` work correctly
- Unit: `buildToolDeclarations()` only emits `<|tool>` blocks for enabled tools
- Unit: MCP server correctly maps tool definitions
- Integration: MCP client connects to external server and lists tools
- Integration: Disabled tool returns error when invoked

### Dependencies

Phase 0 (Gemma 4 tool format). Phase 1 (PromptBuilder for conditional catalog).

---

## Phase 5 — Sub-Agent Orchestration

**What**: Enable the main AgentLoop to spawn sub-agents for focused tasks (verification, research, planning). Sub-agents run on the same Ollama instance sequentially with stripped-down prompts and limited tools.

**Source insights**: Claude Code comparison #5 (verification agent), #13 (sub-agent mode awareness). Gemma 4 model card (native multi-step planning, sub-task decomposition, Tau2-bench 76.9%).

### Single-GPU sequential design

Ollama serves one request at a time on a single GPU. Sub-agents run **sequentially**: the main agent pauses, the sub-agent runs to completion, the main agent resumes with the sub-agent's output injected. This is architecturally clean and avoids GPU contention.

Gemma 4's native multi-step planning capability (trained reasoning loop with sub-task decomposition) makes sub-agents significantly more capable than they would be with Gemma 3. The model can decompose complex tasks, execute steps, and handle errors with retry logic natively.

### Sub-agent types

| Type | Trigger | Tools | Max iterations | System prompt budget | Purpose |
|------|---------|-------|----------------|---------------------|---------|
| **Verification** | Auto after 3+ file edits (configurable) | `read_file`, `grep_codebase`, `list_directory`, `run_terminal` (test commands only) | 10 | ~2K tokens | Review changes for bugs, run relevant tests, report issues |
| **Research** | `/research <query>` or auto on knowledge gap | `read_file`, `grep_codebase`, `list_directory`, `web_search`, `fetch_page` | 10 | ~2K tokens | Gather information, read code, search docs |
| **Planning** | Enhanced plan mode | `read_file`, `grep_codebase`, `list_directory` | 8 | ~1.5K tokens | Decompose complex tasks into implementation steps |

### Files to modify

| File | Change |
|------|--------|
| [AgentLoop.ts](src/tools/AgentLoop.ts) | Add `_fileEditCount` tracker. After threshold, call `SubAgentManager.runVerification()`. Add `spawnSubAgent(config)` that creates isolated ConversationManager + AgentLoop, runs to completion, returns result. |
| [PromptBuilder.ts](src/chat/PromptBuilder.ts) | Add `buildForSubAgent(type, context): string`. Sub-agent prompts are minimal (~200 tokens base): identity + task instructions + changed file list. Omit style, memory, skill sections. Enable thinking mode for verification and planning agents. |
| [GemmaCodePanel.ts](src/panels/GemmaCodePanel.ts) | Wire sub-agent status to webview (spinner with agent type label). |
| [messages.ts](src/panels/messages.ts) | Add `SubAgentStatusMessage` type. |
| [settings.ts](src/config/settings.ts) | Add `verificationThreshold: number` (default: 3), `verificationEnabled: boolean` (default: true), `subAgentMaxIterations: number` (default: 10). |
| [CommandRouter.ts](src/commands/CommandRouter.ts) | Register `/verify` and `/research` commands. |

### New files

| File | Purpose |
|------|---------|
| `src/agents/SubAgentManager.ts` | Creates isolated ConversationManager + AgentLoop per sub-agent. `run(config): Promise<SubAgentResult>`. Manages lifecycle, uses PromptBuilder.buildForSubAgent() for minimal prompts, limits tools via conditional activation (Phase 4), injects result into main conversation. |
| `src/agents/SubAgentPrompts.ts` | Prompt templates per type. Verification: "Review code changes for correctness. Changed files: [list]. Run tests if applicable. Report bugs or issues concisely." Research: "Gather information to answer: [query]. Use read/search tools. Summarize findings." Planning: "Decompose this task: [description]. Analyze codebase, produce numbered implementation steps." |
| `src/agents/types.ts` | `SubAgentConfig` (type, prompt, enabledTools, maxIterations, contextBudget, inputMessages), `SubAgentResult` (output, toolCallCount, tokensUsed), `SubAgentType`. |

### Sub-agent context sharing

Sub-agents receive a context summary from the main conversation:
1. The user's current request
2. A list of files modified in the current session
3. Recent tool results (last 5)
4. Relevant memories from MemoryStore (Phase 3)

This context is assembled by `SubAgentManager` and injected as the first user message in the sub-agent's conversation.

### New slash commands

- `/verify` -- Manually trigger verification of recent changes
- `/research <query>` -- Spawn a research sub-agent

### Verification

- Unit: SubAgentManager creates isolated ConversationManager and AgentLoop
- Unit: Verification triggers after configured file edit count
- Unit: Sub-agent has access only to its allowed tools (Phase 4 conditional activation)
- Unit: Sub-agent output injected correctly into main conversation
- Integration: Full verification flow after 3 file edits with Gemma 4
- Performance: Measure sub-agent overhead (expect 10-30s for verification, 15-45s for research)

### Dependencies

Phase 0 (Gemma 4 protocol). Phase 1 (PromptBuilder for sub-agent prompts). Phase 2 (context management). Phase 4 (conditional tools for sub-agent isolation).

---

## Phase 6 — Integration, Polish, and Backend Alignment

**What**: Align Python backend with all TypeScript-side changes, update webview UI for new features, add documentation, and perform end-to-end integration testing.

### Files to modify

| File | Change |
|------|--------|
| [prompt.py](src/backend/src/backend/services/prompt.py) | Apply multi-strategy compaction (tool-result clearing + sliding window) before formatting. Accept dynamic `system_prompt` parameter. Use Gemma 4 turn tokens in template formatting. |
| [config.py](src/backend/src/backend/config.py) | Add memory, compaction, and sub-agent configuration settings. |
| [webview/index.ts](src/panels/webview/index.ts) | Add: memory status indicator (header, next to token count), sub-agent progress spinner with type label, MCP connection status badge, memory search results panel, thinking mode indicator. |
| `package.json` | Add `@modelcontextprotocol/sdk` dependency. Add all new `contributes.configuration` properties. Bump version to 0.2.0. Update default model to `gemma4:e4b`. |
| `CHANGELOG.md` | Document all v0.2.0 features comprehensively. |

### New files

| File | Purpose |
|------|---------|
| `SECURITY.md` | Root-level vulnerability disclosure policy with 48h ack SLA, 7-day fix target for critical issues (adopted from Graphify comparison). |
| `ARCHITECTURE.md` | Root-level architecture overview (symlink or updated copy of `docs/v0.2.0/architecture.md`, adopted from Graphify comparison for GitHub visibility). |
| `docs/v0.2.0/architecture.md` | Updated architecture document reflecting all v0.2.0 changes. |

### End-to-end verification checklist

1. Send message, verify dynamic prompt includes Gemma 4 `<|tool>` declarations for enabled tools only
2. Trigger tool use (read_file), verify native `<|tool_call>` / `<|tool_result>` round-trip works
3. Run a long session until compaction triggers, verify strategies apply in order (tool clearing before LLM summary)
4. Verify memories are auto-saved during compaction
5. Start a new session, verify relevant memories from prior session appear in system prompt
6. Make 3+ file edits, verify verification sub-agent triggers and reports findings
7. Run `/research` command, verify research sub-agent spawns with read-only tools
8. Connect an external MCP server, verify its tools appear in the tool catalog
9. Toggle thinking mode, verify `<|think|>` behavior in model output
10. Run full test suite, verify all v0.1.0 tests pass (regression)
11. Performance benchmarks: time-to-first-token, compaction speed, memory retrieval latency

---

## Dependency Graph

```
Phase 0: Gemma 4 Native Protocol (FOUNDATION)
  |
  +-------> Phase 1: Dynamic PromptBuilder
  |             |
  |             +-------> Phase 2: Multi-Strategy Compaction (can overlap)
  |             |             |
  |             |             +-------> Phase 3: Persistent Memory
  |             |                           |
  |             +-------> Phase 4: Conditional Tools + MCP
  |                           |
  +---------------------------+-------> Phase 5: Sub-Agents (needs 0, 1, 2, 4)
                                            |
                                            +-------> Phase 6: Integration + Polish
```

Phases 2 and 4 can proceed in parallel after Phase 1. Phase 3 (MemoryStore internals) can start independently but needs Phase 1 for injection and Phase 2 for pre-compaction hooks. Phase 5 requires all prior phases.

---

## New Files Summary

| Phase | New files |
|-------|-----------|
| 0 | `src/tools/Gemma4ToolFormat.ts` |
| 1 | `src/chat/PromptBuilder.ts`, `src/chat/PromptBuilder.types.ts`, `src/config/PromptBudget.ts` |
| 2 | `src/chat/CompactionStrategy.ts` |
| 3 | `src/storage/MemoryStore.ts`, `src/storage/EmbeddingClient.ts`, `src/storage/MemoryStore.types.ts` |
| 4 | `src/mcp/McpServer.ts`, `src/mcp/McpClient.ts`, `src/mcp/McpManager.ts`, `src/mcp/McpTypes.ts` |
| 5 | `src/agents/SubAgentManager.ts`, `src/agents/SubAgentPrompts.ts`, `src/agents/types.ts` |
| 6 | `SECURITY.md`, `ARCHITECTURE.md`, `docs/v0.2.0/architecture.md` |
| **Total** | **17 new files** |

## Critical Files to Modify

These files are touched across multiple phases and represent the core refactoring surface:

| File | Phases | Risk |
|------|--------|------|
| [ConversationManager.ts](src/chat/ConversationManager.ts) | 0, 1, 2 | High: core state management |
| [ContextCompactor.ts](src/chat/ContextCompactor.ts) | 2, 3 | High: compaction correctness is critical |
| [AgentLoop.ts](src/tools/AgentLoop.ts) | 0, 2, 5 | High: tool execution loop + sub-agent spawning |
| [ToolCallParser.ts](src/tools/ToolCallParser.ts) | 0, 4 | High: protocol migration |
| [GemmaCodePanel.ts](src/panels/GemmaCodePanel.ts) | 0, 1, 3, 4, 5, 6 | Medium: orchestrator, many wiring changes |
| [settings.ts](src/config/settings.ts) | 0, 1, 2, 3, 4, 5 | Low: additive configuration |
| [prompt.py](src/backend/src/backend/services/prompt.py) | 0, 6 | Medium: Gemma 4 template + compaction |
| [CommandRouter.ts](src/commands/CommandRouter.ts) | 3, 4, 5 | Low: additive command registration |

## New Dependencies

| Package | Phase | Size | Offline? | Purpose |
|---------|-------|------|----------|---------|
| `@modelcontextprotocol/sdk` | 4 | ~50 KB | Yes | MCP protocol support |
| `nomic-embed-text` (Ollama model) | 3 | 274 MB | Yes (pulled once) | Local embeddings for semantic memory search (optional) |

No other new runtime dependencies. ChromaDB and tree-sitter are deliberately deferred to v0.3.0.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Gemma 4 native tool calling reliability varies across model sizes | High | Test on all 4 variants (E2B, E4B, 26B, 31B). Keep tool definitions under 15. Add fallback to XML protocol if native parsing fails. |
| E2B/E4B models may not follow complex agentic instructions | Medium | Sub-agent prompts are minimal (~200 tokens). Test empirically. Disable sub-agents for E2B by default (tau2-bench: 42.2%). |
| Ollama Gemma 4 tool calling streaming issues | Medium | The OpenAI-compatible endpoint has known streaming issues (GitHub issue #20995). Use native `/api/chat` endpoint. Add robust parsing with fallback. |
| Local embedding quality (nomic-embed-text) | Low | FTS5 keyword search is the primary mechanism. Embeddings are a secondary ranking signal. System works fully without embedding model. |
| Sub-agent serialization blocks UI | Medium | Show progress indicators. Keep sub-agents small (10 iterations). Allow user cancellation via `/cancel`. |
| MCP SDK protocol instability | Low | Pin to specific version. Wrap in try/catch. MCP is off by default. |
| SQLite FTS5 availability | Low | `better-sqlite3` bundles SQLite with FTS5 enabled. Verified on all platforms. |
| Context window misconfiguration | Medium | Auto-detect model variant from Ollama `/api/tags` response and set context window accordingly (128K for E2B/E4B, 256K for 26B/31B). |

## Migration from v0.1.0

All changes are backward-compatible. Users upgrading from v0.1.0 to v0.2.0 will:

- **Automatically get**: Gemma 4 native protocol, dynamic prompt assembly, improved compaction, thinking mode
- **Opt-in features**: Memory (default: enabled, but embeddings require `ollama pull nomic-embed-text`), MCP (default: disabled), manual verification (`/verify`)
- **Auto-triggered features**: Verification sub-agent after 3+ file edits (can disable via `gemma-code.verificationEnabled`)
- **No database migration**: New tables only; existing chat history schema unchanged
- **Model upgrade**: Default changes from `gemma3:27b` to `gemma4:e4b`; users must run `ollama pull gemma4`

## Deferred to v0.3.0

These items from the comparison reports are valuable but out of scope for v0.2.0:

| Item | Source | Reason for deferral |
|------|--------|-------------------|
| Tree-sitter AST parsing | Graphify comparison | Adds significant native dependency complexity. Evaluate after core agentic features stabilize. |
| Knowledge graph generation | Graphify comparison, MemPalace comparison | Major feature better suited as a plugin. Requires tree-sitter as prerequisite. |
| Multi-format export (Obsidian, GraphML) | Graphify comparison | Scope creep risk. Better as a skill/extension. |
| Entity detection/registry | MemPalace comparison | High complexity vs. value tradeoff. Memory system provides 80% of the benefit. |
| Chat format normalization (import from Claude/ChatGPT) | MemPalace comparison | Nice-to-have. Requires vector store (Phase 3) as prerequisite. |
| Cache boundary markers | Claude Code comparison | Ollama does not support prompt caching yet. |
| Retrieval quality benchmarks | MemPalace comparison | Requires stable memory system first. Add after Phase 3 stabilizes. |