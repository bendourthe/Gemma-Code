# v0.7.0 Phase 2 -- Memory file architecture

**Cycle**: v0.7.0
**Phase**: 2 (memory file architecture)
**Date**: 2026-05-05
**Plan reference**: [docs/v0.7.0/plans/v0.7.0-cycle.md](../../plans/v0.7.0-cycle.md) Phase 2
**Comparison reference**: [docs/v0.7.0/comparison-multi-source.md](../../comparison-multi-source.md) C17 / C18 / C19
**Architecture reference**: [docs/v0.7.0/architecture.md](../../architecture.md) Section 2

---

## 1. Scope

Phase 2 introduces the user-editable, on-disk memory architecture at `~/.gemma-code/memory/<workspace-id>/`. Three Markdown files (Instructions.md, Memory.md, Context.md) plus a dated `Archive/` directory provide the human-readable counterpart to the SQL-backed memory subsystem; the user can `vim`/`code` them directly, the agent reads them on every prompt build, and an opt-in scheduled archive captures snapshots so prior states are recoverable.

This phase is the prerequisite for the Phase 1 `build-second-brain` skill (shipped non-functional pending these files) and for Phase 5's manual memory page UI.

Three sub-tasks ran autonomously without blocking on operator action.

---

## 2. Sub-tasks executed

### 2.1 -- Build `MemoryFiles` storage module

Added [src/storage/MemoryFiles.ts](../../../../src/storage/MemoryFiles.ts) -- a single class that owns scaffold / read / archive / append / remove / export / import for the three on-disk files. Constructor takes `(workspaceId, baseDir?)`; the default baseDir is `path.join(os.homedir(), ".gemma-code", "memory")` evaluated **lazily on each construction** (NOT cached at module-import time) so test harnesses can override `os.homedir()` between cases.

Companion helper `deriveWorkspaceId(absolutePath)` produces a stable `<basename-sanitised>-<sha1[0..10]>` identifier. The 10-hex hash disambiguates two workspaces with the same basename on a single machine; the basename keeps the directory human-readable.

Method surface:

- `init(force?: boolean)` -- scaffold the three files. Without `--force`, existing files are left untouched.
- `read()` -- returns the merged contents plus paths. Mtime-cached.
- `archive()` -- snapshot the three files into `Archive/<YYYY-MM-DD>/`. Idempotent for the day.
- `latestArchiveDate()` -- helper for the auto-archive scheduler.
- `appendToMemory(section, line)` -- append a bullet under a Preferences | Corrections | Patterns | Decisions heading. Validates the line does not reference a secret-path pattern.
- `removeFromMemory(pattern)` -- delete matching lines. Rejects catastrophic patterns (`.*`, `.+`, `.`).
- `export(targetPath, options?)` -- write a JSON dump of the three files plus optionally-supplied SQL memories.
- `import(srcPath, mode)` -- merge or replace from a JSON dump. Refuses sources that match the secret-path denylist.

23 unit tests cover every method plus the workspace-ID derivation helper.

### 2.2 -- Wire `MemoryFiles` into PromptBuilder

[src/chat/PromptBuilder.ts](../../../../src/chat/PromptBuilder.ts) now accepts an optional `MemoryFiles` constructor argument. When supplied, the builder emits two new sections:

- `file-memory-pre` (priority 2, always-include) -- joins Instructions.md and Context.md, placed immediately after the bundled system prompt and tool declarations.
- `file-memory-post` (priority 31, conditional) -- Memory.md verbatim, placed last so the model sees the user's most-recent on-disk edits with maximum recency.

Combined file-memory tokens are capped at 50% of the system-prompt budget. When the cap is exceeded, Memory.md is truncated section-by-section in this order: `Preferences -> Corrections -> Patterns -> Decisions`. Decisions stays last because it represents locked-in calls the user is least willing to lose. The `_buildMemorySection` helper now filters SQL-injected memoryContext lines through a case-insensitive substring match against Memory.md and drops shadowed lines, so the on-disk file wins on conflict per the plan's precedence rule.

5 integration tests in [tests/integration/memory-files-prompt-merge.test.ts](../../../../tests/integration/memory-files-prompt-merge.test.ts) exercise: file-memory-post placement after SQL memory; file-memory-pre placement before SQL memory; shadow-line drop; null-MemoryFiles fallback; 50%-budget truncation.

### 2.3 -- Wire `/memory init`, `/memory archive`, `/memory edit` commands

The plan referenced a `memoryCommand.ts` helper file. The actual codebase routes `/memory` through `ChatCommandHandlers._handleMemory`, so the new verbs were appended there in place rather than creating a new file. The three file-backed verbs (`init`, `archive`, `edit`) bypass the `MemoryStore` null check because they operate purely on disk; only the SQL-backed verbs (`search`, `save`, `clear`, `lint`, `status`) require `memoryEnabled=true`.

New helpers exported for unit-testing without instantiating the panel:

- `parseInitArgs(rawArgs)` -- returns `{ force: boolean }` for `/memory init [--force]`.
- `resolveMemorySection(memoryFiles, section)` -- maps `instructions|memory|context` to the absolute file path; returns null for unknown sections.

A new `gemma-code.memoryAutoArchive: "off" | "weekly" | "monthly"` setting (default `"off"`) drives the auto-archive scheduler in `buildMemoryFiles`. When `weekly` or `monthly` is set, the bootstrap helper checks the most-recent archive's age on session start; when older than 7 days (`weekly`) or 30 days (`monthly`), an archive is taken silently before the panel finishes loading.

The integration test in [tests/integration/memory-auto-archive.test.ts](../../../../tests/integration/memory-auto-archive.test.ts) exercises: scaffold-on-first-session; null-when-no-workspace; no-archive-when-off; auto-archive-when-stale; no-archive-when-fresh.

