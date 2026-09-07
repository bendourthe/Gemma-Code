# Last-Phase Evidence: v2.4.8 Desktop Corrections

**Plan**: [v2.4.8 desktop token split, persona, and model order](../plans/v2.4.8-desktop-token-split-persona-and-model-order.md)
**Branch**: `feat/v2.4.8-desktop-token-split-persona-and-model-order` off `develop` at `989107c7`
**Date**: 2026-09-06
**Operator**: Benjamin Dourthe
**Assisted by**: Claude Fable 5.1

Phase 6 duties T024-T033. Each section quotes the command and the result it produced on this host.

---

## T024 - Architecture refactor scan

Files this plan touched, checked for duplication with existing helpers:

| Surface | Finding | Action |
|---|---|---|
| `chatCore.turnUsageFromCollected` | Single split site; `chatMessageHandler` is its only caller. The `core/chat/tokenUsage.ts` estimate remains the page-side fallback for turns the backend never reported. | None |
| `useDismissOnOutside` | `ApprovalsBell.tsx` had its own `mousedown` listener before this plan. Consolidating it is outside the five screenshots. | Recorded, not changed |
| `pickerOrder` vs `collapseAndSortModels` | Both live in `catalogTabs.ts` and share `rowVram`, `releaseOrdinal`, `nameOf`, `recommendationKind`, `isCatalogOverBudget`. They differ deliberately: the picker never collapses by family or hides by VRAM floor. The comparator is not shared because `collapseAndSortModels` groups by tier-matrix `defaults` and `pickerOrder` by catalog tag. | None |
| `providerColors.ts` | New; keyed through the existing `FAMILY_TO_PUBLISHER`. No second publisher map. | None |
| `ModelsSettings.tsx` | `ModelIcon`, `badgeStyle`, `renderFactChips`, `pillLabelStyle`, `pillValueStyle`, `factsRowStyle` removed with the grammar they served; `compactRequirementFacts`, `compactCapabilityFacts`, `splitModelPill` are no longer imported here. They remain exported from `modelPills.ts` for other callers. | Removed dead card helpers |

No behavior-changing refactor was applied in this phase.

## T025 - Known gaps

`docs/v2/v2.4/known-gaps.md` gained a `## v2.4.8` section: three resolved BG rows, five MT rows (one per phase, each an unobserved packaged surface), and three DF rows (inferred split not flagged; uncommitted wizard-merge state in the rebuilt installer; stale `recommendedByTask` masked, not rewritten). Every earlier open row carries forward unchanged.

## T026 - Living documentation

```
grep -rn "Sessions History|Requirements:|recommendedByTask|eval_count" ARCHITECTURE.md docs/handbooks docs/reference README.md
```

No matches. No living document describes the pane title, the Settings card grammar, the snapshot recommendation rule, or the token split, so nothing was invalidated.

## T027 - Git-tree hygiene

Commits on this branch, each staging only the paths its phase names:

| Phase | Commit | Subject |
|---|---|---|
| 1 | `1147920e` | fix(desktop): split the provider token total instead of adding a reasoning estimate |
| 2 | `9765c6cf` | fix(desktop): dismiss composer menus and the persona popover on outside click or Escape |
| 3 | `c1036e03` | fix(desktop): title the history pane Sessions in nav-label type on every pillar |
| 4 | `760a9ced` | feat(desktop): match the installer catalog tab order and card grammar in Settings |
| 5 | `dfeb8ef9` | fix(models): list and default to the installer's recommended model on every picker |
| 6a | see `git log` | test(desktop): expect the proportional token split on the chat-session done event (full-suite finding, T031) |
| 6b | see `git log` | docs(v2.4.8): last-phase evidence, known gaps, CI filter, installer rebuild |

Pre-existing uncommitted state, untouched and unstaged by this plan: 30 modified and 6 untracked files (installer wizard merge rounds 1-3 under `scripts/installer/`, `docs/v2/v2.5/`, `tests/fixtures/memory-tier-benchmark-results/2026-05-26/results.json`, and the wizard-merge notes in `docs/todos.md`). The `docs/todos.md` banner for this plan was staged against the `HEAD` version of the file so the commit carries the banner alone; the working copy keeps the wizard notes. `git status` after the Phase 6 commit lists exactly that pre-existing set.

## T028 - CI/CD reconciliation

