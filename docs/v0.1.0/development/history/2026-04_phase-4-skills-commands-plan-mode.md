# Development Log: Phase 4 — Skills, Commands & Plan Mode

**Date**: 2026-04-05
**Operator**: Benjamin Dourthe
**Assisted by**: Claude Sonnet 4.6 (Claude Code)
**Objective**: Add `/command` slash commands, load DevAI-Hub–compatible skills from disk, enable custom user skills from `~/.gemma-code/skills/`, and implement a plan mode that gates multi-step agent execution behind per-step user approval.
**Outcome**: All four sub-tasks completed and committed (`5348846`). 174/174 tests pass (2 skipped — Ollama-server-dependent). 21 files changed, 1,804 insertions. `npm run build` and `npm run lint` are clean.

---

## 1. Starting State

- **Branch**: `main`
- **Starting tag/commit**: `1ffd638` — *feat: implement agentic tool layer (Phase 3)*
- **Environment**: Windows 11 Pro 10.0.26200, Node.js v24.13.0, TypeScript 5.4, Vitest 1.6.1
- **Prior session reference**: `docs/v0.1.0/development/history/2026-04_phase-2-chat-ui-conversation-manager-streaming-pipeline.md` (most recent history file; Phase 3 was documented in `docs/DEVLOG.md` but no separate session history was generated)
- **Plan reference**: `docs/v0.1.0/implementation-plan.md` (Phase 4, lines 653–838)

Context: Phase 3 delivered the full agentic tool layer (10 tools, `AgentLoop`, `ToolRegistry`, `ConfirmationGate`) with 132 passing tests. The extension could read/edit files, run terminal commands, and search the web. Phase 4 adds the user-facing command surface: a skill loading system, a slash-command router, plan mode gating, and the webview autocomplete and plan UI that exposes these capabilities in the chat panel.

---

## 2. Chronological Steps

### 2.1 Sub-task 4.1 — Skill Loader

**Plan specification**: Implement `src/skills/SkillLoader.ts` that loads SKILL.md files from a bundled catalog and from `~/.gemma-code/skills/`. Parse YAML frontmatter using `js-yaml`. Hot-reload on file changes. Bundle 7 DevAI-Hub skills.

**What happened**: Implemented the SkillLoader without `js-yaml` to avoid adding a dependency. The frontmatter parser uses a regex split on the `---` delimiters and a `key: value` line-by-line pass — sufficient for the flat single-line field format used by SKILL.md files. The tradeoff (no multi-line values) is explicitly acceptable for this format.

The 7 built-in skills were written directly as `SKILL.md` files under `src/skills/catalog/`:
- `commit` — conventional commit message from staged diff
- `review-pr` — structured review with severity scoring (Critical/Major/Minor/Nit)
- `generate-readme` — production README with 9 standard sections
- `generate-changelog` — Keep a Changelog format from git history, version-aware incremental updates
- `generate-tests` — multi-language test generation with AAA structure and ≥80% coverage target
- `analyze-codebase` — 12-section analysis with Mermaid architecture and sequence diagrams
- `setup-project` — project scaffolding including CLAUDE.md, `.gitignore`, and CI config

Hot-reload uses `fs.watch({ recursive: true })` on the user skills directory. It is non-deterministic in timing (no guaranteed delivery), which is noted in tests and lessons learned.

**Key files changed**: `src/skills/SkillLoader.ts`, `src/skills/catalog/commit/SKILL.md`, `src/skills/catalog/review-pr/SKILL.md`, `src/skills/catalog/generate-readme/SKILL.md`, `src/skills/catalog/generate-changelog/SKILL.md`, `src/skills/catalog/generate-tests/SKILL.md`, `src/skills/catalog/analyze-codebase/SKILL.md`, `src/skills/catalog/setup-project/SKILL.md`

**Troubleshooting**: None. The frontmatter parser worked correctly on the first pass. The only decision point was `js-yaml` vs. manual parsing — manual was chosen explicitly to avoid adding a dependency.

