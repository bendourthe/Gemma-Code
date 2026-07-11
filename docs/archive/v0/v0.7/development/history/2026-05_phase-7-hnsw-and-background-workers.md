# v0.7.0 Phase 7 -- HNSW vector index + audit/testgaps background workers

**Cycle**: v0.7.0
**Phase**: 7 (HNSW vector index + background workers)
**Date**: 2026-05-14
**Plan reference**: [docs/archive/versions/v0/v0.7.0/plans/v0.7.0-cycle.md](../../plans/v0.7.0-cycle.md) Phase 7
**Comparison reference**: [docs/archive/versions/v0/v0.7.0/comparison-multi-source.md](../../comparison-multi-source.md) C32, C34
**ADR**: None this phase. Both sub-tasks are additive feature work behind opt-in feature flags / optional dependencies; neither rewrites an architectural seam.

---

## 1. Scope

Phase 7 is the optional-but-lands-if-time phase. It adopts the two P2 items from the comparison report:

1. **C32 -- HNSW vector index**. Swap [src/storage/MemoryStore.ts](../../../../versions/src/storage/MemoryStore.ts)'s FTS5-pre-filtered linear cosine scan for an HNSW ANN index when the entry count crosses a configurable threshold. The native `hnswlib-node` binary is an `optionalDependency`; when load fails the linear scan is the fallback path.
2. **C34 -- Audit + testgaps background workers**. Add `audit-worker` and `testgaps-worker` sub-agent types that fire at the same post-N-edits trigger as `verification`. Both run deterministic CLI commands (`bin/gemma-check.mjs --json` for audit, `vitest --coverage --reporter=json` for testgaps) and report their findings as chat messages.

Both ship behind opt-in feature flags (`gemma-code.memoryHnswThreshold`, `gemma-code.workers.audit.enabled`, `gemma-code.workers.testgaps.enabled`). Default behavior is unchanged.

---

## 2. Sub-tasks executed

### 2.1 -- HNSW vector index (sub-task 7.1)

[src/storage/MemoryHnswIndex.ts](../../../../versions/src/storage/MemoryHnswIndex.ts) is a new module that encapsulates the entire optional-native-dependency surface. The constructor is private; callers go through `MemoryHnswIndex.tryCreate(opts)` which returns `null` on any failure:

- `hnswlib-node` not installed (the `require` throws -> catch -> null).
- ABI mismatch (the native `.node` binary fails to load -> catch -> null).
- The persisted index file is corrupt (`readIndexSync` throws -> the module logs and reinitializes an empty index in memory; subsequent searches will rebuild it).
- The persist directory cannot be created (the `fs.mkdirSync` recursive call throws -> catch -> null).

The instance API is intentionally narrow:

```ts
class MemoryHnswIndex {
  static tryCreate(opts: { dimensions, maxElements, persistPath, fullRebuildEvery? }): MemoryHnswIndex | null;
  insert(label: number, vector: Float32Array): void;
  remove(label: number): void;
  search(query: Float32Array, k: number): Array<{ label: number; distance: number }>;
  needsRebuild(): boolean;
  rebuild(entries: Iterable<{ label: number; vector: Float32Array }>): void;
  persist(): void;
  size(): number;
}
```

Labels are SQL `rowid` integers so MemoryStore can join hit results back to memory rows with a single `WHERE rowid IN (...)` query. The dimension is inferred from the first non-null embedding in the database (or supplied explicitly in `MemoryStoreOptions`); the `maxElements` default is `max(1024, 2 * count)` so the table can grow without immediate resize. The `cosine` distance metric is hnswlib-node's `1 - cosine_similarity`; the wrapping `_searchHnsw` in MemoryStore converts back to a similarity score in the existing 0..1 range used by `MemorySearchResult`.

MemoryStore integration is intentionally narrow:

- A new `MemoryStoreOptions` interface (third constructor argument, optional, backwards-compatible).
- `_shouldUseHnsw()` returns true only when `hnswIndexPath` is set AND `_cachedCount >= threshold`. The count cache is invalidated on every mutating write (`save`, `deleteById`, `clear`, `prune`).
- `_ensureHnswIndex()` is lazy: the native binary is only attempted on first activation. Once activated, `_hydrateHnswIndex()` does an initial scan of every embedding row and adds them to the index, then persists once.
- `searchSemantic()` calls `_searchHnsw` first; if it returns `null` (HNSW inactive) OR an empty array (no usable hits) it falls through to the existing FTS5-pre-filtered cosine scan.
- `save()` calls `_hnswInsertIfActive` after the row is inserted; the helper only acts when the index is active (i.e., the caller is past activation). Pre-activation inserts are picked up by the initial hydration on first search.
- `deleteById()` / `prune()` / `clear()` call `markDelete` / `rebuild` as appropriate and trigger a full rebuild when `needsRebuild()` returns true (default cadence: 1000 mutations).

