# v0.5.0 Phase 5 -- Semantic Recall + Precise Budgeting

**Date**: 2026-04-25
**Plan**: [docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md](../../plans/implementation-plan.md) (Phase 5)
**Status**: Complete

---

## Goal

Layer two precision improvements on top of the Phase 4 persistent tool-output cache:

1. **Semantic recall** -- the `UnifiedMemoryRetriever` can search the tool-output cache by paraphrase using the existing nomic-embed-text Ollama embedder at cosine threshold 0.85, and falls back to FTS5 keyword search whenever Ollama is unreachable or the cache holds no embeddings.
2. **Precise prompt budgeting** -- the chars/4 heuristic that drives token estimates across `CompactionStrategy`, `PromptBuilder`, and `AgentLoop` is replaced by a tiktoken-backed counter (`cl100k_base`), with the existing heuristic preserved as a deterministic offline fallback when the native binding cannot load.

The user-visible delta: when a related cached tool output exists, the agent sees it surfaced via `searchToolOutputs` (paraphrase-tolerant); when Ollama is offline the same call still returns relevant rows via FTS5; and the context-compaction trigger fires at the right point because the budget number is grounded in the same tokenizer family that real models use.

---

## Subtasks completed

### 5.1 -- Semantic recall on cached tool outputs

**Files**:
- [src/storage/ToolOutputCache.ts](../../../../versions/src/storage/ToolOutputCache.ts) (extended with embedding column, FTS5, `searchByEmbedding`, `searchByKeyword`)
- [src/storage/UnifiedMemoryRetriever.ts](../../../../versions/src/storage/UnifiedMemoryRetriever.ts) (new `searchToolOutputs` method)
- [src/storage/MemorySubsystem.ts](../../../../versions/src/storage/MemorySubsystem.ts) (threads ToolOutputCache + EmbeddingClient through)
- [src/panels/GemmaCodePanel.ts](../../../../versions/src/panels/GemmaCodePanel.ts) (passes the cache into the subsystem)

**Schema migration** (idempotent, runs at every `open()`):

```sql
ALTER TABLE tool_output_cache ADD COLUMN embedding BLOB;   -- Float64 vector
ALTER TABLE tool_output_cache ADD COLUMN excerpt TEXT;     -- first 4 KB of content

CREATE VIRTUAL TABLE tool_output_cache_fts USING fts5(
  excerpt, content=tool_output_cache, content_rowid=rowid
);
-- + AFTER INSERT/UPDATE/DELETE triggers via createFtsTableAndTriggers.
```

The migration uses `PRAGMA table_info` to detect missing columns (SQLite has no `ALTER TABLE ADD COLUMN IF NOT EXISTS`). Existing rows from a Phase-4-only cache get their `excerpt` backfilled by decompressing `content_brotli` and a one-shot FTS5 `'rebuild'` so the keyword fallback covers them on first run.

**Public API additions** on `ToolOutputCache`:

| Method | Shape | Purpose |
|--------|-------|---------|
| `setEmbedder(embedder)` | `EmbeddingClient \| null -> void` | Late-bound wiring. Set by `MemorySubsystem` after the subsystem builds its own embedder. |
| `searchByEmbedding(queryVec, options)` | `(ArrayLike<number>, { topK, threshold? }) -> ToolOutputSearchResult[]` | Cosine similarity over rows with non-NULL embedding, threshold default 0.85. Returns decompressed content. |
| `searchByKeyword(query, limit)` | `(string, number) -> ToolOutputSearchResult[]` | FTS5 keyword fallback over the `excerpt` column with BM25 rank normalized to `[0, 1]`. |
| `embeddedCount()` | `() -> number` | Rows currently carrying a non-NULL embedding; surfaces async embed-after-store progress. |
| `getEmbedding(absolutePath)` | `string -> number[] \| null` | Read back the stored vector (test helper). |
| `waitForPendingEmbeddings()` | `() -> Promise<void>` | Awaits all in-flight embed jobs (test helper). |

