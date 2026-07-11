# Development Log: v0.6.0 Phase 4 -- Module-boundary ratchet

**Date**: 2026-05-03
**Operator**: Benjamin Dourthe
**Assisted by**: Claude Opus 4.7 (1M context) via Claude Code
**Objective**: Ratchet the four `BASELINE-2026-04-25` exceptions in [configs/dependency-cruiser.cjs](../../../../versions/configs/dependency-cruiser.cjs) and untangle the two pre-existing circular dependencies. The four boundary rules in question -- `no-llm-outside-llm-folder`, `no-tools-from-storage`, `no-storage-from-panels`, `no-circular` -- carried grandfathered exceptions for: pre-runtime LLM bootstrap (`extension.ts`, `GemmaCodePanel`), `EmbeddingClient` reaching into `OllamaHttp`, two storage modules reaching into tool-side helpers (`secretPaths`, `Compressor`), three panels importing storage directly, and two cycles (`MemoryLayers.types <-> MemoryStore.types`; `SubAgentManager <-> AgentLoop`).
**Outcome**: Three of the four module-boundary exceptions close fully. Both circular cycles eliminated. The fourth rule (`no-storage-from-panels`) remains baselined per the plan's explicit deferral to Phase 6 panel decomposition. `npm run deps:check` returns 0 errors and 0 cycle warnings (1 unrelated `no-orphans` warning on `PredictiveCache.ts` is the Phase 5 wire-or-delete decision). Full test suite green; lint clean.

---

## 1. Starting State

- **Branch**: `main` (no Phase 4 commit yet; awaiting `/generate-commit-message`)
- **Starting commit**: `bc226f6` (`feat(v0.6.0): defense-in-depth ratchets (Phase 3)`)
- **Environment**: Windows 11 Pro 10.0.26200, Node 24, Bash via Git for Windows, Vitest 1.6.1, TypeScript strict + `noUncheckedIndexedAccess`
- **Plan reference**: [docs/archive/versions/v0/v0.6.0/plans/v0.6.0-cycle.md](../../plans/v0.6.0-cycle.md), Phase 4 (sub-tasks 4.1, 4.2, 4.3, 4.4, 4.5, 4.6)
- **Pre-Phase-4 `deps:check`**: 0 errors, 3 warnings (1 PredictiveCache orphan + 2 cycles).

Context: Phase 1 closed Attack Path A. Phase 2 made the test pipeline trustworthy. Phase 3 landed the medium-severity ratchets. Phase 4 finishes the cleanup of long-term boundary contracts so future code touches the right modules. The work is intentionally sequenced *before* Phase 6 panel decomposition because the boundary contract is what Phase 6 must preserve when the panel split lands.

---

## 2. Chronological Steps

### 2.1 Sub-task 4.1 -- Move `secretPaths.ts` and `Compressor.ts` to `src/utils/`

**Plan specification**: Move both files to `src/utils/`, update every importer, drop the `pathNot` exception list from the `no-tools-from-storage` rule, run `deps:check`, run tests, update the cross-reference comment in [scripts/hooks/lib/secret-paths.mjs](../../../../versions/scripts/hooks/lib/secret-paths.mjs). Closes 1 of 4 baseline exceptions.

**What happened**:

1. `git mv` moved `src/tools/handlers/secretPaths.ts -> src/utils/secretPaths.ts` and `src/tools/Compressor.ts -> src/utils/Compressor.ts`. Tests followed: `tests/unit/tools/handlers/secretPaths.test.ts -> tests/unit/utils/secretPaths.test.ts`, `tests/unit/tools/Compressor.test.ts -> tests/unit/utils/Compressor.test.ts`.
2. Updated importers across `src/`:
   - [src/observability/OperationLog.ts](../../../../versions/src/observability/OperationLog.ts): `../tools/handlers/secretPaths.js -> ../utils/secretPaths.js`
   - [src/storage/MemoryHealthCheck.ts](../../../../versions/src/storage/MemoryHealthCheck.ts): same rewrite
   - [src/storage/ToolOutputCache.ts](../../../../versions/src/storage/ToolOutputCache.ts): both `Compressor` and `secretPaths`
   - [src/tools/handlers/filesystem.ts](../../../../versions/src/tools/handlers/filesystem.ts): `./secretPaths.js -> ../../utils/secretPaths.js`
   - [src/tools/OutputRedirector.ts](../../../../versions/src/tools/OutputRedirector.ts): `./Compressor.js -> ../utils/Compressor.js`
   - [src/panels/TraceDashboardPanel.ts](../../../../versions/src/panels/TraceDashboardPanel.ts): `../tools/Compressor.js -> ../utils/Compressor.js`