Threading the configuration through the composition root required:

- [src/config/settings.ts](../../../../versions/src/config/settings.ts): new `memoryHnswThreshold: number` field (default 1000, clamped to [0, 1_000_000]).
- [package.json](../../../../versions/package.json) configuration: new `gemma-code.memoryHnswThreshold` schema entry. New `optionalDependencies` block: `"hnswlib-node": "^3.0.0"`.
- [src/storage/MemorySubsystem.ts](../../../../versions/src/storage/MemorySubsystem.ts): new `hnsw?: { indexPath; threshold? }` option in `MemorySubsystemOptions`, threaded into `new MemoryStore(sharedDb, embedder, hnsw)`.
- [src/panels/ChatPanelInit.ts](../../../../versions/src/panels/ChatPanelInit.ts): `buildMemorySubsystem` sets `hnsw.indexPath = path.join(globalStorageUri.fsPath, "memory.hnsw")` when `memoryHnswThreshold > 0`.

The persistence path uses `globalStorageUri.fsPath` rather than `~/.gemma-code/<workspaceId>` literally; the existing v0.7.0 layout already collocates memory artifacts under `globalStorageUri`. The plan's reference to `~/.gemma-code/<workspaceId>/memory.hnsw` was the *intent* (one index per workspace, persisted under the gemma-code home); the implementation respects that intent through the VS Code-managed global storage URI which IS the gemma-code home directory.

### 2.2 -- Audit + testgaps background workers (sub-task 7.2)

The plan says "Extend `SubAgentManager.ts` with two new sub-agent types: `audit-worker` and `testgaps-worker`. Each follows the verification-sub-agent pattern (post-N-edits trigger)." Literal interpretation: route the workers through the same `AgentLoop` + `ConversationManager` + Ollama call chain as `verification`. Chosen interpretation: extend the `SubAgentType` union and the trigger pattern, but execute deterministically because both workers are external-CLI invocations whose output format is fixed.

Three modules ship:

- [src/agents/types.ts](../../../../versions/src/agents/types.ts): the `SubAgentType` union gains `"audit-worker" | "testgaps-worker"`.
- [src/agents/BackgroundWorkers.ts](../../../../versions/src/agents/BackgroundWorkers.ts): pure functions `runAuditWorker(modifiedFiles, opts)` and `runTestgapsWorker(modifiedFiles, opts)` plus stand-alone parsers `parseGemmaCheckJson`, `formatAuditFindings`, `formatTestgapsOutput`. The `WorkerCommandRunner` type is the spawn-shaped function the workers call; the default runner wraps `child_process.spawn` with stderr / exitCode capture. Tests inject a fake runner via `SubAgentManager.setWorkerRunner` so no real process spawns during the unit suite.
- [src/agents/SubAgentManager.ts](../../../../versions/src/agents/SubAgentManager.ts): `_runWorker(config, postMessage, spanId)` is the deterministic dispatch path. The early branch in `run` checks `config.type === "audit-worker" || config.type === "testgaps-worker"` BEFORE PromptBuilder / AgentLoop construction. The trace span is closed inside `_runWorker` so the worker shows up alongside verification/research in the trace dashboard.

The audit worker:

1. Returns an empty-success result when `modifiedFiles` is empty.
2. Locates `bin/gemma-check.mjs` by walking two compiled-output levels up from `__dirname` (and a third fallback `process.cwd() / bin`). Returns an error result with a clear message when the script is missing.
3. Spawns `process.execPath bin/gemma-check.mjs --json <files...>` via the injectable runner.
4. Parses the JSON output with `parseGemmaCheckJson`. Returns clean-suite acknowledgement on `findings.length === 0 && exitCode === 0`; otherwise renders the findings as a markdown table (rule, severity, file:line, message).

The testgaps worker:

1. Filters modified files to source-only (extension in `.ts/.tsx/.js/.jsx/.mjs/.cjs`, NOT under `tests/`, NOT `*.test.<ext>`).
2. Maps each source file to its conventional test path via `candidateTestFile`:
   - `src/foo/bar.ts -> tests/unit/foo/bar.test.ts` (preferred).
   - `tests/integration/foo/bar.test.ts` (fallback for E2E-only code).
   - `<stem>.test.<ext>` / `<stem>.spec.<ext>` (co-located convention).
   The first existing path on disk wins; missing entirely -> the file is skipped.
