# v0.5.0 Phase 4 -- Persistent Cache + Diff-Based Reads

**Date**: 2026-04-25
**Plan**: [docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md](../../plans/implementation-plan.md) (Phase 4)
**Status**: Complete

---

## Goal

Add a persistent, workspace-scoped tool-output cache that lets `read_file` return a unified diff (or a one-line cached-marker) on the second and subsequent reads of the same file:

1. SQLite-backed cache at `<workspace>/.gemma-code/tool-output-cache.sqlite`, chmod 0o600 on POSIX, keyed by `(absolute_path, mtime, size)`. Cache content is Brotli-compressed via the Phase 3 `Compressor` module.
2. `read_file` consults the cache before returning content. On hit + byte-identical content, the response is a short cached-marker (~150 bytes). On hit + changed content, the response is a unified diff via the existing `diff` package. `full=true` bypasses the cache and always returns the full content.
3. `/cache status`, `/cache clear`, `/cache prune` slash commands surface size, top-by-hits, and explicit eviction.
4. Cache cap of 500 entries enforced via LRU eviction by `stored_at`. A small in-process LRU (50 entries / 1 MB) sits in front of SQLite to dedupe within-session re-reads.
5. Secret-path denylist (matchesSecretPath) blocks `.env`, `id_rsa`, `*.pem`, etc. from caching.

The user-visible delta: re-reading an unchanged file in the same session goes from a multi-KB tool result to a < 200 B cached-marker, and re-reading a modified file returns just the unified diff. Token cost on iterative-debug workflows drops accordingly.

---

## Subtasks completed

### 4.1 -- Schema + dbPermissions integration

**Files**:
- [src/storage/ToolOutputCache.ts](../../../../versions/src/storage/ToolOutputCache.ts) (new)
- [src/storage/dbPermissions.ts](../../../../versions/src/storage/dbPermissions.ts) (doc-comment update)

Public API on `ToolOutputCache`:

| Method | Shape | Purpose |
|--------|-------|---------|
| `open(dbPathOrWorkspaceRoot)` | `string -> void` | Opens `:memory:`, an explicit `.sqlite` path, or `<workspace>/.gemma-code/tool-output-cache.sqlite`. Calls `secureDbPermissions` and `pragma journal_mode = WAL`. |
| `close()` | `() -> void` | Closes SQLite and clears the in-process LRU. |
| `dbPath()` | `() -> string \| null` | Path of the underlying file (null when closed). |
| `lookup(absolutePath)` | `string -> LookupResult \| null` | Returns `{ content, fresh }` for the previously-stored payload. `fresh: true` means the on-disk mtime+size still match the cached row; `fresh: false` means the file changed but the cache still has the previous content (callers can diff). |
| `store(absolutePath, content, relativePath?)` | `(string, string, string?) -> void` | Stores content keyed by current on-disk stat. Skips silently for secret-path matches. Enforces the 500-entry cap via LRU eviction by `stored_at`. |
| `clear()` | `() -> number` | Drops every entry; returns the count removed. |
| `prune()` | `() -> number` | Forces one LRU eviction round; returns the count removed. |
| `size()` | `() -> number` | Total cached entries. |
| `stats()` | `() -> CacheStats` | `{ entries, topByHits[] }`. |
| `lruStats()` | `() -> LruStats` | `{ entries, bytes, hits, misses }` for the in-process front cache. |

Schema (single table):

```
tool_output_cache(
  absolute_path  TEXT PRIMARY KEY,
  mtime_ms       INTEGER NOT NULL,
  size_bytes     INTEGER NOT NULL,
  content_brotli BLOB NOT NULL,
  stored_at      INTEGER NOT NULL,
  hits           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_tool_output_cache_stored_at ON tool_output_cache(stored_at);
```

`secureDbPermissions(dbPath)` is called immediately after `new Database(dbPath)` (mirroring `MemoryStore`, `ChatHistoryStore`, `EpisodicMemory`, `GraphMemory`). The `dbPermissions.ts` doc comment now lists `tool-output-cache.sqlite` alongside the four other known cache files.

### 4.2 -- Diff-based `read_file` handler with `full=true` + `/cache` commands