| Plan added | Pipeline coverage | Change |
|---|---|---|
| Desktop source and tests (`desktop/src/**`, `desktop/tests/**`, `desktop/sidecar/src/**`) | `ci.yml` desktop vitest job | none needed |
| `scripts/installer/tests/test_desktop_parity_fixtures.py`, `test_runtime_provisioner.py` additions | `installer-tests.yml` `scripts/installer/**` | none needed |
| `tests/fixtures/v2.4.8-catalog-tab-order.json`, `tests/fixtures/v2.4.8-provider-colors.json` | `installer-tests.yml` lists fixture files individually (`v2.2.8-catalog-tab-sort.json`) and did not list these | **Applied**: both files added to both `paths:` filters, following the existing per-file convention. Cost: an installer-tests run when a fixture changes, which is exactly when the parity test must run. |
| `useDismissOnOutside.ts`, `providerColors.ts` | inside `desktop/src/**` | none needed |

No other pipeline file changed. No remote CI run was started by this plan.

## T029 - Independent Goal-vs-codebase review

Each definition-of-done bullet checked against the code, not the tests:

| Bullet | Code | Verdict |
|---|---|---|
| 215 / 32 byte turn at `eval_count: 72` renders 63 / 9; parts sum to total | `chatCore.ts` `turnUsageFromCollected`: `Math.round(total * thinkBytes / (thinkBytes + replyBytes))`, remainder to output | Met (the plan said 33 reply bytes; the reply is 32; 63 / 9 either way) |
| Explicit `reasoning_tokens` subtracted | same function, `Math.max(total - reasoning, 0)` | Met |
| No thinking leaves output equal to total | `thinkBytes === 0` branch | Met |
| Three surfaces close on outside pointer and Escape, stay open inside | `useDismissOnOutside` on overflow menu + toggle, mic menu + toggle, persona popover | Met |
| Popover tokens | `ChatPage.tsx` popover: `--bg-elevated`, `--border-subtle`, `--radius-md`, `--shadow-md`; label `--fg-1` / `--text-sm` / 600; textarea `--bg-1`, `--font-sans`, `--text-sm`, `--fg-0` | Met |
| `Sessions` in `--fg-1` at `--text-sm` on four pillars; aria and Chatbot label unchanged | four `paneTitle` strings; `folder-tree-title` color | Met |
| Tabs Embeddings, Document, Chat, Agentic, Image, Video, Audio, fixture on both sides | `CATALOG_TAB_DEFS`; `TYPE_TABS`; `v2.4.8-catalog-tab-order.json` | Met |
| Card grammar (tint, name color, name-row pills, steelblue Recommended, size pill, round badges, description, Best for, license note, Why this one, actions kept) | `ModelsSettings.tsx` `ModelCard` | Met. Font family is not identical across Qt and the webview and cannot be by construction; sizes follow the installer's body / caption ratio. |
| Screenshot 5 roster lists Gemma 4 12B first and selects it by default with no snapshot ranking it | `pickerOrder` (tier before rank); `installedForTask`; `resolveDefaultId` catalog-endorsed rule; installer `_recommended_by_task` | Met, and extended: the same holds against the operator's actual stale snapshot, which the plan had not anticipated |
| Favorite still wins | `resolveDefaultId` `applyFavorite` branch unchanged | Met |

One gap against the Goal statement: "selects it by default" on Agents with the stale on-disk snapshot depends on the desktop rule; the installer rewrite of the snapshot is proven only in pytest until the operator reinstalls (MT-5, DF-3).

## T030 - Human testing suggestions (operator)

Install the rebuilt `dist/NexusSetup.exe`, then in the desktop:

1. **Token label.** Chatbot, Gemma 4 12B, send `Hi`. Hover the assistant bubble's token count. The label total must equal `Reasoning + Output` in the tooltip, and Reasoning must exceed Output when the reasoning block is longer than the reply.
2. **Overflow menu.** Click `...` in the composer, then click anywhere else in the window. The menu closes. Open it again and press Escape. It closes. Clicking `...` twice opens then closes it.
3. **Persona.** Open `...`, click `Persona`. The popover matches the composer's surface (elevated background, hairline border, rounded, drop shadow), the field looks like the composer field. Type into it (it stays open). Click outside: it closes. Reopen and press Escape: it closes.
4. **Sessions.** On Chatbot, Agents, Images, and Videos the left pane header reads `Sessions` in the same weight and color as the `Videos` nav label.
5. **Settings > Models.** Tabs read Embeddings, Document, Chat, Agentic, Image, Video, Audio. Open the Chat tab and compare the Gemma 4 12B card with the same card in the installer picker: cyan-tinted surface and border, cyan name, the same pills on the name row, steelblue `Recommended`, cyan size pill, green round check, violet round download badge, description, `Best for:`, and the star / delete row below.
6. **Picker order.** On Chatbot and Agents, open the model selector. Gemma 4 12B is first. Start a new session with no favorite set: Gemma 4 12B is selected.
7. **Snapshot.** In a terminal: `type %USERPROFILE%\.nexus\selected-models.json`. `recommendedByTask.chat` and `recommendedByTask.agentic` read `gemma-4-12b-it-gguf`.

