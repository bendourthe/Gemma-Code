# Development Log: v0.6.0 Phase 5 -- Doc/code drift + dead-code cleanup

**Date**: 2026-05-03
**Operator**: Benjamin Dourthe
**Assisted by**: Claude Opus 4.7 (1M context) via Claude Code
**Objective**: Resolve every documented-but-not-implemented claim that survived v0.5.0. Decide PredictiveCache (wire or delete). Decide threshold elevation (implement or retract). Delete the legacy `gemma-code.gpuTier` setting. Fix three architecture-doc inaccuracies (meta-test path, v0.4.0 ship date, hand-written permission-tier table). Reconcile the FIFO-vs-LRU mismatch in `ToolOutputCache.prune()`. Add a migration-idempotency regression test.
**Outcome**: All seven sub-tasks complete. PredictiveCache deleted (Option B). Threshold elevation implemented (Option A). Legacy `gpuTier` removed. All three doc bugs fixed; the permission-tier table is now programmatically generated from `PermissionTiers.ts` and gated in CI. `ToolOutputCache` runs true LRU with an `accessed_at` column; the migration ladder is regression-tested for idempotency. `npm run build` / `lint` / `test` / `deps:check` all green; 1579 tests pass.

---

## 1. Starting State

- **Branch**: `main` (no Phase 5 commit yet; awaiting `/generate-commit-message`)
- **Starting commit**: `4491f98` (`feat(v0.6.0): module-boundary ratchet (Phase 4)`)
- **Environment**: Windows 11 Pro 10.0.26200, Node 24, PowerShell + Bash via Git for Windows, Vitest 1.6.1, TypeScript strict + `noUncheckedIndexedAccess`
- **Plan reference**: [docs/v0.6.0/plans/v0.6.0-cycle.md](../../plans/v0.6.0-cycle.md), Phase 5 (sub-tasks 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7)
- **Pre-Phase-5 state**: `deps:check` clean post Phase 4. One unrelated `no-orphans` warning on `PredictiveCache.ts` flagged for the wire-or-delete decision. Three architecture-doc inaccuracies catalogued in [docs/v0.6.0/review/known-gaps.md](../../review/known-gaps.md). The `it.todo` placeholder for threshold elevation in `tests/integration/heuristic-fallback.test.ts` has been waiting since Phase 2 sub-task 2.5.

Context: Phases 1-4 closed the security chain, made the test pipeline trustworthy, landed the medium-severity ratchets, and finished the module-boundary contracts. Phase 5 closes the doc/code drift before the deeper restructuring (Phase 6 panel decomposition) lands. The work is intentionally sequenced after Phase 4 so the boundary contracts are stable when the cache layer is reshaped.

---

## 2. Chronological Steps

### 2.1 Sub-task 5.1 -- Delete `PredictiveCache` (Option B)

**Plan specification**: Decide whether to wire the predictive cache (Option A) or delete it (Option B). Decision criterion: bench shows >= 10% hit-rate uplift on the access-trace fixture (wire) or < 10% (delete). Document the decision and the measurement.

**Decision**: Option B (delete). Three converging reasons made this the only defensible call:

1. **Hard constraint #1 of the v0.6.0 cycle** is "no new product surface." Wiring `PredictiveCache` would require adding a 30-second debounced timer plus a pre-warm loop in `GemmaRuntime` (or a dedicated `PredictiveCacheCoordinator`). That is new behavior, exposed via the existing `gemma-code.predictiveCacheEnabled` setting, but it is *new product surface* in every observable sense -- timers, side effects, opt-in surface area, telemetry to design.
2. **The setting is unwired today.** A `Grep` for `predictiveCacheEnabled` returned exactly zero hits outside the `PredictiveCache` module's own docstring -- no `getSettings()` consumer, no panel, no runtime, no agent loop touches it. Deleting the feature has no observable user impact because the feature has no observable user impact in the first place.
3. **The bench measures latency, not hit-rate.** The plan's decision criterion ("if the bench shows < 10% hit-rate improvement") is unverifiable because no hit-rate bench exists. Building the access-trace fixture and the hit-rate bench, then deciding, is itself new work. With (1) and (2) already closing the case, the additional measurement is unnecessary.

