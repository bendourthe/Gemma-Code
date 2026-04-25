# Gemma Code — Progress Dashboard

**Branch:** `main`

---

## Scores (update after each sprint)

| Metric | Current | Target | Delta |
|--------|---------|--------|-------|
| Tasks done (v0.1.0) | 13 / 21 | 21 / 21 | -8 |
| Tasks done (v0.2.0) | 44 / 44 | 44 / 44 | 0 |
| Tasks done (v0.3.0) | 55 / 55 | 55 / 55 | 0 |
| Tasks done (v0.4.0) | 16 (P1) + 17 (P2) + 21 (P3) + 21 (P4) + 22 (P5) | ~135 / ~135 | in-progress |

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
- [x] Build macOS and Linux installer packages (resolved in v0.3.0 Phase 7 PyQt5 installer)
- [ ] Publish extension to VS Code Marketplace (CHANGELOG Unreleased)
- [ ] Implement Rust performance components for file indexing and grep (CHANGELOG Unreleased)
- [ ] Implement Go CLI tooling for project scaffolding (CHANGELOG Unreleased)

## v0.2.0 — Planned (local Claude Code equivalent)

Full plan: `docs/v0.2.0/development/implementation-plan.md`

### Phase 0 — Gemma 4 Native Protocol Migration
- [x] Create `src/tools/Gemma4ToolFormat.ts` (tool declaration serializer, tool call parser, result formatter)
- [x] Migrate `ToolCallParser.ts` from XML `<tool_call>` regex to Gemma 4 native `<|tool_call>` tokens
- [x] Update `AgentLoop.ts` tool result injection to use `<|tool_result>` format
- [x] Update `ConversationManager.ts` system prompt for native system role
- [x] Update `settings.ts` defaults: model `gemma4:e4b`, maxTokens 131072, temperature 1.0, topP 0.95, topK 64
- [x] Update `prompt.py` to use native system role and Gemma 4 turn tokens
- [x] Update `client.ts` to pass `tools` parameter in Ollama API requests
- [x] Add thinking mode support (`<|think|>` token in system prompt)

### Phase 1 — Dynamic PromptBuilder with Token Budgeting
- [x] Create `src/chat/PromptBuilder.ts` with section-based assembly and greedy packing
- [x] Create `src/chat/PromptBuilder.types.ts` (PromptContext, PromptSection, PromptStyle)
- [x] Create `src/config/PromptBudget.ts` (centralized budget calculator)
- [x] Refactor `ConversationManager.ts` to use PromptBuilder instead of static SYSTEM_PROMPT
- [x] Wire PromptBuilder into `GemmaCodePanel.ts`
- [x] Add `promptStyle` and `systemPromptBudgetPercent` settings

### Phase 2 — Multi-Strategy Context Compaction
- [x] Create `src/chat/CompactionStrategy.ts` with interface and 5 strategy implementations
- [x] Implement ToolResultClearing strategy (regex-based, zero LLM cost)
- [x] Implement SlidingWindow strategy (keep anchors + recent messages)
- [x] Implement CodeBlockTruncation strategy (replace large code blocks with placeholders)
- [x] Refactor `ContextCompactor.ts` to use CompactionPipeline
- [x] Add pre-compaction save hook (wires to MemoryStore in Phase 3)

### Phase 3 — Persistent Memory System
- [x] Create `src/storage/MemoryStore.ts` with SQLite FTS5 schema
- [x] Create `src/storage/EmbeddingClient.ts` wrapping Ollama `/api/embed`
- [x] Add FTS5 virtual table and sync triggers to `ChatHistoryStore.ts`
- [x] Add `buildMemorySection()` to PromptBuilder with budget cap
- [x] Wire memory retrieval into chat flow (GemmaCodePanel)
- [x] Implement pre-compaction memory extraction (`extractAndSave`)
- [x] Add `/memory` slash command (search, save, clear, status)

### Phase 4 — Conditional Tool Activation and MCP Support
- [x] Add enabled/disabled state to `ToolRegistry.ts`
- [x] Update PromptBuilder to only declare enabled tools
- [x] Create `src/mcp/McpServer.ts` (expose tools via MCP stdio)
- [x] Create `src/mcp/McpClient.ts` (consume external MCP servers)
- [x] Create `src/mcp/McpManager.ts` (lifecycle, config from mcp.json)
- [x] Add `/mcp` slash command (status, connect, disconnect)

