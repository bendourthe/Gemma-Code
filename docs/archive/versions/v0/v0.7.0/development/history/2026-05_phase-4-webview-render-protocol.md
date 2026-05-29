# v0.7.0 Phase 4 -- Webview render protocol expansion

**Cycle**: v0.7.0
**Phase**: 4 (webview render protocol expansion)
**Date**: 2026-05-06
**Plan reference**: [docs/archive/versions/v0/v0.7.0/plans/v0.7.0-cycle.md](../../plans/v0.7.0-cycle.md) Phase 4
**Comparison reference**: [docs/archive/versions/v0/v0.7.0/comparison-multi-source.md](../../comparison-multi-source.md) S7 / C21-C27
**ADR**: [docs/adr/0013-webview-render-protocol.md](../../../adr/0013-webview-render-protocol.md)

---

## 1. Scope

Phase 4 adopts the seven Claude-Code-style chat-UI primitives observed in S7 of the multi-source comparison. The bar is "S7 primitives observable in a fresh session" -- not "drop-in visual clone." Specifically:

- C21 -- Inline diff cards for `edit_file` / `write_file` / `create_file` completions.
- C22 -- Action-type tag rendering (Bold-prefix label + path + size badge).
- C23 -- Numbered permission prompts (1 yes, 2 yes-for-all, 3 no, 4 freeform).
- C24 -- Structured todo blocks via a new `update_todos` tool.
- C25 -- "Thought for Ns" meta-row replacing the bouncing-dots indicator.
- C26 -- Queued-message field during streaming with stop button.
- C27 -- End-of-task completion-report block.

All eight sub-tasks (4.1 through 4.8) shipped. 49 new unit tests across 7 jsdom-environment test files plus 4 handler tests + 4 ConversationManager queue tests; existing test catalog adjustments for the new entry count and the new emit; full suite passes.

---

## 2. Sub-tasks executed

### 2.1 -- Inline diff card (sub-task 4.1)

[src/panels/webview/render/diffCard.ts](../../../../src/panels/webview/render/diffCard.ts) computes a common-prefix delta over `\n`-split lines (no `diff` package dependency, since the code path is small and bounded). The card has a header row with file path + Added/Removed counts, a `.diff-card-scroll` container capping height at 320 px, and per-line `.diff-line.added` / `.diff-line.removed` / `.diff-line.context` rows. Each side is capped at 80ch via CSS so a 200-line edit does not overflow the chat. Wired into the runtime for `renderToolCallCompleted` messages with a non-empty `diff` field. 6 tests in [tests/unit/panels/webview/render/diffCard.test.ts](../../../../tests/unit/panels/webview/render/diffCard.test.ts).

### 2.2 -- Action-type tag (sub-task 4.2)

[src/panels/webview/render/actionTag.ts](../../../../src/panels/webview/render/actionTag.ts) maps tool names to display labels (`read_file -> Read`, `write_file -> Write`, `edit_file -> Edit`, `run_terminal -> Bash`, etc.); unknown tools fall back to PascalCase. The element renders `<label> <target> <badge>` with status-driven class (`.action-status-started` / `.action-status-completed` / `.action-status-failed`). Wired into the runtime for `renderToolCallStarted` / `renderToolCallCompleted` / `renderToolCallFailed`. 10 tests in [tests/unit/panels/webview/render/actionTag.test.ts](../../../../tests/unit/panels/webview/render/actionTag.test.ts).

### 2.3 -- Numbered permission prompt (sub-task 4.3)

`ConfirmationGate.requestPrompt(...)` posts a `renderPermissionPrompt` message with the canonical 4-option layout. The render primitive ([src/panels/webview/render/permissionPrompt.ts](../../../../src/panels/webview/render/permissionPrompt.ts)) installs a `keydown` capture listener on `document`, dispatches digit keys + alias chars (`y` / `n` / `a` / `t`) + `Enter` (= yes) + `Esc` (= no), and reveals an inline freeform textarea on option 4 that resolves on `Enter`. After resolution the card adds `.permission-prompt-resolved`, removes the listener, and refuses further keystrokes. The legacy modal `confirmationRequest` card stays for callers that have not migrated; the dual-label policy noted in Section 13 of the comparison report (Yes/No aliases + numbered shortcuts) is preserved. 10 tests in [tests/unit/panels/webview/render/permissionPrompt.test.ts](../../../../tests/unit/panels/webview/render/permissionPrompt.test.ts).