**What happened**:

1. Deleted [src/storage/PredictiveCache.ts](../../../../src/storage/PredictiveCache.ts), `tests/unit/storage/PredictiveCache.test.ts`, `tests/unit/storage/PredictiveCache.budget.test.ts`, and [tests/benchmarks/predictive-cache.bench.ts](../../../../tests/benchmarks/predictive-cache.bench.ts).
2. Removed the `gemma-code.predictiveCacheEnabled` block from [package.json](../../../../package.json) `contributes.configuration.properties`.
3. Removed the `+--- Predictive layer ---+` ASCII block from [docs/v0.5.0/architecture.md](../../../v0.5.0/architecture.md) Section 4 ("Cache stack"). The cache stack diagram now ends at `WebResponseCache`.
4. Removed the three PredictiveCache benchmark entries (`observe()`, `predict(top=5)`, `forecastARIMA101`) plus the `"PredictiveCache throughput"` group header from [tests/benchmarks/baselines/v0.6.0.json](../../../../tests/benchmarks/baselines/v0.6.0.json) so `scripts/check-bench-regressions.mjs` no longer expects benches that do not exist.
5. Added a `### Removed` section under `## [Unreleased]` in [CHANGELOG.md](../../../../CHANGELOG.md) recording both the `PredictiveCache` removal and the `predictiveCacheEnabled` setting removal with the rationale.
6. Verified `Grep` for `PredictiveCache|predictiveCacheEnabled|ARIMA` against `src/` and `tests/` returned zero matches.

**Key files changed**: 4 deletions, 4 modifications (package.json, architecture.md, baselines/v0.6.0.json, CHANGELOG.md).

**Verification**: `npm run build` clean. `npm run deps:check` clean (the previously-orphaned `PredictiveCache.ts` warning is gone with the file).

---

### 2.2 Sub-task 5.3 -- Delete legacy `gemma-code.gpuTier` fallback

**Plan specification**: Delete the `readGpuTierOverride` legacy branch in [src/config/settings.ts](../../../../src/config/settings.ts) lines 46-58. The shim reads the legacy `gemma-code.gpuTier` string and maps it to `gpuTierOverride`. The inline NOTE says `remove in v0.5`; we are in v0.6. Add a `### Removed` entry to the v0.6.0 CHANGELOG section.

**What happened**:

1. Removed the `readGpuTierOverride` helper and the `// NOTE(v0.5): remove gpuTier fallback. ...` comment block from [src/config/settings.ts](../../../../src/config/settings.ts).
2. Inlined the canonical-only read at the call site: `gpuTierOverride` is now `config.get<number | null>("gpuTierOverride")` clamped to the literal-union `1 | 2 | 3 | null`. Users with stale `gemma-code.gpuTier` strings fall back to auto-detect (the v0.5+ default).
3. Removed `"gpuTier"` from the `nonReactiveKeys` list in [tests/integration/config-reload.test.ts](../../../../tests/integration/config-reload.test.ts). The umbrella-listener assertion is now correctly sized to 3 keys (`permissionOverrides`, `autoDetectGpu`, `gpuTierOverride`).
4. Added the `Legacy gemma-code.gpuTier string setting removed. Use gemma-code.gpuTierOverride: number | null instead.` entry to the `## [Unreleased]` `### Removed` block in CHANGELOG.

**Key files changed**: `src/config/settings.ts` (~14 lines removed, ~4 lines added), `tests/integration/config-reload.test.ts` (1 line removed), `CHANGELOG.md` (1 entry).

**Verification**: `npx tsc --noEmit` clean. `tests/unit/config/settings.test.ts` (6 tests), `tests/integration/config-reload.test.ts` (17 tests), `tests/unit/extension.test.ts` (5 tests) -- all pass.

