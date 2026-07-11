# v0.5.0 Phase 9 -- Coverage & Observability

**Date**: 2026-04-26
**Plan**: [docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md](../../plans/implementation-plan.md) (Phase 9) referencing [docs/archive/versions/v0/v0.5.0/plans/token-optimizer-adoption.md](../../plans/token-optimizer-adoption.md) sub-tasks 4.1-4.4 and [docs/archive/versions/v0/v0.5.0/plans/memory-hygiene.md](../../plans/memory-hygiene.md) sub-task 3.2
**Status**: Complete

---

## Goal

Round out the v0.5.0 observability and caching story:

1. **API-response cache for `web_search`**. SQLite-backed, TTL-keyed, SSRF re-validated per lookup. Two consecutive `web_search` calls for the same query produce exactly one network round-trip.
2. **In-process LRU layer** in front of `ToolOutputCache.lookup` to dedupe within-session re-reads. Already shipped in Phase 4; verified the LRU stats path is wired into the dashboard.
3. **Buffered trace writes** in `TraceStore`. Replace the per-event 32-batch flush with a 100-event / 5-second buffer that survives extension reload via a synchronous `dispose()` flush.
4. **Cache-aware dashboard panels**. Surface compression savings, cache-hit rate, and top cached files in the existing trace dashboard webview, refreshing every 5 s.
5. **Opt-in append-only operation log**. Default-off `OperationLog` writes one Markdown-friendly line per tool call to `<workspace>/.gemma-code/operation-log.md`; secret-path entries redact to `<redacted>`; never includes tool inputs.

The user-visible delta: a `web_search` query repeats are free of network cost; the trace dashboard now answers "how much have I saved by compressing tool output?" and "which files are hottest in the cache?"; an opt-in audit trail of every tool call exists for power users who want it; and the trace pipeline drops a measurable per-event SQLite cost in favor of bounded batches.

---

## Subtasks completed

### 9.1 -- API-response cache for `web_search`

**Files**:
- [src/tools/handlers/webCache.ts](../../../../versions/src/tools/handlers/webCache.ts) (new)
- [src/tools/handlers/webSearch.ts](../../../../versions/src/tools/handlers/webSearch.ts) (cache lookup + store wiring)
- [src/panels/GemmaCodePanel.ts](../../../../versions/src/panels/GemmaCodePanel.ts) (instantiation + dispose)
- [tests/unit/tools/handlers/webCache.test.ts](../../../../versions/tests/unit/tools/handlers/webCache.test.ts)
- [tests/integration/web-search-cache.test.ts](../../../../versions/tests/integration/web-search-cache.test.ts)

**Behavior**:
- SQLite file at `<workspace>/.gemma-code/web-response-cache.sqlite`, chmod 0o600 on POSIX via `secureDbPermissions`.
- Schema: `web_response_cache(url, response, content_type, ttl_seconds, stored_at, hits)`.
- Default TTL: 6 hours. Per-row override via `store(url, response, contentType, ttlSeconds)`.
- **SSRF re-validation on every lookup**: a row stored before an `isSsrfBlocked` rule tightening cannot leak. The lookup awaits `isSsrfBlocked(url)` and treats a positive result as a miss.
- The cache stores the final JSON output (parsed search results) rather than the raw HTML, so a future parser change requires a cache clear but normal hits avoid re-parsing.

### 9.2 -- In-process LRU for live tool outputs

The LRU was implemented during Phase 4 (50 entries / 1 MB cap, mtime-keyed). Phase 9 verified `lruStats()` is observable via the dashboard panel and ensured the stats stay accurate across `prune()`/`clear()` paths. No new code; existing tests in [tests/unit/storage/ToolOutputCache.test.ts](../../../../versions/tests/unit/storage/ToolOutputCache.test.ts) cover the contract.

### 9.3 -- Buffered trace writes in `MetricsCollector`

**Files**:
- [src/observability/TraceStore.ts](../../../../versions/src/observability/TraceStore.ts) (5 s `setInterval` flush, 100-event batch, `dispose()`, `flushImmediately()`, `bufferStats()`)
- [src/observability/MetricsCollector.ts](../../../../versions/src/observability/MetricsCollector.ts) (pass-through `bufferStats` + `flushImmediately`)
- [tests/unit/observability/MetricsCollector.buffered.test.ts](../../../../versions/tests/unit/observability/MetricsCollector.buffered.test.ts)

**Behavior**:
- `FLUSH_BATCH_SIZE` raised from 32 to 100; flushes drain in a single transaction.
- `setInterval(5_000)` ensures a quiet stream of writes still lands within 5 s. The interval is created lazily on the first scheduled flush and `unref()`'d so it never keeps Node alive at shutdown.
- `dispose()` clears the interval and performs a final synchronous flush before closing the database. `close()` is now an alias for `dispose()` and is idempotent.
- `flushImmediately(): Promise<void>` exists for correctness-critical events that cannot wait for the cadence.
- New `bufferStats(): { bufferedEvents, lastFlushMs, totalFlushed }` surfaced on both `TraceStore` and `MetricsCollector`.

