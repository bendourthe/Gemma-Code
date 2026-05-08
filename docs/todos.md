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

---

## v0.5.0 — Unified Adoption Release [SHIPPED 2026-04-26]

12-phase consolidation cycle adopting five external comparisons (Claude Code, Routa, Foundry Vault, Token Optimizer MCP, agent-friendly CLI rubric). All phases landed; tag `v0.5.4` cut. Plan: [docs/v0.5.0/plans/implementation-plan.md](v0.5.0/plans/implementation-plan.md). Architecture: [docs/v0.5.0/architecture.md](v0.5.0/architecture.md).

- [x] Phase 1 — Identity & Naming (AGENTS.md canonical; CLAUDE.md removed)
- [x] Phase 2 — Tool Surface Hardening (max_bytes, range_start/end, next_offset)
- [x] Phase 3 — Compression Foundation
- [x] Phase 4 — Persistent Cache + Diff-Based Reads
- [x] Phase 5 — Semantic Recall + Budgeting
- [x] Phase 6 — Mutation Safety + Structured Outputs (dry_run, format=json)
- [x] Phase 7 — Memory Hygiene + Corroboration
- [x] Phase 8 — Generic Harness + Specialist Externalization
- [x] Phase 9 — Coverage + Observability
- [x] Phase 10 — Local-Dev Hygiene + CI Hardening
- [x] Phase 11 — Documentation Discipline (ADRs, catalog, governance)
- [x] Phase 12 — Advanced Fallbacks (PredictiveCache, eviction strategies, HeuristicEmbedder, semantic-release)

---

## v0.6.0 — Review-Driven Cycle [IN PROGRESS]

Hygiene/ratchet cycle closing the v0.6.0 review pass (1 P0, 6 P1, 9 P2, 11 P3). No new product surface; pays down v0.5.0 technical debt. Plan: [docs/v0.6.0/plans/v0.6.0-cycle.md](v0.6.0/plans/v0.6.0-cycle.md).

### Phase 1 — Security chain closure [COMPLETED 2026-04-26]

Closes pen-test F-001, F-003, F-004; both legs of Attack Path A refuse the operation. See [docs/v0.6.0/development/history/2026-04_phase-1-security-chain-closure.md](v0.6.0/development/history/2026-04_phase-1-security-chain-closure.md).

- [x] 1.1 Unify path resolution behind realpath-aware `pathGuard.resolveInsideWorkspace` (with ancestor walk for non-existent leaves) + 7-tool symlink regression test
- [x] 1.2 Clamp `permissionOverrides` so confirmation-tier tools cannot drop to AUTO_APPROVE (with logger warning + dedupe)
- [x] 1.3 Tag MCP-originated tool calls with `source: "mcp"` peer attribution in ConfirmationGate; add `gemma-code.mcpExposedTools` allowlist (read-only by default)
- [x] 1.4 Phase 1 testing and stabilization (17 new tests + lint + deps:check + catalog:check green)

### Phase 2 — Test pipeline reliability + release-gate baselines [PENDING]
### Phase 3 — Defense-in-depth ratchets [PENDING]
### Phase 4 — Module-boundary ratchet [PENDING]

### Phase 5 — Doc/code drift + dead-code cleanup [COMPLETED 2026-05-03]

Closes pen-test F-007, F-008, F-014; known-gaps 4.2, 4.3, 5.1, 5.3, 5.4, sections 8 + 9.7; codebase-review #4, #7, #13, #20. See [docs/v0.6.0/development/history/2026-05_phase-5-doc-code-drift.md](v0.6.0/development/history/2026-05_phase-5-doc-code-drift.md).

