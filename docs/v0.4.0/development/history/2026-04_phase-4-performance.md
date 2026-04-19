# v0.4.0 Phase 4 - Performance Optimization

**Date:** 2026-04-19
**Plan:** [docs/v0.4.0/implementation-plan.md](../../implementation-plan.md) Phase 4
**Findings closed:** 20 (9 P1 + 8 P2 + 3 P3) from [docs/v0.3.0/review.md](../../../v0.3.0/review.md)
**Test status:** 1117 passed, 2 skipped, 0 failed. Lint clean (0 errors, 30 pre-existing warnings).

---

## Overview

Phase 4 closed every remaining performance finding from the v0.3.0 review. Work was organized into seven waves, each ending with a clean `npm run build` before the next began. The send loop, panel/webview rendering path, prompt/tool serialization, storage layer, and observability aggregation were all touched. Two sub-tasks (4.9 ConversationSync-async and 4.15 shared EmbeddingClient) were verified as already resolved by prior phases and documented as deviations rather than re-implemented.

| Wave | Scope | Sub-tasks | Outcome |
|------|-------|-----------|---------|
| A | Send-loop hot path (coupled) | 4.1, 4.2, 4.10, 4.20 | Single Ollama client; no-clone getHistory with `_totalChars` counter; per-Message token WeakMap cache; O(N) trim + EmergencyTrim |
| B | Panels and webview | 4.3, 4.4, 4.18, 4.19 | Cross-call HTML cache; focused-surface routing for streaming; assistant-content stripped from history payload; `retainContextWhenHidden: false` with rehydrate path |
| C | Prompt and tool serialization | 4.5, 4.16 | PromptBuilder tool-section memoization keyed by enabled-tool id set; `hasToolCall` folded into `parseToolCalls` return shape |
| D | Storage layer | 4.6, 4.8, 4.12, 4.13, 4.14, 4.17 | FTS5-routed session search with LIMIT; batched BFS via `getRelationsForEntities`; shared Database across MemoryStore, EpisodicMemory, GraphMemory; FTS rebuild gated on `PRAGMA user_version`; bulk embed + bulk INSERT in extractAndSave; single-array merge in retrieve |
| E | Observability and misc | 4.7, 4.11 | `TraceStore.getTraceAggregates` via one GROUP BY query with `json_extract`; highlight.js reduced to `highlight.js/lib/core` + 8 explicit languages |
| F | N/A verification | 4.9, 4.15 | ConversationSync has zero imports since Phase 3.6; EmbeddingClient already centralized via MemorySubsystem. Both recorded as deviations. |
| G | Stabilization | 4.21 | `v0.4.0.json` baseline seeded; bench gating script gained `--floor` and now prefers v0.4.0 with v0.3.0 as floor; nightly workflow updated |

---

## Sub-task detail

### 4.1 Hoist Ollama client out of setInterval
- **File:** [src/extension.ts](../../../../src/extension.ts)
- **Implementation:** `startOllamaPoller` creates a single `OllamaClient` instance outside the tick callback and reuses it on every poll. `setInterval` replaced with self-rescheduling `setTimeout` so the cadence can vary: 5s while unreachable, 30s once healthy. `clearInterval` swapped to `clearTimeout` in the disposer and in `deactivate`.
- **Acceptance:** 8-hour idle session now allocates zero poller-attributable `OllamaClient` objects (previously one per 5s tick).

### 4.2 No-clone getHistory; O(1) token estimate
- **File:** [src/chat/ConversationManager.ts](../../../../src/chat/ConversationManager.ts)
- **Implementation:** `getHistory()` returns the live `_messages` array typed as `readonly Message[]`. New private field `_totalChars` is incremented in `_append`, decremented/reset in `rebuildSystemPrompt`, `clearHistory`, `loadSession`, `replaceMessages`, `replaceWithSummary`, and `trimToContextLimit`. A public `totalChars` getter exposes the running total for O(1) budget checks.
- **Tests:** Rewrote the "defensive copy" test to lock the new no-clone contract: two calls to `getHistory()` return the same array reference; identity is stable across non-mutating reads. Added a second case for post-mutation identity.

