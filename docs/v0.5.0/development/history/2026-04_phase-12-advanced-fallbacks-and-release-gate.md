# Phase 12 -- Advanced Fallbacks + Release Gate

**Date**: 2026-04-26
**Plan**: [docs/v0.5.0/plans/implementation-plan.md](../../plans/implementation-plan.md) -- Phase 12
**Outcome**: All 5 in-scope sub-tasks shipped; version bumped to 0.5.0; CHANGELOG and architecture.md published. Three release-gate items deferred to a follow-up session that has live Ollama access.

## What landed

| Sub-task | Files | Status |
|----------|-------|--------|
| 12.1 Truncation-recovery golden micro-eval | [tests/golden/tasks/agent-friendly-*.yaml](../../../../tests/golden/tasks/), [tests/golden/snapshots/agent-friendly-*/](../../../../tests/golden/snapshots/), [tests/golden/baselines/v0.5.0+agent-friendly.json](../../../../tests/golden/baselines/v0.5.0+agent-friendly.json) | Shipped |
| 12.2 ARIMA-only predictive cache | [src/storage/PredictiveCache.ts](../../../../src/storage/PredictiveCache.ts), [tests/unit/storage/PredictiveCache.test.ts](../../../../tests/unit/storage/PredictiveCache.test.ts), `gemma-code.predictiveCacheEnabled` setting | Shipped |
| 12.3 Multi-tier eviction strategies | [src/storage/eviction/](../../../../src/storage/eviction/) (5 strategies + factory + types), [tests/unit/storage/eviction/](../../../../tests/unit/storage/eviction/), `gemma-code.cacheEvictionStrategy` setting | Shipped |
| 12.4 HeuristicEmbedder fallback + /cache reembed | [src/storage/HeuristicEmbedder.ts](../../../../src/storage/HeuristicEmbedder.ts), `EmbeddingClient.embedWithProvenance`, `tool_output_cache.embedding_provenance` migration, `ToolOutputCache.reembedHeuristic`, `/cache reembed` slash command | Shipped |
| 12.5 semantic-release + commitlint | [commitlint.config.cjs](../../../../commitlint.config.cjs), [.releaserc.json](../../../../.releaserc.json), [.github/workflows/commitlint.yml](../../../../.github/workflows/commitlint.yml), [.github/workflows/semantic-release.yml](../../../../.github/workflows/semantic-release.yml), 6 new devDependencies | Shipped |
| Release artifacts | `package.json` -> 0.5.0, [CHANGELOG.md](../../../../CHANGELOG.md), [docs/v0.5.0/architecture.md](../../architecture.md) | Shipped |

## Key decisions

- **LSTM stays out of scope.** The plan was explicit; the implementation enforces it: `PredictiveCache.ts` has only an ARIMA path, no pluggable backend, no toggle. Documented at module-comment level so a future contributor doesn't add an LSTM "alternative" by mistake.
- **W-TinyLFU is a minimal port.** The full Caffeine algorithm consults the count-min sketch on both admission and eviction. We admit via the sketch but evict the LRU of main; for our < 500-entry workload, the simpler variant suffices. Documented in the source.
- **Default LRU preserves v0.4.0 behavior.** The eviction refactor inserts the policy interface in front of the existing storage Map; with `LRUEvictor` the observable behavior is byte-equivalent. This was the test that mattered: re-running [tests/unit/storage/ToolOutputCache.test.ts](../../../../tests/unit/storage/ToolOutputCache.test.ts) green confirmed no regression.
- **Heuristic provenance on disk.** Adding the `embedding_provenance` column means `/cache reembed` knows which rows are upgradable when Ollama recovers, instead of re-embedding everything (which would waste cycles on rows that are already high-quality `'ollama'` vectors).
- **No `@semantic-release/npm`.** Gemma is a VSIX. Including the npm plugin would attempt to publish to a public registry on every release. The chain is `changelog -> git -> github`.

## Test mock fix

Two test files mocked `EmbeddingClient` with hand-rolled stubs that exposed only `isAvailable`, `embed`, `embedBatch`. After `_kickOffEmbed` switched to `embedWithProvenance`, both stubs returned undefined and no embeddings persisted. Updated the mocks to include `embedWithProvenance` and `embedHeuristic`. The fix was structural (not behavioral): once the mock had the new methods, the tests passed unchanged.

## Pre-existing failures (not Phase 12)

12 tests across 3 files (`CompactionStrategy.test.ts` x5, `ContextCompactor.test.ts` x6, `error-handling.test.ts` x1) were already failing on `main` before Phase 12. Verified via `git stash; vitest run; git stash pop`. These look like a tiktoken-threshold drift from Phase 5 budgeting that wasn't caught in the Phase 5 stabilization step. Tracked for separate investigation.

## Deferred (require live Ollama)

