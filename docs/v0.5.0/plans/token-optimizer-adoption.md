# Plan — Token Optimizer Adoption

**Project**: Gemma Code
**Version**: v0.5.0
**Slug**: token-optimizer-adoption
**Plan Type**: Feature / Enhancement
**Created**: 2026-04-24
**Source Comparison**: [docs/v0.5.0/comparison/comparison-token-optimizer-mcp.md](../comparison/comparison-token-optimizer-mcp.md)
**Scope Filter**: `all` (P0 + P1 + P2 + P3)
**Hard Constraint**: 100% offline-first single-GPU. No runtime network egress, no cloud APIs, no models that require more than a single consumer GPU via Ollama. Predictive-cache adopts ARIMA only (pure-JS); LSTM variant explicitly excluded.

**Goal**: Adopt all 16 P0–P3 items from the token-optimizer-mcp comparison report so that Gemma Code's tool-output token cost drops by ≥40% on representative golden tasks, cache hit rate exceeds 50% on iterative-debug workloads, and no Vitest, benchmark, or golden-task regressions ship.

## Overview

This plan adopts the 16 in-scope items from [docs/v0.5.0/comparison/comparison-token-optimizer-mcp.md](../comparison/comparison-token-optimizer-mcp.md), grouped into 5 dependency-ordered phases. Phase 1 lands the compression foundation that every later phase builds on; Phase 2 adds the persistent SQLite tool-output cache and diff-based file re-reads (the largest single token-savings lever); Phase 3 layers semantic recall and tiktoken-precision budgeting on top of that cache; Phase 4 fans the cache infrastructure out to the rest of the tool surface and adds operator-visible analytics; Phase 5 closes the loop with CI hygiene and advanced cache strategies behind feature flags.

The user-visible delta is minimal: tool calls return the same logical content, but the conversation transcript carries far less token weight. Power users see new dashboard panels (cache-hit rate, compression savings, top-cached files), a new `/cache` slash-command surface, and tighter prompt budgets. The agent loop itself does not change behavior — every cached path has a `full=true` escape hatch, every compressed payload is decoded transparently before re-injection, and every new SQLite file is `chmod 0o600` via `src/storage/dbPermissions.ts`.

Success is measured against two artifacts that already exist: `tests/golden/baselines/` (a v0.4.0 baseline of token usage per task) and `tests/benchmarks/` (latency tracking for tool execution and context compaction). Phase 5's stabilization gate writes a v0.5.0+adoption baseline that documents the realised token reduction and proves the no-regression bar.

## Phases at a Glance

| Phase | Title | Outcome | Items adopted |
|-------|-------|---------|---------------|
| 1 | Compression foundation | Tool outputs > 500 B are Brotli-compressed in flight; null-safety baseline established | P0-1, P0-3, P1-4 |
| 2 | Persistent cache + diff-based reads | Cross-session SQLite tool-output cache with mtime+size invalidation; `read_file` returns unified diffs against cached content | P0-2, P1-1 |
| 3 | Semantic recall + precise budgeting | `UnifiedMemoryRetriever` recalls cached tool outputs via nomic-embed-text at cosine 0.85; `PromptBudget` uses tiktoken with heuristic fallback | P1-2, P1-3 |
| 4 | Coverage & observability | API-response cache (web_search), single LRU for live tool outputs, buffered trace writes, cache-aware dashboard panel | P2-1...P2-5 |
| 5 | CI hygiene + advanced fallbacks | Node-version CI matrix, semantic-release + commitlint, ARIMA predictive cache (pure-JS), multi-tier eviction, heuristic 128-D embedder fallback | P3-1...P3-4 |

**Explicitly out of scope** (parked from the comparison report under "Risks and Considerations" / "Skip" / breaks the offline-first constraint):

- LSTM-based predictive caching (requires a model file + GPU cycles for marginal gain on a single-user workflow)
- The global `~/.claude-global/hooks/` PowerShell/Bash hook deployment (Gemma owns the agent loop in-process; hooks add platform divergence)
- Auto-detect installer for non-Gemma AI tools (Cursor, Cline, Windsurf, Copilot) — out of scope; Gemma is itself the AI tool
- Local web dashboard (`web-server.js` on `localhost:3000`) — Gemma's analytics already live inside the IDE webview at `src/panels/TraceDashboardPanel.ts`

---

## Phase 1: Compression Foundation

**Goal**: Brotli-compress tool outputs above a 500-byte threshold (text mode, quality 4) before they're stored in the conversation transcript, with transparent decompression on read.

**Prerequisites**: None.

**Stability Gate**: All Vitest unit + integration suites green; new `tests/unit/tools/Compressor.test.ts` covers null/empty/binary/random/JSON/text fixtures; `tests/benchmarks/tool-execution.bench.ts` shows < 5 ms added latency at the p99 for a 10 KB tool output; a fresh `tests/unit/tools/null-safety.test.ts` covers undefined/null/empty/binary tool returns across every handler in `src/tools/handlers/`.

### Sub-tasks

#### 1.1 — Brotli compressor module with threshold logic

**Objective**: Add a self-contained `src/tools/Compressor.ts` that wraps Node's built-in `zlib.brotliCompress`/`brotliDecompress` and exposes `shouldCompress(input)`, `compress(input)`, and `decompress(buffer)` with the offline guarantee that no external dependency is added.

**Prompt**:
> You are working on Gemma Code v0.5.0 (TypeScript VS Code extension; offline-first; uses Ollama + Gemma 4). Create a new module at `src/tools/Compressor.ts` that exposes:
>
> - `shouldCompress(input: string | Buffer): boolean` — returns `true` only when `Buffer.byteLength(input, 'utf8') >= 500` AND a probe Brotli compression at quality 4 in `BROTLI_MODE_TEXT` saves ≥ 20% of bytes. Cache the probe result via a small LRU keyed by SHA-1 of the first 4 KB so callers can ask twice for free.
> - `compress(input: string): Promise<{ data: Buffer; originalBytes: number; compressedBytes: number; ratio: number }>` — runs Brotli at quality 4, text mode.
> - `decompress(buffer: Buffer): Promise<string>` — inverse.
> - `compressSync` / `decompressSync` siblings using `zlib.brotliCompressSync` for cases where the caller cannot await (small inputs only — gate at 4 KB).
>
> Constraints:
> - Use only the Node `zlib` and `crypto` built-ins. No new npm dependencies.
> - All logic offline-first; no network calls, no model loads.
> - Export TypeScript types `CompressedToolOutput = { encoding: 'br'; data: Buffer; originalBytes: number }` and a tagged-union `MaybeCompressed = string | CompressedToolOutput` for downstream consumers.
> - Add a Vitest unit suite at `tests/unit/tools/Compressor.test.ts` covering: null/undefined input rejected with a TypeError; empty string returns the input untouched; 100-byte input bypassed by `shouldCompress`; 10 KB lorem-ipsum compresses ≥ 50%; random-bytes input falls below the 20% threshold and is rejected; round-trip encoding fidelity for UTF-8 strings with emoji and CJK characters.
>
> Acceptance: `npm run test -- tests/unit/tools/Compressor.test.ts` is green; `npm run lint` is clean; no new entries in `package.json` `dependencies`.