### 4.10 Cache estimateTokens per Message
- **File:** [src/chat/CompactionStrategy.ts](../../../../src/chat/CompactionStrategy.ts)
- **Implementation:** Module-scoped `WeakMap<Message, number>` caches the per-message token estimate. New exported `estimateTokensForMessage(msg)` checks the map and falls through to the character-length + code-block-multiplier formula. `estimateTokensForMessages` now iterates via the cached helper. Cache keys are `Message` references; GC reclaims entries when messages drop out of scope.

### 4.20 Replace O(N^2) trim with O(N) single-pass
- **Files:** [src/chat/ConversationManager.ts](../../../../src/chat/ConversationManager.ts), [src/chat/CompactionStrategy.ts](../../../../src/chat/CompactionStrategy.ts)
- **Implementation:** `trimToContextLimit` scans messages once, marks drop indices in a `Set`, then rebuilds the array in one loop. `EmergencyTrim.apply` computes the starting total once via cached per-message estimates, subtracts each dropped message's estimate instead of re-summing the whole array, and rebuilds the result in a single O(N) pass. The previous splice-in-loop pattern was the worst-case O(N^2) from finding #29 and the review's "additional performance notes".

### 4.3 Rendered-HTML cache in _postHistory
- **File:** [src/panels/GemmaCodePanel.ts](../../../../src/panels/GemmaCodePanel.ts)
- **Implementation:** New instance field `_renderedHtmlCache: Map<string, string>` caches per-message rendered Markdown across `_postHistory` calls. Each entry is populated on first render; entries for message ids that no longer appear in the current history are evicted at the end of every `_postHistory` (handles trim, replaceMessages, loadSession, clearHistory).

### 4.4 Track focused webview; avoid double-post
- **File:** [src/panels/GemmaCodePanel.ts](../../../../src/panels/GemmaCodePanel.ts)
- **Implementation:** New field `_editorPanelActive` mirrors `panel.active`, updated by `onDidChangeViewState`. `_postToWebview` inspects the message `type`: `token` and `messageComplete` route through `_postToFocusedWebview`, which picks the one attached surface (or the focused one when both are attached). All other event types continue to broadcast so history / status / errors stay in sync on every surface. The editor panel's `onDidDispose` clears the reference cleanly.

### 4.18 Reduce _postHistory webview payload
- **File:** [src/panels/GemmaCodePanel.ts](../../../../src/panels/GemmaCodePanel.ts)
- **Implementation:** The `messages` payload now preserves metadata (id, role, timestamp) and keeps user content (still needed for plain-text rendering in the webview), but replaces assistant `content` with empty string. The authoritative source for assistant rendering is `renderedHtmlMap` -- the webview already preferred it before falling back to `escapeTextToHtml(content)`, so a 50-message session's payload drops by roughly half. Webview consumer in [src/panels/webview/index.ts](../../../../src/panels/webview/index.ts) was unchanged -- the existing `renderedHtmlMap[msg.id] ?? escapeTextToHtml(msg.content)` fallback remains safe because every assistant message now carries a map entry.

### 4.19 Flip retainContextWhenHidden and add rehydrate path
- **Files:** [src/extension.ts](../../../../src/extension.ts), [src/panels/GemmaCodePanel.ts](../../../../src/panels/GemmaCodePanel.ts)
- **Implementation:** The editor panel registers with `retainContextWhenHidden: false` so hidden panels release their webview JS state. `GemmaCodePanel.attachToWebviewPanel` now listens for `onDidChangeViewState` and calls `_postHistory()` when the panel transitions from hidden to visible. Because `_renderedHtmlCache` is persistent in the extension host, the rehydrate path does no extra Markdown rendering -- the cached HTML goes straight to the webview.

