# v0.4.0 Phase 7 -- Simplification and Release

**Date**: 2026-04-25
**Branch**: main
**Plan**: [docs/archive/versions/v0/v0.4.0/plans/implementation-plan.md](../../plans/implementation-plan.md) lines 1734-1962
**Pre-conditions**: Phase 6 (Restructuring) merged at commit `bf4aa35`; 1097/1099 tests green; ESLint clean.
**Goal**: Close 17 simplification findings (~800 LOC removed), wire every still-disconnected user setting, and finalize the v0.4.0 CHANGELOG. The git tag and VSIX/installer build are gated on user authorization.

> **Companion DEVLOG entry**: [docs/DEVLOG.md](../../../DEVLOG.md) (2026-04-25 section) holds the per-change narrative. This file is the audit trail; consult the DEVLOG for rationale and test outcomes.

## Sub-tasks closed (17 of 18; 1 deferred to user)

| #    | Description                                              | Status                                                      |
|------|----------------------------------------------------------|-------------------------------------------------------------|
| 7.1  | Delete BudgetEnforcer + test                             | Done                                                        |
| 7.2  | Delete LazyToolLoader, serializeToolSummary, get_tool_schema, lazyToolLoading flag | Done                                |
| 7.3  | Delete ConversationSync + test                           | Done                                                        |
| 7.4  | Delete RelevanceScorer; collapse async branch in PromptBuilder.build | Done -- `build` is now synchronous              |
| 7.5  | Unify HardwareTier with GpuTierConfig                    | Done                                                        |
| 7.6  | Delete inferTierFromModelName                            | Done -- removed with GpuTierConfig                          |
| 7.7  | Remove python-multipart from backend pyproject.toml      | N/A -- backend already deleted in 1.13                      |
| 7.8  | Remove highlight.min.js webview copy step                | Done                                                        |
| 7.9  | Disable declaration emit in tsconfig                     | Done                                                        |
| 7.10 | Delete memoryAutoSaveInterval setting                    | Done                                                        |
| 7.11 | Wire permissionOverrides into ToolRegistry               | Done -- new unit test asserts override pathway              |
| 7.12 | Delete maxSessionTokens / maxSessionMinutes settings     | Done                                                        |
| 7.13 | Collapse gpuTier into gpuTierOverride                    | Done -- v0.5 migration shim retained for one release        |
| 7.14 | Simplify parseOtlpHeaders                                | Done                                                        |
| 7.15 | Delete escapeAttr alias                                  | Done                                                        |
| 7.16 | Relocate GoldenTaskSuite TS helpers                      | Done -- moved to `tests/helpers/goldenTaskHelpers.ts`       |
| 7.17 | Release packaging and tag                                | CHANGELOG finalized; VSIX/installer/tag deferred to user    |
| 7.18 | Testing and stabilization                                | Done -- 1097 tests pass, 88.79% coverage, lint clean        |

## What was removed

1. **BudgetEnforcer (7.1)** -- [src/guardrails/BudgetEnforcer.ts](../../../../src/guardrails/BudgetEnforcer.ts) and its unit test deleted; `BudgetEnforcer` and `BudgetEnforcerConfig` exports removed from [src/guardrails/index.ts](../../../../src/guardrails/index.ts). The agent-loop branches that consumed it were already removed in Phase 3.

2. **LazyToolLoader + lazy-loading scaffolding (7.2)** -- [src/tools/LazyToolLoader.ts](../../../../src/tools/LazyToolLoader.ts) and its test deleted; `serializeToolSummary` removed from [src/tools/Gemma4ToolFormat.ts](../../../../src/tools/Gemma4ToolFormat.ts); `lazyToolLoading` field removed from `PromptContext` ([src/chat/PromptBuilder.types.ts](../../../../src/chat/PromptBuilder.types.ts)); `get_tool_schema` removed from `BUILTIN_TOOL_NAMES`, `TOOL_PERMISSION_MAP`, `SAFE_TOOLS`, and the `GetToolSchemaParams` type; `PromptBuilder._buildToolDeclarations` collapsed to a single serializer (cache key no longer encodes the lazy flag).

3. **ConversationSync (7.3)** -- [src/storage/ConversationSync.ts](../../../../src/storage/ConversationSync.ts) and its test deleted. The try/catch that used it was already removed in Phase 3.

4. **RelevanceScorer + async PromptBuilder (7.4)** -- [src/chat/RelevanceScorer.ts](../../../../src/chat/RelevanceScorer.ts) and its test deleted. `PromptBuilder.build`, `buildSync`, and `buildForSubAgent` are now synchronous; the relevance-scoring branch (priority-by-score sorting, embedding cache, `Promise.all`) is gone. `currentQuery`, `recentUserMessage`, and `relevanceScorer` fields removed from `PromptContext`. Eight call sites in [src/panels/GemmaCodePanel.ts](../../../../src/panels/GemmaCodePanel.ts) and one in [src/agents/SubAgentManager.ts](../../../../src/agents/SubAgentManager.ts) drop the `await`. `updateTierConfig` is now synchronous; three call sites in [src/extension.ts](../../../../src/extension.ts) drop the `await` / `void` markers. Stale RelevanceScorer references in [src/storage/embeddingUtils.ts](../../../../src/storage/embeddingUtils.ts) doc comments updated.