**Verification**:
```
✓ tests/unit/skills/SkillLoader.test.ts (8 tests) — all pass
✓ tests/integration/commands/skill-execution.test.ts (4 tests) — all pass against real catalog files
```

---

### 2.2 Sub-task 4.2 — Command Parser & Router

**Plan specification**: Implement `src/commands/CommandRouter.ts` with 6 built-in commands and skill routing. Update the webview to show an inline autocomplete dropdown when the user types `/`. Route commands in `GemmaCodePanel` before forwarding to AgentLoop.

**What happened**: `CommandRouter` is a pure, dependency-free class that takes a factory function `() => CommandDescriptor[]` instead of a static list. This means the router always reflects the live skill set without needing to be reconstructed when skills hot-reload.

The 6 built-in commands:
- `/help` — injects an assistant message listing all commands and skills with descriptions; no model call needed
- `/clear` — calls `ConversationManager.clearHistory()` and resets plan state
- `/history` — stubs with a "coming in Phase 5" assistant message
- `/plan` — toggles `PlanMode`, injects the plan mode addendum as a system message, and posts `planModeToggled` to the webview
- `/compact` — stubs with a "coming in Phase 5" assistant message
- `/model` — calls `OllamaClient.listModels()` and presents `vscode.window.showQuickPick`; on selection updates `gemma-code.modelName` via the VS Code config API

Skill commands expand `$ARGUMENTS` in the skill prompt and prepend it to the user message before sending to `StreamingPipeline.send()`.

The webview autocomplete requests the command list lazily on first `/` keypress via `requestCommandList`, caches it in `commandList` state, and re-filters on subsequent characters. Keyboard navigation: ArrowUp/Down moves the selection, Tab or Enter on a selected item fills in the command name, Escape dismisses.

**Key files changed**: `src/commands/CommandRouter.ts`, `src/panels/GemmaCodePanel.ts` (full rewrite of dispatch logic), `src/panels/messages.ts` (5 new message types), `src/panels/webview/index.ts` (autocomplete CSS + JS)

**Troubleshooting**: None in this sub-task. Command routing worked on first implementation.

**Verification**:
```
✓ tests/unit/commands/CommandRouter.test.ts (14 tests) — all pass
```

---

### 2.3 Sub-task 4.3 — Plan Mode

**Plan specification**: Implement `src/modes/PlanMode.ts` with toggle, plan detection, step lifecycle management, and webview integration. Add PLAN badge to header. Add a plan panel above the footer with per-step Approve buttons.

**What happened**: `PlanMode` is a standalone state machine with no VS Code or webview dependencies. Detection heuristic: scan for `/^\d+\.\s+\S/gm` matches in the first 500 characters of the model response; if ≥2 are found there, extract all numbered steps from the full response via a second pass. This avoids false positives from responses that happen to have a numbered list deep in a long reply.

The step lifecycle: `pending → approved → done`. After a step is approved, `GemmaCodePanel._handleApproveStep()` sends a follow-up user message to the agent ("Please proceed with step N: <description>") and calls `markStepDone()` once the stream completes. This approach reuses the existing `StreamingPipeline.send()` path rather than requiring a new agent loop integration point.

The `state` getter returns a deep-cloned snapshot (`map((s) => ({ ...s }))`) so external callers cannot accidentally mutate internal state.

**Key files changed**: `src/modes/PlanMode.ts`, `src/panels/webview/index.ts` (plan panel CSS + JS, PLAN badge)

**Troubleshooting**:

- **Problem**: `PlanMode.state` snapshot test failed — `expected 'approved' to be 'pending'` — because the shallow array copy (`[...this._state.currentPlan]`) shared object references with the live state. Mutating a step after taking the snapshot mutated the snapshot's copy too.
  - **Root cause**: Spreading an array only copies the array wrapper; object elements remain shared references.
  - **Fix**: Changed to `this._state.currentPlan.map((s) => ({ ...s }))` to deep-clone each step.
  - **Error**: `AssertionError: expected 'approved' to be 'pending' ❯ tests/unit/modes/PlanMode.test.ts:122:45`

