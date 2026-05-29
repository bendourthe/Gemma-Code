# v0.8.0 Phase 6 -- P2 backlog (session history)

**Date**: 2026-05-16
**Plan reference**: [docs/archive/versions/v0/v0.8.0/plans/v0.8.0-cycle.md](../../plans/v0.8.0-cycle.md) -- Phase 6
**Goal**: Ship the nine P2 items from the v0.7.0 multi-source comparison plus the v0.7.0 Phase 6 Cursor-adapter carryover. The v0.8.0 commitment for this phase is the pure modules + unit-test coverage; the live integrations (panel surfacing, background-worker scheduling, persistence to ChatHistoryStore, OllamaOptions wiring) are staged for v0.9.0 as documented gaps.

## Sub-tasks completed

| # | Title | Status |
|---|---|---|
| 6.1 | Three-state sync return for `ContextCompactor.compact` | done |
| 6.2 | `IntuitionCache` anticipatory context cache | done |
| 6.3 | `ReflectJob` nightly Reflect job with dry-run + rollback | done |
| 6.4 | `WorkflowDetector` skill auto-harvest | done |
| 6.5 | `check-architecture.{sh,ps1}` + `init.sh` Step 6/6 + CI job | done |
| 6.6 | `ModelPinRegistry` + Memory panel `Models` tab + `pin` / `unpin` / `unload` protocol | done |
| 6.7 | M-series tier benchmark JSON + tier guide | done (schema only; live capture deferred to operator) |
| 6.8 | Tool-call exact-bytes LRU in `ConversationManager` | done |
| 6.9 | `ToolCallStreamParser` + three new protocol messages | done |
| 6.A | Cursor adapter native `.cursor/rules/<slug>.mdc` | done (closes v0.7.0 10.O.7) |
| 6.10 | Testing + stabilization | done |

## Code surface

### New source files

- `src/storage/IntuitionCache.ts`
- `src/storage/ReflectJob.ts`
- `src/storage/ModelPinRegistry.ts`
- `src/skills/WorkflowDetector.ts`
- `src/chat/ToolCallStreamParser.ts`
- `scripts/check-architecture.sh`
- `scripts/check-architecture.ps1`
- `docs/archive/versions/v0/v0.8.0/m-series-tier-guide.md`
- `tests/benchmarks/baselines/m-series.json`

### Modified source files

- `src/chat/ContextCompactor.ts` -- `compact()` now returns `CompactionResult`; pre-hook errors caught; post-token re-check decides between `ok` and `rebuild-needed`.
- `src/chat/ConversationManager.ts` -- adds `storeToolCallBytes` / `getToolCallBytes` / `toolCallBytesCount` (256-entry LRU).
- `src/tools/AgentLoop.ts` -- inspects three-state result from both compactor call sites.
- `src/panels/ChatCommandHandlers.ts` -- `/compact` reports state errors back to the user.
- `src/panels/messages.ts` -- adds `ModelPinMessage` / `ModelUnpinMessage` / `ModelUnloadMessage` + `ToolCallHeaderMessage` / `ToolCallArgDeltaMessage` / `ToolCallCompleteMessage`.
- `src/panels/webview/memoryView.ts` -- sixth `Models` tab + `buildModelsTab` handler.
- `scripts/package-skills.mjs` -- `renderCursor` rewritten to emit native `.mdc`; `relativePath` switched to `<slug>.mdc`; `warn` flag removed.
- `scripts/init.sh` -- 5 steps -> 6 steps; new Step 6/6 invokes `bash scripts/check-architecture.sh`.
- `.github/workflows/ci.yml` -- new `check-architecture` job.
- `package.json` -- four new settings (`gemma-code.memory.anticipatoryCache`, `gemma-code.skills.harvest`, `gemma-code.skills.harvestMinRecurrence`, `gemma-code.skills.harvestWindowDays`).

### New test files (44 new tests)

| File | Tests |
|---|---|
| `tests/unit/storage/IntuitionCache.test.ts` | 7 |
| `tests/unit/storage/ReflectJob.test.ts` | 9 (incl. 10K-event stress) |
| `tests/unit/storage/ModelPinRegistry.test.ts` | 8 |
| `tests/unit/skills/WorkflowDetector.test.ts` | 7 |
| `tests/unit/chat/ToolCallStreamParser.test.ts` | 5 |
| `tests/unit/scripts/check-architecture.test.ts` | 5 |
| `tests/unit/panels/webview/memoryView.models.test.ts` | 3 |

Existing test files extended:

- `tests/unit/chat/ContextCompactor.test.ts` -- 3 new tests for the three-state contract.
- `tests/unit/chat/ConversationManager.test.ts` -- 4 new tests for the exact-bytes LRU.
- `tests/unit/scripts/package-skills.test.ts` -- updated for `.mdc` shape + fixture-roundtrip.
- `tests/unit/panels/ChatCommandHandlers.test.ts` -- compact mock updated to the three-state return.

## Test results

- `npm run lint` -- clean.
- `npm run build` (tsc --noEmit) -- clean.
- `npm run test` -- **2372 passed, 4 skipped**, 2 pre-existing test FILES fail to collect (`tests/unit/cli/gemma-check.test.ts`, `tests/unit/scripts/package-skills.test.ts`) due to the v0.7.0 10.O.D vitest-vm-transform parse bug. Both failures reproduce on `main` HEAD with no Phase 6 changes (stash-and-rerun verified).

## Deviations

None. All sub-task scope landed as specified in the plan. The wiring of the new pure modules into their live surfaces (MemoryPanel, background workers, ChatHistoryStore, streaming pipeline) is explicitly out-of-scope for v0.8.0 and recorded as gaps 10.O.S through 10.O.Z.

## Manual verification

- `node scripts/package-skills.mjs --quiet` regenerated `dist/cursor/.cursor/rules/*.mdc`; spot-checked `analyze-codebase.mdc` and confirmed the new `description` / `globs` / `alwaysApply` frontmatter.
- New Phase 6 unit tests run cleanly in isolation: `npx vitest run tests/unit/storage/IntuitionCache.test.ts tests/unit/storage/ReflectJob.test.ts tests/unit/storage/ModelPinRegistry.test.ts tests/unit/skills/WorkflowDetector.test.ts tests/unit/chat/ToolCallStreamParser.test.ts tests/unit/scripts/check-architecture.test.ts tests/unit/panels/webview/memoryView.models.test.ts` -> 44/44 passed.

## Next phase

Phase 7 -- polish, golden re-capture, security review, release. The Phase 7 plan reads the v0.8.0 baselines once the Phase 6 changes ship and runs the full pen-test rerun before tagging v0.8.0.
