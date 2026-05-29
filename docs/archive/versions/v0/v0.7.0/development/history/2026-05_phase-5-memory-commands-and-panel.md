# v0.7.0 Phase 5 -- Memory commands + manual MemoryPanel + per-model context limits

**Cycle**: v0.7.0
**Phase**: 5 (memory commands + manual memory page UI + per-model context limits)
**Date**: 2026-05-07
**Plan reference**: [docs/archive/versions/v0/v0.7.0/plans/v0.7.0-cycle.md](../../plans/v0.7.0-cycle.md) Phase 5
**Comparison reference**: [docs/archive/versions/v0/v0.7.0/comparison-multi-source.md](../../comparison-multi-source.md) C18, C19, C20
**ADR**: [docs/adr/0014-memory-file-architecture.md](../../../adr/0014-memory-file-architecture.md) (renumbered from plan's "0007" -- see Section 4 Deviations)

---

## 1. Scope

Phase 5 polishes the memory experience by closing three gaps left after Phase 2 (file architecture + init / archive / edit verbs):

1. Round out the slash-command surface with `/memory forget`, `/memory export`, `/memory import`.
2. Ship a manual MemoryPanel webview tab that shows the three on-disk files, the SQL-backed rows (with a "Promote to Memory.md" path), and the archive snapshots (with a "Restore" path).
3. Confirm the per-model context-limit override is finalised. The work itself shipped in Phase 3 sub-task 3.7; Phase 5 only audits and documents.

All three sub-tasks landed with full test coverage (171 test files / 2036 tests pass; zero failures). One numbering deviation (ADR-0014 not 0007) and one no-code item (per-model limits) are recorded as in-cycle gaps.

---

## 2. Sub-tasks executed

### 2.1 -- `/memory forget`, `/memory export`, `/memory import` (sub-task 5.1)

[src/panels/ChatCommandHandlers.ts](../../../../src/panels/ChatCommandHandlers.ts) gains three new `/memory` verbs. The underlying primitives -- `MemoryFiles.removeFromMemory`, `MemoryFiles.export`, `MemoryFiles.import` -- shipped in Phase 2; Phase 5 wires the slash-command surface, adds argument parsers, and bridges to the SQL-backed store where applicable.

- **`/memory forget <pattern> [--include-sql]`** -- Calls `MemoryFiles.removeFromMemory(pattern)` to drop matching lines from `Memory.md`. The catastrophic-pattern guard (raw `.*`) lives in MemoryFiles and is surfaced verbatim. With `--include-sql`, the new helper `forgetMatchingSqlRows` walks `MemoryStore.listAll(1000)` and calls the new `MemoryStore.deleteById` for each match. The `postMemoryStatus()` callback fires after SQL deletions so the badge updates.
- **`/memory export <path>`** -- Calls `MemoryFiles.export(path, { sqlMemories })` where `sqlMemories` is built from `MemoryStore.listAll(1000)` mapping each entry to `{ content, type }`. Path-guard inside `MemoryFiles.export` rejects secret-path destinations.
- **`/memory import <path> [--mode=merge|replace]`** -- Calls `MemoryFiles.import(path, mode)`. The `--mode=replace` shorthand `--replace` and the merge default mirror the JSON dump format from S2's article. SQL-backed memories from a foreign export are NEVER silently re-imported (the S2 article is explicit on that point); the response message reminds the user to re-issue them via `/memory save`.

The argument parsers are exported as pure functions for unit-testability without instantiating the panel:

- `parseForgetArgs(rawArgs)` -- splits the pattern from `--include-sql`, returns `{ pattern, includeSql }`.
- `parseImportArgs(rawArgs)` -- accepts `--mode=merge`, `--mode=replace`, `--merge`, `--replace`; returns `{ path, mode }`.
- `forgetMatchingSqlRows(store, pattern)` -- regex-matches each row's content and deletes via `deleteById`; returns the count.

The `MemoryStore.deleteById(id)` method is new in Phase 5. It runs `DELETE FROM memories WHERE id = ?`, invalidates the embedding cache for the deleted row, and returns `true` when a row was removed. It is exercised by `/memory forget --include-sql` and by the MemoryPanel's "Promote / Delete" actions.

13 new test cases + 4 parser cases land in [tests/unit/panels/ChatCommandHandlers.test.ts](../../../../tests/unit/panels/ChatCommandHandlers.test.ts).

### 2.2 -- MemoryPanel webview tab (sub-task 5.2)

A new sidebar webview at `gemma-code.memoryPanel` ships as the second sidebar view (between Chat and Traces). The panel host lives in [src/panels/MemoryPanel.ts](../../../../src/panels/MemoryPanel.ts); the HTML / CSS / JS scaffold is in [src/panels/webview/memoryView.ts](../../../../src/panels/webview/memoryView.ts) following the [traceDashboard.ts](../../../../src/panels/webview/traceDashboard.ts) pattern (a single CSP-tight HTML document with everything inlined under a per-render nonce).

**Five tabs:**

1. **Instructions** -- raw `<pre>` of `Instructions.md` with an "Open in editor" button that pipes through `vscode.workspace.openTextDocument` + `vscode.window.showTextDocument`.
2. **Memory** -- same shape, for `Memory.md`.
3. **Context** -- same shape, for `Context.md`.
4. **SQL-backed** -- rows from `MemoryStore.listAll(500)` grouped by type. Each row shows the content, created-at relative timestamp, and access count, plus two action buttons: "Promote" and "Delete".
5. **Archive** -- a list of dated snapshot directories from `<archiveDir>/<YYYY-MM-DD>/`, newest-first. Each row has a "Restore" button. The tab toolbar also has an "Archive now" button that triggers an immediate snapshot.

**Message protocol (no direct storage imports inside the iframe):**

- Outbound (host -> webview): `memorySnapshot` (the canonical payload), `memoryToast` (one-shot notification).
- Inbound (webview -> host): `ready`, `requestMemorySnapshot`, `openMemoryFile`, `promoteSqlMemory`, `deleteSqlMemory`, `archiveMemoryNow`, `restoreArchive`.

**Pure helpers exported for unit testing:**

- `buildMemorySnapshot(memoryFiles, memoryStore)` -- the snapshot payload. Returns `workspaceMissing: true` when `memoryFiles` is null.
- `listArchiveSnapshots(archiveDir)` -- enumerates dated subdirectories, ignores anything that does not match `\d{4}-\d{2}-\d{2}`, sorts newest-first.
- `promoteSqlMemoryToFile(memoryFiles, memoryStore, id)` -- finds the row, calls `appendToMemory(sectionForType(row.type), row.content)`, then `deleteById(id)`. Returns `{ ok: true, section }` or `{ ok: false, reason }`.
- `sectionForType(type)` -- maps SQL types to Memory.md sections: `decision -> Decisions`, `preference -> Preferences`, `error_resolution -> Corrections`, `file_pattern -> Patterns`, fallback `Preferences`.
- `restoreArchiveSnapshot(memoryFiles, date)` -- validates the date format, copies each `<date>/{Instructions,Memory,Context}.md` over the live path, invalidates the mtime cache.

**Bootstrap wiring** in [src/extension.ts](../../../../src/extension.ts) -- the panel is constructed with closures into `chatPanel.getMemoryFiles()` / `chatPanel.getMemoryStore()` so the panel sees the live instances after a settings change. Two new accessors land on `GemmaCodePanel`: `getMemoryFiles()` and `getMemoryStore()` (the bootstrapped fields are now plumbed through the constructor).

13 new test cases land in [tests/unit/panels/MemoryPanel.test.ts](../../../../tests/unit/panels/MemoryPanel.test.ts), exercising every helper against a real `MemoryFiles` instance in a tmp directory plus a vi-mocked `MemoryStore`.

### 2.3 -- ADR-0014 memory file architecture (sub-task 5.3)

[docs/adr/0014-memory-file-architecture.md](../../../../docs/adr/0014-memory-file-architecture.md) documents the precedence and lifecycle of the file-backed memory layer. Sections:

- **Context** -- the v0.5.0 / v0.6.0 SQL-only memory friction (no user-visible editor; no portability) plus the S2 article's four-file proposal.
- **Decision** -- adopt the four files alongside (not replacing) the SQL store. PromptBuilder injection order is: bundled system prompt -> Instructions.md -> Context.md -> SQL-backed memories filtered for non-shadow -> Memory.md (last so the user's most-recent edit dominates). On conflict, the file wins.
- **Consequences** -- positive (user-owned memory, deterministic merge, MemoryPanel reduces support friction); negative (two memory layers, more bootstrap moving parts); neutral (`MemoryStore.deleteById` is the only new API surface in Phase 5).
- **Alternatives considered** -- replacement vs. layering, keep file-only vs. inject both, single Memory.md vs. three files, JSON vs. Markdown.
- **Numbering note** -- the cycle plan called this ADR-0007; that slot was claimed by v0.6.0 Phase 1.2 (Permission-tier floor). Same deviation pattern as ADR-0013 (plan said 0008, taken).

### 2.4 -- Per-model context limits

The Phase 5 stability gate calls for "finalize per-model context limits". Phase 3 sub-task 3.7 already shipped the work:

- `gemma-code.contextLimitsPerModel` exists in [package.json](../../../../package.json) with description.
- `resolveModelContextLimit` exists in [src/config/PromptBudget.ts](../../../../src/config/PromptBudget.ts).
- It is consumed by [src/panels/ChatController.ts](../../../../src/panels/ChatController.ts) line 139 on every prompt-budget calculation.
- Six tests in [tests/unit/config/contextLimitsPerModel.test.ts](../../../../tests/unit/config/contextLimitsPerModel.test.ts) cover override / floor / fallback / zero-or-negative.

Phase 5 has no additional code to add for this item. Logged as in-cycle gap 10.O.6 to keep the audit trail explicit.

---

## 3. Quality gates

| Gate | Command | Result |
|---|---|---|
| Lint | `npm run lint` | Clean |
| Build | `npm run build` (tsc) | Clean |
| Catalog | `npm run catalog` | docs/index.md regenerated; 16 modules |
| Tests | `npm test` | **171 test files passed, 1 skipped (172); 2036 tests passed, 4 skipped (2040); 0 failures** |

The trailing Windows segfault during teardown is the pre-existing native-module cleanup artefact tracked at [docs/archive/versions/v0/v0.7.0/known-gaps.md](../../known-gaps.md) Section 5.1. Tests still report green and exit code 0 from the user's perspective; only the final summary line is occasionally truncated when the segfault races vitest's reporter.

---

## 4. Deviations from the plan

1. **ADR-0014 instead of ADR-0007.** ADR-0007 was already shipped during v0.6.0 Phase 1.2. Same numbering deviation pattern as Phase 4 (plan said ADR-0008, landed as ADR-0013). Documented in the ADR's "Numbering note" section. Tracked as in-cycle gap 10.O.4.
2. **"Finalize per-model context limits" had no code.** The work shipped in Phase 3 sub-task 3.7. Phase 5 only audits and documents. Tracked as in-cycle gap 10.O.6.
3. **Scope of the SQL-backed promotion mapping.** The plan did not specify a section heading for promoted SQL rows. `sectionForType` is a static heuristic (`decision -> Decisions`, `preference -> Preferences`, `error_resolution -> Corrections`, `file_pattern -> Patterns`, fallback `Preferences`). Documented as deliberate. Tracked as in-cycle gap 10.O.5 in case user feedback in v0.7.0 testing prompts a revision.

---

## 5. Files

### New

- [src/panels/MemoryPanel.ts](../../../../src/panels/MemoryPanel.ts) -- the panel host + four exported helpers (`buildMemorySnapshot`, `listArchiveSnapshots`, `promoteSqlMemoryToFile`, `restoreArchiveSnapshot`, `sectionForType`).
- [src/panels/webview/memoryView.ts](../../../../src/panels/webview/memoryView.ts) -- the inlined HTML / CSS / JS scaffold.
- [tests/unit/panels/MemoryPanel.test.ts](../../../../tests/unit/panels/MemoryPanel.test.ts) -- 13 cases.
- [docs/adr/0014-memory-file-architecture.md](../../../../docs/adr/0014-memory-file-architecture.md) -- the architecture ADR.

### Modified

- [src/panels/ChatCommandHandlers.ts](../../../../src/panels/ChatCommandHandlers.ts) -- three new `/memory` handlers + helper functions.
- [src/storage/MemoryStore.ts](../../../../src/storage/MemoryStore.ts) -- `deleteById` method.
- [src/commands/CommandRouter.ts](../../../../src/commands/CommandRouter.ts) -- extended `/memory` argument hint.
- [src/panels/GemmaCodePanel.ts](../../../../src/panels/GemmaCodePanel.ts) -- `getMemoryFiles()` / `getMemoryStore()` accessors + plumbed fields.
- [src/extension.ts](../../../../src/extension.ts) -- MemoryPanel registration in the sidebar provider list.
- [package.json](../../../../package.json) -- new view contribution under `gemma-code-sidebar`.
- [docs/archive/versions/v0/v0.7.0/architecture.md](../../architecture.md) -- "Phase 5 surface" subsection appended to Section 2.
- [docs/index.md](../../../index.md) -- regenerated catalog.
- [docs/DEVLOG.md](../../../DEVLOG.md) -- Phase 5 entry prepended.
- [docs/todos.md](../../../todos.md) -- Phase 5 marked complete with sub-task checklist.
- [docs/archive/versions/v0/v0.7.0/known-gaps.md](../../known-gaps.md) -- Section 10 "v0.7.0 in-cycle gap log" appended.
- [tests/unit/panels/ChatCommandHandlers.test.ts](../../../../tests/unit/panels/ChatCommandHandlers.test.ts) -- 13 cases for the three new verbs + 4 parser cases + 1 import on the helpers.

---

## 6. Phase 5 Exit Checklist

- [x] All memory commands functional (`forget`, `export`, `import` ship; `init`, `archive`, `edit` shipped in Phase 2; `save`, `search`, `clear`, `status`, `lint` ship from earlier cycles).
- [x] MemoryPanel webview registered in [package.json](../../../../package.json) under `gemma-code-sidebar`.
- [x] All five tabs functional (Instructions / Memory / Context with "Open in editor"; SQL-backed with Promote / Delete; Archive with Restore + "Archive now").
- [x] No module-boundary violations (`npm run deps:check` continues to pass; webview iframe imports nothing from `src/storage/`).
- [x] ADR for memory file architecture present (filed as ADR-0014 per the numbering deviation note).
- [x] Per-model context limits finalised (Phase 3 sub-task 3.7; tests in `tests/unit/config/contextLimitsPerModel.test.ts` continue to pass).
- [x] `npm run lint && npm run build && npm test` green.

---

## 7. Next phase

Phase 6 (Multi-harness skill packaging + standalone deterministic-checks CLI):

- `scripts/package-skills.mjs` -- emit `dist/{cursor,claude-code,opencode,gemini-cli}/` shaped per each harness's expectations. Output is `.gitignore`'d; release-time artefact. CI job uploads the four ZIP bundles as release artefacts.
- `bin/gemma-check.mjs` -- standalone Node CLI that runs a small rule-set (no committed `console.log`; no `Math.random` in token contexts; no `.env` leakage; secret-pattern regex from gitleaks-derived patterns) against a directory or file, with `--json` for machine output.

Plan reference: [docs/archive/versions/v0/v0.7.0/plans/v0.7.0-cycle.md](../../plans/v0.7.0-cycle.md) Phase 6.