3. Updated test imports: `tests/unit/utils/secretPaths.test.ts`, `tests/unit/utils/Compressor.test.ts`, `tests/unit/tools/OutputRedirector.test.ts`, `tests/unit/panels/TraceDashboardPanel.cache.test.ts`, `tests/unit/hooks/secret-paths-sync.test.ts`, `tests/integration/tool-output-compression.test.ts` (also updated the synthetic grep-output sample paths in `buildGrepResult` so the test fixture matches reality).
4. Updated the docstring in [scripts/hooks/lib/secret-paths.mjs](../../../../versions/scripts/hooks/lib/secret-paths.mjs) so the cross-reference points at `src/utils/secretPaths.ts`.
5. Dropped the `pathNot` exception list from `no-tools-from-storage` in [configs/dependency-cruiser.cjs](../../../../versions/configs/dependency-cruiser.cjs) and removed its `BASELINE-2026-04-25` annotation. The rule is now the long-term shape: `from: { path: '^src/storage/' }, to: { path: '^src/tools/' }`.

**Key files changed**: `src/utils/secretPaths.ts` (moved), `src/utils/Compressor.ts` (moved), 6 importer files, 6 test files, `configs/dependency-cruiser.cjs`, `scripts/hooks/lib/secret-paths.mjs`.

**Verification**: `npm run deps:check` -> 0 errors. `npx tsc --noEmit` clean. `tests/unit/utils/secretPaths.test.ts` (23 tests pass), `tests/unit/utils/Compressor.test.ts` (23 pass).

---

### 2.2 Sub-task 4.2 -- Refactor `EmbeddingClient` to consume the LLM port

**Plan specification**: Add an optional `embed` method to the `LLMClient` port. Implement it in `OllamaClient` by delegating through `OllamaHttp.postJson`. Refactor `EmbeddingClient` to consume the port (constructor injection of `LLMClient`), not `OllamaHttp`. Update `MemorySubsystem` and `HeuristicEmbedder`. Drop the `EmbeddingClient` exception from `no-llm-outside-llm-folder`.

**What happened**:

1. Extended [src/llm/types.ts](../../../../versions/src/llm/types.ts) with `LLMEmbedResult { embedding: number[] | null, available: boolean }`. Added `embed?` and `embedBatch?` as optional methods on `LLMClient`. The two-field result lets callers distinguish "model not loaded" (a hard miss; bypass retries) from "transient failure" (`embedding === null` with `available === true`).
2. Implemented `embed` and `embedBatch` in [src/llm/OllamaClient.ts](../../../../versions/src/llm/OllamaClient.ts) inside `OllamaClientImpl`. The implementation caches `/api/tags` availability per embedding model so repeated `embed` calls do not pay the round-trip cost; on 404 the verdict is cached as `available: false`.
3. Rewrote [src/storage/EmbeddingClient.ts](../../../../versions/src/storage/EmbeddingClient.ts) so the constructor is now `(client: LLMClient, model: string)` -- no more `baseUrl` or `timeoutMs`, no more `OllamaHttp` import. The class delegates to `client.embed` / `client.embedBatch` and falls back to the deterministic 128-D `HeuristicEmbedder` when the port reports unavailable or returns null. Added a polyfill in `embedBatch` for ports that lack the batch method (serial `embed` calls).
4. Updated [src/storage/MemorySubsystem.ts](../../../../versions/src/storage/MemorySubsystem.ts) `MemorySubsystemOptions`: replaced `(ollamaUrl: string, requestTimeout: number)` with `llmClient: LLMClient`. The factory now passes the port through to `EmbeddingClient`.
5. Threaded the LLM client into [src/panels/GemmaCodePanel.ts](../../../../versions/src/panels/GemmaCodePanel.ts) by hoisting the client construction *before* `_buildMemorySubsystem` and passing it as a new parameter. The panel now obtains the client via `this._runtime.getOllamaClient()` (see 2.3).
6. Rewrote two test files to mock the `LLMClient` port directly instead of `fetch`:
   - [tests/unit/storage/EmbeddingClient.test.ts](../../../../versions/tests/unit/storage/EmbeddingClient.test.ts) (14 tests covering `isAvailable` caching, `embed` happy/empty/unavailable/transient paths, and `embedBatch` including the new polyfill case)
   - [tests/unit/storage/EmbeddingClient.heuristic.test.ts](../../../../versions/tests/unit/storage/EmbeddingClient.heuristic.test.ts) (5 tests covering provenance, fallback, empty input, and direct heuristic access)
   - [tests/unit/storage/MemorySubsystem.test.ts](../../../../versions/tests/unit/storage/MemorySubsystem.test.ts) updated to construct the subsystem with a fake `LLMClient` and `embeddingModel: null` (so the port is never actually called).
