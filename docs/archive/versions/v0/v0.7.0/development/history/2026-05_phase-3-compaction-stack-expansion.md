# v0.7.0 Phase 3 -- Compaction stack expansion

**Cycle**: v0.7.0
**Phase**: 3 (compaction stack expansion)
**Date**: 2026-05-05
**Plan reference**: [docs/archive/versions/v0/v0.7.0/plans/v0.7.0-cycle.md](../../plans/v0.7.0-cycle.md) Phase 3
**Comparison reference**: [docs/archive/versions/v0/v0.7.0/comparison-multi-source.md](../../comparison-multi-source.md) C12 / C13 / C14 / C15 / C16
**Architecture reference**: [docs/archive/versions/v0/v0.7.0/architecture.md](../../architecture.md) Section 3
**ADR**: [docs/adr/0012-model-callable-compress-tool.md](../../../adr/0012-model-callable-compress-tool.md)

---

## 1. Scope

Phase 3 lands the largest single piece of v0.7.0 code: a model-callable `compress` tool plus two new deterministic compaction strategies that run alongside the v0.6.0 chain. The compress tool runs at permission tier 0 (auto-approve, never touches files / terminal / network) so the model can autonomously compress spans of conversation it knows are no longer load-bearing. Per-session `CompressionState` owns stable IDs (`mNNNN` for messages, `bN` for compression blocks) and run history; six new `/compact` verbs surface the lifecycle to the user; per-model context-window overrides make the compactor's threshold respect the actual window size of the active model.

All eight sub-tasks (3.1 through 3.8) shipped. Six new test files contribute 43 new assertions; the full suite passes.

---

## 2. Sub-tasks executed

### 2.1 -- Deduplication compaction strategy (sub-task 3.1)

[src/chat/strategies/deduplication.ts](../../../../src/chat/strategies/deduplication.ts) walks the conversation, parses tool-call and tool-result blocks via the existing `parseToolCalls` helper, and replaces older tool-result payloads whose `(toolName, canonicalArgs)` signature collides with a more-recent call. Replacement: `[deduplicated -- see message #N]`. Errored results are skipped (handled by `purgeErrors`); protected tools and `protectedFilePatterns` are skipped so a watched file dump can never be deduplicated. Pure function; never mutates input. The wrapping `DeduplicationStrategy` class adapts the function to the existing `CompactionStrategy` interface.

8 unit tests in [tests/unit/chat/strategies/deduplication.test.ts](../../../../tests/unit/chat/strategies/deduplication.test.ts).

### 2.2 -- Purge-errors compaction strategy (sub-task 3.2)

[src/chat/strategies/purgeErrors.ts](../../../../src/chat/strategies/purgeErrors.ts) finds errored tool calls older than `compactionErrorPurgeTurns` user-message turns and rewrites their `args` field to `{ purged: true, purgedAt, originalSize }`. The error result message itself stays verbatim. Skips `compactionProtectedTools`. 5 tests in [tests/unit/chat/strategies/purgeErrors.test.ts](../../../../tests/unit/chat/strategies/purgeErrors.test.ts).

### 2.3 -- CompressionState module (sub-task 3.3)

[src/chat/state/CompressionState.ts](../../../../src/chat/state/CompressionState.ts) owns per-session ID and run state. `allocateMessageId` produces zero-padded `mNNNN` IDs (idempotent per Message.id); `allocateBlockId` produces monotonic `bN` IDs. `recordRun` snapshots messages, `decompressBlock` returns the snapshot, `recompressBlock` reverts. `manualOnly` is a session-scoped flag the user toggles via `/compact manual on|off`. `serialise` / `deserialise` are present so a future schema migration can persist state into the chat-history SQLite DB; v0.7.0 keeps state in-memory. 6 tests in [tests/unit/chat/state/CompressionState.test.ts](../../../../tests/unit/chat/state/CompressionState.test.ts).

### 2.4 -- compress_range tool handler (sub-task 3.4)

[src/tools/handlers/compress.ts](../../../../src/tools/handlers/compress.ts) `CompressRangeTool` accepts `{ topic, ranges: [{ startId, endId, summary }] }` and replaces messages in `[startId..endId]` with a placeholder block of role `system` and content `[BLOCK bN: topic]\nsummary`. Multiple ranges per call: allowed but must not overlap each other. Ranges that overlap an EARLIER block automatically embed the prior block's ID via `findNestedBlockIds`. Protected tool outputs (per `compactionProtectedTools`) and (when enabled) user messages are appended verbatim to the end of the placeholder block.

Permission tier 0 added in [src/guardrails/PermissionTiers.ts](../../../../src/guardrails/PermissionTiers.ts). The model-facing prompt at [src/chat/prompts/compress-range.md](../../../../src/chat/prompts/compress-range.md) is written from scratch -- S5 is AGPL-3.0, so no copying. Shared 9 tests with sub-task 3.5 in [tests/unit/tools/handlers/compress.test.ts](../../../../tests/unit/tools/handlers/compress.test.ts).