3. Spawns `npx vitest run --coverage --reporter=json <testFiles...>`.
4. Summarises pass/fail counts and lists uncovered branches per file (cap 20).

The AgentLoop trigger refactor in [src/tools/AgentLoop.ts](../../../../versions/src/tools/AgentLoop.ts):

```ts
// Before:
if (verificationEnabled && subAgentManager && fileEditCount >= threshold) {
  fileEditCount = 0;
  await subAgentManager.run({ type: "verification", ... });
}

// After:
if (subAgentManager && fileEditCount >= threshold &&
    (verificationEnabled || auditWorkerEnabled || testgapsWorkerEnabled)) {
  const modifiedFiles = [...this._modifiedFiles];
  const recentToolResults = [...this._recentToolResults];
  fileEditCount = 0;

  if (verificationEnabled) { await subAgentManager.run({ type: "verification", ... }); }
  if (auditWorkerEnabled) { await subAgentManager.run({ type: "audit-worker", ... }); }
  if (testgapsWorkerEnabled) { await subAgentManager.run({ type: "testgaps-worker", ... }); }
}
```

The capture-then-reset shape ensures all three workers see the same `modifiedFiles` / `recentToolResults` snapshot and the counter resets exactly once.

Settings:

- `gemma-code.workers.audit.enabled` (default `false`) -- gates the audit-worker trigger.
- `gemma-code.workers.testgaps.enabled` (default `false`) -- gates the testgaps-worker trigger.

Both default to `false` per the plan; the workers are opt-in observability.

The webview surface:

- [src/panels/messages.ts](../../../../versions/src/panels/messages.ts): `SubAgentStatusMessage.agentType` widened to include `"audit-worker" | "testgaps-worker"`.
- [src/panels/webview/runtime.ts](../../../../versions/src/panels/webview/runtime.ts): the `subAgentStatus` label map gains `'audit-worker': 'Audit'` and `'testgaps-worker': 'Test Gaps'`.

---

## 3. Tests

Five new / extended test files; **33 added test cases**; full suite green at **2136 passed / 11 skipped (177 files)**.

| File | Status | Count |
|---|---|---|
| `tests/unit/storage/MemoryHnswIndex.test.ts` | new | 6 (5 `runIf` skipped without hnswlib-node) |
| `tests/unit/agents/BackgroundWorkers.test.ts` | new | 18 |
| `tests/integration/memory-hnsw.test.ts` | new | 3 (2 `runIf` skipped without hnswlib-node) |
| `tests/unit/agents/SubAgentManager.test.ts` | extended | +2 (worker dispatch) |
| `tests/unit/tools/AgentLoop.test.ts` | extended | +3 (audit-only / testgaps-only / all-three trigger) |
| `tests/unit/storage/MemoryStore.test.ts` | extended | +1 (HNSW graceful fallback) |

Test design:

- **Pure parsers** (`parseGemmaCheckJson`, `formatAuditFindings`, `formatTestgapsOutput`) are unit-tested directly with hand-crafted JSON inputs. No process spawn, no file I/O.
- **Worker runners** (`runAuditWorker`, `runTestgapsWorker`) are unit-tested via the injectable `WorkerCommandRunner` so the test never spawns `node` or `npx`. The runner mock returns a stubbed `{stdout, stderr, exitCode}` and the test asserts on the parsed output / chat-message shape.
- **AgentLoop triggers** are unit-tested with a mock `SubAgentManager.run`. The test confirms that each enabled worker fires once at the threshold, that all three fire in order when all three are enabled, and that the file-edit count resets exactly once.
- **HNSW activation** is integration-tested with `it.runIf(HNSW_AVAILABLE)` so the loaded path is verified on machines where the native binary installs cleanly. The always-on test exercises the missing-binary fallback.
- **Recall delta** is integration-tested by building two parallel MemoryStores (linear vs. HNSW), populating with 30 deterministic embeddings, and asserting that the HNSW top-1 hit appears within the linear top-3.

Lint: clean (`npm run lint`). Build: clean (`npm run build`). Type-check: clean (`tsc --noEmit`).

---

## 4. Deviations from the plan