The Phase 12.6 release gate's quantitative checks need a live Ollama instance and benchmark baselines:

- `npm run bench` p50/p99 capture; baseline computation against the (missing) `tests/benchmarks/baselines/v0.4.0.json`
- Full 24-golden-task suite vs. `tests/golden/baselines/v0.4.0.json` (also missing); >= 40% token-savings and > 50% cache-hit verification
- CI matrix observation on Node 18/20/22 with the new commitlint and semantic-release workflows
- `git tag -a v0.5.0` -- the plan explicitly defers tag creation to user confirmation

## Lint, build, test summary

- `npm run lint`: 0 errors, 5 pre-existing warnings
- `npm run build`: clean
- `vitest run`: 134 test files passed, 3 failed (pre-existing), 1 skipped
- All new Phase 12 tests green (35 tests added)

## File inventory

Eviction (12.3):
- [src/storage/eviction/types.ts](../../../../src/storage/eviction/types.ts)
- [src/storage/eviction/LRUEvictor.ts](../../../../src/storage/eviction/LRUEvictor.ts)
- [src/storage/eviction/LFUEvictor.ts](../../../../src/storage/eviction/LFUEvictor.ts)
- [src/storage/eviction/ARCEvictor.ts](../../../../src/storage/eviction/ARCEvictor.ts)
- [src/storage/eviction/WTinyLFUEvictor.ts](../../../../src/storage/eviction/WTinyLFUEvictor.ts)
- [src/storage/eviction/ClockEvictor.ts](../../../../src/storage/eviction/ClockEvictor.ts)
- [src/storage/eviction/index.ts](../../../../src/storage/eviction/index.ts)
- 6 test files under [tests/unit/storage/eviction/](../../../../tests/unit/storage/eviction/)
- [src/storage/ToolOutputCache.ts](../../../../src/storage/ToolOutputCache.ts) edited to thread the `Evictor` interface through `ToolOutputLru`

Predictive cache (12.2):
- [src/storage/PredictiveCache.ts](../../../../src/storage/PredictiveCache.ts)
- [tests/unit/storage/PredictiveCache.test.ts](../../../../tests/unit/storage/PredictiveCache.test.ts)

Heuristic embedder + reembed (12.4):
- [src/storage/HeuristicEmbedder.ts](../../../../src/storage/HeuristicEmbedder.ts)
- [tests/unit/storage/HeuristicEmbedder.test.ts](../../../../tests/unit/storage/HeuristicEmbedder.test.ts)
- [src/storage/EmbeddingClient.ts](../../../../src/storage/EmbeddingClient.ts) edited
- [tests/unit/storage/EmbeddingClient.heuristic.test.ts](../../../../tests/unit/storage/EmbeddingClient.heuristic.test.ts)
- [src/storage/ToolOutputCache.ts](../../../../src/storage/ToolOutputCache.ts) edited (migration + reembedHeuristic)
- [src/panels/GemmaCodePanel.ts](../../../../src/panels/GemmaCodePanel.ts) edited (cache subcommand)
- [src/commands/CommandRouter.ts](../../../../src/commands/CommandRouter.ts) edited (descriptor)

Golden tasks (12.1):
- 3 YAML files under [tests/golden/tasks/agent-friendly-*.yaml](../../../../tests/golden/tasks/)
- 3 snapshot directories under [tests/golden/snapshots/agent-friendly-*/](../../../../tests/golden/snapshots/)
- [tests/golden/baselines/v0.5.0+agent-friendly.json](../../../../tests/golden/baselines/v0.5.0+agent-friendly.json)

CI / hygiene (12.5):
- [commitlint.config.cjs](../../../../commitlint.config.cjs)
- [.releaserc.json](../../../../.releaserc.json)
- [.github/workflows/commitlint.yml](../../../../.github/workflows/commitlint.yml)
- [.github/workflows/semantic-release.yml](../../../../.github/workflows/semantic-release.yml)
- [package.json](../../../../package.json) (devDependencies + version bump)
- [CONTRIBUTING.md](../../../../CONTRIBUTING.md) (commit message format section)

Release artifacts:
- [CHANGELOG.md](../../../../CHANGELOG.md) (v0.5.0 entry)
- [docs/v0.5.0/architecture.md](../../architecture.md)

Test mock updates:
- [tests/unit/storage/ToolOutputCache.semantic.test.ts](../../../../tests/unit/storage/ToolOutputCache.semantic.test.ts)
- [tests/integration/semantic-recall-fallback.test.ts](../../../../tests/integration/semantic-recall-fallback.test.ts)

## Next phase

Phase 12 is the final phase of v0.5.0. The release gate's deferred quantitative checks (benchmarks, golden-task baseline) belong to a follow-up "release verification" session. After those checks pass and the user confirms, `git tag -a v0.5.0` ships the release; the existing tag-driven release.yml builds the VSIX.