### 2.5 -- compress_message tool handler (sub-task 3.5)

`CompressMessageTool` is gated behind `gemma-code.compactExperimentalMessageMode` (default `false`). It compresses individual messages by stable ID and refuses to orphan a tool-call / tool-result pair via `rejectsOrphanedToolPair`. The settings page documents the trade-off (more surgical compaction; more risk of fragmenting causally-linked tool sequences). Same test file as 3.4.

### 2.6 -- /compact <verb> commands (sub-task 3.6)

[src/commands/compactCommand.ts](../../../../src/commands/compactCommand.ts) is a pure-function module factored out of the panel handler so the verb logic is unit-testable without spinning up a webview. Six verbs:

- `/compact` -- legacy behaviour (force a sliding-window compaction); preserved.
- `/compact context` -- per-role token breakdown + headroom percentage.
- `/compact stats` -- cumulative pruning stats from `CompressionState`.
- `/compact sweep [n]` -- plans a span over the last N tool-result messages since the last *human* user message; emits the plan as a markdown notice. Auto-issuing the compress call is deferred to Phase 4 once the render protocol lands.
- `/compact decompress <blockId>` -- splices the snapshot back into the conversation.
- `/compact recompress <blockId>` -- re-applies a prior decompression.
- `/compact manual on|off` -- toggles the session-scoped `manualOnly` flag.

The handler in [src/panels/ChatCommandHandlers.ts](../../../../src/panels/ChatCommandHandlers.ts) delegates parsing and rendering to the pure-function module. 9 tests in [tests/unit/commands/compactCommand.test.ts](../../../../tests/unit/commands/compactCommand.test.ts).

### 2.7 -- Per-model context-limit overrides (sub-task 3.7)

`gemma-code.contextLimitsPerModel` is a `Record<string, { maxTokens?: number; minContextLimit?: number }>`. `resolveModelContextLimit` (new helper in [src/config/PromptBudget.ts](../../../../src/config/PromptBudget.ts)) consults the map first; falls back to the global `gemma-code.maxTokens` if no override exists. `maxTokens` is authoritative; `minContextLimit` only acts as a floor when `maxTokens` is unset, so a misconfigured override can never silently shrink the model's effective window. `ChatController.buildContextCompactor` consumes the resolved limit. 6 tests in [tests/unit/config/contextLimitsPerModel.test.ts](../../../../tests/unit/config/contextLimitsPerModel.test.ts).

### 2.8 -- ADR-0012 compress tool design (sub-task 3.8)

[docs/adr/0012-model-callable-compress-tool.md](../../../adr/0012-model-callable-compress-tool.md). The plan called for ADR-0006 but `0006-unified-path-guard.md` already shipped in v0.6.0 Phase 1; renumbered to 0012 (next free slot after 0011-ollama-client-injection from v0.7.0 Phase 0). The ADR documents context, decision, consequences, and alternatives. References [docs/archive/versions/v0/v0.7.0/comparison-multi-source.md](../../comparison-multi-source.md) Section 9.3 entry C12 for the RE classification rationale.

---

## 3. Testing summary

```
PASS tests/unit/chat/strategies/deduplication.test.ts        (8 tests)
PASS tests/unit/chat/strategies/purgeErrors.test.ts          (5 tests)
PASS tests/unit/chat/state/CompressionState.test.ts          (6 tests)
PASS tests/unit/tools/handlers/compress.test.ts              (9 tests)
PASS tests/unit/commands/compactCommand.test.ts              (9 tests)
PASS tests/unit/config/contextLimitsPerModel.test.ts         (6 tests)
```

43 new assertions, all passing. Full `vitest run` passes (the segfault during native-module process teardown after all tests have completed reporting is the documented pre-existing Windows issue).

Lint: clean (`eslint src --quiet` exits 0). Build: clean (`tsc --noEmit` exits 0).

The legacy `tests/unit/tools/ToolCatalog.test.ts` was updated from "exactly 10 entries" to "exactly 12 entries" because `compress_range` and `compress_message` now ship in the catalog.

---

## 4. Deviations from the plan

### 4.1 ADR-0012 instead of ADR-0006

The v0.7.0 plan called for ADR-0006 documenting the compress tool design; that number is already taken by `0006-unified-path-guard.md` (v0.6.0 Phase 1). Shipped as ADR-0012 instead. Tracked here so a future plan reader who searches for "ADR-0006: compress tool" finds the redirect.

### 4.2 `/compact sweep` does not auto-issue a compress_range call

