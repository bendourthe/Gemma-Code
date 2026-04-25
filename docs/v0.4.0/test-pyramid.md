# Test Pyramid — v0.4.0

**Recorded**: 2026-04-19 (end of Phase 5, after the full deferred-items sweep)
**Purpose**: Document the ratio of unit / integration / e2e tests so regressions toward the "ice-cream cone" shape are visible in review.

## File-level counts

Counts below are `*.test.ts` files only. `*.ps1` and `*.sh` smoke scripts are tracked in [tests/smoke/](../../tests/smoke/) and [tests/integration/installer/](../../tests/integration/installer/) but intentionally excluded here because they execute out of the Vitest runner.

| Tier | Location | Test files | Share |
|------|----------|------------|-------|
| Unit | [tests/unit/](../../tests/unit/) | 78 | 86.7% |
| Integration (non-e2e) | [tests/integration/](../../tests/integration/) | 6 | 6.7% |
| E2E | [tests/integration/e2e/](../../tests/integration/e2e/) | 6 | 6.7% |

Total: 90 Vitest test files. Total test cases: 1168 (2 live-Ollama skips, 1166 passing).

## Pyramid target

The v0.4.0 goal (from the [implementation plan](./implementation-plan.md) Phase 5 stability gate) was to move the pyramid "closer to 70/20/10". The measured ratio is **86.7 / 6.7 / 6.7** — still heavily top-heavy on unit tests, with the integration band growing from 4.6% to 6.7% during Phase 5.

That shape is partly intentional: Gemma Code's surface is a VS Code extension whose integration seams (webview messaging, Ollama HTTP, SQLite storage, configuration reload) each have dedicated integration tests. The unit band is large because the agent loop, orchestration, and tool handlers have many branching behaviors that are cheap to unit-test and expensive to exercise end-to-end.

## Additions in Phase 5

Phase 5 added the following Vitest files:

**Integration tier (+4 files):**
- [tests/integration/ollama-client.test.ts](../../tests/integration/ollama-client.test.ts) — 8 msw-backed HTTP cases (health, listModels, streamChat branches).
- [tests/integration/config-reload.test.ts](../../tests/integration/config-reload.test.ts) — 17 cases covering every reactive configuration key and the `onSettingsChange` subscriber.
- [tests/integration/prompt-composition.test.ts](../../tests/integration/prompt-composition.test.ts) — renamed from the old `tests/integration/e2e/full-pipeline.test.ts` so the e2e slot can host a real-`AgentLoop` run (below).

**E2E tier (stayed at 6 but meaningfully strengthened):**
- [tests/integration/e2e/full-pipeline.test.ts](../../tests/integration/e2e/full-pipeline.test.ts) — rewritten to instantiate a real `AgentLoop` with a mocked `OllamaClient`, a real `ConversationManager`, and a real `ToolRegistry`. Covers single-turn, multi-turn tool-call + continuation, and mid-stream cancel.

**Unit tier:**
- [tests/unit/panels/GemmaCodePanel.realSettings.test.ts](../../tests/unit/panels/GemmaCodePanel.realSettings.test.ts) — new file exercising the panel through the real `settings.ts` module.
- Expansions to `AgentLoop.test.ts` (+4 GitSafetyNet cases), `filesystem.test.ts` (+7 GrepCodebaseTool cases), `extension.test.ts` (+2 cases), `Orchestrator.replan.test.ts` (+1 memory-save case).

## Structural improvements

- **Shared test helpers** — [tests/helpers/factories.ts](../../tests/helpers/factories.ts) with a `mockOf<T>()` generic and 10 typed factories. Used by 16 test files; eliminated 44 of 54 `as unknown as` casts in the process.
- **Deterministic synchronization** — removed all 10 `setTimeout(r, N)` test-sync primitives; suite now uses `vi.waitFor` / `Promise.resolve()` / fake timers.
- **Consistent naming** — dropped the `should ` prefix from all 85 `it()` descriptions in the orchestration suite.
- **Assertion strength** — 22 of 46 weak `toBeDefined`/`toBeTruthy`/`toBeFalsy` assertions tightened; remaining 25 are legitimate pre-specific-assertion null guards.
- **Golden-task cross-check** — [scripts/generate-golden-tasks.mjs](../../scripts/generate-golden-tasks.mjs) generates [src/evaluation/goldenTasksYaml.generated.ts](../../src/evaluation/goldenTasksYaml.generated.ts) as a `prebuild`/`pretest` hook; `GoldenTaskSuite.test.ts` cross-checks the YAML count and id-to-filename mapping.
- **Installer test disambiguation** — nightly jobs renamed `installer-package-check-*` (verifies PyQt installer package); weekly `installer-smoke-*` stays the canonical full smoke surface.

## What moved / shrank

- Removed: `tests/unit/installer/nsis-logic.test.ps1` (legacy NSIS PowerShell test; no NSIS installer is shipped as of v0.3.0).

## Follow-ups for v0.5.0

- Continue migrating high-value unit tests that cross module boundaries (e.g., subagent + memory + planner) to the integration tier to push the ratio from 86.7/6.7/6.7 toward 70/20/10.
- Add a real-backed (non-mocked) e2e that stands up Ollama in a container if CI cost allows.
- Consider adopting `js-yaml` for the golden-task generator if the YAML schema grows beyond the simple top-level `id:` field.

## How to reproduce the count

```bash
# Unit
git ls-files 'tests/unit/**/*.test.ts' | wc -l
# Integration (non-e2e)
git ls-files 'tests/integration/**/*.test.ts' | grep -v '/e2e/' | wc -l
# E2E
git ls-files 'tests/integration/e2e/**/*.test.ts' | wc -l
```
