# Phase 4 -- Observability, runtime, and hybrid scoring

**Date**: 2026-05-16
**Plan reference**: [docs/archive/versions/v0/v0.8.0/plans/v0.8.0-cycle.md](../../plans/v0.8.0-cycle.md) Phase 4
**Status**: complete

## Summary

Phase 4 lands the observability + runtime + hybrid-scoring slice of v0.8.0. It ships a single `/trace` bug-report file primitive that unifies the existing `Tracer` and `OperationLog` event surface into one redacted JSONL dump, a second `LLMClient` adapter for LM Studio with auto-detect on macOS, a pure-module Gemma 4 channel parser, three sampler-preset thinking modes (`nothink` / `think` / `think-max`) with budget-aware downgrade, a locked-prefix system-prompt ordering with a byte-stability property test, hybrid reciprocal-rank-fusion (RRF) memory scoring layered on top of the existing HNSW index, and the evaluator-rubric + session-handoff/progress template family for `/wrap-up-session`. All seven sub-tasks landed with passing unit tests, clean lint, and a clean build.

## Sub-tasks completed

### 4.1 -- Single `/trace` bug-report file primitive (item G3)

- Created [src/observability/TraceFile.ts](../../../../versions/src/observability/TraceFile.ts) exposing `enable(path?, sessionId?)`, `disable()`, `append(event)`, `dump(targetPath)`, `clear()`, `stats()`, and a `defaultTracePath(sessionId)` helper. The active file is JSONL (one event per line) and the default location is `~/.gemma-code/trace/<sessionId>.jsonl`. Lives outside the workspace so multiple workspaces do not clobber one another.
- Redaction runs before every write. Three layers: (1) keys matching `password|token|secret|api_key|authorization|bearer` collapse to `<redacted>`; (2) string values that look like paths are passed through `matchesSecretPath` (the canonical `secretPaths.ts` denylist); (3) embedded env-style secrets (`API_KEY=...`) replace just the value with `<env=<redacted>>`. Nested objects and arrays recurse.
- Wired `GemmaRuntime` to own the singleton instance and added `gemma-code.trace.autoEnable` (default off) so users who want the file present at session start can opt in.
- Added the `/trace <enable|disable|dump|clear|status> [path]` slash command -- `BuiltinCommandName` union widened, `CommandRouter` descriptors extended, and `ChatCommandHandlers._handleTrace` dispatches to the runtime's `TraceFile`.
- Added [tests/unit/observability/TraceFile.test.ts](../../../../versions/tests/unit/observability/TraceFile.test.ts) (10 cases covering enabled-state gating, JSONL line shape, three redaction modes, dump round-trip, dump-without-enable error, clear idempotency, stats reporting, and the default-path placement).

### 4.2 -- LM Studio as second `LLMClient` adapter (item F1)

- Created [src/llm/LmStudioClient.ts](../../../../versions/src/llm/LmStudioClient.ts) implementing the existing `LLMClient` port against LM Studio's OpenAI-compatible REST surface (`/v1/chat/completions`, `/v1/embeddings`, `/v1/models`). The stream parser handles SSE frames: `data: {...}` lines, terminated by `data: [DONE]`, with malformed lines silently skipped so a single corrupt frame does not abort the stream. `probeLmStudio(baseUrl, timeoutMs)` exposes the auto-detect ping.
- Updated [src/runtime/GemmaRuntime.ts](../../../../versions/src/runtime/GemmaRuntime.ts) so `getOllamaClient()` (kept-named for compatibility) resolves the backend per the new `gemma-code.llm.backend` setting. `"auto"` picks LM Studio on macOS (`process.platform === "darwin"`) and Ollama elsewhere. The client is cached per `(backend, ollamaUrl, lmStudioBaseUrl, requestTimeout)` so a settings change invalidates cleanly.
- Added settings: `gemma-code.llm.backend` (`"ollama"|"lmstudio"|"auto"`, default `"ollama"`) and `gemma-code.lmstudio.baseUrl` (default `http://127.0.0.1:1234`). Loopback-only by design -- ADR-0016 documents the local-only-thesis preservation.
- Wrote [docs/adr/0016-second-llm-backend.md](../../../../versions/v0/adr/0016-second-llm-backend.md) capturing the decision, alternatives (drop / replace / auto-only), and consequences. The omlx third backend is explicitly deferred to v0.9.0 per the plan.
- Added [tests/unit/llm/LmStudioClient.test.ts](../../../../versions/tests/unit/llm/LmStudioClient.test.ts) (7 cases: `checkHealth` ok/non-ok, `listModels` shape mapping, `embed` happy path, `embed` 404 -> `available: false`, SSE delta-frame parsing, and the `probeLmStudio` unreachable path). All cases use `vi.fn` against `globalThis.fetch` so they run without a live LM Studio server.

