# Phase 2: Advanced Context Engineering

**Date**: 2026-04-14
**Plan**: `docs/v0.3.0/implementation-plan.md`
**Phase**: 2 of 8

## Objective

Implement lazy tool loading, progressive disclosure, output redirection for large tool results, enhanced compaction with regenerate-from-source, hierarchical relevance scoring for prompt section packing, and chat history syncing for agent self-search.

## Sub-tasks Completed

### 2.5 Chat History Syncing (implemented first -- most isolated)
- Created `src/storage/ConversationSync.ts` and test file
- JSONL sync to `{workspace}/.gemma-code/sessions/{sessionId}.jsonl`
- Fire-and-forget I/O with try/catch in all methods
- ConversationManager gains optional 3rd constructor param, hooks in _append/replaceMessages/clearHistory/loadSession
- 11 unit tests

### 2.2 Output Redirection for Large Tool Results
- Created `src/tools/OutputRedirector.ts` (OutputRedirector + TailOutputTool + GrepOutputTool)
- Added `tail_output` and `grep_output` to BuiltinToolName union and TOOL_CATALOG
- ToolRegistry gains `setOutputRedirector()` and wraps in `execute()`
- Updated `.gitignore` with `.gemma-code-output/` and `.gemma-code/`
- 19 unit tests

### 2.1 Lazy Tool Loading with get_tool_schema
- Created `src/tools/LazyToolLoader.ts` (implements ToolHandler)
- Added `serializeToolSummary()` to Gemma4ToolFormat.ts (40%+ token reduction)
- Added `get_tool_schema` to BuiltinToolName and TOOL_CATALOG (13 total tools)
- PromptBuilder._buildToolDeclarations checks `context.lazyToolLoading`
- 11 unit tests

### 2.3 Regenerate-from-Source Compaction
- Created `src/chat/RegenerateFromSource.ts` (implements CompactionStrategy)
- Re-reads source files, git state, extracts decisions and test results
- Inserted in pipeline between CodeBlockTruncation and LlmSummary
- ContextCompactor gains optional `_workspacePath` parameter
- 15 unit tests

### 2.4 Hierarchical Relevance Scoring (highest risk -- done last)
- Created `src/chat/RelevanceScorer.ts` with 4 scoring signals
- PromptBuilder.build() now async with buildSync() for constructors
- Migrated 10 call sites (9 in GemmaCodePanel, 1 in SubAgentManager)
- 3 methods changed from sync to async, extension.ts callers voided
- 22 unit tests

## Implementation Order

2.5 -> 2.2 -> 2.1 -> 2.3 -> 2.4 -> 2.T

Rationale: 2.5 most isolated, 2.2 before 2.1 (catalog must be finalized before lazy loading serializes it), 2.4 last (async migration should happen after all other PromptBuilder changes are stable).

## Test Results

- 534 tests passing across 43 test files
- 83 new tests across 5 new test files
- 2 pre-existing failures (ChatHistoryStore, MemoryStore -- SQLite native module)
- 0 lint errors, 0 type errors
- Zero regressions from Phase 1 changes

## Deviations from Plan

1. **Hardcoded test counts**: ToolCatalog.test.ts and Gemma4ToolFormat.test.ts had hardcoded tool counts (10) that broke when tools were added. Changed to use `TOOL_CATALOG.length` for resilience.
2. **child_process mocking**: `vi.spyOn(await import("child_process"), "execSync")` fails because the property is non-configurable. Used `vi.mock("child_process")` at module level instead.
3. **Extension.ts floating promises**: `setOllamaReachable` and `updateTierConfig` callers in extension.ts needed `void` prefix after becoming async, caught by ESLint's `no-floating-promises` rule.

## Files Changed

**New (10)**: ConversationSync.ts, OutputRedirector.ts, LazyToolLoader.ts, RegenerateFromSource.ts, RelevanceScorer.ts, ConversationSync.test.ts, OutputRedirector.test.ts, LazyToolLoader.test.ts, RegenerateFromSource.test.ts, RelevanceScorer.test.ts

**Modified (15)**: .gitignore, SubAgentManager.ts, ContextCompactor.ts, ConversationManager.ts, PromptBuilder.ts, PromptBuilder.types.ts, extension.ts, GemmaCodePanel.ts, Gemma4ToolFormat.ts, ToolCatalog.ts, ToolRegistry.ts, types.ts, PromptBuilder.test.ts, Gemma4ToolFormat.test.ts, ToolCatalog.test.ts

## Next Steps

Phase 3: Persistent Memory Layer (memory retrieval, embedding-based search, memory extraction hooks)