**Verification**:
```
✓ tests/unit/modes/PlanMode.test.ts (16 tests) — all pass
```

---

### 2.4 Sub-task 4.4 — Phase 4 Tests

**Plan specification**: Write tests for SkillLoader, CommandRouter, PlanMode, and a skill-execution integration test. Run `npm run test` and fix all failures.

**What happened**: Four test files were written covering 42 new test cases:

| File | Tests | Technique |
|------|-------|-----------|
| `tests/unit/skills/SkillLoader.test.ts` | 8 | Real `fs.mkdtempSync` tmp dirs; `fs.watch` timing tested with 200 ms buffer |
| `tests/unit/commands/CommandRouter.test.ts` | 14 | Pure unit, no mocks needed; factory function enables live-descriptor reflection test |
| `tests/unit/modes/PlanMode.test.ts` | 16 | Pure unit; snapshot isolation, detectPlan edge cases, state machine transitions |
| `tests/integration/commands/skill-execution.test.ts` | 4 | Real catalog files on disk; no Ollama server needed |

Two bugs surfaced during test authoring:

**Bug 1 — `extensionUri.fsPath` is `undefined` in the extension unit test mock:**
- `GemmaCodePanel` now constructs `path.join(this._extensionUri.fsPath, "src", "skills", "catalog")` in its constructor. The existing `extension.test.ts` mock had `extensionUri: {} as vscode.Uri` — no `fsPath` property — causing `path.join` to throw.
- **Fix**: Added a nullish guard: `const extensionFsPath = this._extensionUri.fsPath ?? "";`. With an empty string as the base, `path.join` produces a relative path that resolves to no skills (safe for tests, no changes to mock needed).
- **Error**:
  ```
  TypeError: The "path" argument must be of type string. Received undefined
  ❯ Proxy.join node:path:513:7
  ❯ new GemmaCodePanel src/panels/GemmaCodePanel.ts:70:29
  ❯ activate src/extension.ts:55:21
  ```

**Bug 2 — `vitest run --include` flag not supported in Vitest v1.x:**
- The pre-existing `test:integration` npm script used `--include 'tests/integration/**'`. Vitest v1.x's CLI does not have an `--include` flag (it's an array in `vitest.config.ts`, not a CLI option).
- **Fix (two-part)**:
  1. Added `"tests/integration/**/*.test.ts"` to the `include` array in `configs/vitest.config.ts` so both unit and integration suites run under `npm run test`.
  2. Changed `test:integration` to `vitest run --config configs/vitest.config.ts --reporter=verbose tests/integration`, using the positional path filter.
- **Error**: `CACError: Unknown option '--include'`

**Key files changed**: `tests/unit/skills/SkillLoader.test.ts`, `tests/unit/commands/CommandRouter.test.ts`, `tests/unit/modes/PlanMode.test.ts`, `tests/integration/commands/skill-execution.test.ts`, `configs/vitest.config.ts`, `package.json`

**Verification**:
```bash
npm run test
# Test Files  17 passed | 1 skipped (18)
# Tests       174 passed | 2 skipped (176)
# Duration    1.66s
```
```bash
npm run test:integration
# ✓ tests/integration/commands/skill-execution.test.ts (4 tests)
# Test Files  1 passed | 1 skipped (2)
# Tests       4 passed | 2 skipped (6)
```

---

### 2.5 Docs and housekeeping

**What happened**: After all code was complete and tests passing:
- `/update-gitignore` ran: no findings (G0–G3 all zero); audit report updated to document the 14 new Phase 4 files pending commit.
- `/update-devlog` ran: Phase 4 DEVLOG entry written to `docs/DEVLOG.md` documenting architecture, bugs, and lessons learned.
- `/generate-commit-message` ran: conventional commit message drafted and committed as `5348846`.

**Key files changed**: `docs/DEVLOG.md`, `docs/git/gitignore-audit-2026-04-05.md`

---

## 3. Verification Gate