---

#### 1.2 — Integrate compressor into OutputRedirector

**Objective**: Wire the new `Compressor` into `src/tools/OutputRedirector.ts` so every tool result above 500 B is stored as a `CompressedToolOutput` in the conversation transcript, with transparent decode at injection time.

**Prompt**:
> Continuing the Gemma Code token-optimizer adoption work. Modify `src/tools/OutputRedirector.ts` to:
>
> - Accept the existing `string` tool output and, when `Compressor.shouldCompress(output)` is true, store the result as `CompressedToolOutput` (from `src/tools/Compressor.ts`) in the conversation message instead of the raw string. Otherwise leave behavior unchanged.
> - Add a `decode(maybeCompressed: MaybeCompressed): Promise<string>` helper used by `src/chat/PromptBuilder.ts` and `src/chat/ContextCompactor.ts` whenever a stored tool result is re-read. The decode must be idempotent for already-decoded strings.
> - Track per-call compression telemetry on the existing `MetricsCollector` instance: `compression.original_bytes`, `compression.compressed_bytes`, `compression.skipped_below_threshold`, `compression.skipped_low_savings`. Use the existing event-emit pattern; do not introduce a new collector.
>
> Constraints:
> - Behavior must be reversible: `decode(redirector.capture(input))` returns `input` exactly for any UTF-8 string.
> - Ensure `src/chat/CompactionStrategy.ts` (especially the `ToolResultClearing` and `LlmSummary` stages) continues to operate on decoded text — add a decode step there if needed.
> - Do not change the public types of `ToolResult` in `src/tools/types.ts` more than necessary; widen `output` to `MaybeCompressed` only if every consumer is updated in this same change.
>
> Tests:
> - Update `tests/unit/tools/OutputRedirector.test.ts` (or create it) with a round-trip test: capture → store → decode → assert equal.
> - Add an integration test at `tests/integration/tool-output-compression.test.ts` that runs a full agent loop turn against a stubbed Ollama responder, captures a 12 KB grep result, and asserts the conversation message storing the result is < 6 KB on disk after compression.
>
> Acceptance: full Vitest suite green; `tests/benchmarks/tool-execution.bench.ts` p99 increase < 5 ms.

---

#### 1.3 — Null-safety baseline across tool handlers