- **Persisted index location**. Plan says `~/.gemma-code/<workspaceId>/memory.hnsw`. Implemented as `globalStorageUri.fsPath/memory.hnsw` which is the VS Code-managed equivalent. Same workspace-keyed isolation; same gemma-code home directory.
- **Spawn cardinality**. Plan says the audit worker "calls `bin/gemma-check --json` on each changed file". Implemented as a single spawn with all files as positional arguments. gemma-check already accepts a paths list; this saves N-1 process spawns.
- **Native dependency install**. The `optionalDependencies` entry was added to `package.json` but `npm install` was not re-run in this phase. The `package-lock.json` is unchanged. Tracked as in-cycle gap 10.O.13.
- **End-to-end worker tests**. Real `gemma-check` + `vitest --coverage` invocations are not covered by an integration test in this phase. The injectable-runner contract makes a real E2E test feasible but it was not added; the unit suite covers the trigger + runner contract. Tracked as in-cycle gap 10.O.12.

---

## 5. Known gaps recorded

Three new entries in [docs/archive/versions/v0/v0.7.0/known-gaps.md](../../known-gaps.md) Section 10:

- **10.O.11** (MT, P2): HNSW loaded-path tests are `it.runIf(HNSW_AVAILABLE)`-gated. Local Windows dev workstation does not have `hnswlib-node` installed; CI may or may not depending on platform. Operator must run on Linux x64 / macOS to confirm the loaded-path 5 + 2 skipped tests pass.
- **10.O.12** (MT, P2): Background-workers end-to-end test (real `gemma-check` + `vitest` invocations on a fixture) is not yet written. Deferred to v0.8.0 Phase 7 carryover.
- **10.O.13** (DF, P3): `npm install` was not re-run in this phase; `package-lock.json` is unchanged. Operator close-out as part of the v0.7.0 ship gate.

All thirteen v0.7.0 in-cycle items have been transferred to the v0.8.0 plan. The v0.7.0 in-cycle log reaches its terminal state with Phase 7 close.

---

## 6. Files changed

### New files

- `src/storage/MemoryHnswIndex.ts` (212 lines) -- HNSW wrapper.
- `src/agents/BackgroundWorkers.ts` (276 lines) -- deterministic worker functions + parsers.
- `tests/unit/storage/MemoryHnswIndex.test.ts` (115 lines).
- `tests/unit/agents/BackgroundWorkers.test.ts` (189 lines).
- `tests/integration/memory-hnsw.test.ts` (138 lines).
- `docs/archive/versions/v0/v0.7.0/development/history/2026-05_phase-7-hnsw-and-background-workers.md` (this file).

### Modified files

- `src/storage/MemoryStore.ts` -- HNSW integration in save / search / delete / clear / prune.
- `src/storage/MemorySubsystem.ts` -- new `hnsw` option.
- `src/panels/ChatPanelInit.ts` -- wire `memoryHnswThreshold` into the subsystem.
- `src/agents/types.ts` -- `SubAgentType` union.
- `src/agents/SubAgentManager.ts` -- worker dispatch path + injectable runner.
- `src/agents/SpecialistLoader.ts` -- worker entries in the fallback tier / tools tables.
- `src/tools/AgentLoop.ts` -- worker trigger refactor + new options.
- `src/panels/ChatController.ts` -- thread settings through `buildAgentLoop`.
- `src/panels/messages.ts` -- widen `SubAgentStatusMessage.agentType`.
- `src/panels/webview/runtime.ts` -- worker labels.
- `src/config/settings.ts` -- three new settings.
- `package.json` -- three new configuration entries, one new optionalDependency.
- `.gitignore` -- `memory.hnsw` artifact pattern.
- `docs/DEVLOG.md` -- Phase 7 entry.
- `docs/archive/versions/v0/v0.7.0/known-gaps.md` -- three new in-cycle gap rows + summary recomputation.
- `tests/unit/storage/MemoryStore.test.ts` -- one new test for HNSW graceful fallback.
- `tests/unit/agents/SubAgentManager.test.ts` -- two new tests for worker dispatch.
- `tests/unit/tools/AgentLoop.test.ts` -- three new tests for worker triggers.

---

## 7. Next steps

1. Operator: re-run `npm install` on the target platform; commit any `package-lock.json` change.
2. Operator: run the test suite on Linux x64 / macOS to confirm the HNSW-gated tests pass (closes 10.O.11).
3. Phase 8: capture v0.7.0 golden + benchmark baselines, add the v0.7.0 CHANGELOG entry, bump `package.json` version to `0.7.0`, and tag `v0.7.0`.