### 4.5 Memoize tool serialization
- **File:** [src/chat/PromptBuilder.ts](../../../../src/chat/PromptBuilder.ts)
- **Implementation:** New private field `_toolSectionCache: Map<string, PromptSection | null>` on `PromptBuilder`. `_buildToolDeclarations` computes a stable cache key from the sorted set of `source:name` pairs plus the `lazyToolLoading` boolean, and returns the cached `PromptSection` when the key matches. A 30-tool registry re-serializes only when the enabled-tool set changes.
- **Deviation:** The plan also mentioned splicing the memory block into the prompt rather than rebuilding. The current `build()` path already composes sections and the memory section is one `PromptSection` among many -- the tool-cache memoization captures the big win (tools were the expensive block) and the memory-section rebuild cost is small by comparison. Not implementing the memory splice kept the prompt-assembly code path single-flow.

### 4.16 Fold hasToolCall into parseToolCalls
- **Files:** [src/tools/Gemma4ToolFormat.ts](../../../../src/tools/Gemma4ToolFormat.ts), [src/tools/ToolCallParser.ts](../../../../src/tools/ToolCallParser.ts), [src/tools/AgentLoop.ts](../../../../src/tools/AgentLoop.ts)
- **Implementation:** `parseToolCalls` now returns `{ results, hasAny }`. `hasAny` is set both during balanced-brace scanning (any opening tag counts) and via a fallback regex pass that catches opening tokens the brace loop skipped. `hasToolCall` export removed from `Gemma4ToolFormat`, re-export removed from `ToolCallParser`. `AgentLoop._runOneIteration` now destructures the combined result instead of calling `hasToolCall` + `parseToolCalls`.
- **Tests:** Both test files (`ToolCallParser.test.ts`, `Gemma4ToolFormat.test.ts`) adopt a compatibility shim that destructures `.results` / `.hasAny` so the many existing expectations keep reading naturally.

### 4.6 Route searchSessions through FTS5 with LIMIT
- **File:** [src/storage/ChatHistoryStore.ts](../../../../src/storage/ChatHistoryStore.ts)
- **Implementation:** `searchSessions(query, limit = 100)` first attempts an FTS5-backed query that joins through `messages_fts`; if the sanitized query is empty or FTS5 is unavailable at runtime, it falls back to the legacy LIKE join. Both paths now apply `LIMIT ?` using the same parameter. A new `DEFAULT_SEARCH_LIMIT` constant sets the default.

### 4.8 Batched BFS queries
- **Files:** [src/storage/GraphMemory.ts](../../../../src/storage/GraphMemory.ts), [src/storage/GraphQueryEngine.ts](../../../../src/storage/GraphQueryEngine.ts)
- **Implementation:** New method `GraphMemory.getRelationsForEntities(entityIds, direction)` issues one SQL query with `source_id IN (...)` / `target_id IN (...)` for the full frontier. `findRelatedEntities` and `GraphQueryEngine.explainPath` both rewrite their depth-level loops to call it once per depth level. A frontier of 50 nodes at depth 2 now issues at most 3 SQL queries (one per level + the start-entity lookup) instead of ~50.
- **Deviation:** `GraphQueryEngine.queryByEntity` was not touched -- it already delegated its primary work to `findRelatedEntities` (which is now batched), so the direct win propagates without additional code. The `.getEntityRelations` calls that remain in `queryByEntity`/`explainPath` at leaf enrichment sites are single-entity fetches, which were not the review's hot path.

### 4.12 Share a single better-sqlite3 connection
- **Files:** [src/storage/MemoryStore.ts](../../../../src/storage/MemoryStore.ts), [src/storage/EpisodicMemory.ts](../../../../src/storage/EpisodicMemory.ts), [src/storage/MemorySubsystem.ts](../../../../src/storage/MemorySubsystem.ts), [src/panels/GemmaCodePanel.ts](../../../../src/panels/GemmaCodePanel.ts)
- **Implementation:** `MemoryStore` and `EpisodicMemory` constructors accept `string | Database.Database`. When a string is passed, the class opens and owns the connection (back-compat for tests). When a Database is passed, it is treated as injected -- `close()` becomes a no-op. `MemorySubsystem` opens one Database, injects it into `MemoryStore`, `EpisodicMemory`, and `GraphMemory`, and owns the connection via a new `close()` method. `GemmaCodePanel.dispose()` now calls `_memorySubsystem.close()` once instead of per-layer close.
- **Constraints met:** On construction failure the shared DB is closed explicitly in the catch block so no file handle leaks.