### Phase 5 — Sub-Agent Orchestration [COMPLETED]
- [x] Create `src/agents/SubAgentManager.ts` (isolated ConversationManager + AgentLoop)
- [x] Create `src/agents/SubAgentPrompts.ts` (verification, research, planning templates)
- [x] Add file-edit counter and auto-verification trigger to AgentLoop
- [x] Add `buildForSubAgent()` to PromptBuilder
- [x] Wire sub-agent status to webview
- [x] Add `/verify` and `/research` slash commands

### Phase 6 — Integration, Polish, and Backend Alignment [COMPLETED]
- [x] Align Python backend prompt.py with multi-strategy compaction
- [x] Update webview UI (memory status, sub-agent spinner, MCP badge)
- [x] Create root-level `SECURITY.md` and `ARCHITECTURE.md`
- [x] Run end-to-end verification checklist (11 items in plan)
- [x] Bump version to 0.2.0, update CHANGELOG

## v0.3.0 — Harness Engineering Infrastructure

Full plan: `docs/v0.3.0/implementation-plan.md`

### Phase 1 — GPU Detection & Hardware-Aware Foundation [COMPLETED]
- [x] GPU/VRAM detection service (nvidia-smi, rocm-smi, system_profiler, WMI fallbacks)
- [x] Hardware tier classification (3 tiers: constrained/balanced/full)
- [x] Tier-aware context budget calculator (expanded BudgetOverrides, calculateTierBudget)
- [x] Token and iteration budget middleware (BudgetMiddleware in AgentLoop)
- [x] Wire GPU detection into extension lifecycle (status bar, detectGpu command, panel integration)

### Phase 2 — Advanced Context Engineering [COMPLETED]
- [x] Lazy tool loading with progressive disclosure
- [x] Output redirection for large tool results
- [x] Enhanced compaction with regenerate-from-source
- [x] Context budget middleware chain
- [x] Token estimation accuracy improvements

### Phase 3 — Graph-Vector Hybrid Memory [COMPLETED]
- [x] 4-layer memory stack (working/episodic/semantic/graph)
- [x] Entity extraction and provenance tracking
- [x] Memory-aware context assembly
- [x] Memory pruning and consolidation

### Phase 4 — Safety, Budgeting & Runaway Prevention [COMPLETED]
- [x] Hash-based loop detection
- [x] Irreversible action classification
- [x] Git safety net
- [x] Permission escalation system

### Phase 5 — Plan-and-Execute Orchestration [COMPLETED]
- [x] Task DAG data model and PlannerAgent (LLM-based request decomposition)
- [x] DAG executor with GPU-aware semaphore scheduling
- [x] Reflexion pattern for error recovery (analyze, constrain, retry)
- [x] Structured output contracts for sub-agent communication
- [x] Orchestrator integration with GemmaCodePanel (plan mode + complexity heuristic)
- [x] Dynamic replanning on divergence (>30% failure threshold)

### Phase 6 — Local Observability & Trace Dashboard [COMPLETED]
- [x] SQLite trace store (TraceStore with spans, traces, events)
- [x] Tracer singleton with no-op mode and core component instrumentation
- [x] Metrics collector and golden task evaluation framework
- [x] Webview-based trace dashboard with waterfall visualization
- [x] Optional OTLP export (off by default, minimal fetch-based exporter)

### Phase 7 — Cross-Platform PyQt5 Installer [COMPLETED]
- [x] PyQt5 project scaffold with dark theme engine and custom widgets (7.1)
- [x] Welcome, Prerequisites, GPU Detection wizard pages with background detection (7.2)
- [x] Install Path, Model Selection, Configuration, Review wizard pages (7.3)
- [x] Installation engine with Ollama/extension/venv/model installers and real-time log (7.4)
- [x] Completion page with services table, management commands, and navigation polish (7.5)
- [x] Cross-platform packaging: PyInstaller for Windows/macOS/Linux (7.6)
- [x] Comprehensive test suite (184 tests, 83% coverage) and NSIS migration to legacy (7.7)
- [x] Testing stabilization to 80%+ coverage (7.T)

