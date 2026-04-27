# [0.6.0](https://github.com/bendourthe/Gemma-Code/compare/v0.5.5...v0.6.0) (2026-04-27)


### Features

* **v0.6.0:** security chain closure (Phase 1) ([4ddcec0](https://github.com/bendourthe/Gemma-Code/commit/4ddcec0d4ddee6b9271907956bda0575e6cc381b))

## [0.5.5](https://github.com/bendourthe/Gemma-Code/compare/v0.5.4...v0.5.5) (2026-04-27)


### Bug Fixes

* **ci:** regenerate docs/index.md after SessionListPanel import change ([9e86640](https://github.com/bendourthe/Gemma-Code/commit/9e86640c9f70f51a6ed28afeed2532afd2999c0a))

## [0.5.4](https://github.com/bendourthe/Gemma-Code/compare/v0.5.3...v0.5.4) (2026-04-27)


### Bug Fixes

* **ci:** drop Node 18 from matrix; bump engines.node to >=20 ([ad39bc1](https://github.com/bendourthe/Gemma-Code/commit/ad39bc1e7bf9fa75f4c7640fa5166495dd6e65ed)), closes [#77](https://github.com/bendourthe/Gemma-Code/issues/77)

## [0.5.3](https://github.com/bendourthe/Gemma-Code/compare/v0.5.2...v0.5.3) (2026-04-26)


### Bug Fixes

* **release:** wire @semantic-release/npm so package.json version bumps ([d0e4017](https://github.com/bendourthe/Gemma-Code/commit/d0e4017fcf2fef2f1d65650bbf08333edbf6ca70))
* **tests:** rewrite token-estimation tests for tiktoken ([4b4840e](https://github.com/bendourthe/Gemma-Code/commit/4b4840e698794a52441afd77bc9531e5cce389b8))

## [0.5.2](https://github.com/bendourthe/Gemma-Code/compare/v0.5.1...v0.5.2) (2026-04-26)


### Bug Fixes

* **ci:** collapse duplicate CI runs on Dependabot PRs ([725d78c](https://github.com/bendourthe/Gemma-Code/commit/725d78ced581ead5955635eb5cf098ba3fe4e3e5))

## [0.5.1](https://github.com/bendourthe/Gemma-Code/compare/v0.5.0...v0.5.1) (2026-04-26)


### Bug Fixes

* **ci:** sync package-lock.json and unblock Dependabot ([d4bdcfd](https://github.com/bendourthe/Gemma-Code/commit/d4bdcfddaa6e33f54a3ed5098c7942ea6f12c22e)), closes [#7](https://github.com/bendourthe/Gemma-Code/issues/7)
* **ci:** unblock semantic-release and drop opaque npm ci --silent ([6e3c1c4](https://github.com/bendourthe/Gemma-Code/commit/6e3c1c4dd4de188380ad0233c670e3bca0d3166e))
* **deps:** split Dependabot major-version updates from minor groups ([c087d8c](https://github.com/bendourthe/Gemma-Code/commit/c087d8c4f61316ee7a37f92a52880978dbf212cb)), closes [#7](https://github.com/bendourthe/Gemma-Code/issues/7)

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

## [0.5.0] -- 2026-04-26

Unified adoption release. Combines five comparison-driven adoption plans (token-optimizer-mcp, agent-friendly-CLIs, routa-harness, free-claude-code, foundry-vault) into a coherent dozen-phase roadmap. The product surface stays the same (offline VS Code extension on top of Gemma 4 via Ollama); the changes are inside the harness, the tool catalogue, the cache stack, and the operational hygiene.

### Phase 1 -- Identity and Naming

- AGENTS.md adopted as the sole canonical directive; no CLAUDE.md anywhere in the repo
- Test-pyramid taxonomy split into "smoke" / "regression" / "scenario" with the rubric in [docs/v0.5.0/test-pyramid.md](./docs/v0.5.0/test-pyramid.md)
- Generic naming convention applied across product files (no provider branding)

### Phase 2 -- Tool Surface Hardening

- Universal 64 KB byte-cap on every tool output via `OutputRedirector` with a structured truncation hint pointing at narrow-down parameters
- `read_file(range_start, range_end)` pagination (1 MB max window; EOF marker on short reads)
- `grep_codebase(max_results, next_offset)` pagination with opaque base64-encoded cursor; default 50 / max 500
- Per-call `max_bytes` override (per-tool ceiling 1 MB)
- `tool_output.truncated` metric on `MetricsCollector` for cap-fire calibration

### Phase 3 -- Compression Foundation

- Brotli-backed `Compressor` for cache and transcript payloads
- Round-trip fidelity tests for ASCII / emoji / CJK / JSON / binary fixtures
- Transcript integration: tool outputs > 12 KB serialize to disk compressed

### Phase 4 -- Persistent Cache + Diff-Based Reads

- `ToolOutputCache` (SQLite, chmod 0o600) keyed by `(absolute_path, mtime_ms, size_bytes)`
- In-process LRU front (50 entries / 1 MB) for within-session re-reads
- Diff-based read on cache hit when on-disk file changed
- Secret-path denylist applied on every `store()`
- `/cache status|clear|prune` slash command surface

### Phase 5 -- Semantic Recall + Precise Budgeting

- tiktoken-backed budgeting on prompt construction (replaces character-count heuristic)
- Embedding column on `tool_output_cache` rows; cosine search via `searchByEmbedding`
- FTS5 keyword fallback when Ollama is offline; `excerpt` column backfilled by migration
- Default semantic threshold 0.85; sub-task `searchByKeyword` fallback path

### Phase 6 -- Mutation Safety + Structured Outputs

- `run_terminal(dry_run=true)` returns token list + allowlist verdict without spawning
- `delete_file(dry_run=true)` returns size + SHA-256 (first 1 MB) without unlinking
- `list_directory(format='json')` and `grep_codebase(format='json')` return RFC-8259 JSON; truncated form remains valid JSON
- Adversarial property-based test confirms `child_process.spawn` and `fs.unlinkSync` are never called on dry-run

### Phase 7 -- Memory Hygiene + N-Corroboration

- `MemoryConsolidator` enforces N >= 2 corroboration before promoting an observation to a fact (default `gemma-code.memoryCorroborationThreshold = 2`; setting to 1 restores legacy behavior)
- Migration backfills `corroboration_count = 1` on every existing row
- `/memory lint` produces a parseable health report (counts, candidate rows, top corroborated)
- New missed-fact golden eval `memory-hygiene-missed-fact-01` proves single-source candidates are not blindly trusted

### Phase 8 -- Generic Harness + Specialist Externalization

- Three generic Node ESM hook scripts under `scripts/hooks/` (`check-commit-msg.mjs`, `check-prompt-policy.mjs`, `check-tool-permission.mjs`); harness-agnostic by design
- Sub-agent prompts externalized to `assets/specialists/*.md` and resolved through a priority chain (`<workspace>/.gemma-code/specialists/` overrides workspace, which overrides committed defaults)
- No `.claude/` directory committed to the repository
- Characterization tests prove behavior preservation against the pre-Phase-8 inline prompts

### Phase 9 -- Coverage and Observability

- `tests/benchmarks/` covers `tool-execution`, `context-compaction`, `cache-hit`, `hooks` with p50/p99 captures
- Nightly benchmark regression gate via `scripts/check-bench-regressions.mjs` against committed baselines
- `scripts/build-vsix.ps1` smoke-tests the packaged VSIX before tagging

### Phase 10 -- Local Development Hygiene + CI Hardening

- husky pre-commit (`lint-staged`) + commit-msg (ASCII-only enforcement) wired
- ESLint blocks un-justified `@ts-ignore` (allow-with-description, 20-char min)
- All GitHub Actions pinned to commit SHAs (40-char hex, version-tag preserved as a comment)
- `concurrency: cancel-in-progress` on long-running workflows
- CI matrix expanded to Node 18, 20, 22

### Phase 11 -- Documentation Discipline

- 4 new ADRs landed: 0002 memory subsystem layering, 0003 compaction strategy ordering, 0004 sub-agent isolation contract, 0005 tool permission tiers
- Mermaid module-dependency diagram in [ARCHITECTURE.md](./ARCHITECTURE.md)
- Module Authorship Contract in [AGENTS.md](./AGENTS.md)
- [docs/refactor-playbook.md](./docs/refactor-playbook.md) published; cross-referenced from CONTRIBUTING.md
- [docs/index.md](./docs/index.md) auto-generated by `scripts/generate-catalog.mjs`; CI gate via `npm run catalog:check`

### Phase 12 -- Advanced Fallbacks + Release Gate

**Eviction strategies (`src/storage/eviction/`)**
- New pluggable `Evictor` interface with five pure-JS strategies: `LRUEvictor` (default; preserves v0.4.0 behavior), `LFUEvictor`, `ARCEvictor` (adaptive recency/frequency split), `WTinyLFUEvictor` (window LRU + count-min sketch admission), `ClockEvictor` (second-chance approximation)
- Selectable via `gemma-code.cacheEvictionStrategy` (default `lru`)
- `ToolOutputLru` threads the strategy through `onAccess` / `onInsert` / `onRemove` / `pickVictim` so the storage Map and the policy stay decoupled
- Per-strategy unit tests under `tests/unit/storage/eviction/`

**Predictive cache (`src/storage/PredictiveCache.ts`)**
- Pure-JS ARIMA(1,0,1) forecaster fit by gradient descent; ~80 LOC core
- Tracks per-path access timestamps (max 256 paths, 64 samples each)
- `predict(topK)` ranks paths by inverse predicted-arrival-delta, weighted by residual variance
- LSTM is **explicitly out of scope** -- not a model, not a toggle, not a future flag
- Off by default; opt-in via `gemma-code.predictiveCacheEnabled`

**Heuristic embedder fallback (`src/storage/HeuristicEmbedder.ts`)**
- Deterministic 128-D embedding from hash features (21 dims) + statistical features (43 dims) + n-gram presence over a 64-token vocabulary (64 dims)
- L2-normalised; pure JS; no model file
- Wired into `EmbeddingClient.embedWithProvenance` -- callers receive `{ embedding, provenance: 'ollama' | 'heuristic' }`
- `tool_output_cache.embedding_provenance` column added (migration); rows tagged `'heuristic'` are upgradable
- New `/cache reembed` slash command walks heuristic-tagged rows and re-embeds them via Ollama once the model is back online

**Truncation-recovery golden micro-eval**
- 3 new golden tasks under `tests/golden/tasks/agent-friendly-*.yaml`
  - `agent-friendly-truncation-recovery-read-01` -- `read_file(range_start, range_end)` past the 64 KB cap
  - `agent-friendly-truncation-recovery-grep-02` -- `grep_codebase(next_offset)` paging through > 200 matches
  - `agent-friendly-dry-run-then-execute-03` -- `delete_file(dry_run=true)` before the destructive call
- Snapshots include deterministic `_setup.mjs` generators so fixtures stay reproducible
- Baseline at [tests/golden/baselines/v0.5.0+agent-friendly.json](./tests/golden/baselines/v0.5.0+agent-friendly.json)

**semantic-release + commitlint**
- [commitlint.config.cjs](./commitlint.config.cjs) extending `@commitlint/config-conventional` (allowed types: feat, fix, chore, docs, refactor, test, ci, build, perf, revert, style)
- [.releaserc.json](./.releaserc.json) plugin chain: `commit-analyzer -> release-notes-generator -> changelog -> git -> github` (deliberately no `@semantic-release/npm` because Gemma is a VSIX, not an npm package)
- New workflows: [.github/workflows/commitlint.yml](./.github/workflows/commitlint.yml) (PR commits) and [.github/workflows/semantic-release.yml](./.github/workflows/semantic-release.yml) (push to main)
- New devDependencies: `@commitlint/cli`, `@commitlint/config-conventional`, `@semantic-release/changelog`, `@semantic-release/git`, `@semantic-release/github`, `semantic-release`

**Release artifacts**
- `package.json` version bumped to 0.5.0
- This CHANGELOG entry
- [docs/v0.5.0/architecture.md](./docs/v0.5.0/architecture.md) describing the v0.5.0 architecture
- v0.5.0 git tag prepared (push deferred to explicit user confirmation)

### Deferred / Out of Scope

The following are recorded for v0.6.0+: LSTM predictive caching (hard constraint), multi-provider LLM proxy, voice transcription, distributed cache, `/memory prune` and `/memory lint --apply`, auto-merge for Dependabot, `format=json` on `read_file` and `run_terminal`. See [docs/v0.5.0/plans/implementation-plan.md](./docs/v0.5.0/plans/implementation-plan.md) "Out of Scope" section for the full table.

---

## [0.4.0] -- 2026-04-22

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