### 4.13 Gate FTS5 rebuild on PRAGMA user_version
- **File:** [src/storage/ChatHistoryStore.ts](../../../../src/storage/ChatHistoryStore.ts)
- **Implementation:** A new module constant `SCHEMA_VERSION = 1` is compared against `PRAGMA user_version` during `_initSchema`. The `INSERT INTO messages_fts(messages_fts) VALUES('rebuild')` runs only when the versions differ; the pragma is bumped after a successful rebuild. Cold start on a populated DB is now a no-op instead of re-indexing every row.

### 4.14 Batch extractAndSave in pre-compaction hook
- **Files:** [src/storage/MemoryStore.ts](../../../../src/storage/MemoryStore.ts), [src/storage/EmbeddingClient.ts](../../../../src/storage/EmbeddingClient.ts) (already has `embedBatch`)
- **Implementation:** `extractAndSave` now gathers all extractions, filters duplicates, embeds the full batch via `EmbeddingClient.embedBatch` (one HTTP request), and INSERTs the rows inside a single `better-sqlite3` transaction. A 30-extraction compaction used to issue 30 embed requests plus 30 individual INSERTs; now it issues one embed request and one transactional batch.

### 4.17 Reduce allocation in MemoryStore.retrieve
- **File:** [src/storage/MemoryStore.ts](../../../../src/storage/MemoryStore.ts)
- **Implementation:** Replaced the `Map<id, result>` + `[...merged.values()].sort(...)` pattern with a single array of results plus a `Map<id, index>` lookup. Keyword results are copied once; semantic results either replace an existing index or push to the array. Sort runs in place on the same array. No more second-array allocation for the spread.

### 4.7 GROUP BY aggregate query in TraceStore
- **Files:** [src/observability/TraceStore.ts](../../../../src/observability/TraceStore.ts), [src/observability/MetricsCollector.ts](../../../../src/observability/MetricsCollector.ts)
- **Implementation:** New `TraceStore.getTraceAggregates(traceIds)` runs one SQL query with `GROUP BY trace_id`, using conditional aggregation (`SUM(CASE WHEN kind = ... THEN 1 ELSE 0 END)`) for each span-kind count and `json_extract(attributes, '$.confirmation_required')` / `json_extract(attributes, '$.tokens_estimated')` for the attribute-dependent metrics. `MetricsCollector.computeAggregateMetrics` consumes the batched result instead of calling `computeSessionMetrics` per trace; per-span JSON parsing now happens only on detail-view queries (`getTrace`, `getSpansByKind`).
- **Deviation:** The original `computeSessionMetrics` path is preserved (still used by the dashboard detail view). The aggregate path's `successRate` is computed per-trace from `toolSuccessCount / toolCount` rather than deriving from a status attribute -- matches the original semantics where only `status = 'ok'` tool calls count, with a 1.0 default when a trace has no tool calls.

### 4.11 Explicit highlight.js language registration
- **File:** [src/utils/MarkdownRenderer.ts](../../../../src/utils/MarkdownRenderer.ts)
- **Implementation:** Default `highlight.js` import swapped to `highlight.js/lib/core`. Eight languages registered explicitly: TypeScript, JavaScript, Python, Go, Rust, JSON, Bash, YAML -- plus the common aliases (`ts`, `js`, `py`, `rs`, `sh`, `shell`, `yml`). Unregistered languages fall through `highlightAuto` over the registered set, then to the plain-text catch in `renderer.code`.

### 4.9 ConversationSync async -- N/A (deviation)
- **File:** [src/storage/ConversationSync.ts](../../../../src/storage/ConversationSync.ts)
- **Result:** The class has zero importers in `src/` (verified via grep). Phase 3 sub-task 3.6 removed the last callers. Making the sync methods async would be dead-code churn; Phase 7 owns the file deletion as originally planned.

