# Gemma Code — Progress Dashboard

**Branch:** `main`

---

## Scores (update after each sprint)

| Metric | Current | Target | Delta |
|--------|---------|--------|-------|
| Tasks done (v0.1.0) | 13 / 21 | 21 / 21 | -8 |
| Tasks done (v0.2.0) | 0 / 38 | 38 / 38 | -38 |

---

## Sprint 1 — Completed Work [DONE]

- [x] Bootstrap VS Code extension scaffold with TypeScript, tsconfig, ESLint, and Vitest (Phase 1)
- [x] Implement OllamaClient with streaming chat, health check, and model listing (Phase 1)
- [x] Build chat engine with ConversationManager and streaming webview UI (Phase 2)
- [x] Implement agentic tool layer with 10 tool handlers and confirmation gate (Phase 3)
- [x] Add skill loader, command router, and plan mode with slash command autocomplete (Phase 4)
- [x] Add persistent SQLite chat history, auto-compact, and edit modes (Phase 5)
- [x] Implement Python inference backend with FastAPI and Gemma chat template (Phase 6)
- [x] Build BackendManager with auto-start and graceful fallback to direct Ollama (Phase 6)
- [x] Build Windows NSIS installer with Ollama, VSIX, venv, and model download (Phase 7)
- [x] Set up CI/CD workflows: ci.yml, release.yml, nightly.yml (Phase 7)
- [x] Fix SSRF vulnerability in FetchPageTool and harden terminal blocklist (Phase 8)
- [x] Add performance benchmark suite and error handling hardening (Phase 8)
- [x] Write comprehensive README, CHANGELOG, and architecture documentation (Phase 8)

## Sprint 2 — Active (v0.1.x maintenance)

- [ ] Implement ripgrep-backed GrepCodebaseTool to replace slow workspace.findFiles approach (CHANGELOG Known Limitations)
- [ ] Build macOS and Linux installer packages (CHANGELOG Known Limitations)
- [ ] Publish extension to VS Code Marketplace (CHANGELOG Unreleased)
- [ ] Implement Rust performance components for file indexing and grep (CHANGELOG Unreleased)
- [ ] Implement Go CLI tooling for project scaffolding (CHANGELOG Unreleased)

## v0.2.0 — Planned (local Claude Code equivalent)

Full plan: `docs/v0.2.0/development/implementation-plan.md`

### Phase 0 — Gemma 4 Native Protocol Migration
- [ ] Create `src/tools/Gemma4ToolFormat.ts` (tool declaration serializer, tool call parser, result formatter)
- [ ] Migrate `ToolCallParser.ts` from XML `<tool_call>` regex to Gemma 4 native `<|tool_call>` tokens
- [ ] Update `AgentLoop.ts` tool result injection to use `<|tool_result>` format
- [ ] Update `ConversationManager.ts` system prompt for native system role
- [ ] Update `settings.ts` defaults: model `gemma4:e4b`, maxTokens 131072, temperature 1.0, topP 0.95, topK 64
- [ ] Update `prompt.py` to use native system role and Gemma 4 turn tokens
- [ ] Update `client.ts` to pass `tools` parameter in Ollama API requests
- [ ] Add thinking mode support (`<|think|>` token in system prompt)

### Phase 1 — Dynamic PromptBuilder with Token Budgeting
- [ ] Create `src/chat/PromptBuilder.ts` with section-based assembly and greedy packing
- [ ] Create `src/chat/PromptBuilder.types.ts` (PromptContext, PromptSection, PromptStyle)
- [ ] Create `src/config/PromptBudget.ts` (centralized budget calculator)
- [ ] Refactor `ConversationManager.ts` to use PromptBuilder instead of static SYSTEM_PROMPT
- [ ] Wire PromptBuilder into `GemmaCodePanel.ts`
- [ ] Add `promptStyle` and `systemPromptBudgetPercent` settings

### Phase 2 — Multi-Strategy Context Compaction
- [ ] Create `src/chat/CompactionStrategy.ts` with interface and 5 strategy implementations
- [ ] Implement ToolResultClearing strategy (regex-based, zero LLM cost)
- [ ] Implement SlidingWindow strategy (keep anchors + recent messages)
- [ ] Implement CodeBlockTruncation strategy (replace large code blocks with placeholders)
- [ ] Refactor `ContextCompactor.ts` to use CompactionPipeline
- [ ] Add pre-compaction save hook (wires to MemoryStore in Phase 3)