5. **GpuTierConfig and inferTierFromModelName (7.5, 7.6)** -- [src/config/GpuTierConfig.ts](../../../../src/config/GpuTierConfig.ts) and its test deleted. `HardwareTierConfig` ([src/config/HardwareTier.types.ts](../../../../src/config/HardwareTier.types.ts)) gains `subAgentMaxIterations` and `maxConcurrentSubAgents` fields; [src/config/HardwareTier.ts](../../../../src/config/HardwareTier.ts) `TIER_CONFIGS` populated with the values previously held in `GPU_TIER_PROFILES` (Tier 1: 8 / 1; Tier 2: 12 / 2; Tier 3: 15 / 3). [src/orchestration/Orchestrator.ts](../../../../src/orchestration/Orchestrator.ts) and [src/orchestration/DAGExecutor.ts](../../../../src/orchestration/DAGExecutor.ts) now consume `HardwareTierConfig` directly; `OrchestratorConfig.gpuTierProfile` renamed to `hardwareTier`. `GemmaCodePanel` no longer calls `detectGpuTier`/`getEffectiveProfile`; it bootstraps with `getTierConfig(settings.gpuTierOverride ?? 2)` and `extension.ts` updates via `updateTierConfig` once GPU detection completes. Test factories ([tests/helpers/factories.ts](../../../../tests/helpers/factories.ts), [tests/unit/orchestration/DAGExecutor.test.ts](../../../../tests/unit/orchestration/DAGExecutor.test.ts)) now return `getTierConfig(N)` instead of hand-rolled `GpuTierProfile` objects.

6. **highlight.min.js copy step (7.8)** -- the `Copy-Item $HljsMin` block in [scripts/build-vsix.ps1](../../../../scripts/build-vsix.ps1) deleted. The webview imports highlight.js languages via the bundled module loader; the standalone bundle is no longer needed and the VSIX shrinks by ~1 MB.

7. **Settings cleanup (7.10, 7.12, 7.13)** -- `gemma-code.memoryAutoSaveInterval`, `gemma-code.maxSessionTokens`, `gemma-code.maxSessionMinutes`, and `gemma-code.gpuTier` removed from [package.json](../../../../package.json) `contributes.configuration.properties` and from [src/config/settings.ts](../../../../src/config/settings.ts). A `readGpuTierOverride` migration shim in `settings.ts` reads the legacy `gpuTier` string for one release and maps it onto `gpuTierOverride`; the shim is annotated `// NOTE(v0.5): remove gpuTier fallback`.

8. **escapeAttr alias (7.15)** -- the `escapeAttr` helper in [src/utils/MarkdownRenderer.ts](../../../../src/utils/MarkdownRenderer.ts) deleted; the two call sites (code-block copy button + link renderer) now invoke `escapeHtml` directly. Inline `escapeAttr` helpers inside the SessionListPanel and traceDashboard webview HTML strings are independent JS implementations and stay in place.

9. **GoldenTaskSuite test helpers (7.16)** -- `validateExpectation` and `detectRegressions` moved out of [src/evaluation/GoldenTaskSuite.ts](../../../../src/evaluation/GoldenTaskSuite.ts) into a new [tests/helpers/goldenTaskHelpers.ts](../../../../tests/helpers/goldenTaskHelpers.ts) (test-only consumer). The existing test suite imports the helpers from the new location; the shipped extension carries less code.

## What was wired

1. **permissionOverrides (7.11)** -- [src/panels/GemmaCodePanel.ts](../../../../src/panels/GemmaCodePanel.ts) `_buildToolRegistry` now accepts `permissionOverrides` and forwards it to `ToolRegistry.setConfirmationGate`. A new `ToolRegistry` unit test asserts that an `{ read_file: 2 }` override elevates an auto-approve tool to dangerous and triggers the confirmation gate.

## Internal cleanup

1. **Declaration emit disabled (7.9)** -- [tsconfig.json](../../../../tsconfig.json) sets `declaration: false` and `declarationMap: false`. No `.d.ts` artifacts in `out/`; faster `tsc` compile.

2. **parseOtlpHeaders rewrite (7.14)** -- [src/observability/OtlpExporter.ts](../../../../src/observability/OtlpExporter.ts) `parseOtlpHeaders` now uses `split` -> `map` -> `filter` -> `Object.fromEntries` (same shape, half the lines, no mutable accumulator).

## Quality gates (Phase 7.18)

| Gate                | Threshold | Result                                  |
|---------------------|-----------|-----------------------------------------|
| All tests passing   | 0 failures | 1097 / 1099 (2 ollama-health skipped)  |
| Line coverage       | >= 80%   | 88.79%                                   |
| Branch coverage     | >= 70%   | 82.58%                                   |
| Lint errors         | 0        | 0 errors (5 pre-existing warnings)       |
| Build / compile     | Succeeds | clean                                    |

Test execution: 8.18s wall-clock for the full vitest suite.

## Deviations from the plan

- **7.7 (python-multipart)**: N/A. The Python backend was deleted in Phase 1.13; there is no `src/backend/pyproject.toml` to edit. The legacy locked `scripts/installer/legacy/backend-requirements.txt` retains the entry but is not on any active CI or build path.
- **7.17 (release packaging)**: The CHANGELOG.md v0.4.0 section is finalized and the source tree is ready to ship, but `npm run package` (VSIX), the installer-smoke matrix, and the `v0.4.0` git tag are gated on explicit user authorization. They affect shared state (CI runs, release artifacts) and are deferred to interactive execution.

## Next steps for the user

1. Run `npm run package` to build the VSIX.
2. Trigger `installer-smoke.yml workflow_dispatch` for Windows / macOS / Linux installer builds.
3. Verify the v0.4.0 CHANGELOG entries are complete (the present file documents Phase 7 only; Phases 2-6 entries were already authored in their session-history files but should be aggregated into CHANGELOG.md before tagging).
4. Create the `v0.4.0` git tag and push to trigger `release.yml`.
5. Hold for explicit go-ahead before publishing to the VS Code Marketplace.