| Check | Result |
|-------|--------|
| `npm run test` (174 tests) | PASS |
| `npm run test:integration` (4 skill catalog tests) | PASS |
| `npm run build` (`tsc`) | PASS |
| `npm run lint` (`eslint src`) | PASS |
| `.gitignore` audit (G0–G3 scan) | PASS — 0 findings |
| Skill hot-reload (fs.watch, 200 ms buffer) | PASS |
| `/help` command lists all 13 commands+skills | Manually verified |
| `/plan` toggles badge and plan panel | Manually verified |
| Autocomplete dropdown on `/` keypress | Manually verified |
| Integration tests against real catalog files | PASS |

---

## 4. Known Issues

| Issue | Severity | Decision |
|-------|----------|----------|
| `fs.watch` hot-reload is non-deterministic (no guaranteed delivery) | P2 | Accepted — best-effort is sufficient for user-managed skill files; documented in lessons learned |
| `/history` and `/compact` are stubs ("coming in Phase 5") | P2 | Deferred to Phase 5 by design |
| Skill catalog path resolves incorrectly when `extensionUri.fsPath` is undefined (tests only) | P2 | Mitigated with `?? ""` guard; production behavior unaffected (VS Code always provides a valid Uri) |
| Plan step detection fires only post-message, not mid-stream | P2 | Accepted — full response needed to reliably match numbered list pattern |

---

## 5. Plan Discrepancies

- **`js-yaml` not used for frontmatter parsing**: The plan specified using `js-yaml` to parse SKILL.md frontmatter. A custom regex/line-split parser was implemented instead to avoid adding a runtime dependency. The tradeoff (no multi-line YAML values) is acceptable given the single-line field format used by all skills.
- **Plan detection not integrated into `AgentLoop`**: The plan specifies modifying `AgentLoop` to pause after plan detection. Instead, `_checkForPlan()` is called in `GemmaCodePanel` after `StreamingPipeline.send()` returns. This achieves the same user-observable behavior (plan panel appears after the model response) without modifying the tested `AgentLoop` class and without requiring a new post-stream callback mechanism.
- **Autocomplete uses JS, not CSS-only**: The plan specified a "CSS-only dropdown." A small JavaScript implementation was used because filtering by query prefix and lazy-loading the command list requires scripting. CSS-only would require all items pre-rendered in the DOM.
- **All other deliverables**: Implemented exactly as specified.

---

## 6. Assumptions Made

- **SKILL.md frontmatter is always flat (single-line values)**: The parser does not support multi-line YAML values. All 7 built-in skills and the DevAI-Hub format use flat fields, so this assumption holds. If a user writes a multi-line `description:`, it will be truncated to the first line.
- **`fs.watch` is available on all supported platforms**: Used for hot-reload. Non-fatal if unavailable — `watch()` catches exceptions and degrades gracefully. Windows 11 (the development environment) supports it.
- **Plan detection is post-stream**: It was assumed that detecting a plan requires the full model response (needed to count numbered lines in the first 500 chars). If the model produces a plan mid-stream and then continues, the plan panel will not appear until the stream ends.
- **Skill `$ARGUMENTS` substitution is a simple string replace**: If a skill prompt contains `$ARGUMENTS` multiple times, all occurrences are replaced with the same argument string. No escaping is performed on the arguments.
- **User skills directory at `~/.gemma-code/skills/`**: Chosen as the default per the implementation plan. No settings entry was added to override this path (not specified in the plan).

---

## 7. Testing Summary

### Automated Tests

| Suite | Passed | Failed | Skipped |
|-------|--------|--------|---------|
| Unit — SkillLoader | 8 | 0 | 0 |
| Unit — CommandRouter | 14 | 0 | 0 |
| Unit — PlanMode | 16 | 0 | 0 |
| Integration — skill catalog | 4 | 0 | 2 (Ollama-dependent) |
| All prior phases (unchanged) | 132 | 0 | 0 |
| **Total** | **174** | **0** | **2** |

### Manual Testing Performed