---

### 2.3 Sub-task 5.4 -- Fix architecture-doc inaccuracies

**Plan specification**: Fix three doc bugs. (a) The Section 1 reference to `tests/unit/meta/no-claude-md.test.ts` -- the actual file is `tests/unit/docs/AGENTS-md.test.ts`. (b) `## [0.4.0] -- 2026-04-22` in CHANGELOG should be `2026-04-25` to match the commit date of `ef6d8b3`. (c) The Section 3 tool-permission-tier table is plausible-but-unaudited; re-derive it programmatically from `ToolCatalog.ts` (or, in our case, the actual source of truth, `PermissionTiers.ts`).

**What happened**:

1. (a) Updated the Section 1 sentence in [docs/v0.5.0/architecture.md](../../../v0.5.0/architecture.md) to point at `tests/unit/docs/AGENTS-md.test.ts`.
2. (b) Bumped the v0.4.0 heading in [CHANGELOG.md](../../../../CHANGELOG.md) from `2026-04-22` to `2026-04-25`. The actual commit date of `ef6d8b3` (verified via `git log --format=%cd --date=short -1 ef6d8b3`) is `2026-04-25`.
3. (c) Replaced the hand-written tool-permission-tier table in architecture.md Section 3 with a marker block: `<!-- BEGIN:TOOL-PERMISSION-TABLE -->` / `<!-- END:TOOL-PERMISSION-TABLE -->`.
4. Wrote [scripts/generate-tool-permission-table.mjs](../../../../scripts/generate-tool-permission-table.mjs). The script parses `TOOL_PERMISSION_MAP` directly out of [src/guardrails/PermissionTiers.ts](../../../../src/guardrails/PermissionTiers.ts) source text (a regex over `name: PermissionTier.X` pairs), groups entries by tier, and writes a 4-row markdown block. `--check` mode exits non-zero when the doc is out of sync. The script intentionally avoids importing the compiled TS so it runs in CI without requiring `npm run build` first.
5. Added two npm scripts: `perm-tier` (regenerate) and `perm-tier:check` (CI gate).
6. Extended the `catalog-sync` job in [.github/workflows/ci.yml](../../../../.github/workflows/ci.yml) with a new step `npm run perm-tier:check` so future drift fails CI alongside the existing `docs/index.md` check.

The hand-written table had two real errors. The old table claimed:
- `delete_file` was tier 2 (DANGEROUS) -- actually tier 1 (CONFIRM) per `PermissionTiers.ts`.
- `web_search` was tier 1 (CONFIRM) -- actually tier 2 (DANGEROUS).

The generated table corrects both. Tier 0 now lists `grep_codebase`, `grep_output`, `list_directory`, `read_file`, `tail_output`. Tier 1 lists `create_file`, `delete_file`, `edit_file`, `write_file`. Tier 2 lists `fetch_page`, `run_terminal`, `web_search`.

**Key files changed**: `docs/v0.5.0/architecture.md` (Section 1 sentence + Section 3 table replaced with markers), `CHANGELOG.md` (1 date), `scripts/generate-tool-permission-table.mjs` (new, ~110 lines), `package.json` (2 npm scripts), `.github/workflows/ci.yml` (1 step added to catalog-sync).

**Verification**: `npm run perm-tier:check` exits 0. `tests/unit/docs/AGENTS-md.test.ts` confirms the new doc reference is reachable (5 tests pass).

---

### 2.4 Sub-task 5.5 -- True LRU eviction in `ToolOutputCache.prune()`

**Plan specification**: Audit `prune()`. Current ordering uses `stored_at` (FIFO). Decision A (correct the doc, claim FIFO) or B (correct the code, true LRU). Plan recommendation: B. Add an `accessed_at` column; update `lookup()` to bump `accessed_at`; update `prune()` to ORDER BY `accessed_at`; add a hot-vs-cold regression test.

**What happened**:

