# Development Log: Phase 2 -- Multi-Strategy Context Compaction

**Date**: 2026-04-08
**Operator**: Benjamin Dourthe
**Assisted by**: Claude Opus 4.6 (Claude Code)
**Objective**: Replace the monolithic LLM-summary context compaction with a 5-strategy pipeline that applies cheap transformations first, deferring expensive LLM calls.
**Outcome**: All 5 strategies implemented, pipeline wired into ContextCompactor. 327 tests passing (up from 288), 0 lint errors, clean build.

---

## 1. Starting State

- **Branch**: `main`
- **Starting commit**: `e680a99` (feat(core): implement Gemma 4 native protocol and dynamic PromptBuilder)
- **Environment**: Windows 11 Pro, Node.js, TypeScript 5.4, Vitest 1.0
- **Prior session reference**: `docs/v0.2.0/development/history/2026-04-08_phase-0-1-gemma4-protocol-promptbuilder.md`
- **Plan reference**: `docs/v0.2.0/development/implementation-plan.md` (Phase 2)

Context: Phase 0+1 established the Gemma 4 native protocol and dynamic PromptBuilder with token budgeting. The existing `ContextCompactor` used a single LLM-summary approach that was too coarse for long agentic sessions. Phase 2 introduces a cost-ordered strategy pipeline to preserve more context while minimizing model calls.

---

## 2. Chronological Steps

### 2.1 Add new compaction settings

**Plan specification**: Add `compactionKeepRecent: number` (default 10) and `compactionToolResultsKeep: number` (default 8) to settings.

**What happened**: Added both fields to `GemmaCodeSettings` interface and `getSettings()` in `settings.ts`. Registered both settings in `package.json` under `contributes.configuration.properties` with type, default, min, max, and description.

**Key files changed**: `src/config/settings.ts`, `package.json`

### 2.2 Create CompactionStrategy interface, helper, and pipeline

**Plan specification**: Create `CompactionStrategy` interface with `name`, `canApply()`, `apply()`. Extract `estimateTokensForMessages()` helper. Create `CompactionPipeline` class.

**What happened**: Created `src/chat/CompactionStrategy.ts` with:
- `estimateTokensForMessages()` extracted from `ContextCompactor.estimateTokens()` (same chars/4 heuristic with 1.3x code block multiplier)
- `CompactionStrategy` interface with uniform `Promise<Message[]>` return type for all strategies
- `CompactionPipeline` class that iterates strategies in order and short-circuits when under budget

**Key files changed**: `src/chat/CompactionStrategy.ts` (new)

### 2.3 Implement all 5 strategy classes

**Plan specification**: Implement ToolResultClearing, SlidingWindow, CodeBlockTruncation, LlmSummary, EmergencyTrim.

**What happened**: All 5 strategies implemented in `CompactionStrategy.ts`:

1. **ToolResultClearing**: Regex-based. Finds `<|tool_result>...<tool_result|>` blocks, counts tool-result messages from newest to oldest, clears all but the N most recent. Extracts tool name and success status via `JSON.parse` with try/catch fallback for malformed results.

2. **SlidingWindow**: Filter-based. Preserves system messages, first non-system message (original intent), `[Conversation summary]` markers, and last N non-system messages. Deduplicates anchors already in the tail window. Sorts by timestamp for chronological order.

3. **CodeBlockTruncation**: Text replacement. Regex matches code fences, counts lines, replaces blocks exceeding 80 lines with `[Code block: N lines, language]` placeholder. Language extracted from fence tag.

4. **LlmSummary**: Streams a structured summary prompt to the model, preserving file paths, decisions, errors, action items, and tool outcomes. Returns system messages + summary message + last N messages. `canApply` returns false when within 5% of budget to avoid wasting an LLM call. Graceful degradation on failure.

5. **EmergencyTrim**: Pure-function version of `ConversationManager.trimToContextLimit()`. Drops non-system messages from front until under budget.

**Key files changed**: `src/chat/CompactionStrategy.ts`

### 2.4 Wire pipeline into ContextCompactor and ConversationManager

**Plan specification**: Add `replaceMessages()` to ConversationManager. Refactor ContextCompactor to use pipeline. Add pre-compaction hook.

**What happened**:
- Added `replaceMessages(messages: readonly Message[])` to `ConversationManager` for atomic message array replacement
- Rewrote `ContextCompactor.compact()` to build a `CompactionPipeline` with all 5 strategies, run it against `calculateBudget(maxTokens).conversationBudget`, and call `_manager.replaceMessages(compacted)`
- Added optional `preCompactionHook` constructor parameter (currently unused; Phase 3 wires MemoryStore)
- `estimateTokens()` now delegates to shared `estimateTokensForMessages()` helper
- `GemmaCodePanel.ts` unchanged (new constructor parameter is optional)