- Confirmed `/help` renders a formatted Markdown list of all 13 descriptors (6 builtins + 7 skills) in the webview
- Confirmed `/plan` toggles the PLAN badge in the header and injects a system message
- Confirmed autocomplete dropdown appears when typing `/` and filters correctly as characters are added
- Confirmed keyboard navigation (ArrowDown, Tab to select) fills the input correctly

### Manual Testing Still Needed

- [ ] End-to-end: run `/commit` on a real staged diff and verify the model receives the expanded skill prompt and generates a conventional commit message
- [ ] End-to-end: run `/review-pr` on a branch with real changes and verify structured review output
- [ ] Plan mode end-to-end: send a multi-step coding request in plan mode and step through all approvals
- [ ] Hot-reload: add a new skill file to `~/.gemma-code/skills/` while the extension is running and confirm it appears in autocomplete within ~1 second
- [ ] User skill override: add a `commit/SKILL.md` to `~/.gemma-code/skills/` and verify it overrides the built-in
- [ ] `/model` command with a live Ollama server: confirm the quick-pick populates with real model names and switching takes effect on the next message
- [ ] Webview plan panel: verify Approve buttons are disabled after clicking (prevent double-approval)

---

## 8. TODO Tracker

### Completed This Session

- [x] **4.1** SkillLoader — YAML frontmatter parser, user dir creation, hot-reload, `getSkill`, `listSkills`
- [x] **4.1** Built-in catalog — 7 SKILL.md files (commit, review-pr, generate-readme, generate-changelog, generate-tests, analyze-codebase, setup-project)
- [x] **4.2** CommandRouter — route(), getAllDescriptors(), 6 built-in commands + skill routing
- [x] **4.2** GemmaCodePanel — full rewrite of `_handleSendMessage`, new `_handleBuiltinCommand`, `_checkForPlan`
- [x] **4.2** Webview autocomplete — lazy fetch, filter-as-you-type, keyboard navigation, item selection
- [x] **4.3** PlanMode — toggle, detectPlan, setPlan, approveStep, markStepDone, resetPlan, snapshot isolation
- [x] **4.3** Webview plan panel — sticky above footer, numbered steps, Approve buttons, status badges, PLAN badge
- [x] **4.3** Plan mode system prompt addendum injected on activation
- [x] **4.4** Unit tests: SkillLoader (8), CommandRouter (14), PlanMode (16)
- [x] **4.4** Integration test: skill catalog load + `$ARGUMENTS` substitution (4)
- [x] **4.4** Fix `vitest.config.ts` include array; fix `test:integration` script

### Remaining (Not Started or Partially Done)

- [ ] None for Phase 4 — all plan subtasks complete.

### Out of Scope (Deferred to Phase 5)

- [ ] `/history` — chat session browser (Phase 5 persistent storage)
- [ ] `/compact` — manual context compaction (Phase 5 `ContextCompactor`)
- [ ] Settings entry to override user skills directory path (not in plan; could be added in Phase 5)
- [ ] Plan step Approve button disabled state after click (minor UX gap; no impact on functionality)

---

## 9. Summary and Next Steps

Phase 4 delivered the full skill and command surface for Gemma Code. Users can now type `/` to trigger autocomplete, invoke any of the 7 bundled DevAI-Hub skills or 6 built-in commands, add their own skills to `~/.gemma-code/skills/`, and use plan mode to step through multi-step agent tasks with explicit per-step approval. All 174 tests pass, build and lint are clean, and the commit is on `main` at `5348846`.

**Next session should**:
1. Implement Phase 5.1 — persistent chat history with SQLite (`ChatHistoryStore`) and `/history` command
2. Implement Phase 5.2 — auto-compact (`ContextCompactor`) wired into `AgentLoop` with token count indicator in the webview header
3. Implement Phase 5.3 — three edit modes (`auto` / `ask` / `manual`) threaded through `EditFileTool` and `GemmaCodeSettings`
4. Complete Phase 5 tests and run `/generate-session-history` for Phase 5
