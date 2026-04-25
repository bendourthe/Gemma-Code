# Changelog

All notable changes to Gemma Code will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Rust performance components for file indexing and grep
- Go CLI tooling for project scaffolding
- ripgrep-backed GrepCodebaseTool
- Extension Marketplace publication
- Tree-sitter AST parsing for semantic code understanding
- SSE transport for MCP server

---

## [0.4.0] -- Unreleased

Code-review remediation release closing all 14 P0 findings from the v0.3.0 review.

### Phase 1 -- Critical Hotfix (P0 Unblock)

**Correctness**
- ChatHistoryStore FTS5 index stays in sync on message re-saves (added AFTER UPDATE trigger; switched saveMessage from INSERT OR REPLACE to explicit UPDATE/INSERT so the trigger fires)
- TaskDAG.hasCycle() no longer contains a dead in-degree loop; edge-direction intent is documented inline
- GraphQueryEngine.explainPath returns all intermediate entities on multi-hop paths (GraphMemory.getEntityById promoted to public)

**Security**
- run_terminal rejects any cwd that resolves outside the workspace root (shared path guard in src/tools/handlers/pathGuard.ts; symlink-aware)

**Security**
- Webview HTML rendered from LLM/tool/memory content is now sanitized through DOMPurify before reaching any innerHTML sink (strips <script>, <iframe>, <style>, inline event handlers, javascript: URIs)
- Content-Security-Policy tightened in both chat and trace-dashboard webviews: img-src, connect-src, object-src, frame-src, base-uri, form-action explicitly denied; require-trusted-types-for 'script' added
- run_terminal rejects any cwd that resolves outside the workspace root via a new shared src/tools/handlers/pathGuard.ts (symlink-aware)
- SessionListPanel HTML template now escapes session ids in attribute contexts (also gates finding #87)

**Performance**
- MemoryStore.searchSemantic scales with an FTS5 candidate pre-filter (bounded at 200 rows) and a per-instance Float32 embedding cache invalidated on save/prune/clear (previously full-table scan + Float64 per call)
- Tracer writes are batched: startSpan/endSpan buffer in memory and flush in a single transaction every 32 ops or on process.nextTick; endSpan no longer issues a per-span SELECT (startTime + attributes kept in-memory); reads auto-flush for consistency

**Testing**
- McpToolHandler unit tests (delegation, error propagation, rejection bubbling, argument pass-through)
- SessionListPanel unit tests (HTML rendering, message handling, escapeAttr wiring, null-store safety)
- MarkdownRenderer XSS regression tests (8 cases covering <script>/<iframe>/javascript:/<style>/<details open ontoggle>/inline event handlers)
- MemorySubsystem unit tests (disabled() contract, wired layers, graph-engine binding, isReady semantics)
- TraceStore batching tests (flushed queryability, in-memory endSpan path, implicit flush on read)
- Integration test for the safety pipeline: classifier -> requiresCheckpoint -> GitSafetyNet.createCheckpoint/rollback wired with real classifier + GitSafetyNet and mocked execFile (tests/integration/safety/agent-safety-pipeline.test.ts)

**CI**
- Benchmark regression gate: nightly.yml now exports bench results as JSON and runs scripts/check-bench-regressions.mjs against tests/benchmarks/baselines/v0.3.0.json; fails on >20% hz regression. First post-merge nightly will populate the baseline via --update-baseline mode.
- Golden task live-Ollama job: golden-tasks.yml now matrixes e2b + e4b, pulls Gemma, runs tests/golden/framework/run_all.py against OLLAMA_URL, diffs against v0.3.0 baseline, and uploads a Markdown regression report.

**Restructuring**
- Python FastAPI backend removed (ADR-0001). src/backend/ tree deleted along with BackendManager wiring, lint-py / test-py CI jobs, integration-py nightly job, and the installer venv step. The extension now talks directly to Ollama.
- `gemma-code.useBackend`, `gemma-code.backendPort`, `gemma-code.pythonPath` settings removed. Users with these set in their workspace will see "unknown setting" warnings on upgrade; they are safe to delete.
- GemmaCodePanel memory wiring extracted into src/storage/MemorySubsystem.ts (first slice of the god-object split). GemmaCodePanel.ts shrank by ~84 lines; the factory is independently unit-tested.

**Release**
- package.json version bumped to 0.4.0
- modelName default aligned across package.json manifest and src/config/settings.ts (both now "gemma4:e4b")

### Phase 7 -- Simplification and Release

**Removed (~800 LOC)**
- BudgetEnforcer (`src/guardrails/BudgetEnforcer.ts`) and its test; agent-loop branches that consumed it were already removed in Phase 3
- LazyToolLoader (`src/tools/LazyToolLoader.ts`), the `serializeToolSummary` helper in `Gemma4ToolFormat.ts`, the `lazyToolLoading` flag on `PromptContext`, and the `get_tool_schema` meta-tool from the catalog/permission tiers
- ConversationSync (`src/storage/ConversationSync.ts`) and its test
- RelevanceScorer (`src/chat/RelevanceScorer.ts`), its test, and the async relevance branch in `PromptBuilder.build` (build is now synchronous; all call sites updated)
- GpuTierConfig (`src/config/GpuTierConfig.ts`) and `inferTierFromModelName`; tier model unified onto `HardwareTierConfig` (gains `subAgentMaxIterations` + `maxConcurrentSubAgents`); `Orchestrator` and `DAGExecutor` now consume `HardwareTierConfig` directly
- `gemma-code.gpuTier` setting (with v0.5 migration shim that maps the legacy "1"/"2"/"3" string onto the canonical `gpuTierOverride` numeric tier)
- `gemma-code.memoryAutoSaveInterval` setting (no readers remained)
- `gemma-code.maxSessionTokens` and `gemma-code.maxSessionMinutes` settings (tied to BudgetEnforcer deletion)
- `escapeAttr` alias in MarkdownRenderer (every call site now invokes `escapeHtml` directly)
- `highlight.min.js` copy step in `scripts/build-vsix.ps1` (webview imports highlight.js via the bundled module loader; ~1 MB smaller VSIX)
- `validateExpectation` and `detectRegressions` relocated from `src/evaluation/GoldenTaskSuite.ts` to `tests/helpers/goldenTaskHelpers.ts` (test-only consumers)

**Wired**
- `gemma-code.permissionOverrides` setting now reaches `ToolRegistry.setConfirmationGate` so user overrides take effect (previously read but never applied); covered by a new `ToolRegistry` unit test

**Internal**
- `tsconfig.json`: `declaration: false`, `declarationMap: false` (no `.d.ts` artifacts in `out/`; faster builds)
- `parseOtlpHeaders` rewritten as `split` -> `map` -> `Object.fromEntries` (same shape, half the lines)

---

## [0.3.0] -- 2026-04-18

Cross-platform installer, golden task evaluation suite, and integration stabilization.

### Added

**Phase 7 -- Cross-Platform PyQt5 Installer**
- PyQt5 wizard installer replacing Windows-only NSIS installer
- 9-step installation wizard: Welcome, Prerequisites, GPU Detection, Install Path, Model Selection, Configuration, Review, Installing, Complete
- Automatic GPU detection (NVIDIA, AMD, Apple Silicon, Intel) with model recommendation
- Platform-specific installation: Windows (.exe), macOS (.dmg), Linux (AppImage)
- Real-time log panel during installation with color-coded output
- Headless mode (`--headless`, `--model`, `--install-path`, `--skip-model`, `--json-output`) for CI/automated installations
- "Open VS Code" button on completion page

**Phase 8 -- Golden Task Suite & Integration Stabilization**
- Golden task evaluation framework with YAML-based task definitions
- 24 golden tasks across 5 categories: multi-file edits (5), bug fixes (5), refactors (5), test generation (5), code review (4)
- Per-model-tier benchmark suite (E2B, E4B, 26B, 31B) measuring TTFT p50/p99 and throughput
- Memory recall accuracy benchmarks (keyword and semantic search) with latency targets
- Regression detection with baseline comparison (pass/fail flips, time, tokens, iterations, pass-rate drop)
- Cross-platform installer smoke tests (Windows, macOS, Linux)
- End-to-end integration tests for core v0.2.0 + v0.3.0 composition (full mocks)
- v0.2.0 vs v0.3.0 performance comparison framework

### Changed

- Installer technology changed from NSIS (Windows-only) to PyQt5 (cross-platform)
- Old NSIS installer preserved under `scripts/installer/legacy/`

### Known Limitations

- macOS .dmg is not notarized (requires Apple Developer account)
- Linux AppImage requires FUSE to run on some distributions
- Golden tasks require a running Ollama instance; CI uses E2B on CPU which is slower
- GPU detection may not work in virtualized environments (CI runners)

---

## [0.2.0] -- 2026-04-10

Major architectural evolution: Gemma 4 native protocol, dynamic prompt engineering, persistent cross-session memory, multi-strategy compaction, MCP interoperability, and sub-agent orchestration.

### Added

**Phase 0 -- Gemma 4 Native Protocol**
- Gemma 4 native tool calling via `<|tool_call>`, `<|tool_result>`, `<|tool>` tokens (replaces custom XML `<tool_call>` protocol)
- Gemma 4 native system role via `<|turn>system` token (removes Gemma 3 system-to-user workaround)
- Thinking mode via `<|think|>` token for chain-of-thought reasoning
- `Gemma4ToolFormat` parser with `<|"|>` string delimiter handling and code fence exclusion

**Phase 1 -- Dynamic PromptBuilder**
- `PromptBuilder` class assembling system prompt sections conditionally within a token budget
- Section-based architecture with priority ordering and greedy packing (always-include sections first, then conditional by ascending priority)
- `PromptBudget` calculator: system 10%, memory 3%, skills 2%, conversation 65%, response 20%
- `promptStyle` setting: `concise` (default), `detailed`, or `beginner`
- `systemPromptBudgetPercent` setting for custom budget tuning

**Phase 2 -- Multi-Strategy Context Compaction**
- 5-strategy compaction pipeline applied in cost order (cheapest first):
  1. ToolResultClearing -- strip old `<|tool_result>` blocks, keep N most recent
  2. SlidingWindow -- drop middle messages, preserve first + last N + summaries
  3. CodeBlockTruncation -- replace large code blocks (>80 lines) with placeholders
  4. LlmSummary -- structured summary preserving file paths, decisions, errors
  5. EmergencyTrim -- hard clip as last resort
- Pre-compaction hook for memory extraction before lossy operations
- `compactionKeepRecent` and `compactionToolResultsKeep` settings

**Phase 3 -- Persistent Memory System**
- SQLite FTS5 keyword search for cross-session memory (zero new dependencies)
- Optional Ollama embeddings (`nomic-embed-text`) for semantic search
- 5 memory types: decision, fact, preference, file_pattern, error_resolution
- Auto-extraction of memories during compaction via pre-compaction hooks
- Token-budgeted memory injection into system prompt (3% of context window)
- `/memory` slash command with search, save, clear, and status subcommands
- `memoryEnabled`, `embeddingModel`, `memoryAutoSaveInterval`, `memoryMaxEntries` settings

**Phase 4 -- Conditional Tool Activation and MCP**
- Context-dependent tool enable/disable via `ToolActivationRules`
- 15-tool cap for reliable Gemma 4 tool calling; lowest-priority tools dropped when exceeded
- Activation rules: Ollama reachability, network availability, read-only sessions, sub-agent type
- MCP client: connect to external MCP servers, discover and register tools
- MCP server: expose Gemma Code tools via stdio protocol (opt-in)
- `McpManager` lifecycle management with config from `~/.gemma-code/mcp.json`
- `/mcp` slash command with status, connect, and disconnect subcommands
- `mcpEnabled` and `mcpServerMode` settings

**Phase 5 -- Sub-Agent Orchestration**
- Verification sub-agent: auto-triggers after 3+ file edits (configurable), reviews changes for bugs, runs relevant tests
- Research sub-agent: gathers information using read-only tools + web search; triggered via `/research <query>`
- Planning sub-agent: decomposes complex tasks into numbered implementation steps
- Isolated execution: each sub-agent gets its own ConversationManager, AgentLoop, and ToolRegistry with scoped tools
- Sub-agent results injected into main conversation as advisory messages
- `/verify` and `/research` slash commands for manual sub-agent triggering
- `verificationEnabled`, `verificationThreshold`, `subAgentMaxIterations` settings
- Webview status banner with spinner showing active sub-agent type

**Phase 6 -- Integration and Documentation**
- Python backend aligned with multi-strategy compaction (tool-result clearing + sliding window)
- Python backend accepts dynamic `system_prompt` parameter
- Webview UI indicators for memory status, MCP connection, sub-agent progress, and thinking mode
- `SECURITY.md` with vulnerability disclosure policy (48h ack, 7-day critical fix)
- `ARCHITECTURE.md` root-level architecture overview
- Full architecture documentation at `docs/v0.2.0/architecture.md`

### Changed

- Default model changed from `gemma4` to `gemma4:e4b` (explicit variant selection)
- Default `maxTokens` increased from 32768 to 131072 (Gemma 4 E4B 128K context)
- Default `temperature` changed from 0.2 to 1.0 (Gemma 4 recommended sampling)
- Added `topP` (0.95) and `topK` (64) sampling parameters (Gemma 4 recommended)
- Tool protocol migrated from custom XML to Gemma 4 native tokens
- System prompt changed from static constant to dynamic `PromptBuilder` assembly
- Context compaction upgraded from single LLM summary to 5-strategy pipeline
- Python backend `prompt.py` updated for Gemma 4 turn tokens and dynamic system prompt parameter
- Fixed bug in Python backend where `request_timeout` was passed as `max_tokens`

### Known Limitations

- MCP support is experimental; only stdio transport is implemented
- Sub-agents run sequentially on a single GPU; each sub-agent adds 10-30 seconds of latency
- Semantic memory search requires pulling `nomic-embed-text` (274 MB); falls back to keyword-only search without it
- E2B model variant may not reliably follow complex agentic instructions; sub-agents are most effective on E4B or larger
- macOS and Linux installer scripts are still not implemented

---

## [0.1.0] — 2026-04-07

First stable release of Gemma Code — a fully offline, agentic coding assistant for VS Code powered by Google's Gemma 4 via Ollama.

### Added

**Phase 1 — Extension Skeleton & Ollama Client**
- VS Code extension scaffold with TypeScript, tsconfig, ESLint, and Vitest
- `OllamaClient` with streaming chat support (`streamChat`), health check (`checkHealth`), and model listing (`listModels`)
- Extension activation/deactivation lifecycle with an Output channel ("Gemma Code")
- `gemma-code.ping` command for verifying Ollama connectivity
- Unit tests for the Ollama client; integration smoke test for live Ollama health checks

**Phase 2 — Chat Engine & Streaming UI**
- `ConversationManager` maintaining ordered message history with token-count trimming and `onDidChange` events
- Webview chat panel (`GemmaCodePanel`) registered as a VS Code sidebar view
- Bidirectional postMessage protocol between extension host and webview
- Streaming token pipeline: each Ollama chunk is relayed to the webview in real time
- Vanilla TypeScript webview UI with streaming bubbles, Shift+Enter newlines, and auto-scroll
- Retry on stream failure within the first 3 tokens

**Phase 3 — Agentic Tool Layer**
- Tool-call protocol: model emits `<tool_call>` XML blocks; extension parses, executes, and injects `<tool_result>` messages
- Tool handlers: `read_file`, `write_file`, `create_file`, `delete_file`, `edit_file`, `list_directory`, `grep_codebase`, `run_terminal`, `web_search`, `fetch_page`
- Path traversal protection on all file system tools (workspace-root boundary check)
- `ConfirmationGate` for user-approved tool execution (edit and terminal)
- `AgentLoop` with configurable `maxAgentIterations` (default 20) and stop-signal on overflow
- Tool progress indicators in the webview ("Using tool: …")
- Web search via DuckDuckGo HTML endpoint (no API key required)

**Phase 4 — Skills, Commands & DevAI-Hub Integration**
- `SkillLoader` parsing SKILL.md frontmatter; hot-reloads from `~/.gemma-code/skills/`
- Built-in skill catalog: `commit`, `review-pr`, `generate-readme`, `generate-changelog`, `generate-tests`, `analyze-codebase`, `setup-project`
- `CommandRouter` parsing slash commands and routing to built-in handlers or skill executor
- Built-in commands: `/help`, `/clear`, `/history`, `/plan`, `/compact`, `/model`
- Inline autocomplete popup for slash commands in the webview chat input
- `PlanMode` with numbered-plan detection heuristic and step-by-step approval workflow

**Phase 5 — Advanced UX Features**
- SQLite-backed chat history (`ChatHistoryStore`) with session create/save/list/search/delete
- `/history` command showing past sessions; click to resume
- `ContextCompactor` with 80%-threshold auto-compact and `/compact` command
- Token count indicator in the webview header (X / Y tokens, colour-coded)
- Three edit modes: Auto, Ask (diff editor + confirmation), Manual (display only)
- Edit mode selector in the webview header
- Markdown rendering with `marked` and syntax highlighting with `highlight.js` (both bundled, no CDN)
- Code block "Copy" button and collapsible tool-result blocks
- Incremental streaming render: raw text during stream, full Markdown after completion

**Phase 6 — Python Backend & Inference Optimisation**
- FastAPI backend (`src/backend/`) with `/health`, `/models`, and `/chat/stream` (SSE) endpoints
- Gemma chat template formatting (`<start_of_turn>user … <end_of_turn>`) applied server-side
- `BackendManager` in TypeScript: auto-starts the Python process on activation, falls back to direct Ollama on failure
- `gemma-code.useBackend`, `gemma-code.backendPort`, and `gemma-code.pythonPath` settings

**Phase 7 — Installer & Distribution**
- VSIX build pipeline (`scripts/build-vsix.ps1`) producing `gemma-code-0.1.0.vsix`
- NSIS installer script (`scripts/installer/setup.nsi`) for Windows 10/11
  - Installs Ollama silently if not present
  - Installs the VSIX via `code --install-extension`
  - Sets up a Python virtual environment for the backend
  - Optional Gemma model download with progress display
  - Adds Start Menu shortcut and Add/Remove Programs entry
  - Uninstaller removes the venv and VS Code extension
- GitHub Actions workflows: `ci.yml` (lint + test + coverage gate), `release.yml` (VSIX + installer + GitHub Release), `nightly.yml` (integration tests + benchmarks)
- CI documentation in `docs/v0.1.0/ci-setup.md`
- E2E smoke test verifying the extension loads in VS Code without a running Ollama instance

**Phase 8 — Hardening, CI/CD & Release**
- Global `unhandledRejection` handler in `extension.ts` — logs to the Output channel instead of crashing the extension host
- Ollama availability poller: polls every 5 seconds; posts a recovery notification when Ollama comes back online; posts an error banner when it goes offline
- Startup health check with actionable error messaging and a "Pull model" quick action
- SSRF protection in `FetchPageTool`: rejects localhost, loopback, link-local, and all RFC-1918 private IP ranges; blocks non-HTTP(S) schemes
- Terminal blocklist hardening: blocklist now checks every shell-metacharacter-separated segment to prevent chain-bypass attacks
- `GemmaCodePanel.postStatus()` and `postError()` public methods for external error signalling
- Python backend crash detection with VS Code notification and graceful fallback to direct Ollama
- Performance benchmark suite: `time-to-first-token`, `context-compaction`, `tool-execution`, `skill-loading`, `markdown-rendering` — all integrated into nightly CI
- Security audit documentation (`docs/v0.1.0/security-audit.md`) with findings and remediations
- Performance benchmark documentation (`docs/v0.1.0/performance-benchmarks.md`)
- Architecture documentation (`docs/v0.1.0/architecture.md`) with component descriptions and data-flow diagrams
- Comprehensive README with installation guide, quick start, configuration reference, and troubleshooting section
- Error regression tests in `tests/unit/errors/`

### Changed

- Default model switched from `gemma3:27b` to `gemma4` (Gemma 4 e4b, 128K context, native function calling)
- Default `maxTokens` increased from 8192 to 32768 to take advantage of Gemma 4's larger context window
- Ollama requests now pass `num_ctx` and `temperature` options to the server for consistent context handling
- Nightly CI uses `gemma4:e2b` (smallest Gemma 4 variant) instead of `gemma3:2b`
- Windows installer model download updated to `gemma4` (~9.6 GB, down from ~15 GB for gemma3:27b)
- Removed duplicate `configs/eslint.config.mjs` (dead file; canonical ESLint config is at project root)

### Known Limitations

- The Rust performance components and Go CLI tooling described in the tech stack are placeholders for future phases; v0.1.0 uses TypeScript and Python only.
- The GrepCodebaseTool uses VS Code's `workspace.findFiles` API and may be slow on very large repositories (>10 000 files). A ripgrep-based implementation is planned.
- The web search tool fetches DuckDuckGo's HTML endpoint; result quality varies and the endpoint is rate-limited by IP.
- macOS and Linux installer scripts are not yet implemented; manual VSIX installation is required on non-Windows platforms.
- The E2E test suite requires a VS Code instance and is not run in the standard CI matrix; it runs manually or in the nightly workflow.

[Unreleased]: https://github.com/bendourthe/Gemma-Code/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/bendourthe/Gemma-Code/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/bendourthe/Gemma-Code/releases/tag/v0.1.0
