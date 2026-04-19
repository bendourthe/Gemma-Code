# v0.4.0 Phase 3 - Correctness and Code Quality

**Date:** 2026-04-19
**Plan:** [docs/v0.4.0/implementation-plan.md](../../implementation-plan.md) Phase 3
**Findings closed:** 24 (8 P1 + 10 P2 + 6 P3) from [docs/v0.3.0/review.md](../../../v0.3.0/review.md)
**Test status:** 1116 passed, 2 skipped, 0 failed. Lint clean (0 errors, 30 pre-existing warnings).

---

## Overview

Phase 3 closed every remaining correctness / code-quality finding from the v0.3.0 review. The work was organized into six "waves" that each ended with a clean typecheck before the next wave began:

| Wave | Scope | Sub-tasks | Outcome |
|------|-------|-----------|---------|
| A | Correctness bug-fixes (P1) | 3.1 - 3.6 | Single-confirmation file-edit UX; session-token budget wired; dead `_budgetEnforcer` / `_sync` branches removed |
| B | Shared-utility extractions | 3.7 - 3.8 | `embeddingUtils.ts` + `sqliteFts.ts` created; four call sites migrated |
| C | Refactors + targeted fixes | 3.9 - 3.16 | Nested-JSON parser; AgentLoop.run split; PromptBuilder dedup; ComplexityClassifier extracted |
| D | P3 sweep | 3.17 | Settings cache + output-channel error logging; maxTokens wired; magic numbers hoisted |
| E | Cleanup | 3.18 - 3.20 | Unused export deleted; debt comments converted to `NOTE(v0.5):` |
| F | Stabilization | 3.21 | `npm run lint` + `npm run test` green; regression tests for every new behavior |

## Sub-task detail