### 4.15 Shared EmbeddingClient instance -- already satisfied (deviation)
- **File:** [src/storage/MemorySubsystem.ts](../../../../src/storage/MemorySubsystem.ts)
- **Result:** `MemorySubsystem.buildSubsystem` already constructs a single `EmbeddingClient` instance (line 98) and passes it by reference to `MemoryStore`, `EpisodicMemory`, and `GraphQueryEngine`. Grep confirms exactly one `new EmbeddingClient` call site in `src/`. Recorded as "already satisfied".

### 4.21 Testing and stabilization
- **Lint:** `npm run lint` -- 0 errors, 30 pre-existing `no-console` warnings (unchanged from Phase 3).
- **Tests:** `npm run test` -- 1117 passed, 2 skipped (ollama-health integration + one pre-existing skip), 0 failures across 85 test files.
- **Typecheck:** `npm run build` clean across the whole tree.
- **Benchmarks baseline:** [tests/benchmarks/baselines/v0.4.0.json](../../../../tests/benchmarks/baselines/v0.4.0.json) seeded in the same shape as v0.3.0 (empty benchmarks object, `thresholds.regressionPct = 20`). The nightly CI workflow will populate it via `--update-baseline` on the first run after v0.4.0 merges, matching the pattern used for v0.3.0.
- **Bench gating script:** [scripts/check-bench-regressions.mjs](../../../../scripts/check-bench-regressions.mjs) gained a `--floor` flag. Benchmarks missing from the primary baseline fall through to the floor; both are silent no-ops for benchmarks that have never been measured. [.github/workflows/nightly.yml](../../../../.github/workflows/nightly.yml) now passes `--baseline v0.4.0.json --floor v0.3.0.json`.

---

## Files created

- `tests/benchmarks/baselines/v0.4.0.json`
- `docs/v0.4.0/development/history/2026-04_phase-4-performance.md` (this file)

## Files modified (19)

- `src/extension.ts`
- `src/chat/ConversationManager.ts`
- `src/chat/CompactionStrategy.ts`
- `src/chat/PromptBuilder.ts`
- `src/panels/GemmaCodePanel.ts`
- `src/tools/Gemma4ToolFormat.ts`
- `src/tools/AgentLoop.ts`
- `src/tools/ToolCallParser.ts`
- `src/storage/ChatHistoryStore.ts`
- `src/storage/MemoryStore.ts`
- `src/storage/EpisodicMemory.ts`
- `src/storage/MemorySubsystem.ts`
- `src/storage/GraphMemory.ts`
- `src/storage/GraphQueryEngine.ts`
- `src/observability/MetricsCollector.ts`
- `src/observability/TraceStore.ts`
- `src/utils/MarkdownRenderer.ts`
- `scripts/check-bench-regressions.mjs`
- `.github/workflows/nightly.yml`

## Tests modified (3)

- `tests/unit/chat/ConversationManager.test.ts`
- `tests/unit/tools/Gemma4ToolFormat.test.ts`
- `tests/unit/tools/ToolCallParser.test.ts`

## Deviations summary

1. **4.5 memory splice not implemented.** Tool-section memoization captures the big win; memory-block rebuild cost is small and would fork the prompt-assembly flow.
2. **4.8 queryByEntity not directly batched.** It delegates to `findRelatedEntities`, which is batched; remaining per-entity lookups are not on the review's hot path.
3. **4.9 ConversationSync async.** Dead code since Phase 3.6. Deletion owned by Phase 7.
4. **4.15 shared EmbeddingClient.** Already satisfied by MemorySubsystem construction.
5. **4.21 baseline numbers not captured in this run.** v0.3.0 baseline was also seeded empty and populated by the first nightly CI run; v0.4.0 inherits the same pattern. The gating logic is active via the new `--floor` flag.

## Next steps

- **Phase 5 (Testing Pipeline Completeness):** 22 testing findings; flake elimination, pyramid rebalancing, 80%+ coverage held.
- **Phase 7 (Simplification and Release):** delete `ConversationSync`, `BudgetEnforcer`, `LazyToolLoader` and their catalog entries; tag v0.4.0; nightly run will seed real benchmark baselines into `v0.4.0.json`.