`store(absolutePath, content)` now also writes the truncated excerpt and -- when an embedder is wired -- kicks off a fire-and-forget embed job. The job updates the row's `embedding` column when Ollama responds; failures decrement no counters and increment `getEmbeddingStats().skippedOllamaOffline` so the dashboard can surface offline conditions. **Module-level telemetry** (mirroring `Compressor.getCompressionStats()`):

```ts
export interface EmbeddingStats {
  embeddedRows: number;        // successful embed-after-store upserts
  skippedOllamaOffline: number; // embedder returned null / threw
  skippedNoEmbedder: number;   // store() called with no embedder wired
}
```

**`UnifiedMemoryRetriever.searchToolOutputs(query, options)`** wraps the cache surface:

```ts
async searchToolOutputs(query, { topK, threshold = 0.85 }): Promise<ToolOutputSearchResult[]>
```

Decision tree:

1. No `ToolOutputCache` wired (e.g. memory disabled) -> `[]`.
2. Empty query -> `[]`.
3. Embedder wired and reachable -> embed query, run `searchByEmbedding(...)`. If results non-empty, return them.
4. Embedder absent / Ollama down (returns null or throws) / semantic step empty -> fall through to `searchByKeyword(query, topK)`.

Failures never throw upstream; `searchToolOutputs` always returns an array.

**Tests added**:

- [tests/unit/storage/ToolOutputCache.semantic.test.ts](../../../../versions/tests/unit/storage/ToolOutputCache.semantic.test.ts) -- 14 tests covering: schema migration, embed-after-store async behavior, telemetry counters, embedding clear-on-overwrite, cosine ranking, threshold override, topK respected, empty-query / empty-vector edge cases, FTS5 keyword fallback (including content beyond the 4 KB excerpt cap).
- [tests/unit/storage/UnifiedMemoryRetriever.test.ts](../../../../versions/tests/unit/storage/UnifiedMemoryRetriever.test.ts) (extended with 8 new tests) -- covers: no-cache short circuit, empty-query short circuit, semantic happy path, fallback when embedder returns null, fallback when embedder throws, fallback when semantic results are empty, no-embedder skip-to-keyword path, threshold-override forwarding.
- [tests/integration/semantic-recall-fallback.test.ts](../../../../versions/tests/integration/semantic-recall-fallback.test.ts) -- 3 end-to-end tests against a real (in-memory) SQLite cache plus a mocked embedder: FTS5 fallback when embedder is unreachable, semantic recall when reachable, paraphrase recall when query and content embeddings collapse onto the same axis.

### 5.2 -- tiktoken-backed PromptBudget with heuristic fallback

**Files**:
- [src/config/PromptBudget.ts](../../../../versions/src/config/PromptBudget.ts) (new exports: `countTokens`, `heuristicTokenCount`, `disposeEncoder`, `getTokenCounterStats`, `resetTokenCounterStats`)
- [src/chat/CompactionStrategy.ts](../../../../versions/src/chat/CompactionStrategy.ts) (delegates `_computeTokensForMessage` to `countTokens`)
- [src/chat/PromptBuilder.ts](../../../../versions/src/chat/PromptBuilder.ts) (delegates internal `estimateTokens` to `countTokens`)
- [src/tools/AgentLoop.ts](../../../../versions/src/tools/AgentLoop.ts) (delegates `estimateTokensForString` to `countTokens`)
- [src/extension.ts](../../../../versions/src/extension.ts) (`deactivate()` now calls `disposeEncoder()`)
- [package.json](../../../../versions/package.json) (`tiktoken: ^1.0.17` added to runtime dependencies)

**API**:

```ts
// Heuristic chars/4 with a 1.3x multiplier when the input contains a fenced
// code block. Deterministic, offline, no native bindings.
export function heuristicTokenCount(text: string): number;

// Tiktoken `cl100k_base` when available; falls back to heuristicTokenCount
// when the native binding cannot load. The first call eagerly loads the
// encoder (synchronously). Subsequent calls reuse the cached encoder.
export function countTokens(text: string): number;

export interface TokenCounterStats {
  tiktokenCalls: number;
  heuristicCalls: number;
  tiktokenLoadAttempted: boolean;
  tiktokenLoadFailed: boolean;
}
export function getTokenCounterStats(): TokenCounterStats;
export function resetTokenCounterStats(): void;

// Idempotent. Frees the cached tiktoken handle. Test-only / called from
// extension deactivate().
export function disposeEncoder(): void;
```