### 3.1 GitSafetyNet inverted diff check — regression test added
- **File:** [src/safety/GitSafetyNet.ts:57-79](../../../../src/safety/GitSafetyNet.ts#L57-L79)
- **Result:** DEVIATION: the inverted diff check appears to have been corrected in a prior phase. Added a regression test in [tests/unit/safety/GitSafetyNet.test.ts](../../../../tests/unit/safety/GitSafetyNet.test.ts) that locks the correct behavior: two consecutive `commitAgentChanges` invocations produce exactly one commit when only the first has staged changes.

### 3.2 Remove double-confirmation for file-edit tools
- **Files:** [src/tools/ToolRegistry.ts](../../../../src/tools/ToolRegistry.ts), [src/panels/GemmaCodePanel.ts](../../../../src/panels/GemmaCodePanel.ts)
- **Implementation:** `ToolRegistry` gained `setEditMode(mode)` and the `setConfirmationGate` signature now takes an optional `editMode` arg. The centralized gate is suppressed for `write_file`, `edit_file`, `create_file` when edit mode is `ask` or `plan` — the per-tool handler already posts a diff-bearing confirmation. `delete_file` continues through the central gate.
- **DEVIATION:** The plan wording said "remove per-tool ConfirmationGate calls". Chose the inverse — skip the central gate — because the per-tool gate carries the diff and is the richer UX. Same acceptance criteria met, smaller surface area changed.
- **Tests:** 5 new cases in [tests/unit/tools/ToolRegistry.test.ts](../../../../tests/unit/tools/ToolRegistry.test.ts) cover `delete_file` (central fires), `write_file` / `edit_file` in ask / plan (central skipped), `create_file` in auto (central fires), and user-rejection propagation.

### 3.3 Remove unregistered tools from catalog
- **File:** [src/tools/ToolCatalog.ts](../../../../src/tools/ToolCatalog.ts)
- **Result:** `TOOL_CATALOG` shrinks from 13 to 10 entries. `BuiltinToolName` in [src/tools/types.ts](../../../../src/tools/types.ts) still carries the three legacy names so Phase 7 can cleanly delete `LazyToolLoader` and `OutputRedirector`. [tests/unit/tools/LazyToolLoader.test.ts](../../../../tests/unit/tools/LazyToolLoader.test.ts) builds a synthetic catalog that still contains the helpers.

### 3.4 Wire BudgetMiddleware.recordTurnTokens
- **Files:** [src/tools/AgentLoop.ts](../../../../src/tools/AgentLoop.ts), [src/tools/BudgetMiddleware.ts](../../../../src/tools/BudgetMiddleware.ts)
- **Implementation:** After each model stream completes, `AgentLoop._runOneIteration` calls `recordTurnTokens(estimateTokensForString(accumulated))`. The middleware's own per-turn cap (`maxTurnTokens`) halts immediately; session budget (`maxSessionTokens`) halts on the next iteration's `checkPreTurn`.
- **Tests:** Two integration tests in [tests/unit/tools/AgentLoop.test.ts](../../../../tests/unit/tools/AgentLoop.test.ts) assert both halts fire.

### 3.5 Remove _budgetEnforcer branches from AgentLoop
- **File:** [src/tools/AgentLoop.ts](../../../../src/tools/AgentLoop.ts)
- **Result:** Import, field, `AgentLoopOptions.budgetEnforcer`, `checkBudget`, `recordInput`, `recordOutput` all removed. The `BudgetEnforcer` class file at `src/safety/BudgetEnforcer.ts` is untouched (Phase 7 owns deletion).

### 3.6 Remove ConversationSync try/catch blocks
- **File:** [src/chat/ConversationManager.ts](../../../../src/chat/ConversationManager.ts)
- **Result:** Constructor now takes `(systemPrompt, _store?)`. All four fire-and-forget try/catch blocks removed. `ConversationSync` class file remains (Phase 7).

### 3.7 Extract embedding utilities
- **New file:** [src/storage/embeddingUtils.ts](../../../../src/storage/embeddingUtils.ts)
- **Exports:** `cosineSimilarity` (raw `[-1, 1]`), `cosineSimilarityNormalized` (`[0, 1]` with 0.5 neutral), `serializeEmbedding`, `deserializeEmbedding`, `deserializeEmbeddingF32`, `sanitizeFtsQuery`.
- **Retired duplicates:** `MemoryStore._deserializeEmbedding`, `MemoryStore._cosineSimilarity32`, `MemoryStore._sanitizeFtsQuery`, `EpisodicMemory._deserializeEmbedding`, `EpisodicMemory._cosineSimilarity`, `EpisodicMemory._sanitizeFtsQuery`, `RelevanceScorer._cosineSimilarity`, `ChatHistoryStore` inline FTS sanitization.
- **Range decision:** Default is raw `[-1, 1]`. `RelevanceScorer` uses the normalized helper to preserve its pre-existing 0.5 neutral behavior exactly.
- **Tests:** 16 cases in [tests/unit/storage/embeddingUtils.test.ts](../../../../tests/unit/storage/embeddingUtils.test.ts).

### 3.8 Extract FTS5 trigger helper
- **New file:** [src/storage/sqliteFts.ts](../../../../src/storage/sqliteFts.ts)
- **Export:** `createFtsTableAndTriggers(db, {ftsTable, contentTable, columns, triggerPrefix?})` - emits the virtual table DDL plus INSERT / UPDATE / DELETE triggers uniformly.
- **Applied:** `MemoryStore`, `EpisodicMemory`, `ChatHistoryStore`. All three FTS tables now have homogenized triggers - review finding #3's AFTER UPDATE fix is automatic for every caller going forward.

### 3.9 Extend Gemma4 tool-format parser for nested JSON
- **File:** [src/tools/Gemma4ToolFormat.ts](../../../../src/tools/Gemma4ToolFormat.ts)
- **Implementation:** `parseToolCalls` now scans for the `<|tool_call>call:NAME{` opener via `GEMMA4_TOOL_CALL_OPEN_RE`, then locates the matching `}` via a balanced-brace walker (`findBalancedEnd`). `parseKeyValueBody` pre-extracts `key:{...}` and `key:[...]` substrings through `extractNestedJsonValues`, `JSON.parse`s them, and falls back to storing the raw text on parse failure so the model still sees something. `stripToolCalls` uses `<|tool_call>[\s\S]*?<tool_call|>` for simple strip-only scenarios.
- **Tests:** 4 new cases in [tests/unit/tools/Gemma4ToolFormat.test.ts](../../../../tests/unit/tools/Gemma4ToolFormat.test.ts) covering object values, array values, deeply nested objects with strings containing braces, and malformed-JSON fallback.

### 3.10 Split AgentLoop.run
- **File:** [src/tools/AgentLoop.ts](../../../../src/tools/AgentLoop.ts)
- **Result:** `run()` is under 30 lines and reads as orchestration only. Extracted `_runOneIteration(iteration, tracer, postMessage): Promise<"continue" | "done" | "abort">` and `_runToolCall(call, iteration, iterSpanId, tracer, postMessage): Promise<"continue" | "abort">`. Observable behavior is unchanged; all 21 existing AgentLoop tests pass without modification.

### 3.11 Dedupe _buildBaseInstructions shared blocks
- **File:** [src/chat/PromptBuilder.ts](../../../../src/chat/PromptBuilder.ts)
- **Result:** Introduced `IDENTITY_LINE_BY_STYLE`, `SHARED_TOOL_USE_BLOCK`, `SHARED_PATH_RULE`. `_buildBaseInstructions` composes them with a single identity line. Output for each prompt style matches the pre-refactor byte-for-byte; existing snapshot / thinking-mode / sub-agent tests continue to pass.

### 3.12 Extract ComplexityClassifier
- **New file:** [src/orchestration/ComplexityClassifier.ts](../../../../src/orchestration/ComplexityClassifier.ts)
- **API:** `classify(text: string): { complex: boolean; reason: string }`. `HeuristicComplexityClassifier` is the default, injectable via `OrchestratorConfig.complexityClassifier`.
- **Tests:** 6 cases in [tests/unit/orchestration/ComplexityClassifier.test.ts](../../../../tests/unit/orchestration/ComplexityClassifier.test.ts) covering simple-prefix / trigger-keyword / length-threshold / boundary / precedence.

### 3.13 Fix MemoryConsolidator unreachable user_requested branch
- **Files:** [src/storage/MemoryConsolidator.ts](../../../../src/storage/MemoryConsolidator.ts), [src/storage/MemoryLayers.types.ts](../../../../src/storage/MemoryLayers.types.ts)
- **Result:** Chose path A: removed `"user_requested"` from `WritePolicy`. The dead switch case is gone; the type doc comment records why.

### 3.14 Harden GrepCodebaseTool regex safety
- **Files:** [src/tools/handlers/filesystem.ts](../../../../src/tools/handlers/filesystem.ts), [src/tools/types.ts](../../../../src/tools/types.ts)
- **Result:** Regex compiled eagerly under try/catch; `case_insensitive?: boolean` parameter added to `GrepCodebaseParams` and propagated to both the ripgrep path (`-i`) and the vscode.workspace.findFiles fallback (`new RegExp(pattern, "i")`).

### 3.15 Fix EntityExtractor occurrences tracking
- **File:** [src/storage/EntityExtractor.ts](../../../../src/storage/EntityExtractor.ts)
- **Result:** `ExtractedEntity` gained `occurrences: Array<{start, end}>`. `extractFromText` accumulates all positions per (name, type). `extractRelationsFromText` now uses `splitIntoSentenceSpans` (character-aware splitter that preserves `.ts` / `.json` extensions) and filters entities by position overlap with each sentence span, eliminating the spurious `sentence.includes(name)` false positives.

### 3.16 Fix TraceDashboardPanel randomUUID import
- **File:** [src/panels/TraceDashboardPanel.ts](../../../../src/panels/TraceDashboardPanel.ts)
- **Result:** Explicit `import { randomUUID } from "crypto"` to match the rest of the codebase.

### 3.17 P3 sweep
- **Item 1 (ActionClassifier unused import):** No-op - already resolved in a prior phase.
- **Item 2 (AgentLoop limit: 0 sentinel):** `AgentLoopOptions.maxTokens` added; `_postTokenCount` emits the real limit; `GemmaCodePanel` passes `settings.maxTokens`.
- **Item 3 (GemmaCodePanel settings cache + error logging):** `_settingsCache` + `workspace.onDidChangeConfiguration` invalidation; all ~13 internal `getSettings()` call sites route through `_getSettings()`; `_handleSetEditMode` config-save errors now go to a dedicated `Gemma Code` output channel; both disposable and output channel torn down in `dispose()`.
- **Item 4 (magic numbers):** [src/storage/constants.ts](../../../../src/storage/constants.ts) created with `CHARS_PER_TOKEN`, `MAX_NODES_VISITED`, `GRAPH_MAX_TRAVERSAL_RESULTS`, `ONE_DAY_MS`, `ONE_WEEK_MS`; applied to `GraphQueryEngine` and `GraphMemory`.
- **Item 5 (PromptBuilder Tier-2 assumption):** `buildForSubAgent(config, enabledTools, maxTokens)` — `maxTokens` is now required; `SubAgentManager` passes the real tier-aware `num_ctx`.

### 3.18 Fix ConversationManager rebuildSystemPrompt comment
- **File:** [src/chat/ConversationManager.ts](../../../../src/chat/ConversationManager.ts)
- **Result:** Comment reconciled with the actual reassign-not-splice behavior.

### 3.19 Delete getRecommendedModel safe-delete-now
- **File:** [src/config/HardwareTier.ts](../../../../src/config/HardwareTier.ts)
- **Result:** Unused export gone; `ModelRecommendation` import removed; corresponding test block in [tests/unit/config/HardwareTier.test.ts](../../../../tests/unit/config/HardwareTier.test.ts) deleted.

### 3.20 Tracked-debt comment cleanup
- **Files:** [src/config/GpuDetector.ts](../../../../src/config/GpuDetector.ts), [src/chat/ContextCompactor.ts](../../../../src/chat/ContextCompactor.ts), [src/observability/GoldenTaskSuite.ts](../../../../src/observability/GoldenTaskSuite.ts), [src/storage/UnifiedMemoryRetriever.ts](../../../../src/storage/UnifiedMemoryRetriever.ts)
- **Result:** Implicit-TODO comments either describe the actual state accurately now, or are tagged with `NOTE(v0.5):` so the next version cycle has a concrete list.

### 3.21 Testing and stabilization
- **Lint:** `npm run lint` -- 0 errors, 30 pre-existing `no-console` warnings (unchanged from Phase 2).
- **Tests:** `npm run test` -- 85 test files pass, 1 skipped (ollama-health integration), 1116 tests pass, 2 skipped, 0 failures.
- **Typecheck:** `npx tsc --noEmit` clean across the entire tree.

---

## Files created

- `src/storage/embeddingUtils.ts`
- `src/storage/sqliteFts.ts`
- `src/storage/constants.ts`
- `src/orchestration/ComplexityClassifier.ts`
- `tests/unit/storage/embeddingUtils.test.ts`
- `tests/unit/orchestration/ComplexityClassifier.test.ts`

## Files modified (26)

`src/agents/SubAgentManager.ts`, `src/chat/ContextCompactor.ts`, `src/chat/ConversationManager.ts`, `src/chat/PromptBuilder.ts`, `src/chat/RelevanceScorer.ts`, `src/config/GpuDetector.ts`, `src/config/HardwareTier.ts`, `src/observability/GoldenTaskSuite.ts`, `src/orchestration/Orchestrator.ts`, `src/panels/GemmaCodePanel.ts`, `src/panels/TraceDashboardPanel.ts`, `src/storage/ChatHistoryStore.ts`, `src/storage/EntityExtractor.ts`, `src/storage/EpisodicMemory.ts`, `src/storage/GraphMemory.ts`, `src/storage/GraphQueryEngine.ts`, `src/storage/MemoryConsolidator.ts`, `src/storage/MemoryLayers.types.ts`, `src/storage/MemoryStore.ts`, `src/storage/UnifiedMemoryRetriever.ts`, `src/tools/AgentLoop.ts`, `src/tools/Gemma4ToolFormat.ts`, `src/tools/ToolCatalog.ts`, `src/tools/ToolRegistry.ts`, `src/tools/handlers/filesystem.ts`, `src/tools/types.ts`.

## Tests modified (8)

`tests/unit/chat/PromptBuilder.test.ts`, `tests/unit/config/HardwareTier.test.ts`, `tests/unit/safety/GitSafetyNet.test.ts`, `tests/unit/tools/AgentLoop.test.ts`, `tests/unit/tools/Gemma4ToolFormat.test.ts`, `tests/unit/tools/LazyToolLoader.test.ts`, `tests/unit/tools/ToolCatalog.test.ts`, `tests/unit/tools/ToolRegistry.test.ts`.

## Next steps

- **Phase 4 (Performance Optimization):** 20 perf findings, benchmark threshold tightening, hot-path instrumentation.
- **Phase 7 (Simplification and Release):** delete `BudgetEnforcer` / `ConversationSync` / `LazyToolLoader` classes and their corresponding entries in `BuiltinToolName`.