1. Added an additive migration in `_initSchema()`. When `accessed_at` is absent: `ALTER TABLE tool_output_cache ADD COLUMN accessed_at INTEGER NOT NULL DEFAULT 0`, then `UPDATE tool_output_cache SET accessed_at = stored_at WHERE accessed_at = 0` to backfill, then `CREATE INDEX IF NOT EXISTS idx_tool_output_cache_accessed_at`.
2. Updated `store()` to write `accessed_at = now` alongside `stored_at = now` on insert, and `accessed_at = excluded.accessed_at` on conflict-update.
3. Updated `lookup()` to bump `accessed_at = Date.now()` on every cache hit -- both the LRU-hit branch (which previously only did `hits = hits + 1`) and the SQLite-row-hit branch.
4. Updated `_enforceCapacity()` to `ORDER BY accessed_at ASC` (was `stored_at ASC`).
5. Updated the docstring at the top of `ToolOutputCache.ts` to read "LRU eviction by `accessed_at` (last hit timestamp; backfilled to `stored_at` on insert)."
6. Renamed the existing capacity test in `tests/unit/storage/ToolOutputCache.test.ts` from `(LRU by stored_at)` to `(LRU by accessed_at)` -- the test still passes unchanged because in absence of intervening lookups, accessed_at == stored_at, preserving the FIFO observation.
7. Added a new "preserves a hot row and evicts a cold row" regression: stores `hot.txt` first, then four `cold0..cold3` files; bumps `hot`'s `accessed_at` via a `lookup`; inserts a 6th file. Asserts `hot` survives and `cold0` (oldest cold row) is evicted. Without the LRU change this test would fail because FIFO would evict `hot` first.

**Key files changed**: `src/storage/ToolOutputCache.ts` (~15 lines added across migration / store / lookup / `_enforceCapacity`), `tests/unit/storage/ToolOutputCache.test.ts` (1 test renamed + 1 new test).

**Verification**: All 15 ToolOutputCache unit tests pass.

---

### 2.5 Sub-task 5.6 -- Migration-ordering regression test

**Plan specification**: Add `tests/integration/tool-output-cache-migration.test.ts`. (1) seed a SQLite file with the v0.4.0 schema; (2) open through current `ToolOutputCache`, confirm migrations run cleanly; (3) close + re-open, migrations no-op (idempotent); (4) assert all new columns exist; (5) write + read through the migrated schema.

**What happened**:

1. Wrote the test file with four cases. Test 1 ("runs every additive migration on first open of a v0.4.0-shaped DB") seeds a fresh SQLite with only the v0.4.0 columns (`absolute_path`, `mtime_ms`, `size_bytes`, `content_brotli`, `stored_at`, `hits`), opens with the current `ToolOutputCache`, asserts that `embedding`, `embedding_provenance`, `excerpt`, and `accessed_at` all now exist.
2. Test 2 ("backfills accessed_at to stored_at for pre-migration rows") seeds a row with `stored_at = 1_700_000_000_000` and confirms the migration backfills `accessed_at` to the same value.
3. Test 3 ("close + re-open of an already-migrated DB is a no-op") opens, closes, opens, closes, opens, closes -- captures `table_info` shape after each pass and asserts shape is identical. This catches the failure mode where a migration ALTER runs unconditionally (would error on second open because the column already exists).
4. Test 4 ("round-trips a fresh write/read through the migrated schema") proves that after migration the cache can `store` and `lookup` a new entry, with `excerpt` populated from `_truncateExcerpt` and `accessed_at` set to a non-zero `Date.now()`.

**Key file added**: `tests/integration/tool-output-cache-migration.test.ts` (~140 lines, 4 tests).

**Verification**: All 4 tests pass in 117 ms.

---

### 2.6 Sub-task 5.2 -- Implement threshold elevation (Option A)