### 2.4 -- Todo block + `update_todos` tool (sub-task 4.4)

A new `update_todos` builtin tool ([src/tools/handlers/todos.ts](../../../../src/tools/handlers/todos.ts)) ships at permission tier 0. The handler validates the payload (each todo must have non-empty `content`, `activeForm`, and a status in `pending` | `in_progress` | `completed`), emits `renderTodoUpdate`, and stashes the latest list on a `TodoState` holder so the completion-report renderer (Phase 4.7) can build its end-of-task summary without re-walking message history. The `ToolRegistryBuilder.todos` opt-in registers the tool; legacy callers that omit the field continue to work unchanged. The render primitive ([src/panels/webview/render/todoBlock.ts](../../../../src/panels/webview/render/todoBlock.ts)) uses status-driven glyphs (■ = completed, □ = pending, ★ + glow = in_progress) and shows the active-form text while in_progress. 5 render tests + 4 handler tests.

### 2.5 -- Thought-for-Ns meta-row (sub-task 4.5)

[src/panels/webview/render/thoughtMetaRow.ts](../../../../src/panels/webview/render/thoughtMetaRow.ts) renders a subdued meta-row that shows `Thinking...` while streaming and finalises to `Thought for Ns` (one decimal of seconds) once the thinking phase ends. `StreamingPipeline.send` now bookends the stream with `renderThoughtMetaRow` events around the existing `status: thinking` -> `status: streaming` transitions. The runtime suppresses the "complete" row for thinking phases under 250 ms so trivial requests do not flicker. 5 tests in [tests/unit/panels/webview/render/thoughtMetaRow.test.ts](../../../../tests/unit/panels/webview/render/thoughtMetaRow.test.ts).

### 2.6 -- Queued-message field (sub-task 4.6)

[src/panels/webview/render/queuedMessageField.ts](../../../../src/panels/webview/render/queuedMessageField.ts) renders the queue input + attach + stop trio. `Enter` (no Shift) flushes the input via the `onQueue` handler and clears the field; the `+` button calls `onAttach`; the stop (`■`) button calls `onStop` (the host wires this to `cancelStream` + `dropQueued`). [src/chat/ConversationManager.ts](../../../../src/chat/ConversationManager.ts) gains `enqueueMessage` / `drainQueued` / `dropQueued` / `queuedCount`. 6 render tests + 4 ConversationManager queue tests.

### 2.7 -- Completion-report block (sub-task 4.7)

[src/panels/webview/render/completionReport.ts](../../../../src/panels/webview/render/completionReport.ts) renders an end-of-task key:value summary as a compact `<table>`. `buildCompletionReport(state)` walks the latest `update_todos` payload + recent edits + tests + commit to produce the canonical fields (Plan / Sub-task done / Updates landed / Tests run / Commit), with empty fields dropped and clickable commit SHAs when `href` is supplied. Empty-state suppression: when no items remain, the render returns an element with class `.completion-report-empty` that the runtime detects and skips so a no-op task does not produce a blank report. 7 tests in [tests/unit/panels/webview/render/completionReport.test.ts](../../../../tests/unit/panels/webview/render/completionReport.test.ts).

### 2.8 -- ADR-0013 (sub-task 4.8)

[docs/adr/0013-webview-render-protocol.md](../../../adr/0013-webview-render-protocol.md) documents the typed render-message protocol: one render helper per primitive, single source of truth via `_FN_SOURCE` strings inlined into `runtime.ts` and re-instantiated through `new Function(...)` for tests, no `innerHTML` for any user-supplied text. The cycle plan called this ADR-0008; it lands as 0013 because 0006-0012 were already assigned during v0.6.0 Phase 5-8 and v0.7.0 Phase 0/3 (same numbering deviation pattern as ADR-0011).

---

## 3. New / modified files