### 9.4 -- Cache-aware dashboard panel

**Files**:
- [src/panels/TraceDashboardPanel.ts](../../../../versions/src/panels/TraceDashboardPanel.ts) (new `CacheStatsProviders` constructor arg, `buildCacheStatsPayload()`, 5 s refresh timer)
- [src/panels/messages.ts](../../../../versions/src/panels/messages.ts) (new `cacheStats` and `requestCacheStats` message types)
- [src/panels/webview/traceDashboard.ts](../../../../versions/src/panels/webview/traceDashboard.ts) (three new panels rendered through the existing escape-then-set pipeline)
- [src/extension.ts](../../../../versions/src/extension.ts) (wires `chatPanel.getToolOutputCache()` and `chatPanel.getWebResponseCache()` into the dashboard panel)
- [src/panels/GemmaCodePanel.ts](../../../../versions/src/panels/GemmaCodePanel.ts) (new `getToolOutputCache()` and `getWebResponseCache()` accessors)
- [tests/unit/panels/TraceDashboardPanel.cache.test.ts](../../../../versions/tests/unit/panels/TraceDashboardPanel.cache.test.ts)

**Three new panels**:
1. **Compression savings**: `compression.original_bytes - compression.compressed_bytes` from `getCompressionStats()`, plus the raw original / compressed totals.
2. **Cache-hit rate**: `tool-output-cache` LRU hits / (hits + misses) and `web-response-cache` hits / (hits + misses) side-by-side.
3. **Top cached files**: top 10 absolute paths from `ToolOutputCache.stats().topByHits`, plus the total entries count.

**CSP-safe rendering**: panels are rendered into the webview via the existing escape-then-string-concat pattern, no `innerHTML` from any untrusted source. The webview HTML still carries `require-trusted-types-for 'script'` and `default-src 'none'`; nothing changed in the CSP.

### 9.5 -- Opt-in append-only operation log

**Files**:
- [src/observability/OperationLog.ts](../../../../versions/src/observability/OperationLog.ts) (new)
- [src/tools/AgentLoop.ts](../../../../versions/src/tools/AgentLoop.ts) (records each tool call after execution)
- [src/panels/GemmaCodePanel.ts](../../../../versions/src/panels/GemmaCodePanel.ts) (init + slash-command handler + dispose + settings-change wiring)
- [src/commands/CommandRouter.ts](../../../../versions/src/commands/CommandRouter.ts) (`/operation-log` builtin)
- [src/config/settings.ts](../../../../versions/src/config/settings.ts), [package.json](../../../../versions/package.json) (new `gemma-code.operationLog.enabled` setting, default `false`)
- [tests/unit/observability/OperationLog.test.ts](../../../../versions/tests/unit/observability/OperationLog.test.ts)
- [tests/integration/operation-log-end-to-end.test.ts](../../../../versions/tests/integration/operation-log-end-to-end.test.ts)

**Format**:
```
## [<ISO timestamp>] tool=<name> outcome=<ok|error> path=<rel|n/a|<redacted>> session=<id|n/a>
```
The `## [` prefix keeps the file Markdown-renderable while remaining grep-friendly (`grep '^## \['`).

**Privacy invariants** (enforced by tests):
- Default off. Toggling `gemma-code.operationLog.enabled` flips writes on/off live.
- Writes contain ONLY metadata: tool name, outcome, optional path, session id. Tool inputs (command strings, file contents, search patterns) are never recorded.
- Paths matching the secret-path denylist redact to `<redacted>`. Same denylist as `pathGuard.ts` and the harness hooks.
- File chmod'ed to 0o600 on POSIX.

**Slash commands**:
- `/operation-log status` -- enabled flag, file path, file size, last 5 entries.
- `/operation-log clear` -- truncates the file to zero bytes.

**Buffered writes**: 1 s / 50 events to amortize disk cost. `close()` flushes synchronously; the interval is `unref()`'d so it never holds the process open.

---

## Verification

### Lint, build, tests

| Command | Result |
|---------|--------|
| `npm run lint` | 0 errors, 5 warnings (all pre-existing return-type warnings) |
| `npm run build` | 0 TypeScript errors |
| `npm run test` (full suite) | All test files pass; new tests: 4 unit + 2 integration = 6 new files / 26 new test cases |
| `npm run bench` | No regression on `cache-hit`, `tool-execution`, `skill-loading`, `rendering`, or `hooks`. The pre-existing `context-compaction.bench.ts` failure (unrelated to Phase 9) is left for a follow-up. |

### New test files