**Objective**: Establish a `tests/unit/tools/null-safety.test.ts` suite (parallel to token-optimizer-mcp's `null-safety.test.ts`) that exercises every handler in `src/tools/handlers/` against null / undefined / empty / binary inputs and outputs.

**Prompt**:
> Gemma Code v0.5.0 token-optimizer adoption — Phase 1 testing pass. Create `tests/unit/tools/null-safety.test.ts` covering:
>
> For every handler exported from `src/tools/handlers/filesystem.ts`, `terminal.ts`, `webSearch.ts`, `secretPaths.ts`, and `pathGuard.ts`:
> - Call the handler with `undefined` and `null` for each documented parameter; assert it returns a structured `ToolResult` with `ok: false` and an actionable error message (parameter name + correct invocation pattern). Do NOT assert specific phrasing — only that the message contains the parameter name.
> - Call with empty-string parameters; assert the same.
> - For tools that produce file content (`read_file`), feed a binary fixture at `tests/fixtures/binary-1kb.bin` (create it as 1 KB of `Buffer.alloc(1024, 0)`); assert the handler returns either a structured "binary file" notice or correctly base64-encodes the content. Whichever the current behavior is, lock it in with a snapshot.
> - For `Compressor` from `src/tools/Compressor.ts` (added in 1.1), already covered by its own suite — skip.
>
> Constraints:
> - Use the existing `tests/helpers/factories.ts` `mockOf<T>()` helper for any dependency mocks.
> - Each test must call `vi.clearAllMocks()` in `afterEach` to enforce isolation.
> - Run with `npm run test -- tests/unit/tools/null-safety.test.ts` and verify zero flaky reruns across 5 consecutive runs.
>
> Acceptance: file exists; suite green; no `as unknown as` casts (use `mockOf<T>()`).

---

#### 1.4 — Phase 1 testing and stabilization

**Objective**: Generate and run all Phase 1 tests; iterate until stable.

**Prompt**:
> Generate and run comprehensive tests for Phase 1 of the token-optimizer-adoption plan (`docs/v0.5.0/plans/token-optimizer-adoption.md`). Specifically:
>
> 1. Run `npm run lint`, `npm run build`, `npm run test`. Fix every failure or warning. Iterate.
> 2. Run `npm run bench -- tests/benchmarks/tool-execution.bench.ts` and capture the p50/p99 numbers. If p99 latency increases more than 5 ms vs. the baseline already in `tests/benchmarks/`, identify the cause (likely Brotli quality > 4 or a missed `shouldCompress` short-circuit) and fix.
> 3. Run the integration suite: `npm run test:integration`. Fix any regressions.
> 4. Run the existing nightly Ollama integration smoke (`tests/integration/ollama-client.test.ts`) and confirm green when Ollama is running.
> 5. After all tests pass, run `/generate-session-history` to document Phase 1.
>
> Do not advance to Phase 2 until every step above is fully verified.

---

### Phase 1 Exit Checklist

- [ ] `src/tools/Compressor.ts` exists with the documented public API
- [ ] `src/tools/OutputRedirector.ts` stores compressed payloads above 500 B and decodes transparently
- [ ] `tests/unit/tools/Compressor.test.ts`, `tests/unit/tools/OutputRedirector.test.ts`, `tests/unit/tools/null-safety.test.ts` all green
- [ ] `tests/integration/tool-output-compression.test.ts` green
- [ ] `tests/benchmarks/tool-execution.bench.ts` p99 within +5 ms of baseline
- [ ] `npm run lint` clean
- [ ] `MetricsCollector` emits the four new compression events
- [ ] No new entries in `package.json` `dependencies`
- [ ] Session history generated

---

## Phase 2: Persistent Cache + Diff-Based Reads

**Goal**: Add a SQLite-backed tool-output cache (`tool-output-cache.sqlite`) keyed by `(absolute_path, mtime, size)` for `read_file`, with a `full=true` escape hatch and a `/cache` slash-command surface; on cache hit, return only the unified diff against the cached content.

**Prerequisites**: Phase 1 (Compressor is used to store cached entries Brotli-compressed).

**Stability Gate**: New `src/storage/ToolOutputCache.ts` is exercised end-to-end in `tests/integration/tool-output-cache.test.ts`; `read_file` returns full content on first call, unified diff on second call (when mtime+size unchanged); `/cache clear` empties the cache; `dbPermissions.ts` chmods the new file to `0o600` on POSIX; cache-hit rate is observable in the metrics collector.

### Sub-tasks

#### 2.1 — Schema + dbPermissions integration

**Objective**: Add the `tool_output_cache` SQLite schema and register the new file with `src/storage/dbPermissions.ts` so it's chmod 0o600 on POSIX.

**Prompt**:
> Continuing the Gemma Code v0.5.0 token-optimizer adoption — Phase 2.
>
> Create `src/storage/ToolOutputCache.ts` exposing:
> - `class ToolOutputCache { open(workspaceRoot: string): Promise<void>; lookup(absolutePath: string): Promise<CachedEntry | null>; store(absolutePath: string, content: string): Promise<void>; clear(): Promise<void>; size(): Promise<number>; }`
> - `type CachedEntry = { absolutePath: string; mtimeMs: number; sizeBytes: number; contentBrotli: Buffer; storedAt: number; hits: number }`
>
> The schema (single table `tool_output_cache`, columns `absolute_path TEXT PRIMARY KEY`, `mtime_ms INTEGER`, `size_bytes INTEGER`, `content_brotli BLOB`, `stored_at INTEGER`, `hits INTEGER DEFAULT 0`). Use `better-sqlite3` (already a dependency). The cache file lives at `<workspace>/.gemma-code/tool-output-cache.sqlite`.
>
> Update `src/storage/dbPermissions.ts` to chmod the new file `0o600` immediately after open, mirroring the existing pattern for `chat-history.sqlite` / `memory.sqlite` / `traces.sqlite` / `graph.sqlite`. Add a unit test in `tests/unit/storage/dbPermissions.test.ts` that asserts the new file is chmod-ed (skip on Windows via `process.platform`).
>
> The `lookup` method must return `null` if the on-disk file's current mtime+size do not match the cached row. Use `fs.statSync` synchronously — the latency overhead is acceptable for the read-cache path.
>
> Constraints:
> - Offline-first: no network calls.
> - Brotli content is stored via `Compressor.compressSync` (added in Phase 1) when content fits the sync threshold; otherwise via `compress`.
> - `secretPaths.ts` denylist still applies: before storing, check `isSecretPath(absolutePath)` and skip caching if true.
> - Cap the cache at 500 entries (LRU eviction by `stored_at`); add `prune()` for explicit eviction.
>
> Tests at `tests/unit/storage/ToolOutputCache.test.ts`:
> - Open + close + reopen round-trips a stored entry.
> - mtime change invalidates lookup (returns null).
> - size change invalidates lookup.
> - Storing a `.env` path is silently skipped (secret-path guard).
> - Cap is enforced: 501st insert evicts the oldest by `stored_at`.
>
> Acceptance: full Vitest suite green; `npm run lint` clean; no new dependencies.

---

#### 2.2 — Diff-based read_file handler with full=true escape hatch

**Objective**: Modify `src/tools/handlers/filesystem.ts` `read_file` to consult `ToolOutputCache` on every call and return only the unified diff when the cached content matches mtime+size; introduce a `full=true` parameter to bypass the cache.

**Prompt**:
> Gemma Code v0.5.0 token-optimizer adoption — Phase 2 step 2.
>
> Modify the `read_file` handler in `src/tools/handlers/filesystem.ts`:
>
> - Accept an optional `full?: boolean` parameter (default `false`). When `full === true`, bypass the cache entirely and always return the full file content.
> - On the cache path: read the on-disk file content; query `ToolOutputCache.lookup(absolutePath)`; if there is a hit AND the cached content differs from the on-disk content, compute a unified diff via the `diff` package (already a dependency: `diff` ^5.2.2); return a `ToolResult` whose `output` field contains a header line `=== diff vs. cached read at <ISO timestamp> ===` followed by the unified diff. If the cached content is identical, return a one-line `ToolResult` `=== cached: file unchanged since <ISO timestamp> ===`.
> - Always update the cache with the freshly-read content (so the next `read_file` diff is against the latest read).
> - Honor the existing path guard, secret-path denylist, and `OutputRedirector` integration (which now compresses the result above 500 B).
> - Update the tool schema in `src/tools/ToolCatalog.ts` to document the new `full` parameter.
>
> Add a slash-command `/cache` handler in `src/commands/CommandRouter.ts` with subcommands:
> - `/cache clear` — calls `ToolOutputCache.clear()`; reports the number of entries removed.
> - `/cache status` — reports `size()` and the top 10 cached files by hits.
> - `/cache prune` — explicit eviction round.
>
> Tests:
> - `tests/unit/tools/handlers/filesystem.read_file.cache.test.ts`: first read returns full content; second read of unchanged file returns the unchanged-marker; second read after content modification returns a unified diff containing both removed and added lines; `full: true` always returns full content.
> - `tests/integration/read-file-cache.test.ts`: complete agent loop turn that re-reads the same file twice and asserts the second tool result is < 200 bytes when the file is unchanged.
>
> Acceptance: full Vitest suite green; `npm run lint` clean; `/cache` slash command listed in `/help` output.

---

#### 2.3 — Phase 2 testing and stabilization

**Objective**: Run all Phase 2 tests; verify cache invalidation correctness; iterate until stable.

**Prompt**:
> Generate and run comprehensive tests for Phase 2 of the token-optimizer-adoption plan (`docs/v0.5.0/plans/token-optimizer-adoption.md`). Specifically:
>
> 1. Run `npm run lint`, `npm run build`, `npm run test`. Fix every failure or warning.
> 2. Run the integration suite: `npm run test:integration`. Fix any regressions.
> 3. Add a benchmark at `tests/benchmarks/cache-hit.bench.ts` that measures the p50/p99 latency of `ToolOutputCache.lookup` across a populated cache of 500 entries. Target: p99 < 1 ms for a hit, < 0.5 ms for a miss.
> 4. Verify file permissions: on a Linux/macOS dev machine, run `ls -l .gemma-code/tool-output-cache.sqlite` and confirm `-rw-------` (chmod 0o600). On Windows, document that ACL inheritance from `%APPDATA%` is the protective layer.
> 5. Cache-correctness test: write a manual repro that reads `package.json`, modifies one line out-of-band (via a separate `fs.writeFileSync`), reads again, and asserts the second `read_file` returns a diff covering the modified line.
> 6. After all tests pass, run `/generate-session-history` to document Phase 2.
>
> Do not advance to Phase 3 until every step above is fully verified. Pay particular attention to the secret-path guard — manually attempt to cache a path matching `**/.env*` and confirm the guard rejects it.

---

### Phase 2 Exit Checklist

- [ ] `src/storage/ToolOutputCache.ts` exists with the documented public API
- [ ] `src/storage/dbPermissions.ts` covers `tool-output-cache.sqlite`
- [ ] `read_file` handler returns diffs on cache hit and full content on `full=true`
- [ ] `/cache clear`, `/cache status`, `/cache prune` commands available
- [ ] Cache cap (500 entries) enforced via LRU eviction
- [ ] Secret-path denylist blocks caching of `.env`, `id_rsa`, etc.
- [ ] `tests/benchmarks/cache-hit.bench.ts` shows p99 < 1 ms hit / < 0.5 ms miss
- [ ] Full Vitest suite green; integration suite green; nightly Ollama smoke green
- [ ] Session history generated

---

## Phase 3: Semantic Recall + Precise Budgeting

**Goal**: Extend `UnifiedMemoryRetriever` so the tool-output cache participates in semantic recall (cosine 0.85 threshold via the existing nomic-embed-text Ollama embedding), and replace the heuristic `chars/4` token estimator in `PromptBudget` with a tiktoken-backed counter that loads locally with no network egress.

**Prerequisites**: Phase 2 (the cache must exist before it can be searched semantically).

**Stability Gate**: When Ollama is reachable, the agent can recall a cached tool output by paraphrase via `UnifiedMemoryRetriever`; `PromptBudget` numbers match `tiktoken`'s counts within 0.5%; when Ollama or tiktoken cannot load, both gracefully degrade to the existing FTS5 / heuristic paths.

### Sub-tasks

#### 3.1 — Semantic recall on cached tool outputs

**Objective**: Extend `src/storage/UnifiedMemoryRetriever.ts` to embed each new cache entry on store, search by cosine similarity at 0.85 on retrieval, and fall back to FTS5 keyword search when Ollama is unreachable.

**Prompt**:
> Gemma Code v0.5.0 token-optimizer adoption — Phase 3 step 1.
>
> Extend `src/storage/UnifiedMemoryRetriever.ts` so it can also search the `ToolOutputCache` (added in Phase 2). Specifically:
>
> - Add an embedding column to `tool_output_cache` (migration: `ALTER TABLE tool_output_cache ADD COLUMN embedding BLOB`).
> - On `ToolOutputCache.store(...)`, asynchronously call `EmbeddingClient.embed(content)` (using the existing `nomic-embed-text` model via Ollama) and upsert the resulting Float32 vector. Tolerate Ollama unavailability — store NULL embedding and surface a metric `cache.embedding_skipped_ollama_offline`.
> - Add `UnifiedMemoryRetriever.searchToolOutputs(query: string, options: { topK: number; threshold?: number })` that:
>     1. Tries cosine similarity at `threshold ?? 0.85` against rows with non-NULL embedding.
>     2. Falls back to FTS5 keyword search (use `src/storage/sqliteFts.ts` patterns) when no embeddings exist or Ollama is unreachable.
>     3. Returns a list of `{ absolutePath, similarity, content }` entries decompressed via `Compressor.decompress`.
>
> Surface this in the retrieval pipeline so the budget allocation in `src/config/PromptBudget.ts` can pull cached tool-output snippets into the working window when relevant — but cap the contribution to 5% of the total context budget to avoid crowding out memory.
>
> Constraints:
> - Offline-first: gracefully degrade when Ollama is unreachable. Never throw upstream — log + metric + fall back.
> - Do not duplicate the recall path with `MemoryStore`'s existing semantic search; reuse `EmbeddingClient` and `embeddingUtils.ts` (cosine helper).
> - Use the existing migration pattern from `src/storage/MemoryStore.ts` (a single `_schema_version` row guards re-running ALTER TABLE).
>
> Tests:
> - `tests/unit/storage/ToolOutputCache.semantic.test.ts`: store 3 entries with mock `EmbeddingClient` returning known vectors; assert `searchToolOutputs` ranks by cosine; assert threshold 0.85 filters out the lowest-similarity entry.
> - `tests/integration/semantic-recall-fallback.test.ts`: with `EmbeddingClient` configured to fail, assert FTS5 fallback returns at least one result for an exact-keyword query.
>
> Acceptance: full Vitest suite green; integration suite green; `npm run lint` clean.

---

#### 3.2 — tiktoken-backed PromptBudget with heuristic fallback

**Objective**: Replace the heuristic `chars / 4` token estimator in `src/config/PromptBudget.ts` with a tiktoken-backed counter; cache the encoder instance; fall back to the heuristic when tiktoken cannot load (e.g. native binding missing on a niche platform).

**Prompt**:
> Gemma Code v0.5.0 token-optimizer adoption — Phase 3 step 2.
>
> Replace the chars/4 estimator in `src/config/PromptBudget.ts` with a tiktoken-backed counter:
>
> - Add `tiktoken` ^1.0.x as a runtime dependency (`npm install tiktoken@^1.0.0`).
> - Wrap the encoder load in a lazy singleton: `let encoder: Tiktoken | null = null; let encoderLoadFailed = false;`. The first call attempts `get_encoding('cl100k_base')`. If it throws (native binding missing, unsupported platform), set `encoderLoadFailed = true` and emit a one-time warning log + metric `prompt_budget.tiktoken_load_failed`.
> - When the encoder is loaded, count tokens via `encoder.encode(text).length`. When `encoderLoadFailed`, fall back to the existing chars/4 heuristic — keep the existing function as `heuristicTokenCount` for clarity.
> - Add a public `disposeEncoder()` for tests; ensure it's called from `extension.ts` deactivate().
>
> Constraints:
> - tiktoken's `cl100k_base` encoding is shipped inside the package; no network egress on first load. Verify by running `npm install --offline` after a fresh install.
> - Encoder load is ~15 ms cold; cache aggressively. Do not load on extension activation — load on the first `PromptBudget.estimate(...)` call.
> - Update the budget tests in `tests/unit/config/PromptBudget.test.ts` to assert: tiktoken counts ≠ heuristic counts for a 1 KB English fixture by < 5%; for a 1 KB code fixture, tiktoken counts more accurately (assert via a known token count from a reference fixture).
> - Add a gracefully-degraded test that mocks `tiktoken.get_encoding` to throw, then asserts the heuristic is used and the metric fires once.
>
> Tests:
> - `tests/unit/config/PromptBudget.tiktoken.test.ts` — covers all the above.
>
> Acceptance: full Vitest suite green; `npm run lint` clean; `package.json` reflects tiktoken; offline `npm install --offline` succeeds against a fresh `npm cache verify`.

---

#### 3.3 — Phase 3 testing and stabilization

**Objective**: Run all Phase 3 tests; verify graceful degradation when Ollama and/or tiktoken are unavailable; iterate until stable.

**Prompt**:
> Generate and run comprehensive tests for Phase 3 of the token-optimizer-adoption plan. Specifically:
>
> 1. Run `npm run lint`, `npm run build`, `npm run test`, `npm run test:integration`. Fix every failure.
> 2. Verify offline install: stop the network adapter (or use `npm install --offline` after a primed cache) and confirm the project still builds and starts. No runtime download paths must be triggered.
> 3. Run the nightly Ollama integration: with Ollama running, exercise `/research <query>` and confirm at least one cached tool output is recalled via `searchToolOutputs` when the query semantically matches an earlier read.
> 4. Run the nightly Ollama integration with Ollama stopped: confirm the agent loop still works, semantic recall falls back to FTS5, and the metric `cache.embedding_skipped_ollama_offline` increments.
> 5. Capture a fresh prompt-budget benchmark: record tiktoken-vs-heuristic delta on the 24 golden tasks (`tests/golden/tasks/`) — store in `tests/golden/baselines/v0.5.0-tiktoken.json` for future comparison.
> 6. After all tests pass, run `/generate-session-history` to document Phase 3.
>
> Do not advance to Phase 4 until every step above is fully verified.

---

### Phase 3 Exit Checklist

- [ ] `searchToolOutputs` returns cosine-ranked results when Ollama is up; FTS5 fallback when down
- [ ] Cache embeddings stored via existing `EmbeddingClient` (nomic-embed-text)
- [ ] `PromptBudget` uses tiktoken when available; heuristic fallback proven via mock
- [ ] `tiktoken` listed in `package.json` `dependencies`
- [ ] Offline install verified (`npm install --offline`)
- [ ] `tests/golden/baselines/v0.5.0-tiktoken.json` written
- [ ] Full Vitest suite + integration + nightly Ollama suites green
- [ ] Session history generated

---

## Phase 4: Coverage and Observability

**Goal**: Extend the cache infrastructure to `web_search` (and the future `fetch_page`); add a single in-process LRU layer for live tool-output dedup; buffer trace writes in `MetricsCollector`; surface cache-hit and compression-savings panels in `TraceDashboardPanel`.

**Prerequisites**: Phase 2 (cache infrastructure).

**Stability Gate**: API-response cache reduces repeat `web_search` calls on a known query to a single network round-trip; in-process LRU has > 80% hit rate on a synthetic loop; `MetricsCollector` writes trace events in 5 s / 100 op buffers and survives a forced extension reload without losing the most recent batch via `dispose()`; the trace dashboard shows cache-hit %, compression-savings bytes, and the top 10 cached files.

### Sub-tasks

#### 4.1 — API-response cache for web_search

**Objective**: Add a TTL+URL-keyed cache for `web_search` results that respects the existing SSRF guard; mirror the design for the future `fetch_page` tool.

**Prompt**:
> Gemma Code v0.5.0 token-optimizer adoption — Phase 4 step 1.
>
> Create `src/tools/handlers/webCache.ts`:
>
> - Schema: a new SQLite file `<workspace>/.gemma-code/web-response-cache.sqlite` with table `web_response_cache(url TEXT PRIMARY KEY, response BLOB, content_type TEXT, ttl_seconds INTEGER, stored_at INTEGER, hits INTEGER)`.
> - API: `class WebResponseCache { lookup(url): CachedResponse | null; store(url, response, contentType, ttlSeconds): void; clear(): void }`.
> - Integration: modify `src/tools/handlers/webSearch.ts` to consult the cache before issuing a network call. On hit (with `stored_at + ttl_seconds * 1000 > now`), return the cached response and increment `hits`. Default TTL: 6 hours.
> - **Critical**: cache lookup must NOT bypass the SSRF guard at `src/utils/ssrf.ts`. Re-validate the URL through `isSsrfBlocked` before serving from cache. This protects against an SSRF guard rule change after a cached entry was stored.
> - Register the new file with `src/storage/dbPermissions.ts` for chmod 0o600.
>
> Tests:
> - `tests/unit/tools/handlers/webCache.test.ts`: store + lookup happy path; expired TTL evicts; SSRF rule change post-cache invalidates the entry.
> - `tests/integration/web-search-cache.test.ts`: with MSW mocking the search endpoint, two consecutive `web_search` calls for the same query result in exactly one network request.
>
> Acceptance: full Vitest suite green; `npm run lint` clean.

---

#### 4.2 — Single in-process LRU for live tool outputs

**Objective**: Add a process-lifetime LRU cache (max 50 entries, 1 MB total, mtime-keyed) that sits in front of `ToolOutputCache.lookup` to dedupe within-session redundant lookups.

**Prompt**:
> Gemma Code v0.5.0 token-optimizer adoption — Phase 4 step 2.
>
> Add a small in-process LRU cache to `src/storage/ToolOutputCache.ts` that fronts `lookup`:
>
> - Use the existing `lru-memoize` analog (or a hand-rolled `Map`-based LRU; do not add a new dependency unless necessary).
> - Cap: 50 entries OR 1 MB total uncompressed bytes, whichever comes first.
> - Key: `(absolutePath, mtimeMs, sizeBytes)`. On lookup, if the on-disk file's stat matches the LRU key, serve from LRU without touching SQLite.
> - On `store`, also update the LRU.
> - Expose `lruStats(): { entries: number; bytes: number; hits: number; misses: number }` for the dashboard.
>
> Tests:
> - `tests/unit/storage/ToolOutputCache.lru.test.ts`: LRU cap enforced; eviction order is LRU; stats are accurate; mtime change invalidates LRU entry.
>
> Acceptance: full Vitest suite green; `npm run lint` clean.

---

#### 4.3 — Buffered trace writes in MetricsCollector

**Objective**: Buffer trace events in memory and flush every 5 seconds or 100 events, dropping per-event SQLite write cost; ensure flush on `dispose()`.

**Prompt**:
> Gemma Code v0.5.0 token-optimizer adoption — Phase 4 step 3.
>
> Modify `src/observability/MetricsCollector.ts`:
>
> - Replace per-event synchronous SQLite write with an in-memory buffer (`Array<TraceEvent>`).
> - Flush condition: buffer length ≥ 100 events OR last flush was > 5 seconds ago. Use `setInterval(5_000)` for the time-based flush; clear the interval on `dispose()`.
> - On `dispose()`, perform a final synchronous flush to avoid losing the last batch when the extension is deactivated.
> - Add a `flushImmediately(): Promise<void>` method for tests and for the `/cache status` command path.
> - Expose buffer stats: `bufferedEvents: number; lastFlushMs: number; totalFlushed: number`.
>
> Constraints:
> - Behavior must be observable from the existing trace dashboard — no UI changes required in this sub-task; just keep the contract intact.
> - The 5-second flush is acceptable for analytics; for any *correctness*-critical event (e.g. a confirmation gate decision), call `flushImmediately()` synchronously.
>
> Tests:
> - `tests/unit/observability/MetricsCollector.buffered.test.ts`: 99 events buffered without flush; 100th triggers flush; time-based flush after 5 s under fake timers; `dispose()` flushes; `flushImmediately()` returns when the buffer is empty.
>
> Acceptance: full Vitest suite green; integration suite green; `npm run lint` clean.

---

#### 4.4 — Cache-aware dashboard panel

**Objective**: Surface compression savings, cache-hit rate, top-cached files, and tiktoken-vs-heuristic delta in `src/panels/TraceDashboardPanel.ts`.

**Prompt**:
> Gemma Code v0.5.0 token-optimizer adoption — Phase 4 step 4.
>
> Extend `src/panels/TraceDashboardPanel.ts` with three new panels:
>
> 1. **Compression savings**: total `compression.original_bytes - compression.compressed_bytes` over the last hour / 24 h / session. Render as a single number with a sparkline.
> 2. **Cache-hit rate**: `tool-output-cache` hits / (hits + misses) and `web-response-cache` hits / (hits + misses). Show both side-by-side.
> 3. **Top cached files**: `ToolOutputCache.size()` total + the top 10 absolute paths by `hits` column.
>
> Constraints:
> - All HTML rendered through the existing `MarkdownRenderer.ts` + DOMPurify pipeline. No raw `innerHTML` from any source. Honor the existing CSP.
> - Read from `MetricsCollector.snapshot()` and a new `ToolOutputCache.stats()` and `WebResponseCache.stats()` helpers.
> - No new dependencies; reuse the existing webview message protocol in `src/panels/messages.ts`.
> - Refresh interval: 5 s (matches `MetricsCollector` flush cadence).
>
> Tests:
> - `tests/unit/panels/TraceDashboardPanel.cache.test.ts`: assert the three panels render given a fixture `MetricsCollector.snapshot()` and stub cache stats.
> - Manual test: `F5` to launch the Extension Development Host, open the Traces panel, perform a few `read_file` and `web_search` calls, confirm the panels populate.
>
> Acceptance: full Vitest suite green; `npm run lint` clean; manual smoke pass.

---

#### 4.5 — Phase 4 testing and stabilization

**Objective**: Run all Phase 4 tests; iterate until stable.

**Prompt**:
> Generate and run comprehensive tests for Phase 4 of the token-optimizer-adoption plan. Specifically:
>
> 1. Run `npm run lint`, `npm run build`, `npm run test`, `npm run test:integration`. Fix every failure.
> 2. Run `npm run bench`. The new `cache-hit.bench.ts` (from Phase 2) plus existing benchmarks must show no >10% regression on `tool-execution.bench.ts` or `context-compaction.bench.ts`.
> 3. Manual smoke: launch via `F5`, verify the new dashboard panels render with realistic data after exercising `read_file`, `web_search`, and a `/cache status` call.
> 4. Verify trace flushing: artificially crash the extension host (Developer: Restart Window) and confirm via SQLite inspection that the most recent batch was persisted (proves `dispose()` flush works).
> 5. After all tests pass, run `/generate-session-history` to document Phase 4.
>
> Do not advance to Phase 5 until every step above is fully verified.

---

### Phase 4 Exit Checklist

- [ ] `web-response-cache.sqlite` registered, chmod 0o600
- [ ] `web_search` returns cached responses on TTL hit; SSRF re-validation enforced
- [ ] In-process LRU layer measurable via `lruStats()`
- [ ] `MetricsCollector` flushes every 5 s / 100 events; `dispose()` flushes synchronously
- [ ] Three new dashboard panels render correctly
- [ ] No benchmark regression > 10%
- [ ] Full Vitest + integration + nightly green
- [ ] Session history generated

---

## Phase 5: CI Hygiene + Advanced Fallbacks

**Goal**: Add a Node-version CI matrix (18 / 20 / 22), introduce semantic-release + commitlint for automated changelog and version bumps, add ARIMA-only predictive caching (pure-JS, no LSTM), expose the multi-tier eviction strategies (ARC, W-TinyLFU, Clock) behind a setting, and ship a heuristic 128-D embedder (`HeuristicEmbedder.ts`) as the offline fallback when Ollama embeddings are unavailable.

**Prerequisites**: Phases 1-4.

**Stability Gate**: CI runs all three Node versions green; semantic-release dry-run produces a valid changelog stanza; commitlint blocks a malformed commit message; ARIMA predictive cache improves cache pre-warm hit rate by ≥ 10% on the iterative-debug golden task category; heuristic embedder is observable as the fallback path when Ollama is offline; **final golden-task baseline `tests/golden/baselines/v0.5.0+adoption.json` shows ≥ 40% average tool-output token reduction vs. v0.5.0** and the recorded benchmark deltas show no > 10% regression.

### Sub-tasks

#### 5.1 — Node-version CI matrix

**Objective**: Run `ci.yml` against Node 18, 20, and 22.

**Prompt**:
> Gemma Code v0.5.0 token-optimizer adoption — Phase 5 step 1.
>
> Modify `.github/workflows/ci.yml`:
>
> - Add `strategy.matrix.node: [18.x, 20.x, 22.x]` to the `lint-ts`, `test-ts`, and `build-ts` jobs.
> - Use `actions/setup-node@v4` (current stable) with `node-version: ${{ matrix.node }}`.
> - Add `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }` at workflow level so superseded pushes do not waste CI minutes.
> - Update `engines.node` in `package.json` to `>=18.0.0` (current target) and confirm no syntax requires a newer Node.
>
> Acceptance: push a branch and confirm three matrix legs run; previous push to the same branch is auto-cancelled.

---

#### 5.2 — semantic-release + commitlint

**Objective**: Automate version bumps and changelog generation via semantic-release; enforce conventional commits via commitlint in CI.

**Prompt**:
> Gemma Code v0.5.0 token-optimizer adoption — Phase 5 step 2.
>
> Add semantic-release + commitlint:
>
> - Install `semantic-release` ^25.x and the conventional-commits plugin set (`@semantic-release/changelog`, `@semantic-release/git`, `@semantic-release/github`) as devDependencies.
> - Install `@commitlint/cli` and `@commitlint/config-conventional` as devDependencies.
> - Create `commitlint.config.cjs` referencing `@commitlint/config-conventional`.
> - Create a new workflow `.github/workflows/commitlint.yml` running on PR `synchronize` and `opened` that lints commit messages.
> - Create a new workflow `.github/workflows/release.yml` (or extend the existing one) running semantic-release on push to `main`. Configure it to:
>   - Update `CHANGELOG.md` automatically (Keep-a-Changelog format already in use).
>   - Bump `package.json` `version`.
>   - Tag the commit.
>   - Build the VSIX (existing `scripts/build-vsix.ps1` can be wrapped via PowerShell-on-Linux or replicated with `vsce package`).
>   - Upload artifacts to a GitHub Release.
> - Document in `CONTRIBUTING.md` the conventional-commits format. **Do not** add a `prepare-commit-msg` hook injecting a `Co-Authored-By` template — `CLAUDE.md` forbids it.
>
> Constraints:
> - Build steps in CI must NOT publish to npm (Gemma is a VSIX, not an npm package). semantic-release plugin chain: changelog → git → github (no `@semantic-release/npm`).
> - Existing `scripts/build-vsix.ps1` is PowerShell; consider keeping a parallel `vsce package` call in the GH workflow for cross-platform CI.
>
> Acceptance: a PR with a `feat:` commit triggers commitlint pass; a malformed `fix bug` commit fails; semantic-release dry-run on `main` produces a valid version-bump plan.

---

#### 5.3 — ARIMA predictive cache (pure-JS only)

**Objective**: Pre-warm the tool-output cache using a pure-JS ARIMA model on the access-pattern history; LSTM excluded by hard constraint.

**Prompt**:
> Gemma Code v0.5.0 token-optimizer adoption — Phase 5 step 3.
>
> Add a predictive cache layer behind a feature flag:
>
> - New module `src/storage/PredictiveCache.ts` exposing `class PredictiveCache { observe(absolutePath: string): void; predict(topK: number): string[]; }`.
> - Use a small pure-JS ARIMA implementation (write a minimal one — order (1,0,1) is enough; ~80 LOC). Do NOT add a heavyweight ML dependency. **Do not add an LSTM path of any kind** — that is explicitly out of scope.
> - On every tool-output cache lookup, call `observe(absolutePath)`. The model maintains a per-path arrival-time series.
> - On idle (use the existing event loop or a debounced 30 s timer), call `predict(5)` to surface the top 5 paths likely to be read soon, and pre-`lookup` them so they're warm in the LRU. Cap the pre-warm budget at 5 paths × 50 KB = 250 KB additional memory.
> - Add a setting `gemma-code.predictiveCacheEnabled` (default `false` — opt-in for v0.5.0).
> - Surface predictive-cache hits as a separate metric `cache.predictive_hit` so the dashboard can show what the model contributed.
>
> Constraints:
> - Offline-first: pure JavaScript; no model file; no GPU cycles.
> - When `enabled === false`, the module compiles in but does no work — verify zero observable behavior change.
>
> Tests:
> - `tests/unit/storage/PredictiveCache.test.ts`: feed a known-periodic access pattern; assert `predict` returns the periodic path; feed white noise; assert prediction confidence is below the surface threshold.
> - `tests/benchmarks/predictive-cache.bench.ts`: ARIMA fit on 1000 observations completes < 50 ms.
>
> Acceptance: full Vitest suite green; `npm run lint` clean; setting toggle exercised in `tests/integration/`.

---

#### 5.4 — Multi-tier eviction strategies

**Objective**: Make the eviction policy on `ToolOutputCache` and the in-process LRU pluggable: support LRU (default), LFU, ARC, W-TinyLFU, Clock — all pure-JS implementations behind a setting.

**Prompt**:
> Gemma Code v0.5.0 token-optimizer adoption — Phase 5 step 4.
>
> Extract eviction logic from `src/storage/ToolOutputCache.ts` into `src/storage/eviction/`:
>
> - `LRUEvictor`, `LFUEvictor`, `ARCEvictor`, `WTinyLFUEvictor`, `ClockEvictor` — each implementing a common interface `interface Evictor { onAccess(key): void; onInsert(key, size): void; pickVictim(): string | null }`.
> - Configurable via setting `gemma-code.cacheEvictionStrategy` (default `lru`). Document each strategy's trade-offs in `package.json` `enumDescriptions`.
> - Each strategy in pure JavaScript; no native modules; no new dependencies.
> - Provide a small benchmark fixture (`tests/benchmarks/eviction-strategies.bench.ts`) that compares hit-rate across strategies on the existing golden-task access trace (collect once into `tests/fixtures/access-trace.json`).
>
> Tests:
> - `tests/unit/storage/eviction/*.test.ts`: each strategy's behaviour on a known sequence (e.g. classic LRU vs. ARC trace).
>
> Acceptance: full Vitest suite green; `npm run lint` clean; default strategy preserves Phase 2 behavior exactly.

---

#### 5.5 — Heuristic 128-D embedder fallback

**Objective**: Ship a model-free 128-D embedder (`HeuristicEmbedder.ts`) computing hash + statistics + n-grams features so semantic recall keeps working when Ollama is unreachable; clearly mark its lower recall in metrics.

**Prompt**:
> Gemma Code v0.5.0 token-optimizer adoption — Phase 5 step 5.
>
> Create `src/storage/HeuristicEmbedder.ts` implementing a 128-D embedding using:
>
> - Hash features (1/6 of the vector): bucketed term hashes via `crypto.createHash('sha1')`.
> - Statistics features (1/3): document-level statistics — length, avg word length, ratio of digits, ratio of punctuation, line count, indent-level distribution.
> - N-gram features (1/2): bigram + trigram presence over a fixed vocabulary of 64 common code/text tokens.
> - L2-normalize the result to unit length.
>
> Wire it as a fallback path in `src/storage/EmbeddingClient.ts`: when the Ollama call fails (network error, 404 model not found, timeout), retry once via `HeuristicEmbedder.embed(text)` and tag the result with `provenance: 'heuristic'`. Bubble the provenance up so `searchToolOutputs` can lower the cosine threshold to 0.95 (heuristic embeddings are noisier — fewer false positives at higher threshold) when querying heuristic-embedded entries.
>
> Constraints:
> - Pure JavaScript; no model file; deterministic; offline-safe.
> - Document the recall difference in `SECURITY.md` "operational caveats" or in `docs/v0.5.0/architecture.md`.
> - When Ollama recovers, do NOT auto-replace heuristic embeddings — let them remain until natural eviction. Add a `/cache reembed` slash command that walks heuristic-tagged rows and re-embeds them via Ollama on demand.
>
> Tests:
> - `tests/unit/storage/HeuristicEmbedder.test.ts`: deterministic output for the same input; cosine similarity > 0.5 for paraphrases of the same sentence; cosine < 0.2 for unrelated text.
> - `tests/integration/heuristic-fallback.test.ts`: with mocked `EmbeddingClient` failure, end-to-end semantic recall still returns relevant results above the 0.95 threshold.
>
> Acceptance: full Vitest suite green; `npm run lint` clean; `/cache reembed` exposed via `/help`.

---

#### 5.6 — Phase 5 testing and stabilization (final adoption gate)

**Objective**: Run the full test, benchmark, and golden-task suite; produce the v0.5.0+adoption baseline; verify the ≥40% token-savings target.

**Prompt**:
> Gemma Code v0.5.0 token-optimizer adoption — Phase 5 (FINAL stabilization).
>
> Generate and run comprehensive tests for the entire adoption:
>
> 1. Run `npm run lint`, `npm run build`, `npm run test`, `npm run test:integration`. Fix every failure or warning.
> 2. Run `npm run bench`. Compare against the baseline numbers in `tests/benchmarks/`. **No more than +10% regression** on any benchmark; otherwise diagnose and fix.
> 3. Run the full golden-task suite: `python tests/golden/framework/run_all.py`. For each task, capture `total_tokens` and `tool_output_tokens` per turn. Write the new baseline to `tests/golden/baselines/v0.5.0+adoption.json`.
> 4. Compute the average tool-output-token reduction across the 24 golden tasks vs. `tests/golden/baselines/v0.4.0.json`. **The reduction must be ≥ 40%**. If lower, identify which tasks regressed and which P-level item is the most likely cause; iterate on configuration (Brotli quality, cache cap, threshold) before declaring failure.
> 5. Compute the cache-hit rate on the iterative-debug task category. **It must exceed 50%.** If lower, examine cache invalidation rules.
> 6. Push to a fresh branch and confirm the GitHub Actions matrix (Node 18/20/22) is green; commitlint passes on a `feat: token-optimizer adoption (P0-P3)` commit.
> 7. Update `docs/v0.5.0/architecture.md` with a "Cache architecture" section describing the new cache files (`tool-output-cache.sqlite`, `web-response-cache.sqlite`), the in-process LRU, and the predictive/eviction settings.
> 8. Update `CHANGELOG.md` with the adoption entry.
> 9. Run `/generate-session-history` to document Phase 5.
> 10. Run `/update-devlog` to capture the final summary.
>
> Do not declare the adoption complete until steps 1-9 are fully green and step 4 / step 5 thresholds are met.

---

### Phase 5 Exit Checklist

- [ ] CI matrix green on Node 18 / 20 / 22 with `concurrency: cancel-in-progress`
- [ ] semantic-release + commitlint workflows passing
- [ ] ARIMA predictive cache opt-in setting available; LSTM not present in the codebase
- [ ] Five eviction strategies pluggable; default LRU preserves Phase 2 behavior
- [ ] `HeuristicEmbedder.ts` present; `/cache reembed` command works
- [ ] `tests/golden/baselines/v0.5.0+adoption.json` written
- [ ] **Average tool-output token reduction ≥ 40%** vs. v0.4.0 baseline
- [ ] **Cache-hit rate > 50%** on iterative-debug golden tasks
- [ ] No benchmark regression > 10%
- [ ] `docs/v0.5.0/architecture.md` updated with the cache architecture
- [ ] `CHANGELOG.md` updated
- [ ] Session history + devlog updated

---

## Definition of Done (Plan-Level)

The adoption is complete when **all** of the following hold:

1. (a) Golden-task suite shows ≥40% average tool-output token reduction vs. `tests/golden/baselines/v0.4.0.json`; cache hit rate > 50% on the iterative-debug task category.
2. (b) Full Vitest suite green; `tests/benchmarks/` shows no > 10% regression on tool-execution / context-compaction / cache-hit benchmarks; nightly Ollama integration green.
3. The 16 in-scope adoption items are all landed (or explicitly waived with rationale captured in this plan's history).
4. No runtime network egress added by any change; all caches respect the secret-path denylist; all new SQLite files are chmod 0o600 on POSIX.
5. `docs/v0.5.0/architecture.md` and `CHANGELOG.md` reflect the new cache architecture.

---

## Out of Scope (Recorded for Future Versions)

- LSTM-based predictive caching (requires model file; deferred to a future version exploring on-device fine-tuning)
- A "balance speed vs. quality" mode toggle (per user note on this plan; deferred)
- Replacing nomic-embed-text with a smaller embedding model
- Sharing the cache across workspaces (single-workspace by design today)
- Distributed cache (multi-machine) — explicitly excluded by the offline-first single-GPU constraint