**Plan specification**: In `searchByEmbedding`, change the SQL to also `SELECT embedding_provenance` and apply per-row threshold: if `provenance === 'heuristic' && cosine < 0.95` skip. Make per-provenance thresholds configurable: `gemma-code.heuristicEmbeddingThreshold = 0.95`, `gemma-code.ollamaEmbeddingThreshold = 0.85`. The `it.todo` integration test in `tests/integration/heuristic-fallback.test.ts` should now pass.

**What happened**:

1. Added `DEFAULT_HEURISTIC_SEMANTIC_THRESHOLD = 0.95` next to the existing `DEFAULT_SEMANTIC_THRESHOLD = 0.85` in [src/storage/ToolOutputCache.ts](../../../../src/storage/ToolOutputCache.ts).
2. Extended `searchByEmbedding(queryVec, options)` `options` type with `heuristicThreshold?: number`. The existing `threshold?` field stays, now interpreted as the ollama-tier threshold.
3. The SQL now reads `SELECT absolute_path, embedding, embedding_provenance, content_brotli ...`. The scoring loop checks `row.embedding_provenance === "heuristic"` to pick the row's threshold; rows with provenance `'ollama'` or NULL use the lower bar (NULL conservatively classified as the higher-quality tier, since heuristic rows are always tagged).
4. Added two settings to [src/config/settings.ts](../../../../src/config/settings.ts) `GemmaCodeSettings`: `ollamaEmbeddingThreshold` and `heuristicEmbeddingThreshold`, both clamped to `[0, 1]`. Registered them in [package.json](../../../../package.json) `contributes.configuration.properties` with `minimum: 0`, `maximum: 1`, defaults 0.85 and 0.95 respectively.
5. Plumbed `heuristicThreshold` through [src/storage/UnifiedMemoryRetriever.ts](../../../../src/storage/UnifiedMemoryRetriever.ts) -- `ToolOutputSearchOptions` gains the optional field, and `searchToolOutputs` forwards it via spread (`...(heuristicThreshold !== undefined ? { heuristicThreshold } : {})`) to keep the call signature minimal.
6. Replaced the three `it.todo` placeholders in [tests/integration/heuristic-fallback.test.ts](../../../../tests/integration/heuristic-fallback.test.ts) with three real tests:
   - **filters heuristic-tagged rows below the elevated cosine threshold**: stores two heuristic-tagged rows -- `near.txt` with `[1, 0, 0, 0]` (cosine 1.0 vs query) and `far.txt` with `[0.92, 0.39, 0, 0]` (cosine ~0.92). Asserts only `near.txt` survives because 0.92 < 0.95.
   - **preserves the default 0.85 threshold for ollama-provenance rows**: same vectors, but tagged `ollama`. Asserts both rows survive because 0.92 >= 0.85.
   - **falls back to keyword search when no rows clear the elevated threshold**: stores a single heuristic row at cosine 0.92; semantic step returns 0; FTS5 fallback matches the literal `alpha` keyword.

**Key files changed**: `src/storage/ToolOutputCache.ts` (~15 lines), `src/storage/UnifiedMemoryRetriever.ts` (~5 lines), `src/config/settings.ts` (~6 lines + 2 type fields), `package.json` (2 setting entries), `tests/integration/heuristic-fallback.test.ts` (rewritten end-to-end, 3 tests).

**Verification**: `tests/integration/heuristic-fallback.test.ts` -- all 3 tests pass. `tests/unit/storage/ToolOutputCache.semantic.test.ts` (existing 8+ tests) all pass with the new SQL select.

---

### 2.7 Sub-task 5.7 -- Stabilization

`npm run build`: tsc clean. `npm run lint`: 0 errors, 1 pre-existing warning (`GpuDetector.ts` missing return type, unrelated to Phase 5). `npm run deps:check`: 0 errors, 0 cycle warnings, 121 modules / 432 dependencies. `npm run test`: 142 passed, 1 skipped (Ollama integration auto-skips when `OLLAMA_URL` unset), 0 failures, 1579 individual tests in 30 seconds. `npm run perm-tier:check`: doc in sync. `npm run catalog`: regenerated `docs/index.md` to reflect the storage module dropping from 30 to 29 (PredictiveCache deletion).

