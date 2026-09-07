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
| 6b | `817edbaa` | docs(v2.4.8): record last-phase evidence, known gaps, CI filter, and the installer rebuild |
| 7 | `eaaea3c2` | feat(desktop): put the model card action in the title row and group each tab as collapsible Downloaded, Compatible, Incompatible |
| 7b | `ff618b9d` | docs(v2.4.8): record Phase 7 evidence, known gaps, and the second installer rebuild |
| 8 | `c34154a0` | fix(media): pin torch 2.5.1 with a 2.4 floor, add a Loading model state, center the composer cluster, and trim the GPU card |
| 8b | see `git log` | docs(v2.4.8): Phase 8 evidence, known gaps, and the third installer rebuild |

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

## Phase 7 addendum (2026-09-07) - Models card actions and availability groups

Operator feedback on the Phase 4 card arrived after the first rebuild and became Phase 7 (T034-T036), committed as `eaaea3c2`. Session history: `history/2026-09-07_v2.4.8-phase-7-models-card-actions.md`.

**Verification**

```
cd desktop
npm run typecheck   -> exit 0
npm run lint        -> exit 0
npx vitest run tests/ModelsSettings.test.tsx tests/settings-models-density.test.tsx   -> 39 passed (39)
npx vitest run <every file that renders the page: ipcModelsClient, ModelsSettings, SettingsPage,
                owned-picker-allowlist, settings-models-density, settings-phase7>          -> 68 passed (68)
```

**Known gaps added**: MT-6 (packaged Phase 7 not observed), DF-4 (Settings no longer offers a favorite control).

**Operator checks, appended to T030**

8. **Card cluster.** On any Models tab, each card's top right reads the size pill followed by one button: red delete on a downloaded row, blue download on a compatible row, nothing on an incompatible row. No star, no green checkmark, no row of controls under the description.
9. **Groups.** Each tab shows `Downloaded`, `Compatible`, `Incompatible` headings (only those with rows), each with a count and a chevron. Clicking a chevron hides that group's cards and flips the chevron; the other groups stay. Incompatible cards are faded and do not react to the mouse.

**Second installer rebuild**

```
cd desktop && npm run build:shell                       -> shell rebuilt with Phase 7
build-windows.ps1 -SkipSign
  Desktop bundle staged: Nexus AI Studio_2.4.1_x64-setup.exe (sha256 9f2403dcf184...)
  File: dist/NexusSetup.exe
  Size: 239.4 MB (251,067,827 bytes)
  SHA256: BD224EA36740DF397DC6F8D8845E038239E9DACACB38D861D51638754BE88282
Build complete.
```

Built 2026-09-07 09:14 local. This supersedes the 2026-09-06 build (`0E66604B...9DC7FF`) and is the one to field-test. The same two expected log notes apply (stale Hub snapshot refused; placeholder HF pins), and the uncommitted wizard-merge state is still included (DF-2).

## Phase 8 addendum (2026-09-07) - Video runtime torch floor and field round 2

Second field round became Phase 8 (T037-T039). Session history: `history/2026-09-07_v2.4.8-phase-8-video-runtime-and-field-round-2.md`.

**Root cause of the video failure**: `~/.nexus/runtime.json` read `ready` at `torch_version: 2.3.0+cu121`; both lock files pinned 2.3.0; diffusers 0.36's SANA-Video imports `torch.nn.RMSNorm` (torch 2.4+); no readiness layer checked the version. Fixed at the lock (2.5.1 cu121, twelve verified wheels) and guarded at the installer smoke, the sidecar status, and the runtime readiness.

**Why the Models card still showed the star**: `~/.nexus/desktop-payload.json` records sha `cf3401c9...` (the 2026-09-06 22:46 payload, Phases 1-5). The Phase 7 payload is `9f2403dc...`; the installed desktop predates it. The Settings footer prints the installed payload sha prefix for exactly this check.

**Verification**

```
scripts/installer: uv run pytest -q                                     -> full suite passed (lock bump included)
tests/python/diffusion/test_real_execute.py                             -> 41 passed
desktop: mediaMessageBubble, shell-phase6, diffusion-runtime-factory,
         MediaComposer, composer-surface-phase5, ImageStudioPage,
         VideoLabPage, AgentStateOrb, ChatPage, CodingPage                -> 196 passed (196)
desktop: npm run typecheck / npm run lint                               -> exit 0
```

**Known gaps added**: BG-4 resolved; MT-7 (packaged Phase 8 not observed); DF-5 (stale venv repaired only by reinstall or Settings > Video Repair).

**Operator checks, appended to T030**

10. **Reinstall.** Run the new `dist/NexusSetup.exe`. The media-runtime step re-provisions (the manifest changed) and downloads about 2.4 GB of torch 2.5.1 wheels; wait for it. Then `type %USERPROFILE%\.nexus\runtime.json` shows `"torch_version": "2.5.1+cu121"` and `"status": "ready"`. If you skip the reinstall, Settings > Video shows the runtime as repairable with "older than 2.4"; press Repair.
11. **Video.** Videos, `Generate a video of a puppy playing in the grass`. No `RMSNorm` error; the bubble reads `Loading model...` first, then rotates Generating / Creating / Crafting, then plays the clip.
12. **Loading state.** From Chat, switch to Images and generate. The orb reads `Loading model...` while the GPU bar is still low, and switches to the studio captions when the bar rises.
13. **Composer.** On Chat, Agents, Images, and Videos the `+`, `...`, mic, and send controls sit vertically centered on the field, at one line and after the field grows.
14. **GPU card.** Idle: the card is the bar plus `GPU usage 0%` and free VRAM, no `Idle` line. While a model is loaded, the model name row returns above the bar.
15. **Footer fingerprint.** Settings footer reads `Desktop payload 2.4.1 (` followed by the new payload sha prefix recorded below; if it still reads `cf3401c9`, the reinstall did not replace the desktop.

**Third installer rebuild**

```
cd desktop && npm run build:shell                       -> shell rebuilt with Phases 7 and 8
build-windows.ps1 -SkipSign
  Desktop bundle staged: Nexus AI Studio_2.4.1_x64-setup.exe (sha256 368e75a70e5c...)
  File: dist/NexusSetup.exe
  Size: 251.1 MB (251,069,461 bytes)
  SHA256: 3C1EBA0489F7B5AFACA212E76EA999685E2660AB44346E6F81523698972BC9B3
Build complete.
```

Built 2026-09-07 local. This supersedes both earlier v2.4.8 builds (`0E66604B...` and `BD224EA3...`) and is the one to field-test. The installed payload record must read `368e75a7...` after the reinstall (operator item 15). The embedded media manifest now carries the torch 2.5.1 lock, so the installer reprovisions the diffusion venv (DF-5). The same two expected log notes apply (stale Hub snapshot refused; placeholder HF pins), and the uncommitted wizard-merge state is still included (DF-2).

## T033 - Publication

Not performed. Nothing was pushed, no pull request was opened, no remote CI ran, no version was bumped. Publication waits on explicit operator approval; the commands that perform it are:

```
git push -u origin feat/v2.4.8-desktop-token-split-persona-and-model-order
gh pr create --base develop --title "v2.4.8: desktop token split, persona chrome, Sessions title, models parity, picker order" --body-file docs/v2/v2.4/development/last-phase-evidence-v2.4.8-desktop-corrections.md
```

Release (`/update release`) starts only after that pull request is green and merged, and only once field testing of the rebuilt installer passes.