7 unit tests in [tests/unit/panels/ChatCommandHandlers.test.ts](../../../../tests/unit/panels/ChatCommandHandlers.test.ts) exercise the three new verbs plus their no-workspace / unknown-section error paths.

---

## 3. Files added

- `src/storage/MemoryFiles.ts`
- `tests/unit/storage/MemoryFiles.test.ts`
- `tests/integration/memory-files-prompt-merge.test.ts`
- `tests/integration/memory-auto-archive.test.ts`

## 4. Files modified

- `src/chat/PromptBuilder.ts` -- constructor takes `MemoryFiles | null`; new `file-memory-pre` / `file-memory-post` sections; new `_buildFileMemoryAllocation` helper for the 50%-budget cap; `_buildMemorySection` filters shadowed SQL lines.
- `src/panels/ChatPanelInit.ts` -- new `buildMemoryFiles(settings, baseDir?)` helper plus `runAutoArchive` scheduler.
- `src/panels/ChatPanelBootstrap.ts` -- threads `memoryFiles` into `BootstrappedPanel` and the `ChatCommandContext` getter chain.
- `src/panels/ChatCommandHandlers.ts` -- `_handleMemory` routes `init|archive|edit` ahead of the SQL-store check; `parseInitArgs` and `resolveMemorySection` exported helpers.
- `src/config/settings.ts` -- new `memoryAutoArchive` field with validated default.
- `package.json` -- new `gemma-code.memoryAutoArchive` configuration property.
- `docs/v0.7.0/architecture.md` -- Section 2 filled in (was placeholder).
- `tests/unit/panels/ChatCommandHandlers.test.ts` -- 7 new tests + `memoryFiles` added to `FakeContextOptions`.
- `docs/index.md` -- catalog regenerated by `npm run catalog`.
- `README.md` -- settings table + slash-commands table updated.
- `docs/DEVLOG.md` -- new Phase 2 entry.

## 5. Decisions and trade-offs

### Lazy `os.homedir()` resolution

Originally the default base directory was a module-level constant (`const DEFAULT_BASE_DIR = path.join(os.homedir(), ...);`). That value freezes at module-import time. After integration tests redirected `process.env.HOME`, the constant still pointed at the real home directory. Refactored to a `defaultBaseDir()` function called per-instantiation so the env override takes effect.

### Test-time path injection for Windows

Windows `os.homedir()` reads `GetUserProfileDirectoryW` directly and ignores `process.env.USERPROFILE`. The auto-archive integration test redirected env vars and saw them silently ignored on Windows. Fix: added an optional `baseDir` parameter to `buildMemoryFiles(settings, baseDir?)` so tests inject a temp directory explicitly. Production callers leave it undefined.

### Append `init|archive|edit` to existing handler vs. creating `memoryCommand.ts`

The plan said "In `memoryCommand.ts`, route each verb." The codebase actually routes `/memory` inside `ChatCommandHandlers._handleMemory`, so the new verbs were appended there. Creating a new file solely because the plan hinted at one would have introduced an unjustified abstraction.

### Bypass `memoryEnabled` for the file-backed verbs

The SQL-backed `MemoryStore` is gated by the `gemma-code.memoryEnabled` setting. The new file-backed verbs operate on Markdown files and have no dependency on the SQL store. Routing them through the same `if (!memoryStore) return` early-exit would have made the file architecture unreachable when the user disables SQL memory. Solution: route the three file-backed verbs ahead of the SQL-store null check.

### Workspace-ID format

`<basename-sanitised>-<sha1[0..10]>` -- the basename is human-readable when browsing `~/.gemma-code/memory/`, the hash disambiguates same-named workspaces. SHA-1 truncated to 10 hex chars is sufficient (1 in 16^10 ~= 1 in 10^12 collision odds for the realistic case of < 100 workspaces per machine).

---

## 6. Verification

- `npm run lint` -- green.
- `npm run build` -- green.
- `npm test` -- 157 test file references, 0 FAIL markers across the run; 71 of those are direct Phase 2 surface (23 MemoryFiles unit + 5 prompt-merge integration + 5 auto-archive integration + 38 ChatCommandHandlers unit). The trailing SIGSEGV on Windows is the documented Node + better-sqlite3 native-cleanup issue, not a test failure.
- `npm run deps:check` -- 135 modules, 564 dependencies, 0 violations.
- `npm run catalog:check` -- regenerated docs/index.md (16 modules); the diff is committed alongside the source changes.
- `npm run perm-tier:check` -- green.

---

## 7. Phase 2 Exit Checklist

- [x] `MemoryFiles` storage module with mtime-cached reads
- [x] First-session auto-scaffold of Instructions.md / Memory.md / Context.md
- [x] PromptBuilder consumes file memory; on-disk wins on conflict
- [x] `/memory archive` snapshots into `Archive/<YYYY-MM-DD>/`
- [x] `gemma-code.memoryAutoArchive` setting honored on session start
- [x] Path-guard / secret-path denylist applied to writes
- [x] Unit + integration tests added per the plan
- [x] Architecture doc updated
- [x] DEVLOG entry written
- [x] Session history (this file) generated

---

## 8. Out of scope (deferred to later phases)

- Phase 5: `/memory forget|export|import` slash commands.
- Phase 5: manual memory page UI (webview tab).
- Phase 5: `gemma-code.contextLimitsPerModel` setting.
- Phase 6: skill packaging script for multi-harness export.

---

## 9. Next steps

Phase 3 (compaction stack expansion) is the next phase per the plan. It depends on Phase 2 only insofar as `Memory.md` is now part of the prompt budget the compactor must respect; no direct dependency on the Phase 2 modules.