### Phase 8 — Golden Task Suite & Integration Stabilization [COMPLETED]
- [x] Golden task framework: types, loader, runner, evaluator, reporter, snapshot (8.1)
- [x] 24 golden task YAMLs + snapshots across 5 categories (8.2)
- [x] Per-tier model-matrix, memory-recall, and golden-task-perf benchmarks (8.3)
- [x] Baseline save/load + regression detection framework (8.3)
- [x] Installer CLI flags (`--headless`, `--model`, `--install-path`, `--skip-model`, `--json-output`) (8.4)
- [x] Cross-platform smoke tests (Windows PowerShell, macOS/Linux bash) with verify + cleanup helpers (8.4)
- [x] E2E integration tests: full-pipeline, memory-across-sessions, compaction-under-load, sub-agent, MCP, prompt-budget (8.5)
- [x] Comparison framework (`compare_versions` + markdown report) (8.6)
- [x] v0.3.0 architecture doc, performance benchmarks, performance comparison template (8.6)
- [x] `.github/workflows/golden-tasks.yml` + `installer-smoke.yml` (conservative, workflow_dispatch + weekly cron) (8.7)
- [x] Release checklist and CI pipeline documentation (8.7)
- [x] ARCHITECTURE.md, CHANGELOG.md, docs/todos.md updates (8.6)

## Backlog

- [ ] *(suggested)* Improve web search backend to reduce rate-limiting and improve result quality
- [ ] *(suggested)* Add E2E test suite to the standard CI matrix for pre-merge validation
- [ ] *(deferred)* Tree-sitter AST parsing for semantic code understanding (from Graphify comparison)
- [ ] *(deferred)* Knowledge graph generation (from Graphify/MemPalace comparisons)
- [ ] *(deferred)* Chat format normalization for importing Claude/ChatGPT history (from MemPalace comparison)
- [ ] *(deferred)* Retrieval quality benchmarks (from MemPalace comparison)

### v0.5 follow-ups (deferred from v0.4.0 Phase 6)

- [ ] Complete the GemmaCodePanel split: extract `ChatController` (agent loop + orchestration mediator) and `ChatWebviewHost` (webview provider + message translation) from `src/panels/GemmaCodePanel.ts`. Reduce the panel to <100 lines or delete it; thin `extension.ts` to a lifecycle adapter. Seam already in place via `GemmaRuntime`.
- [ ] Finish settings injection: eliminate the 12 `_getSettings()` reads inside `panels/GemmaCodePanel.ts` and the activation-time `getSettings()` in `extension.ts`. Reach the strict acceptance criterion of "exactly one `getSettings()` call, in `GemmaRuntime`."
- [ ] Expand Zod adoption beyond the LLM boundary: `panels/messages.ts` (webview payloads), `storage/GraphMemory.ts` (persisted entity attributes), `observability/TraceStore.ts` (persisted span attributes).
- [ ] Upgrade `marked` from v4 to v12: adapt the renderer API break, snapshot-test the rendered HTML against the existing fixture set, keep DOMPurify in the pipeline. See the `NOTE(v0.5)` comment in `src/utils/MarkdownRenderer.ts:1`.

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

---

## v0.4.0 — Code Review Remediation

Driven by [docs/v0.3.0/review.md](v0.3.0/review.md) (129 findings: 14 P0, 46 P1, 42 P2, 27 P3). Plan: [docs/v0.4.0/implementation-plan.md](v0.4.0/implementation-plan.md).

### Phase 1 — Critical Hotfix (P0 Unblock) [COMPLETED 2026-04-18]

All 14 P0 findings closed plus version bump. See [docs/DEVLOG.md](DEVLOG.md) and [docs/adr/0001-python-backend-disposition.md](adr/0001-python-backend-disposition.md) for detail.