- [x] 5.1 Decide PredictiveCache: deleted (Option B). Hard constraint #1 forbids new product surface; setting was unwired; bench measured latency, not hit-rate.
- [x] 5.2 Decide threshold elevation: implemented (Option A). Per-row provenance threshold in `searchByEmbedding`; `gemma-code.ollamaEmbeddingThreshold` (0.85) + `gemma-code.heuristicEmbeddingThreshold` (0.95) settings; 3 real heuristic-fallback tests replace the `it.todo`.
- [x] 5.3 Delete legacy `gemma-code.gpuTier` setting fallback; CHANGELOG `### Removed` entry.
- [x] 5.4 Architecture-doc inaccuracies: meta-test path corrected; v0.4.0 ship date bumped to 2026-04-25; permission-tier table now generated from `PermissionTiers.ts` via `scripts/generate-tool-permission-table.mjs` and CI-gated in `catalog-sync` (also fixed two inverted tier rows -- delete_file is tier 1, web_search is tier 2).
- [x] 5.5 FIFO-vs-LRU reconciled: `accessed_at` column + index added; `lookup()` bumps it; `_enforceCapacity()` orders by it; hot-vs-cold regression test.
- [x] 5.6 Migration-ordering regression test (4 cases) seeds v0.4.0 schema, asserts all four migrations land cleanly + are idempotent.
- [x] 5.7 Lint + test + build + deps stabilization (1579 pass / 0 fail; 0 lint errors).

### Phase 6 — Panel decomposition [COMPLETED 2026-05-03]

Closes codebase-review #2, #3, #16 (deferred), #23. See [docs/v0.6.0/development/history/2026-05_phase-6-panel-decomposition.md](v0.6.0/development/history/2026-05_phase-6-panel-decomposition.md).

- [x] 6.1 Extract `ChatController.ts` (agent-loop wiring + slash-command dispatch composition). Routes `submitUserMessage`, `cancelInFlight`, `approveStep`, plan detection, and pre-prompt memory injection. Tests: 12 cases, 90% coverage.
- [x] 6.2 Extract `ChatWebviewHost.ts` (sidebar view + editor panel + postMessage routing + focus tracking). Tests: 7 cases, 99% coverage.
- [x] 6.3 Extract `ChatCommandHandlers.ts` (12 slash commands moved out of the panel). Tests: 33 cases, 86% coverage.
- [x] 6.4 Source-level webview split (Option B): `scaffold.ts` / `bodyMarkup.ts` / `runtime.ts` / `styles.ts`. `index.ts` shrank from 1,573 to 12 lines. Tests: 9 scaffold + 4 CSP cases.
- [ ] 6.5 Optional: split `filesystem.ts` per-tool. **Deferred per plan note** ("Lower-priority; defer if Phase 6 is already large").
- [x] 6.6 Stabilization: lint clean, typecheck clean, deps:check clean, catalog regenerated. Manual flow verification (5 paths) is on the operator -- see history file section 4.

**Partial deviation**: `GemmaCodePanel.ts` is 935 lines (down from 1,724); the plan's < 400 target requires further factory work (PanelComposition + post-helper move) tracked as v0.7.0 follow-up. See history file section 3.1.

### Phase 7 — Polish + simplification [PENDING]
### Phase 8 — Release gate + ADRs + CHANGELOG [PENDING]

---

## v0.7.0 — Multi-Source Adoption Cycle [IN PROGRESS]

Phased adoption of comparison-multi-source findings across skills, memory architecture, compaction, render protocol, and per-model context overrides. Plan: [docs/v0.7.0/plans/v0.7.0-cycle.md](v0.7.0/plans/v0.7.0-cycle.md).

### Phase 0 — Close-out + carryovers [COMPLETED 2026-05-05]
### Phase 1 — Skill expansion (zero-code first) [COMPLETED 2026-05-05]
### Phase 2 — Memory file architecture [COMPLETED 2026-05-05]

### Phase 3 — Compaction stack expansion [COMPLETED 2026-05-05]

Adopts C12 / C13 / C14 / C15 / C16. Adds two deterministic strategies (deduplication, purgeErrors), a model-callable compress tool with two modes (range, message-experimental), per-session CompressionState, six `/compact` verbs, per-model context overrides, and ADR-0012. See [docs/DEVLOG.md](DEVLOG.md) for details.