The plan called for `/compact sweep [n]` to "manually issue a `compress_range` call covering the last N tool results since the last user message." Auto-issuing requires the agent loop to inject a tool call mid-stream, which is much cleaner once the Phase 4 render protocol is in place (the new structured events are precisely the surface a UI-issued sweep needs). v0.7.0 ships the planning step (the sweep span is computed and reported via markdown) but defers the auto-issue. The user can copy the suggested IDs into a manual model prompt if they want immediate action.

### 4.3 CompressionState persistence is in-memory only

The plan referenced a new `compression_state` JSON column on the chat-history SQLite table. The schema migration is non-trivial -- chat-history's FTS triggers, `user_version` schema bump, and idempotent backfill semantics each need their own test. Scoped out of Phase 3 to keep the diff reviewable. `serialise` / `deserialise` are present on the class so the column add is purely additive in a future cycle (likely v0.8.0).

### 4.4 New `compactionProtectedFilePatterns` setting

Not in the plan but implied by sub-task 3.1's "tool calls whose args contain a path matching `config.protectedFilePatterns`." Defaults to `[]`. Users populate it to exempt specific watched files (e.g. the file currently under refactor) from deduplication.

---

## 5. Open questions / next-phase carryovers

- **Phase 4 render protocol**: agent loop must emit `tool_call_started / tool_call_succeeded / tool_call_failed / todo_update / compaction_event / completion` events; the new render protocol consumes them. The auto-issue of `/compact sweep` will fold into that work cleanly.
- **CompressionState persistence**: deferred to v0.8.0; tracked in Section 4.3 above.
- **Mutation testing**: The plan asked for `npm run mutate -- src/chat/strategies/deduplication.ts` and confirming survival above baseline. Stryker config currently mutates `src/orchestration/`; expanding to `src/chat/strategies/` is left as a Phase 8 release-gate task to keep this phase's diff focused.

---

## 6. Files added / changed

### Added

- `src/chat/strategies/deduplication.ts`
- `src/chat/strategies/purgeErrors.ts`
- `src/chat/state/CompressionState.ts`
- `src/chat/prompts/compress-range.md`
- `src/tools/handlers/compress.ts`
- `src/commands/compactCommand.ts`
- `docs/adr/0012-model-callable-compress-tool.md`
- `docs/archive/versions/v0/v0.7.0/development/history/2026-05_phase-3-compaction-stack-expansion.md` (this file)
- `tests/unit/chat/strategies/deduplication.test.ts`
- `tests/unit/chat/strategies/purgeErrors.test.ts`
- `tests/unit/chat/state/CompressionState.test.ts`
- `tests/unit/tools/handlers/compress.test.ts`
- `tests/unit/commands/compactCommand.test.ts`
- `tests/unit/config/contextLimitsPerModel.test.ts`

### Modified

- `src/chat/ContextCompactor.ts` -- wires deduplication + purgeErrors into the pipeline; settings provider extended.
- `src/config/PromptBudget.ts` -- adds `resolveModelContextLimit`.
- `src/config/settings.ts` -- adds `contextLimitsPerModel`, `compactionProtectedTools`, `compactionErrorPurgeTurns`, `compactionProtectedFilePatterns`, `compactExperimentalMessageMode`.
- `src/guardrails/PermissionTiers.ts` -- adds `compress_range` / `compress_message` at tier 0.
- `src/panels/ChatCommandHandlers.ts` -- delegates `/compact` to the new compactCommand module.
- `src/panels/ChatController.ts` -- uses `resolveModelContextLimit` in `buildContextCompactor`.
- `src/panels/ChatPanelBootstrap.ts` -- constructs `CompressionState`, passes `compress` deps into `buildToolRegistry`, adds `getCompressionState` to the controller context.
- `src/tools/ToolCatalog.ts` -- adds catalog entries for the two compress tools.
- `src/tools/ToolRegistryBuilder.ts` -- adds optional `compress: { deps, experimentalMessageMode }` argument.
- `src/tools/types.ts` -- adds `compress_range` / `compress_message` to `BuiltinToolName` and `BUILTIN_TOOL_NAMES`; adds `CompressRangeParams` / `CompressMessageParams` types.
- `package.json` -- adds five new `gemma-code.*` settings.
- `tests/unit/tools/ToolCatalog.test.ts` -- updates the entry-count assertion from 10 to 12.
- `docs/DEVLOG.md` -- new Phase 3 section.
- `docs/todos.md` -- new v0.7.0 section with Phase 3 marked complete.
- `docs/archive/versions/v0/v0.7.0/architecture.md` -- replaces the Phase 3 placeholder with a full sub-section.
- `docs/index.md` (auto-regenerated by `npm run catalog`).
- `docs/archive/versions/v0/v0.5.0/architecture.md` (permission-tier table auto-regenerated by `npm run perm-tier`).