### 4.3 -- Gemma 4 channel parser (item F3)

- Created [src/llm/Gemma4Parser.ts](../../../../versions/src/llm/Gemma4Parser.ts) -- a pure parsing module with no runtime dependencies. Apache-2.0-clean rewrite -- no code lines are copied from `omlx/adapter/gemma4.py`. Two exports: `parseChannel(text) -> {visible, thought, toolResponse?}` strips `<|channel>thought ... <channel|>`, `<|tool_response> ... <tool_response|>`, `<turn|>`, `<start_function_call>`, and legacy `<think> ... </think>` blocks; `stripLeadingThinkBlocks(text)` is the focused helper for `ConversationManager.replayForCompaction`.
- Wiring into `StreamingPipeline._attemptStream` and `ConversationManager.replayForCompaction` is **deferred to v0.9.0** (logged as 10.O.K). Reason: wiring the parser into the streaming hot path before LM Studio stream parity tests land risks regressing the existing Ollama path. Phase 4 commits the pure module and full test coverage; the wiring lands alongside the broader compaction-prompt refactor.
- Added [tests/unit/llm/Gemma4Parser.test.ts](../../../../versions/tests/unit/llm/Gemma4Parser.test.ts) (10 cases: pass-through, `<think>` block extraction, channel-format thought spans, tool-response capture, dangling-token strip, empty input, multi-thought aggregation, `stripLeadingThinkBlocks` leading-block / all-blocks / empty-input).

### 4.4 -- Per-model sampler presets + thinking modes (items F4 / F5 / E4)

- Created [src/config/SamplerPresets.ts](../../../../versions/src/config/SamplerPresets.ts) exporting `SAMPLER_PRESETS` for the three modes plus `resolvePresetForBudget(mode, contextBudget)` and `parseThinkingMode(raw)`. Preset values: `nothink` = temp 0.7, top_p 0.95, top_k 64, no reasoning; `think` = temp 0.6, top_p 0.95, top_k 20, reasoning enabled (Qwen / jola tuned); `think-max` = `think` values + 32K max output budget. `resolvePresetForBudget` auto-downgrades `think-max` to `think` when the context budget is below 64K so prompt assembly never blows past `num_ctx`.
- Defined a `PerModelLimits` interface in the same file (`tools`, `reasoning`, `maxTokens`, `thinkingFormat`) so per-model config maps can carry the four fields the comparison report calls out. Consumption is staged: Phase 4 ships the schema and the presets; the integration into the request-build path is exercised through `/thinking-mode` and the existing `LLMOptions` flow.
- Added the `/thinking-mode <nothink|think|think-max>` slash command. Without args it prints the active preset plus the catalog; with an arg it updates the `gemma-code.thinkingModePreset` setting via `vscode.workspace.getConfiguration("gemma-code").update`. Setting widened in `src/config/settings.ts` and `package.json` `contributes.configuration`.
- Added [tests/unit/config/SamplerPresets.test.ts](../../../../versions/tests/unit/config/SamplerPresets.test.ts) (9 cases covering the three preset value tables, budget-driven downgrade behaviour, parser case-insensitivity, and unrecognised-input handling).

### 4.5 -- Prefix-aware system-prompt construction (item F7)

- Ratified the locked-prefix invariant in a class-level comment on `PromptBuilder`. Priorities 0..5 (identity, tools, frozen file-memory-pre, plan-mode capabilities, sub-agent directive) form the stable prefix; priorities >=15 are variable per turn. Plan-mode capabilities priority moved from 10 to 3 so they sit inside the locked prefix when plan mode is active.
- Added [tests/unit/chat/PromptBuilder.prefix.test.ts](../../../../versions/tests/unit/chat/PromptBuilder.prefix.test.ts) (3 cases: byte-stability of the first 50% of the prompt across two builds with different `memoryContext`; identity precedes tool declarations which precede plan-mode which precedes recalled-memory; the substring up to `<tool|>` is identical across three builds that differ only in `memoryContext`).
- No `architecture.md` or ADR-0014 cross-ref update was required because v0.7.0 Phase 2 already documented the section order; Phase 4 only locks it explicitly in code.

### 4.6 -- Hybrid RRF memory scoring + why-retrieved (items A5 / A6)