---

## 3. Files Created / Deleted

**Created**:
- [scripts/generate-tool-permission-table.mjs](../../../../scripts/generate-tool-permission-table.mjs)
- [tests/integration/tool-output-cache-migration.test.ts](../../../../tests/integration/tool-output-cache-migration.test.ts)
- This file ([docs/v0.6.0/development/history/2026-05_phase-5-doc-code-drift.md](2026-05_phase-5-doc-code-drift.md))

**Deleted**:
- `src/storage/PredictiveCache.ts`
- `tests/unit/storage/PredictiveCache.test.ts`
- `tests/unit/storage/PredictiveCache.budget.test.ts`
- `tests/benchmarks/predictive-cache.bench.ts`

**Modified** (significant):
- [src/storage/ToolOutputCache.ts](../../../../src/storage/ToolOutputCache.ts) -- accessed_at migration; per-provenance threshold filter; LRU prune order.
- [src/storage/UnifiedMemoryRetriever.ts](../../../../src/storage/UnifiedMemoryRetriever.ts) -- threshold plumbing.
- [src/config/settings.ts](../../../../src/config/settings.ts) -- gpuTier shim removed; per-provenance thresholds added.
- [package.json](../../../../package.json) -- predictiveCacheEnabled removed; ollama/heuristic embedding-threshold settings added; perm-tier scripts added.
- [docs/v0.5.0/architecture.md](../../../v0.5.0/architecture.md) -- meta-test path corrected; PredictiveCache section removed; permission-tier table replaced with generated block.
- [CHANGELOG.md](../../../../CHANGELOG.md) -- v0.4.0 date corrected; `### Removed` Unreleased block listing both legacy gpuTier and PredictiveCache deletions.
- [.github/workflows/ci.yml](../../../../.github/workflows/ci.yml) -- catalog-sync job extended with `perm-tier:check`.
- [tests/unit/storage/ToolOutputCache.test.ts](../../../../tests/unit/storage/ToolOutputCache.test.ts) -- existing capacity test renamed; hot-vs-cold regression added.
- [tests/integration/heuristic-fallback.test.ts](../../../../tests/integration/heuristic-fallback.test.ts) -- 3 `it.todo` placeholders replaced with 3 real tests.
- [tests/integration/config-reload.test.ts](../../../../tests/integration/config-reload.test.ts) -- removed `"gpuTier"` from non-reactive-keys list.
- [tests/benchmarks/baselines/v0.6.0.json](../../../../tests/benchmarks/baselines/v0.6.0.json) -- 4 PredictiveCache benchmark entries removed.
- [docs/index.md](../../../../docs/index.md) -- regenerated by `npm run catalog`.

---

## 4. Phase 5 Exit Checklist

- [x] `PredictiveCache` fully deleted (Option B). Justification documented above.
- [x] Threshold elevation implemented (Option A). Integration test from 2.5 is no longer `it.todo`.
- [x] Legacy `gemma-code.gpuTier` setting removed; CHANGELOG `### Removed` entry added.
- [x] 3 architecture-doc inaccuracies fixed: meta-test path, v0.4.0 ship date (2026-04-25), permission-tier table is now programmatically generated and CI-gated.
- [x] FIFO-vs-LRU reconciled: `accessed_at` column added; `lookup()` bumps it; `_enforceCapacity()` orders by it; hot-vs-cold regression test passes.
- [x] Migration idempotency regression test (4 cases) added.
- [x] Session history generated (this file).

---

## 5. Next Phase

Phase 6 -- Panel decomposition. Splits `GemmaCodePanel` into `ChatController` + `ChatWebviewHost` + handlers, splits `webview/index.ts` into scaffold/render/messages, hoists webview helpers. The `no-storage-from-panels` baseline exception (deferred from Phase 4) is closed during this split.