7. After 4.3 lands too, dropped `^src/storage/EmbeddingClient\.ts$`, `^src/panels/GemmaCodePanel\.ts$`, and `^src/extension\.ts$` from the `no-llm-outside-llm-folder` `pathNot` list, leaving `^src/llm/` and `^src/runtime/GemmaRuntime\.ts$` (the composition root). Removed the `BASELINE-2026-04-25` annotation.

**Key files changed**: `src/llm/types.ts`, `src/llm/OllamaClient.ts`, `src/storage/EmbeddingClient.ts`, `src/storage/MemorySubsystem.ts`, `src/panels/GemmaCodePanel.ts`, three test files, `configs/dependency-cruiser.cjs`.

**Verification**: All 19 EmbeddingClient tests pass; 4 MemorySubsystem tests pass.

---

### 2.3 Sub-task 4.3 -- Move `OllamaClient` bootstrap into `GemmaRuntime`

**Plan specification**: Add `getOllamaClient(): LLMClient` to `GemmaRuntime`. Update `extension.ts` and `GemmaCodePanel.ts` to consume `runtime.getOllamaClient()` instead of `createOllamaClient()`. Remove the two files from the `no-llm-outside-llm-folder` `pathNot` list, leaving only `^src/llm/`.

**What happened**:

1. Extended [src/runtime/GemmaRuntime.ts](../../../../versions/src/runtime/GemmaRuntime.ts) with `getOllamaClient()`. The method caches the client per `(ollamaUrl, requestTimeout)` pair; the existing settings-change subscription invalidates the cache when either input changes, so subsystems do not need to re-resolve the client manually.
2. Updated [src/extension.ts](../../../../versions/src/extension.ts):
   - Removed `import { createOllamaClient } from "./llm/OllamaClient.js"`.
   - `startOllamaPoller` now takes a `runtime: GemmaRuntime` parameter and calls `runtime.getOllamaClient()` for the long-lived poller client.
   - The `gemma-code.ping` command and the initial health check both use `runtime.getOllamaClient()`.
3. Updated [src/panels/GemmaCodePanel.ts](../../../../versions/src/panels/GemmaCodePanel.ts):
   - Removed `import { createOllamaClient } from "../llm/OllamaClient.js"`.
   - Constructor: `const client = this._runtime.getOllamaClient()` is now the first thing built after the operation log; passed into `_buildMemorySubsystem`, `ContextCompactor`, `SubAgentManager`, `Orchestrator`, `AgentLoop`, `StreamingPipeline`.
   - The `model` command handler obtains the client via `this._runtime.getOllamaClient()`.
   - Removed the unused `settings` local in the `model` case (lint flagged it).
4. The `no-llm-outside-llm-folder` rule now keeps only the runtime as a permitted importer of `OllamaClient` / `OllamaHttp`. The `BASELINE-2026-04-25` annotation is removed; the rule comment now describes the long-term composition-root pattern.

**Key files changed**: `src/runtime/GemmaRuntime.ts`, `src/extension.ts`, `src/panels/GemmaCodePanel.ts`, `configs/dependency-cruiser.cjs`.

**Verification**: `npx tsc --noEmit` clean. The composition-root pattern now means `OllamaClient` and `OllamaHttp` are imported only inside `src/llm/` and from `GemmaRuntime`, matching the long-term contract.

---

### 2.4 Sub-task 4.4 -- Route panels through `panels/messages.ts` (DEFERRED to Phase 6)