### Phase 3 — Persistent Memory System
- [ ] Create `src/storage/MemoryStore.ts` with SQLite FTS5 schema
- [ ] Create `src/storage/EmbeddingClient.ts` wrapping Ollama `/api/embeddings`
- [ ] Add FTS5 virtual table and sync triggers to `ChatHistoryStore.ts`
- [ ] Add `buildMemorySection()` to PromptBuilder
- [ ] Wire memory retrieval into chat flow (GemmaCodePanel)
- [ ] Implement pre-compaction memory extraction (`extractAndSave`)
- [ ] Add `/memory` slash command (search, save, clear, status)

### Phase 4 — Conditional Tool Activation and MCP Support
- [ ] Add enabled/disabled state to `ToolRegistry.ts`
- [ ] Update PromptBuilder to only declare enabled tools
- [ ] Create `src/mcp/McpServer.ts` (expose tools via MCP stdio)
- [ ] Create `src/mcp/McpClient.ts` (consume external MCP servers)
- [ ] Create `src/mcp/McpManager.ts` (lifecycle, config from mcp.json)
- [ ] Add `/mcp` slash command (status, connect, disconnect)

### Phase 5 — Sub-Agent Orchestration
- [ ] Create `src/agents/SubAgentManager.ts` (isolated ConversationManager + AgentLoop)
- [ ] Create `src/agents/SubAgentPrompts.ts` (verification, research, planning templates)
- [ ] Add file-edit counter and auto-verification trigger to AgentLoop
- [ ] Add `buildForSubAgent()` to PromptBuilder
- [ ] Wire sub-agent status to webview
- [ ] Add `/verify` and `/research` slash commands

### Phase 6 — Integration, Polish, and Backend Alignment
- [ ] Align Python backend prompt.py with multi-strategy compaction
- [ ] Update webview UI (memory status, sub-agent spinner, MCP badge)
- [ ] Create root-level `SECURITY.md` and `ARCHITECTURE.md`
- [ ] Run end-to-end verification checklist (11 items in plan)
- [ ] Bump version to 0.2.0, update CHANGELOG

## Backlog — v0.3.0+

- [ ] *(suggested)* Improve web search backend to reduce rate-limiting and improve result quality
- [ ] *(suggested)* Add E2E test suite to the standard CI matrix for pre-merge validation
- [ ] *(deferred)* Tree-sitter AST parsing for semantic code understanding (from Graphify comparison)
- [ ] *(deferred)* Knowledge graph generation (from Graphify/MemPalace comparisons)
- [ ] *(deferred)* Chat format normalization for importing Claude/ChatGPT history (from MemPalace comparison)
- [ ] *(deferred)* Retrieval quality benchmarks (from MemPalace comparison)

---

## Functionality Matrix

### Tool Handlers

| Feature | Status | File/Location | Sprint |
|---------|--------|---------------|--------|
| read_file | Done | `src/tools/handlers/` | -- |
| write_file | Done | `src/tools/handlers/` | -- |
| create_file | Done | `src/tools/handlers/` | -- |
| delete_file | Done | `src/tools/handlers/` | -- |
| edit_file | Done | `src/tools/handlers/` | -- |
| list_directory | Done | `src/tools/handlers/` | -- |
| grep_codebase | Partial | `src/tools/handlers/` | Sprint 2 |
| run_terminal | Done | `src/tools/handlers/terminal.ts` | -- |
| web_search | Done | `src/tools/handlers/webSearch.ts` | Sprint 3 |
| fetch_page | Done | `src/tools/handlers/webSearch.ts` | -- |

### Platform Installers

| Platform | Status | File/Location | Sprint |
|----------|--------|---------------|--------|
| Windows (NSIS) | Done | `scripts/installer/setup.nsi` | -- |
| macOS | Missing | -- | Sprint 2 |
| Linux | Missing | -- | Sprint 2 |
| VS Code Marketplace | Missing | -- | Sprint 2 |