**Key files changed**: `src/chat/ContextCompactor.ts`, `src/chat/ConversationManager.ts`

### 2.5 Write and update tests

**Plan specification**: New test file for all strategies and pipeline. Update existing ContextCompactor and ConversationManager tests.

**What happened**:
- Created `tests/unit/chat/CompactionStrategy.test.ts` with 35 tests covering all strategies, the pipeline, and the token estimation helper
- Updated `tests/unit/chat/ContextCompactor.test.ts` (12 tests): mocks now include `replaceMessages`; tests verify pipeline-based behavior; added pre-compaction hook tests
- Added 3 `replaceMessages()` tests to `tests/unit/chat/ConversationManager.test.ts`

**Key files changed**: `tests/unit/chat/CompactionStrategy.test.ts` (new), `tests/unit/chat/ContextCompactor.test.ts`, `tests/unit/chat/ConversationManager.test.ts`

**Verification**:
```
tsc --noEmit: 0 errors
eslint: 0 errors
vitest: 327 passed, 0 failed, 2 skipped (Ollama integration)
```

---

## 3. Verification Gate

| Check | Result |
|---|---|
| TypeScript compilation (`tsc --noEmit`) | PASS (0 errors) |
| ESLint | PASS (0 errors) |
| Vitest full suite | PASS (327 passed, 0 failed, 2 skipped) |
| New test count | 39 tests added (35 + 1 + 3) |

---

## 4. Known Issues

None identified during this session.

---

## 5. Plan Discrepancies

None; all work followed the implementation plan.

---

## 6. Assumptions Made

- **All strategies return `Promise<Message[]>`**: Chose uniform async return type over `Message[] | Promise<Message[]>` union to avoid runtime `instanceof Promise` checks. Zero-cost strategies use synchronous logic wrapped in `Promise.resolve` implicitly via `async`. Negligible overhead for the benefit of a uniform pipeline loop.
- **`getSettings()` called at compaction time**: Rather than caching settings at construction, `compact()` reads fresh settings each time. This allows users to change `compactionKeepRecent` and `compactionToolResultsKeep` mid-session without restarting.
- **LlmSummary `canApply` 5% threshold**: Set to avoid wasting an LLM call when the conversation is only marginally over budget. The 5% figure is a heuristic; it may need tuning based on real-world usage.

---

## 7. Testing Summary

### Automated Tests
- CompactionStrategy tests: 35 passed, 0 failed
- ContextCompactor tests: 12 passed, 0 failed
- ConversationManager tests: 23 passed, 0 failed (3 new)
- Full suite: 327 passed, 0 failed, 2 skipped

### Manual Testing Still Needed
- [ ] Long conversation with 20+ tool calls to verify ToolResultClearing produces correct summaries
- [ ] Conversation exceeding 80% context to trigger the full pipeline end-to-end with a live Ollama instance
- [ ] Verify SlidingWindow preserves conversation summary markers from prior compaction cycles

---

## 8. TODO Tracker

### Completed This Session
- [x] Create `src/chat/CompactionStrategy.ts` with interface and 5 strategy implementations
- [x] Implement ToolResultClearing strategy (regex-based, zero LLM cost)
- [x] Implement SlidingWindow strategy (keep anchors + recent messages)
- [x] Implement CodeBlockTruncation strategy (replace large code blocks with placeholders)
- [x] Refactor `ContextCompactor.ts` to use CompactionPipeline
- [x] Add pre-compaction save hook (wires to MemoryStore in Phase 3)

### Remaining (Not Started)
- [ ] Phase 3: Persistent Memory System
- [ ] Phase 4: Conditional Tool Activation and MCP Support
- [ ] Phase 5: Sub-Agent Orchestration
- [ ] Phase 6: Integration, Polish, and Backend Alignment

### Out of Scope (Deferred)
- [ ] Benchmark: Token reduction per strategy on synthetic conversations (deferred to Phase 6 integration testing)
- [ ] Python backend alignment with multi-strategy compaction (Phase 6 scope)

---

## 9. Summary and Next Steps

Phase 2 replaced the monolithic LLM-summary context compaction with a 5-strategy pipeline (ToolResultClearing, SlidingWindow, CodeBlockTruncation, LlmSummary, EmergencyTrim) that applies cheap transformations first. The pipeline is wired into `ContextCompactor` with a pre-compaction hook placeholder for Phase 3. All 327 tests pass with 0 lint errors.

**Next session should**:
1. Implement Phase 3 (Persistent Memory System) -- create MemoryStore with SQLite FTS5, wire `extractAndSave` into the pre-compaction hook
2. Add `/memory` slash command for search, save, clear, and status operations
3. Wire memory retrieval into the PromptBuilder's memory section placeholder