**Files**:
- [src/tools/types.ts](../../../../versions/src/tools/types.ts) (added `full?: boolean` to `ReadFileParams`)
- [src/tools/ToolCatalog.ts](../../../../versions/src/tools/ToolCatalog.ts) (declared `full` parameter in the tool schema)
- [src/tools/handlers/filesystem.ts](../../../../versions/src/tools/handlers/filesystem.ts) (cache integration in `ReadFileTool`)
- [src/commands/CommandRouter.ts](../../../../versions/src/commands/CommandRouter.ts) (registered `cache` builtin)
- [src/panels/GemmaCodePanel.ts](../../../../versions/src/panels/GemmaCodePanel.ts) (cache lifecycle, `/cache` handler, registry wiring)

`ReadFileTool` now takes an optional `ToolOutputCache` constructor argument (third positional parameter). When the cache is wired in and `full !== true`, the handler:

1. Reads the on-disk content (existing path — VS Code FS API).
2. Pagination short-circuits unchanged (range_start / range_end always returns the requested window — they are byte windows of the current file, not delta-able).
3. Calls `cache.lookup(absolutePath)`.
4. Calls `cache.store(absolutePath, content, p.path)` -- always, so the next call diffs against the latest content.
5. If `lookup` returned a hit:
   - `hit.content === content` -> JSON `{ cached: true, changed: false, marker: '=== cached: file unchanged since ISO-DATE ===', file_size }`.
   - Otherwise -> JSON `{ cached: true, changed: true, diff: '=== diff vs. cached read at ISO-DATE ===\n<unified diff>', file_size }`.
6. Otherwise (cache miss) -> falls through to the existing line/truncation path that emits `{ content, lines, truncated }`.

Cache failures (`lookup`/`store` throwing) are swallowed inside a try/catch so a broken cache never breaks `read_file`.

`/cache` builtin command (registered in `CommandRouter.BuiltinCommandName`, descriptor in `BUILTIN_DESCRIPTORS`, handled in `GemmaCodePanel._handleBuiltinCommand`):

| Subcommand | Behaviour |
|------------|-----------|
| `/cache status` (default) | Prints total entries, in-process LRU stats (entries, bytes, hits, misses), and the top 10 cached files by hits. |
| `/cache clear` | Calls `cache.clear()` and reports the row count removed. |
| `/cache prune` | Calls `cache.prune()` and reports the row count evicted. |

The cache is constructed in the panel constructor (one instance per panel), pointed at the first workspace folder, and disposed in `dispose()` alongside the chat-history and memory stores. When no workspace is open or initialization fails, the cache reference is null and the handler / `/cache` command degrade gracefully (full reads everywhere; `/cache` reports the disabled state).

---

## Tests added

| File | Cases | What it covers |
|------|------:|----------------|
| [tests/unit/storage/ToolOutputCache.test.ts](../../../../versions/tests/unit/storage/ToolOutputCache.test.ts) | 14 | null lookup on unknown path, fresh round-trip, fresh=false on mtime change, fresh=false on size change, secret-path denylist (`.env`, `id_rsa`), capacity LRU eviction, `clear()` / `prune()` / `size()` / `stats()` / `lruStats()`, throw when not opened, close+reopen disk persistence, `.gemma-code/` subdir creation |
| [tests/unit/storage/dbPermissions.test.ts](../../../../versions/tests/unit/storage/dbPermissions.test.ts) | 3 (2 POSIX-only) | chmod 0o600 on existing file, chmod 0o600 on the new tool-output cache via `ToolOutputCache.open()`, no-throw on missing file |
| [tests/unit/tools/handlers/filesystem.read_file.cache.test.ts](../../../../versions/tests/unit/tools/handlers/filesystem.read_file.cache.test.ts) | 6 | first read is full content, second read of unchanged file returns cached-marker, second read after content change returns unified diff with both `-` and `+` lines, `full=true` always returns full content, secret-path skipped on cache, cache failure inside try/catch never breaks the tool |
| [tests/integration/read-file-cache.test.ts](../../../../versions/tests/integration/read-file-cache.test.ts) | 2 | end-to-end: 3 KB code fixture -> first ToolResult > 2 KB, second ToolResult < 200 B; second-read-after-modification produces a parseable diff with both sides |
| [tests/benchmarks/cache-hit.bench.ts](../../../../versions/tests/benchmarks/cache-hit.bench.ts) | 2 latency gates + 2 throughput | Hit p99 < 1 ms, miss p99 < 0.5 ms on a 500-row populated cache; `bench` blocks for `vitest bench` runs |

All four `*.test.ts` files are picked up by the default `npm run test` include (`tests/unit/**/*.test.ts` and `tests/integration/**/*.test.ts`). The benchmark file is consumed by `vitest bench` -- the latency gates in `describe`/`it` blocks fire under `npm run bench`.