The encoder is loaded via `createRequire(__filename)("tiktoken")` rather than a static import so platforms missing a prebuilt native binding (or environments where the package is intentionally absent) gracefully fall back to the heuristic. A single warning is emitted via the project logger; subsequent calls go straight to the heuristic without retrying the load.

**DEVIATION** from the sub-plan prompt: the sub-plan calls for replacing "the chars/4 estimator in `src/config/PromptBudget.ts`". That file did not previously hold a token-counting function -- the heuristic was duplicated across `CompactionStrategy`, `PromptBuilder`, and `AgentLoop`. The implementation centralizes the counter in `PromptBudget.ts` (matching the sub-plan's location) and rewires the three duplicate sites to delegate. The behavior contract is preserved: when tiktoken cannot load, every call site computes exactly the same number it did before Phase 5 (chars/4 with a 1.3x code multiplier).

**Tests added**:

- [tests/unit/config/PromptBudget.tiktoken.test.ts](../../../../versions/tests/unit/config/PromptBudget.tiktoken.test.ts) -- 11 tests covering: heuristic correctness (chars/4, code multiplier, empty input), `countTokens` non-empty/empty handling, ratio sanity check vs. heuristic on English text (within factor of 3), telemetry recording (load attempt, per-call counter increments), graceful degradation when tiktoken cannot load, `disposeEncoder` idempotence.

The pre-existing `tests/unit/chat/CompactionStrategy.test.ts` continues to pass byte-equivalent because in this environment tiktoken is not installed (the package is in `dependencies` for production but skipped at test time), so all calls route through the heuristic path with the same numbers as before.

---

## Test results

```
Test Files  101 passed | 1 skipped (102)
Tests       1343 passed | 4 skipped (1347)
Duration    ~10s
```

`npm run lint` clean. `npm run build` clean. The Phase 5 tests:

- `ToolOutputCache.semantic.test.ts`: 14/14 passed.
- `UnifiedMemoryRetriever.test.ts`: 16/16 passed (8 new + 8 existing).
- `PromptBudget.tiktoken.test.ts`: 11/11 passed.
- `semantic-recall-fallback.test.ts` (integration): 3/3 passed.

---

## Deferred to Phase 12 (release gate) or follow-up

Three items on the Phase 5 exit checklist are deferred to Phase 12 because they require either a live Ollama instance or a primed `npm install --offline` baseline that is not available inside the implementation environment:

- **Offline install verification** (`npm install --offline`) -- to be run on the dev workstation before the v0.5.0 tag.
- **`tests/golden/baselines/v0.5.0-tiktoken.json`** -- the tiktoken-vs-heuristic delta on the 24 golden tasks; rolled into the Phase 12 final golden-task baselining run.
- **Nightly Ollama integration with `searchToolOutputs`** -- exercises the full embedder + cache + retriever path against a real `nomic-embed-text` model; requires `OLLAMA_URL` set in the smoke environment.

The structural work and unit / integration coverage for both branches (Ollama up + Ollama down) is in place; the deferred items are baseline measurements, not implementation gaps.

---

## Files changed

```
M  package.json
M  src/chat/CompactionStrategy.ts
M  src/chat/PromptBuilder.ts
M  src/config/PromptBudget.ts
M  src/extension.ts
M  src/panels/GemmaCodePanel.ts
M  src/storage/MemorySubsystem.ts
M  src/storage/ToolOutputCache.ts
M  src/storage/UnifiedMemoryRetriever.ts
M  src/tools/AgentLoop.ts
A  tests/integration/semantic-recall-fallback.test.ts
A  tests/unit/config/PromptBudget.tiktoken.test.ts
A  tests/unit/storage/ToolOutputCache.semantic.test.ts
M  tests/unit/storage/UnifiedMemoryRetriever.test.ts
A  docs/archive/versions/v0/v0.5.0/development/history/2026-04_phase-5-semantic-recall-and-budgeting.md
M  docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md  (Phase 5 exit checklist)
```