- [x] 1.1 DOMPurify-sanitize markdown + tighten webview CSP
- [x] 1.2 Restrict `run_terminal` cwd to workspace root (via `src/tools/handlers/pathGuard.ts`)
- [x] 1.3 Add AFTER UPDATE FTS5 trigger to ChatHistoryStore + switch `saveMessage` to UPDATE-or-INSERT
- [x] 1.4 Delete dead in-degree loop in TaskDAG.hasCycle
- [x] 1.5 Fix GraphQueryEngine path reconstruction
- [x] 1.6 Add Float32 embedding cache + FTS5 candidate filter to MemoryStore.searchSemantic
- [x] 1.7 Batch tracer writes; eliminate SELECT in endSpan
- [x] 1.8 Add end-to-end safety-pipeline integration test
- [x] 1.9 Add McpToolHandler unit tests
- [x] 1.10 Add SessionListPanel unit tests + attribute-context escaping (closes #87)
- [x] 1.11 Wire benchmark threshold gating in nightly.yml
- [x] 1.12 Wire golden-task live-Ollama matrix CI (e2b + e4b)
- [x] 1.13 Delete Python backend; record ADR-0001
- [x] 1.14 Extract MemorySubsystem factory from GemmaCodePanel (-84 LOC)
- [x] 1.15 Version bump to 0.4.0 + CHANGELOG seed
- [x] 1.16 Testing & stabilization (build + lint + test green on touched files)

### Phase 2 — Security Hardening [COMPLETED 2026-04-19]

20 non-P0 security findings closed (6 P1 + 9 P2 + 5 P3). 2.2 and 2.13 closed N/A per ADR-0001. See [docs/v0.4.0/development/history/2026-04_phase-2-security-hardening.md](v0.4.0/development/history/2026-04_phase-2-security-hardening.md).

### Phase 3 — Correctness & Code Quality [COMPLETED 2026-04-19]

24 findings closed (8 P1 + 10 P2 + 6 P3). See [docs/v0.4.0/development/history/2026-04_phase-3-correctness.md](v0.4.0/development/history/2026-04_phase-3-correctness.md).

### Phase 4 — Performance Optimization [COMPLETED 2026-04-19]

20 findings closed across seven waves; 5 closed N/A. See [docs/v0.4.0/development/history/2026-04_phase-4-performance.md](v0.4.0/development/history/2026-04_phase-4-performance.md).

### Phase 5 — Testing Pipeline Completeness [COMPLETED 2026-04-19]

22 findings closed; 2 closed N/A. 1166 Vitest cases at 89.07% line / 82.78% branch coverage. See [docs/v0.4.0/development/history/2026-04_phase-5-testing-pipeline.md](v0.4.0/development/history/2026-04_phase-5-testing-pipeline.md).

### Phase 6 — Restructuring (Architecture) [COMPLETED 2026-04-24]

14 of 17 sub-tasks landed; 3 scoped down with documented v0.5 deferrals (panel split, full settings injection, full Zod boundary coverage). See the [DEVLOG entry](DEVLOG.md) for the full breakdown.

- [x] 6.1 Record ADR-0001 Python backend disposition
- [x] 6.2 GemmaRuntime composition root extracted (full ChatController / ChatWebviewHost split deferred to v0.5)
- [x] 6.3 src/safety/ -> src/guardrails/ (all 5 modules + BLOCKED_PATTERNS extracted to policy.ts)
- [x] 6.4 src/llm/ port with vendor-neutral types + OllamaClient driver (10 consumers migrated; src/ollama/ deleted)
- [x] 6.5 src/llm/OllamaHttp.ts shared client; OllamaClient + EmbeddingClient compose over it
- [x] 6.6 GoldenTaskSuite + goldenTasksYaml.generated.ts moved to src/evaluation/
- [x] 6.7 src/modes/PlanMode.ts inlined into src/chat/PlanMode.ts; src/modes/ deleted
- [x] 6.8 Tracer singleton retired; constructor injection via GemmaRuntime; tests parallel-safe
- [x] 6.9 Settings injection in ContextCompactor + RegenerateFromSource (panel reads deferred)
- [x] 6.10 src/utils/logger.ts (vscode.OutputChannel wrapper); 25 console.* calls migrated; ESLint no-console -> error
- [x] 6.11 src/utils/errors.ts (formatForUser with redaction; formatForLog); 21 ad-hoc patterns replaced
- [x] 6.12 Zod schemas at LLM boundary (stream chunks + listModels); webview/storage/observability deferred
- [x] 6.13 docs/adr/ scaffolding (README index + MADR template)
- [x] 6.14 scripts/dev-setup.{sh,ps1} + CONTRIBUTING.md + npm run dev
- [x] 6.15 Already satisfied via Phase 5 sub-task 5.19 (no-op)
- [x] 6.16 marked v12 deferred with NOTE(v0.5) (renderer API break; DOMPurify already provides sanitization)
- [x] 6.17 Lint + test + build stabilization (1165 pass / 0 fail; 0 lint errors)

### Phase 7 — Simplification & Release [PENDING]

17 simplification findings; ~800 LOC target deletion; v0.4.0 tag + VSIX publish.