---

## Stabilization results

| Check | Result |
|-------|--------|
| `npm run build` | Clean (tsc 5.x). |
| `npm run lint` | 0 errors (5 pre-existing warnings on unrelated files). |
| `npm run test` | 1307 passing, 4 skipped, 0 failures across 99 test files. |
| `tests/unit/storage/ToolOutputCache.test.ts` | 14/14 green. |
| `tests/unit/storage/dbPermissions.test.ts` | 3/3 green (2 skipped on Windows). |
| `tests/unit/tools/handlers/filesystem.read_file.cache.test.ts` | 6/6 green. |
| `tests/integration/read-file-cache.test.ts` | 2/2 green. |
| `tests/benchmarks/cache-hit.bench.ts` | Deferred to Phase 12 (vitest bench in this repo runs continuously without exiting when scoped to a single file; latency capture lands alongside the rest of `npm run bench`). |

---

## Deviations from the plan

1. **`lookup` return shape.** The plan-source sub-task specified that `lookup` returns null whenever the on-disk mtime+size do not match the cached row. Strictly applied, that contract makes the diff path unreachable: when the file changes, `lookup` would return null and the handler would treat it as a first-time read. To make the spec's diff path observable, `lookup` now returns `{ content, fresh }` instead of `string | null`. `fresh: true` matches the original semantics (cached content is current); `fresh: false` exposes the previously-stored content so the handler can compute a diff. Tests cover both branches.

2. **`secureDbPermissions` registration.** The sub-plan asked us to "register" the new file with `dbPermissions.ts`. The existing pattern in this codebase is just to call the helper directly from each store; there is no central registry. `secureDbPermissions` is now invoked from `ToolOutputCache.open()` (mirroring `MemoryStore` / `ChatHistoryStore`), and the helper's doc-comment lists `tool-output-cache.sqlite` alongside the four other known cache files. Verified by `tests/unit/storage/dbPermissions.test.ts`.

3. **In-process LRU lives inside `ToolOutputCache`.** The token-optimizer-adoption sub-plan defers the front-cache LRU to Phase 4 step 4.2 (a separate sub-task in that sub-plan). The implementation-plan's Phase 4 stability gate references "in-process LRU layer measurable via `lruStats()`" only in Phase 9 (sub-task 9.2). Since the SQLite-eviction path needs the LRU to stay consistent (otherwise stale LRU entries mask SQLite-level eviction), I included a small front-cache (50 entries / 1 MB) and `lruStats()` here. The Phase 9 sub-task will be a no-op when it gets there: documentation + dashboard panel only.

4. **Benchmark capture deferred.** Same deferral path as Phases 2 and 3 (`tests/benchmarks/tool-execution.bench.ts` p99 capture deferred to Phase 12). `vitest bench` runs continuously in this repo and does not auto-exit when scoped to a single file, which is incompatible with a one-shot phase stabilization run. The latency gates inside `cache-hit.bench.ts` will fire alongside the full Phase 12 `npm run bench` invocation that captures p50/p99 across the whole suite.

---

## Files added or modified

**Added (5)**:
- `src/storage/ToolOutputCache.ts`
- `tests/unit/storage/ToolOutputCache.test.ts`
- `tests/unit/storage/dbPermissions.test.ts`
- `tests/unit/tools/handlers/filesystem.read_file.cache.test.ts`
- `tests/integration/read-file-cache.test.ts`
- `tests/benchmarks/cache-hit.bench.ts`

**Modified (5)**:
- `src/storage/dbPermissions.ts` -- doc comment lists tool-output-cache.sqlite
- `src/tools/types.ts` -- `ReadFileParams.full`
- `src/tools/ToolCatalog.ts` -- `read_file` schema includes `full`
- `src/tools/handlers/filesystem.ts` -- cache integration in `ReadFileTool`
- `src/commands/CommandRouter.ts` -- `cache` builtin descriptor
- `src/panels/GemmaCodePanel.ts` -- cache lifecycle, `/cache` handler, registry wiring
- `docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md` -- Phase 4 exit checklist updated

---

## Next phase

Phase 5: Semantic Recall + Precise Budgeting. Builds on the cache (Phase 4) and the embedder/FTS5 stack (existing) to surface paraphrased recall of cached tool outputs at cosine 0.85; introduces `tiktoken` as a runtime dependency and replaces the chars/4 heuristic in `PromptBudget`.