## T031 - Full local testing

### Desktop

```
cd desktop
npm run lint        -> exit 0
npm run typecheck   -> exit 0
npm test            -> Test Files 10 failed | 203 passed (213)
                       Tests 37 failed | 1964 passed | 1 skipped (2002)   [155 s]
```

The 37 failures split into two causes.

**36 failures, 9 files, one environmental error that predates this branch:**

```
Error: The module '...\node_modules\better-sqlite3\build\Release\better_sqlite3.node'
was compiled against a different Node.js version using NODE_MODULE_VERSION 146.
This version of Node.js requires NODE_MODULE_VERSION 137.
```

`better-sqlite3` on this host is compiled for Electron's ABI (the v2.4.6 VS Code 1.136 VSIX rebuild, WN-2), while Node 24.13 expects ABI 137. The nine files (`generation-queue-handlers` 10, `video-enhancement-persistence-adapter` 7, `video-enhancement-integration` 5, `sidecar-handlers` 5, `video-enhancement-runtime-factory` 4, `audit-handlers` 2, `json-cli-routes` 1, `generation-smoke` 1, `diffusion-segment-handler` 1) all construct a SQLite database and none imports a module this plan changed. Running `npm rebuild better-sqlite3` would fix them locally and break the VSIX ABI pin, so it was not run. CI installs native modules fresh for its Node and is unaffected.

**1 failure that was this plan's, now fixed:** `chat-session.test.ts` still expected the pre-Phase-1 semantics (`eval_count: 8` reported as output plus an estimated reasoning token, context sum 29). The Phase 1 run covered `serving-chatCore.test.ts` only. The expectation now reads 5 reasoning / 3 output (4 thinking bytes against 2 reply bytes) and a sum of 28, committed as `test(desktop): expect the proportional token split on the chat-session done event`. After the fix, both token test files pass (49 tests) and lint is clean.

Every file this plan touched passes:

```
tests/serving-chatCore.test.ts                     36 passed
tests/MediaComposer.test.tsx + ChatPage.test.tsx   34 passed
FolderTree + sidebar-history-host + StudioHistoryPane   66 passed
ModelsSettings + settings-models-density + catalogTabs + providerColors   55 passed
QuickModelSwitcher + selection-policy + Chat/Coding/Image/Video pages   134 passed
```

### Installer

```
cd scripts/installer
uv run ruff check .           -> clean on every file this plan touched
uv run pytest -q              -> all passed (full suite, including the uncommitted wizard-merge state)
```

## T032 - Installer rebuild

```
cd desktop && npm run build:shell
  -> Finished 2 bundles: Nexus AI Studio_2.4.1_x64_en-US.msi, Nexus AI Studio_2.4.1_x64-setup.exe
powershell -File scripts/installer/build/build-windows.ps1 -SkipSign
  -> see below
```

```
[3/5] Locating artifacts...
  Version: 2.4.1
  VSIX: nexus-coding-2.4.1-win32-x64.vsix
  Desktop bundle staged: Nexus AI Studio_2.4.1_x64-setup.exe (sha256 cf3401c92738...)
[4/5] Running PyInstaller (single onefile -> dist/NexusSetup.exe)...
[5/5] Build output:
  File: dist/NexusSetup.exe
  Size: 239.4 MB (251,067,748 bytes)
  SHA256: 0E66604B6E7002A85AD26D957A59E813910517248EF49AF0A0657009059DC7FF
Signing skipped (--SkipSign).
Build complete.
```

Built 2026-09-06 22:46 local, immediately after `build:shell`, so the staged desktop bundle is the one containing Phases 1-5 (WN-1 from v2.4.6 respected). Two expected notes in the log: the Nexus-Hub snapshot pack was refused because the local catalog tag (4.7.0) is not the latest release, so no snapshot is embedded and the installer syncs latest at install time, which is the documented behavior; and placeholder HF weight pins remain (`dist/pin-check.log`), unchanged from prior cycles.

The rebuilt installer includes the uncommitted wizard-merge state described under T027 (DF-2), exactly as the installer the operator already field-tested did.

## T033 - Publication

Not performed. Nothing was pushed, no pull request was opened, no remote CI ran, no version was bumped. Publication waits on explicit operator approval; the commands that perform it are:

```
git push -u origin feat/v2.4.8-desktop-token-split-persona-and-model-order
gh pr create --base develop --title "v2.4.8: desktop token split, persona chrome, Sessions title, models parity, picker order" --body-file docs/v2/v2.4/development/last-phase-evidence-v2.4.8-desktop-corrections.md
```

Release (`/update release`) starts only after that pull request is green and merged, and only once field testing of the rebuilt installer passes.