- Created [src/storage/HybridRanker.ts](../../../../versions/src/storage/HybridRanker.ts) as a pure fusion module. Inputs: `VectorCandidate[]` (HNSW or linear-scan source) and `LexicalCandidate[]` (FTS5 BM25). Output: `RankedEntry[]` with `entry`, `score`, `reason: readonly string[]`. Two fusion methods: `rrf` (default, k=60) and `weighted` (50/30/20 vector/lexical/recency). Recency is an exponential decay from `entry.accessedAt` with a 7-day half-life.
- Wired `HybridRanker` into `MemoryStore` via a new `searchHybrid(query, limit, method)` method. The existing `retrieve` / `searchKeyword` / `searchSemantic` paths are unchanged so v0.7.0 callers see no behaviour drift. The v0.9.0 default flip is logged as 10.O.M.
- Widened `MemorySearchResult.matchSource` union to include `"hybrid"` and added optional `reason: readonly string[]`. Widened `MemorySnapshotMessage.sqlMemories[]` with optional `reason` and `matchSource` so the MemoryPanel webview can surface a "why retrieved" affordance.
- Wrote [docs/adr/0018-hybrid-scoring-over-hnsw.md](../../../../versions/v0/adr/0018-hybrid-scoring-over-hnsw.md) documenting why we don't replace HNSW -- it's the vector retrieval engine, RRF is the fusion layer.
- Added [tests/unit/storage/HybridRanker.test.ts](../../../../versions/tests/unit/storage/HybridRanker.test.ts) (7 cases: empty-input, RRF fuses-above-singletons, every-result-has-reason property test, weighted 50/30/20 sum, recency half-life decay, ranking determinism, limit-respect) and [tests/unit/storage/MemoryStore.searchHybrid.test.ts](../../../../versions/tests/unit/storage/MemoryStore.searchHybrid.test.ts) (4 cases: empty-query, fusion produces hybrid results with reasons, limit-respect, weighted method).

### 4.7 -- Evaluator-rubric template + handoff/progress split (items C4 / C5)

- Created [docs/archive/versions/v0/v0.8.0/review/evaluator-rubric.md](../../review/evaluator-rubric.md) with 15 criteria across 5 categories (Correctness, Architecture, Verification, Documentation, Operability), each scored 1-5 with anchored descriptions and a per-category average.
- Created [docs/archive/versions/v0/v0.8.0/review/quality-document.md](../../review/quality-document.md) mapping the rubric overall average to an A-F letter grade plus three-strengths / three-risks fields.
- Created [src/chat/SessionDocs.ts](../../../../versions/src/chat/SessionDocs.ts) exporting `renderSessionHandoff`, `renderSessionProgress`, and `writeSessionDocs(docsRoot, version, sessionId, handoff, progress)`. The writer emits both `session-handoff.md` (forward-looking carryover) and `session-progress.md` (chronological log) under `docs/<version>/development/<sessionId>/`. The split mirrors hermes-agent's separation of "what next" from "what happened" so the next session's first prompt lifts off the handoff alone.
- Added [tests/unit/chat/SessionDocs.test.ts](../../../../versions/tests/unit/chat/SessionDocs.test.ts) (3 cases: structured handoff markdown, empty-list fallback for progress, both-files written end-to-end).

## Tests added

| Test file | Cases |
|-----------|-------|
| `tests/unit/observability/TraceFile.test.ts` | 10 |
| `tests/unit/llm/LmStudioClient.test.ts` | 7 |
| `tests/unit/llm/Gemma4Parser.test.ts` | 10 |
| `tests/unit/config/SamplerPresets.test.ts` | 9 |
| `tests/unit/storage/HybridRanker.test.ts` | 7 |
| `tests/unit/storage/MemoryStore.searchHybrid.test.ts` | 4 |
| `tests/unit/chat/PromptBuilder.prefix.test.ts` | 3 |
| `tests/unit/chat/SessionDocs.test.ts` | 3 |
| **Total** | **53** |

## Gate results

- `npm run lint` -- clean.
- `npm run build` -- clean.
- New unit suite -- 53/53 pass.
- Full `npm run test` -- no new failures; pre-existing carryovers (10.O.D, 10.O.E) and Windows-only segfault during teardown (10.O.N) carry forward.

## Known gaps added in Phase 4

See [docs/archive/versions/v0/v0.8.0/known-gaps.md](../../known-gaps.md) Section 10.1 entries 10.O.J through 10.O.N.

## Next phase

Phase 5 -- Skill ecosystem maturation: per-skill metrics, curator background-worker with dry-run + rollback, AST-scanned tool registry, `.gemma.md` git-root walk, shell-hook stdin-JSON protocol, pre-tool compressor, single test runner, prompt linter. Closes v0.7.0 known-gap items 10.O.5 and 10.O.6.