**Plan specification**: Convert `GemmaCodePanel`, `SessionListPanel`, and `TraceDashboardPanel` so every storage read becomes a `requestSessions / sessionsResult` style postMessage pair. The plan note explicitly permits deferral: *"this sub-task has overlap with Phase 6 panel decomposition; it is acceptable to defer 4.4 to Phase 6 if the dependency graph there is cleaner. Coordinate with Phase 6.1 explicitly."*

**Decision**: Defer. The two reasons:

1. **Avoid scaffolding what Phase 6 must rework.** Phase 6 sub-task 6.1 introduces `ChatController` + `ChatWebviewHost` + `ChatCommandHandlers`, defining the long-term postMessage boundary. Designing the storage-routing port now would build a contract that the Phase 6 split must redesign once. Doing it once during the decomposition is cheaper and keeps the messaging surface coherent.
2. **The `messages.ts` file already exists** and is the natural home for the new request/response pairs; deferring 4.4 does not mean inventing new infrastructure -- it means designing the request/response shape against the post-Phase-6 controller layout rather than against the current 1,723-line `GemmaCodePanel` god-class.

**Action taken**: Updated the `no-storage-from-panels` rule in [configs/dependency-cruiser.cjs](../../../../versions/configs/dependency-cruiser.cjs). The exception list still contains all three panels, but the rule comment now explicitly cross-references this Phase 4 deferral and the Phase 6 sub-task that will close it. This makes the deferral visible to anyone reading `deps:check` errors in the future.

I briefly experimented with a narrowed exception list (just `GemmaCodePanel`, on the theory that `SessionListPanel` and `TraceDashboardPanel` might import storage as types only and pass dependency-cruiser). The experiment confirmed they do *not*: dependency-cruiser flags both panels because each performs runtime calls (`_store.listSessions(50)` in `SessionListPanel`, `ToolOutputCache` snapshots in `TraceDashboardPanel`). A paper-only fix would not satisfy the spirit of the rule, so the deferral covers all three panels uniformly.

**Verification**: The Phase 4 exit checklist updates to reflect the deferral; the plan's Phase 6 prerequisites already list "Phase 4 (panels-through-messages contract is the long-term shape)", so the cross-reference is bidirectional.

---

### 2.5 Sub-task 4.5 -- Untangle the `MemoryLayers.types <-> MemoryStore.types` cycle

**Plan specification**: Create `src/storage/MemoryShared.types.ts` with the truly shared declarations. Update both `MemoryLayers.types.ts` and `MemoryStore.types.ts` to import from the shared file rather than from each other. Remove the cycle warning's BASELINE annotation.

**What happened**:

1. Identified the cycle: `MemoryLayers.types.ts` imported `MemoryEntry` from `MemoryStore.types.ts` (used by `SemanticMemoryEntry extends MemoryEntry`); `MemoryStore.types.ts` imported `MemoryProvenance, MemoryTTL` from `MemoryLayers.types.ts`.
2. Created [src/storage/MemoryShared.types.ts](../../../../versions/src/storage/MemoryShared.types.ts) hosting the foundation types: `MemoryProvenance`, `MemoryTTL`, `isStale`, `isExpired`, `MemoryEntry`, `MemoryType`, `CorroborationTier`. These are the types that genuinely belong to *both* the layered view and the row-storage view.
3. Rewrote [src/storage/MemoryLayers.types.ts](../../../../versions/src/storage/MemoryLayers.types.ts) to import from `MemoryShared.types.ts`. Re-exported `MemoryProvenance`, `MemoryTTL`, `isStale`, `isExpired` so existing call sites that import from `MemoryLayers.types.js` keep working without churn.
4. Rewrote [src/storage/MemoryStore.types.ts](../../../../versions/src/storage/MemoryStore.types.ts) to import `MemoryEntry` and friends from the shared file. Re-exported the layer types from `MemoryLayers.types.js` (also unchanged surface) so the public type-import contract from `MemoryStore.types` remains identical.
5. The cycle disappears from `npm run deps:check`. Both files now point one-way at `MemoryShared.types.ts`; neither imports from the other.

**Key files changed**: `src/storage/MemoryShared.types.ts` (new), `src/storage/MemoryLayers.types.ts` (rewritten), `src/storage/MemoryStore.types.ts` (rewritten).