| Layer | New | Modified |
|---|---|---|
| Render | [diffCard.ts](../../../../src/panels/webview/render/diffCard.ts), [actionTag.ts](../../../../src/panels/webview/render/actionTag.ts), [permissionPrompt.ts](../../../../src/panels/webview/render/permissionPrompt.ts), [todoBlock.ts](../../../../src/panels/webview/render/todoBlock.ts), [thoughtMetaRow.ts](../../../../src/panels/webview/render/thoughtMetaRow.ts), [queuedMessageField.ts](../../../../src/panels/webview/render/queuedMessageField.ts), [completionReport.ts](../../../../src/panels/webview/render/completionReport.ts) | [runtime.ts](../../../../src/panels/webview/runtime.ts), [styles.ts](../../../../src/panels/webview/styles.ts) |
| Protocol | -- | [messages.ts](../../../../src/panels/messages.ts) (8 new outbound + 1 inbound) |
| Tools | [todos.ts](../../../../src/tools/handlers/todos.ts) | [ConfirmationGate.ts](../../../../src/tools/ConfirmationGate.ts), [ToolCatalog.ts](../../../../src/tools/ToolCatalog.ts), [ToolRegistryBuilder.ts](../../../../src/tools/ToolRegistryBuilder.ts), [types.ts](../../../../src/tools/types.ts) |
| Guardrails | -- | [PermissionTiers.ts](../../../../src/guardrails/PermissionTiers.ts) (update_todos tier 0) |
| Chat | -- | [StreamingPipeline.ts](../../../../src/chat/StreamingPipeline.ts), [ConversationManager.ts](../../../../src/chat/ConversationManager.ts) |
| Tests | 7 render-primitive jsdom test files + [todos.test.ts](../../../../tests/unit/tools/handlers/todos.test.ts) | [ToolCatalog.test.ts](../../../../tests/unit/tools/ToolCatalog.test.ts) (12 -> 13), [StreamingPipeline.test.ts](../../../../tests/unit/chat/StreamingPipeline.test.ts) (filter renderThoughtMetaRow), [ConversationManager.test.ts](../../../../tests/unit/chat/ConversationManager.test.ts) (queue suite) |
| Docs | [ADR-0013](../../../adr/0013-webview-render-protocol.md) | [DEVLOG.md](../../../DEVLOG.md), [docs/index.md](../../../index.md) (regenerated catalog) |

---

## 4. Tests results / quality gates

- TypeScript: `tsc --noEmit` clean.
- Lint: `eslint src` clean.
- Unit + integration: full suite passes. Trailing Windows segfault during teardown is a pre-existing native-module cleanup quirk noted in project memory; not a test failure.
- Per-primitive coverage: each `_FN_SOURCE` is exercised through a jsdom factory and asserts DOM structure + status-class toggling + the `innerHTML` safety sentinel.

---

## 5. Deviations and follow-ups

1. **ADR number**: filed as 0013, not 0008. Same reasoning as ADR-0011 (already-taken numbers).
2. **Queued-message-field UX wiring deferred**: the renderer is in place and unit-tested, but the runtime IIFE does not yet replace the standard input area with the queued field during streaming. That wiring touches the existing send / cancel / status flow and was deferred to keep Phase 4 scope contained. Follow-up: open an issue under v0.8.0 Phase 1 alongside the panel host's adoption of the full render protocol.
3. **Permission prompt -> ConfirmationGate plumbing**: `requestPrompt` is implemented and unit-tested, but the panel's `ChatMessageRouter` does not yet route `permissionPromptResponse` messages to `gate.resolvePrompt`. Same reason as (2): keeps the patch surface small. The legacy modal `confirmationRequest` flow keeps working for now. Follow-up: track in the v0.8.0 Phase 1 ticket above.
4. **Tool registration in production**: `ToolRegistryBuilder.todos` is optional and not yet wired in the panel bootstrap. Same justification: incremental rollout. Adding the wiring is a 5-line change once the runtime queued-field UX lands.

These three follow-ups are the "panel-host adoption of the render protocol" item; they are scoped together because they share the same surface area (the panel host's wiring of inbound webview messages).

---

## 6. Next phase

Phase 5 -- Memory commands + manual memory page UI + per-model context limits. The `gemma-code.contextLimitsPerModel` setting is partly wired (see [tests/unit/config/contextLimitsPerModel.test.ts](../../../../tests/unit/config/contextLimitsPerModel.test.ts)); the new `MemoryPanel` webview tab and the four `/memory` verbs are the bulk of the remaining work.