- [x] 3.1 Deduplication compaction strategy (`src/chat/strategies/deduplication.ts` + 8 tests)
- [x] 3.2 Purge-errors compaction strategy (`src/chat/strategies/purgeErrors.ts` + 5 tests)
- [x] 3.3 CompressionState module + block ID allocation (`src/chat/state/CompressionState.ts` + 6 tests)
- [x] 3.4 `compress_range` tool handler (`src/tools/handlers/compress.ts` + prompt md + 6 tests)
- [x] 3.5 `compress_message` tool handler (experimental, flag-gated; 3 tests)
- [x] 3.6 `/compact <verb>` commands (`src/commands/compactCommand.ts` + 9 tests; sweep auto-issue deferred to Phase 4)
- [x] 3.7 Per-model context-limit overrides (`gemma-code.contextLimitsPerModel` + `resolveModelContextLimit` + 6 tests)
- [x] 3.8 ADR-0012 model-callable compress tool design (renumbered from plan's ADR-0006 because 0006 is taken)

### Phase 4 — Webview render protocol expansion [COMPLETED 2026-05-06]

Adopt the seven Claude-Code-style chat-UI primitives (S7 / C21-C27): inline diff cards, action-type tags, numbered permission prompts, structured todo blocks, "Thought for Ns" meta-rows, queued-message fields, and end-of-task completion reports. History: [docs/v0.7.0/development/history/2026-05_phase-4-webview-render-protocol.md](v0.7.0/development/history/2026-05_phase-4-webview-render-protocol.md).

- [x] 4.1 Inline diff card (`src/panels/webview/render/diffCard.ts` + 6 tests)
- [x] 4.2 Action-type tag (`src/panels/webview/render/actionTag.ts` + 10 tests)
- [x] 4.3 Numbered permission prompt (`src/panels/webview/render/permissionPrompt.ts` + 10 tests; `ConfirmationGate.requestPrompt`)
- [x] 4.4 Todo block + `update_todos` tool (5 + 4 tests; `src/tools/handlers/todos.ts` permission tier 0)
- [x] 4.5 Thought-for-Ns meta-row (`src/panels/webview/render/thoughtMetaRow.ts` + 5 tests; StreamingPipeline emits)
- [x] 4.6 Queued-message field (renderer 6 tests + ConversationManager queue 4 tests; UX wiring deferred to v0.8.0)
- [x] 4.7 Completion-report block (`src/panels/webview/render/completionReport.ts` + 7 tests; `buildCompletionReport`)
- [x] 4.8 ADR-0013 webview render protocol (renumbered from plan's ADR-0008 because 0006-0012 are taken)

**Follow-ups (deferred to v0.8.0 Phase 1)**: panel-host adoption of the new render protocol -- (a) replace input row with queued-message field during streaming, (b) route `permissionPromptResponse` through `ChatMessageRouter` to `gate.resolvePrompt`, (c) wire `ToolRegistryBuilder.todos` in the panel bootstrap. All three share the same surface; bundling is intentional.

### Phase 5 — Memory commands + manual memory page UI + per-model context limits [COMPLETED 2026-05-07]

Polish the memory experience: complete `/memory` slash-command surface, ship a sidebar `MemoryPanel` webview, and confirm the per-model context-limit override is wired. Plan: [docs/v0.7.0/plans/v0.7.0-cycle.md](v0.7.0/plans/v0.7.0-cycle.md) Phase 5.

- [x] 5.1 `/memory forget`, `/memory export`, `/memory import` slash commands (extends `ChatCommandHandlers.dispatch("memory", ...)`; new helpers `parseForgetArgs`, `parseImportArgs`, `forgetMatchingSqlRows`; new `MemoryStore.deleteById`; 13 cases + 4 parser cases in `tests/unit/panels/ChatCommandHandlers.test.ts`)
- [x] 5.2 MemoryPanel webview tab (`src/panels/MemoryPanel.ts`, `src/panels/webview/memoryView.ts`, view registered in `package.json`, wired in `src/extension.ts` via `chatPanel.getMemoryFiles()` / `chatPanel.getMemoryStore()`; 13 cases in `tests/unit/panels/MemoryPanel.test.ts`)
- [x] 5.3 ADR-0014 memory file architecture (renumbered from plan's ADR-0007 because 0007 is taken; same pattern as ADR-0013)
- [x] Per-model context limits finalised (no new code; Phase 3 sub-task 3.7 already shipped `resolveModelContextLimit` + 6 tests; tracked as in-cycle gap 10.O.6 for the audit trail)

**Follow-ups carried into v0.8.0**: same three Phase 4 panel-host items (queued-field swap, permissionPromptResponse routing, todos opt-in wiring); no new follow-ups from Phase 5.

### Phase 6 — Multi-harness skill packaging [PENDING]
### Phase 7 — HNSW vector index (optional) [PENDING]
### Phase 8 — Release gate + ADRs + CHANGELOG [PENDING]