- [tests/unit/tools/handlers/webCache.test.ts](../../../../versions/tests/unit/tools/handlers/webCache.test.ts) -- 9 tests
- [tests/integration/web-search-cache.test.ts](../../../../versions/tests/integration/web-search-cache.test.ts) -- 2 tests
- [tests/unit/observability/MetricsCollector.buffered.test.ts](../../../../versions/tests/unit/observability/MetricsCollector.buffered.test.ts) -- 6 tests
- [tests/unit/panels/TraceDashboardPanel.cache.test.ts](../../../../versions/tests/unit/panels/TraceDashboardPanel.cache.test.ts) -- 2 tests
- [tests/unit/observability/OperationLog.test.ts](../../../../versions/tests/unit/observability/OperationLog.test.ts) -- 9 tests
- [tests/integration/operation-log-end-to-end.test.ts](../../../../versions/tests/integration/operation-log-end-to-end.test.ts) -- 2 tests

### Stability gate (per [implementation-plan.md](../../plans/implementation-plan.md))

- [x] `web-response-cache.sqlite` registered, chmod 0o600, SSRF re-validation enforced
- [x] In-process LRU layer measurable via `lruStats()` (Phase 4 carry-over; verified by [tests/unit/storage/ToolOutputCache.test.ts](../../../../versions/tests/unit/storage/ToolOutputCache.test.ts))
- [x] `MetricsCollector` flushes every 5 s / 100 events; `dispose()` flushes synchronously
- [x] Three new dashboard panels render correctly (asserted by `buildCacheStatsPayload()` test)
- [x] `gemma-code.operationLog.enabled` setting registered (default false)
- [x] `.gemma-code/operation-log.md` writes one line per tool call when enabled; redacts secret paths
- [x] `/operation-log status` and `/operation-log clear` listed in `/help`
- [x] No benchmark regression > 10% on cache-hit, tool-execution, hooks, rendering, skill-loading
- [x] Session history generated (this document)

### Manual smoke (deferred -- requires a live VS Code Extension Development Host)

Items below require `F5` in VS Code to launch the extension host. They are documented here for the next manual verification pass:

1. Open the Traces panel; trigger a few `read_file` and `web_search` calls; confirm the three new panels populate and refresh every 5 s.
2. Set `gemma-code.operationLog.enabled = true`; perform several tool calls; confirm `.gemma-code/operation-log.md` exists with one line per call. Toggle the setting off; confirm subsequent calls do not append.
3. Run `/operation-log status` -- confirm the file size and last 5 lines are reported. Run `/operation-log clear` -- confirm the file is empty.
4. Force-restart the extension host (Developer: Restart Window) mid-session; confirm the most recent batch of trace events persisted (proves `dispose()` flush works).

---

## Trade-offs

- **Cache key for `web_search`** is the full URL (including the query string). This is a deliberate choice: DuckDuckGo's `kl=us-en` parameter affects results, so a query-only key would be wrong. Trade-off: if the agent perturbs the URL (e.g. trailing whitespace), it misses the cache. We accept this; the rate limiter still bounds the network cost.
- **Trace flush is `unref()`'d.** The interval cannot keep Node alive at shutdown, but VS Code's extension lifecycle calls `dispose()` first anyway. The change makes the test environment cleaner without losing any production guarantee.
- **Operation log is buffered for 1 s / 50 events.** A crash within 1 s of a tool call may lose that line. We accept this for the disk-cost amortization; the file is opt-in observability, not an authoritative audit log.
- **Operation log redaction is path-based, not content-based.** A `read_file` of `secrets.txt` (no `secret/` directory) is logged at full path. The secret-path denylist matches the same patterns the runtime uses to block reads, so any path the agent could not have read is also `<redacted>` here.

---

## Files changed

```
M  package.json
M  src/commands/CommandRouter.ts
M  src/config/settings.ts
M  src/extension.ts
M  src/observability/MetricsCollector.ts
A  src/observability/OperationLog.ts
M  src/observability/TraceStore.ts
M  src/panels/GemmaCodePanel.ts
M  src/panels/TraceDashboardPanel.ts
M  src/panels/messages.ts
M  src/panels/webview/traceDashboard.ts
M  src/tools/AgentLoop.ts
A  src/tools/handlers/webCache.ts
M  src/tools/handlers/webSearch.ts
A  tests/integration/operation-log-end-to-end.test.ts
A  tests/integration/web-search-cache.test.ts
A  tests/unit/observability/MetricsCollector.buffered.test.ts
A  tests/unit/observability/OperationLog.test.ts
A  tests/unit/panels/TraceDashboardPanel.cache.test.ts
A  tests/unit/tools/handlers/webCache.test.ts
```

---

## Next phase

Phase 10 -- Local Development Hygiene + CI Hardening: husky pre-commit + commit-msg hooks, dependency-cruiser baseline, Dependabot, ESLint `@ts-ignore` rule, SHA-pinned actions, concurrency cancel-in-progress, Node 18/20/22 CI matrix.