**Verification**: `npx tsc --noEmit` clean (the public type surface is preserved). All 25 MemoryStore tests + 12 MemoryConsolidator tests + 16 UnifiedMemoryRetriever tests + 13 EpisodicMemory tests + 14 GraphMemory tests pass without modification.

---

### 2.6 Sub-task 4.6 -- Untangle the `SubAgentManager <-> AgentLoop` cycle

**Plan specification**: Define a `SubAgentSpawner` interface in `src/agents/SubAgentSpawner.types.ts` with the methods `AgentLoop` needs. Have `SubAgentManager` implement it. Have `AgentLoop` consume only the interface. The `SubAgentManager` keeps the one-way edge to `AgentLoop`.

**What happened**:

1. Created [src/agents/SubAgentSpawner.types.ts](../../../../versions/src/agents/SubAgentSpawner.types.ts) with a single-method interface mirroring `SubAgentManager.run`'s signature: `run(config, postMessage, parentTraceId?, parentSpanId?): Promise<SubAgentResult>`.
2. Updated [src/tools/AgentLoop.ts](../../../../versions/src/tools/AgentLoop.ts):
   - Replaced `import type { SubAgentManager } from "../agents/SubAgentManager.js"` with `import type { SubAgentSpawner } from "../agents/SubAgentSpawner.types.js"`.
   - Replaced the type annotations on `AgentLoopOptions.subAgentManager` and `_subAgentManager` field. (The option name is unchanged; only the type widens.)
3. Updated [src/agents/SubAgentManager.ts](../../../../versions/src/agents/SubAgentManager.ts):
   - Imported `SubAgentSpawner` from the new types file.
   - `class SubAgentManager implements SubAgentSpawner`. The existing `run(config, postMessage, parentTraceId?, parentSpanId?)` signature already matches the interface byte-for-byte.
4. The cycle collapses to a one-way edge: `SubAgentManager` still imports `AgentLoop` (to drive each spawned loop); `AgentLoop` no longer imports `SubAgentManager`.

**Key files changed**: `src/agents/SubAgentSpawner.types.ts` (new), `src/tools/AgentLoop.ts`, `src/agents/SubAgentManager.ts`.

**Verification**: `npm run deps:check` -> 0 errors, 0 cycle warnings. `tests/unit/tools/AgentLoop.test.ts` (25 pass), `tests/unit/agents/SubAgentManager.test.ts` (7 pass), `tests/unit/agents/SubAgentManager.characterization.test.ts` (8 pass).

---

### 2.7 Sub-task 4.7 -- Phase 4 testing and stabilization

**What happened**:

1. **`npx tsc --noEmit`**: clean.
2. **`npm run lint`**: 0 errors (1 pre-existing warning in `src/config/GpuDetector.ts` unrelated to Phase 4).
3. **`npm run deps:check`**: 0 errors, 0 cycle warnings, 1 unrelated `no-orphans` warning on `src/storage/PredictiveCache.ts` (Phase 5 wire-or-delete decision).
4. **Test suite**: All Phase-4-affected files pass. The previous run surfaced one stale assertion in [tests/unit/panels/SessionListPanel.test.ts](../../../../versions/tests/unit/panels/SessionListPanel.test.ts) -- a Phase 3 leftover (the test asserted `data-id="' + escapeAttr(s.id)`, the regex shape from before Phase 3 sub-task 3.4 replaced innerHTML concat with `document.createElement` + `dataset.id`). Updated the assertion to verify the safer DOM-builder pattern (`document.createElement` is present, `item.dataset.id = s.id` matches, and no `innerHTML = ... + ...` BinaryExpression survives). All 8 SessionListPanel tests pass.
5. **`npm run catalog:check`**: regenerated [docs/index.md](../../../../versions/v0/index.md) to reflect the moves. The `utils` row went from 4 files / 608 LOC to 6 files / 1002 LOC; `tools` from 18 / 4592 to 16 / 4198; `storage` from 29 / 6543 to 30 / 6551 (added `MemoryShared.types.ts`); `agents` from 4 / 609 to 5 / 638 (added `SubAgentSpawner.types.ts`); `runtime` from 1 / 59 to 1 / 94 (the `getOllamaClient` cache).

---

## 3. Acceptance evidence

