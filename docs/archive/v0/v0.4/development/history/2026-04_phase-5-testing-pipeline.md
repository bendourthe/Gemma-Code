# v0.4.0 Phase 5 -- Testing Pipeline Completeness

**Date**: 2026-04-19
**Branch**: main
**Plan**: [docs/archive/versions/v0/v0.4.0/implementation-plan.md](../../implementation-plan.md) lines 1236-1511
**Pre-conditions**: Phase 4 (Performance Optimization) merged at commit `a26de53`; 1117/1119 tests green.
**Goal**: Close all 22 testing-pipeline findings -- remove flake, consolidate helpers, add missing coverage, document the pyramid.

## Sub-tasks closed (22 of 22)

| # | Description | Status |
|---|-------------|--------|
| 5.1 | Replace sleep-based synchronization across 6 test files | Done |
| 5.2 | Add GitSafetyNet integration to AgentLoop tests | Done |
| 5.3 | Test `Orchestrator.replan` memory-save branch | Done |
| 5.4 | Introduce typed mock factories and sweep casts | Done (54 -> 10 legitimate survivors) |
| 5.5 | Fix trivial-pass assertion | Done |
| 5.6 | Python `/models` endpoint test | N/A (backend removed Phase 3) |
| 5.7 | Rewrite full-pipeline.test.ts to run real AgentLoop | Done |
| 5.8 | Mocked Ollama integration (msw) | Done |
| 5.9 | Regenerate YAML golden-task cross-check | Done (generated module + prebuild hook) |
| 5.10 | Sweep weak assertions | Done (22 tightened; 25 legitimate null-guards retained) |
| 5.11 | Expand extension.test.ts | Done (+2) |
| 5.12 | GrepCodebaseTool cases | Done (+7) |
| 5.13 | GemmaCodePanel real-settings test | Done |
| 5.14 | Windows unlink retry | Done |
| 5.15 | Fake-timer Ollama backoff tests | N/A (no retry logic in source) |
| 5.16 | Drop "should" prefix in test descriptions | Done (85 renamed) |
| 5.17 | Delete legacy NSIS test | Done |
| 5.18 | Create `tests/golden/.gitignore` | Done |
| 5.19 | Installer smoke disambiguation | Done (job rename + README) |
| 5.20 | Create `tests/helpers/factories.ts` | Done |
| 5.21 | Add config-reload integration test | Done (17 cases) |
| 5.22 | Testing and Stabilization | Done |

## What was built

1. **Shared factory module** — [tests/helpers/factories.ts](../../../../versions/tests/helpers/factories.ts) with `mockOf<T>()` generic and 10 typed factories. 16 test files migrated; 44 of 54 `as unknown as` casts eliminated (remaining 10 are all legitimate: ChildProcess internals in `terminal.test.ts`, private-field introspection in `MemorySubsystem`/`memory-recall.bench`/`tool-execution.bench`, the encapsulated cast in `factories.ts` itself, and a generic-type-erasure in `GemmaCodePanel.realSettings.test.ts`).

2. **Deterministic synchronization** — removed every `setTimeout(r, N)` test-sync primitive; replaced with `Promise.resolve()`, `vi.waitFor`, or fake timers.

3. **New integration coverage:**
   - [tests/integration/ollama-client.test.ts](../../../../versions/tests/integration/ollama-client.test.ts) — 8 msw-backed HTTP cases.
   - [tests/integration/e2e/full-pipeline.test.ts](../../../../versions/tests/integration/e2e/full-pipeline.test.ts) — 3 real-`AgentLoop` e2e cases with mocked client.
   - [tests/integration/config-reload.test.ts](../../../../versions/tests/integration/config-reload.test.ts) — 17 cases covering `onSettingsChange` wiring.
   - [tests/integration/prompt-composition.test.ts](../../../../versions/tests/integration/prompt-composition.test.ts) — renamed from the old full-pipeline.

4. **New unit coverage:**
   - GitSafetyNet integration block in AgentLoop.test.ts (+4 cases).
   - Orchestrator memory-save branch (+1 case).
   - GrepCodebaseTool breadth (+7 cases).
   - Extension activation (+2 cases).
   - GemmaCodePanel real-settings (new file, +3 cases).

5. **Golden-task cross-check** — [scripts/generate-golden-tasks.mjs](../../../../versions/scripts/generate-golden-tasks.mjs) emits a typed module listing the YAML corpus count and ids. Wired as `prebuild` and `pretest` hooks. Four new test cases in `GoldenTaskSuite.test.ts` cross-check count, id uniqueness, and id-to-filename mapping.

6. **Windows unlink retry** in `memory-across-sessions.test.ts` (EBUSY/EPERM retry loop).

7. **Weak-assertion tightening** across 9 files (22 assertions strengthened; 25 legitimate null-guards preserved).

8. **Test description rename** — 85 `it("should ...")` descriptions converted to the bare present-tense form across 7 orchestration files.

9. **Installer test disambiguation** — nightly jobs renamed `installer-package-check-*` to reflect what they actually verify (package imports, GPU detection); the weekly full-smoke workflow continues to run `tests/smoke/*` unchanged. New [tests/integration/installer/README.md](../../../../versions/tests/integration/installer/README.md) documents the distinction.

10. **Docs** — [test-pyramid.md](../../test-pyramid.md), updated DEVLOG, updated `docs/todos.md`.

## N/A findings (closed as obsolete)

- **5.6** — `src/backend/` was removed in Phase 3; no `/models` endpoint exists to mirror.
- **5.15** — `src/ollama/client.ts` does not implement retry or backoff, so there is no retry state machine to cover.

## Test status at exit

- `npm run test`: **1166 passed, 2 skipped, 0 failed** across 89 test files.
- Coverage: **89.07% lines / 82.78% branches** — above the 80/75 gate in `configs/vitest.config.ts`.
- `git grep 'it(\"should\\|it('"'"'should' tests/` returns nothing.
- `git grep 'setTimeout(r' tests/` returns only the deliberate Windows-unlink backoff and a golden-task production-like fixture.
- `git grep 'as unknown as' tests/` returns 10 legitimate survivors (all documented above).

## Files touched (summary)

### Created (11)

- `tests/helpers/factories.ts`
- `tests/integration/ollama-client.test.ts`
- `tests/integration/config-reload.test.ts`
- `tests/integration/prompt-composition.test.ts`
- `tests/integration/installer/README.md`
- `tests/unit/panels/GemmaCodePanel.realSettings.test.ts`
- `tests/golden/.gitignore`
- `scripts/generate-golden-tasks.mjs`
- `src/observability/goldenTasksYaml.generated.ts` (generated; do not edit)
- `docs/archive/versions/v0/v0.4.0/test-pyramid.md`
- `docs/archive/versions/v0/v0.4.0/development/history/2026-04_phase-5-testing-pipeline.md` (this file)

### Deleted

- `tests/unit/installer/nsis-logic.test.ps1` + empty parent directory.

### Modified

- 30+ test files (factories migration, sleep removal, should-prefix rename, weak-assertion tightening, cast sweep).
- `package.json` (msw devDependency; `generate:golden-tasks` / `prebuild` / `pretest` scripts).
- `.github/workflows/nightly.yml` (installer job renames).
- `docs/DEVLOG.md`, `docs/todos.md`.

## Next steps

Phase 5 closes the testing pipeline gate for v0.4.0. The remaining v0.4.0 phases are Phase 6 (Restructuring) and Phase 7 (Simplification and Release), per the implementation plan.