| Plan acceptance bar | Evidence |
|---|---|
| `secretPaths.ts` and `Compressor.ts` under `src/utils/` | `git status` shows the moves; tests in `tests/unit/utils/` mirror the layout |
| `EmbeddingClient` consumes the LLM port | Constructor takes `LLMClient`; no `OllamaHttp` import survives in `src/storage/` |
| `extension.ts` and `GemmaCodePanel.ts` consume `runtime.getOllamaClient()` | Both files no longer import `createOllamaClient`; the only direct importer is `src/runtime/GemmaRuntime.ts` |
| Both circular cycles eliminated | `MemoryShared.types.ts` + `SubAgentSpawner.types.ts` break the two cycles; `deps:check` reports 0 cycle warnings |
| Three of four BASELINE annotations removed | `no-llm-outside-llm-folder`, `no-tools-from-storage`, `no-circular` are now plain rules |
| `no-storage-from-panels` BASELINE retained | Per the plan-permitted deferral to Phase 6; rule comment cross-references this phase and Phase 6 |
| `npm run deps:check` clean of Phase-4 violations | 0 errors, 0 cycle warnings; 1 unrelated `no-orphans` warning on PredictiveCache.ts |

---

## 4. Outstanding gaps

| Item | Owner | Disposition |
|---|---|---|
| `no-storage-from-panels` BASELINE for `GemmaCodePanel`, `SessionListPanel`, `TraceDashboardPanel` | Phase 6.1 / 6.4 | Deferred per plan note in 4.4. The Phase 6 panel decomposition designs the request/response port; routing storage through it is one of the deliverables there. |
| `PredictiveCache.ts` orphan warning | Phase 5.1 | Wire-or-delete decision pending. Phase 5 sub-task 5.1 captures the criterion. |

---

## 5. Files changed (Phase 4 only)

**Source moves**:
- `src/tools/handlers/secretPaths.ts -> src/utils/secretPaths.ts`
- `src/tools/Compressor.ts -> src/utils/Compressor.ts`

**New source files**:
- `src/storage/MemoryShared.types.ts`
- `src/agents/SubAgentSpawner.types.ts`

**Modified source**:
- `src/llm/types.ts`, `src/llm/OllamaClient.ts`
- `src/runtime/GemmaRuntime.ts`
- `src/storage/EmbeddingClient.ts`, `src/storage/MemorySubsystem.ts`, `src/storage/MemoryLayers.types.ts`, `src/storage/MemoryStore.types.ts`, `src/storage/MemoryHealthCheck.ts`, `src/storage/ToolOutputCache.ts`
- `src/tools/AgentLoop.ts`, `src/tools/OutputRedirector.ts`, `src/tools/handlers/filesystem.ts`
- `src/agents/SubAgentManager.ts`
- `src/observability/OperationLog.ts`
- `src/panels/GemmaCodePanel.ts`, `src/panels/TraceDashboardPanel.ts`
- `src/extension.ts`

**Test moves**:
- `tests/unit/tools/handlers/secretPaths.test.ts -> tests/unit/utils/secretPaths.test.ts`
- `tests/unit/tools/Compressor.test.ts -> tests/unit/utils/Compressor.test.ts`

**Modified tests**:
- `tests/unit/storage/EmbeddingClient.test.ts`, `tests/unit/storage/EmbeddingClient.heuristic.test.ts`, `tests/unit/storage/MemorySubsystem.test.ts`
- `tests/unit/tools/OutputRedirector.test.ts`
- `tests/unit/panels/TraceDashboardPanel.cache.test.ts`, `tests/unit/panels/SessionListPanel.test.ts`
- `tests/unit/hooks/secret-paths-sync.test.ts`
- `tests/integration/tool-output-compression.test.ts`

**Other**:
- `configs/dependency-cruiser.cjs`
- `scripts/hooks/lib/secret-paths.mjs`
- `docs/index.md` (catalog regeneration)
- `docs/archive/versions/v0/v0.6.0/plans/v0.6.0-cycle.md` (exit checklist updated)

---

## 6. Next phase

Phase 5 (Doc/code drift + dead-code cleanup) is unblocked. Phase 5 includes the wire-or-delete decision for `PredictiveCache` (the orphan warning surfaced today), the threshold-elevation implement-or-retract decision, the legacy `gpuTier` setting removal, and the architecture-doc inaccuracies. Phase 6 (panel decomposition) inherits the deferred sub-task 4.4.
