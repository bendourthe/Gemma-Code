# Last-Phase Evidence - v2.2.9 Phase 7

**Project**: Nexus AI Studio
**Plan**: [../plans/v2.2.9-field-chrome-catalog-and-generate.md](../plans/v2.2.9-field-chrome-catalog-and-generate.md)
**Date**: 2026-08-27
**Driver**: `/implement in-full` final phase (Phase 7 of 7)

Each section quotes the proving command or scan per the fail-closed last-phase gate.

## Architecture refactor

`npm run cleanup:scan` (2026-08-27):

```
[cleanup-scanner] scanned C:\Users\bdour\Documents\Projects\Development\Nexus-AI at 2026-08-27T15:15:49.882Z
  stale-cache-files:         0
  deleted-path-references:   0
  orphan-memory-rows:        0
  orphan-fts-rows:           0
  dangling-embeddings:       0
Total findings: 0
```

`npm run check:docs-layout`: `check-docs-layout: canonical layout OK (no docs/versions|docs/archive/versions wrappers)`, exit 0.

Deprecated chrome removed by the phases themselves: the always-rendered empty Image/Video `<header>` became render-when-children (Phase 3); the v2.2.7 duplicate under-description chip rows in installer and Settings were replaced by one shared name-row pill grammar with dual-asserted fixtures (Phase 5); `UNKNOWN_TOKEN_MARK` (em dash) left the pending path (Phase 1). Chatbot stays on `chat.explorer.*`. No file moves were needed; no reference repair required.

## Known-gaps reconciliation

Reconciled in `docs/v2/v2.2/known-gaps.md` (2026-08-27, v2.2.9 section added). Disposition summary:

- Closed: DF-32, DF-35 (v2.2.8 Resolved; 2026-08-25 field session), DF-28, DF-31 (v2.2.9 Resolved; same session), BG-55 (stub OR-gate found by the Goal review, fixed, tested).
- Kept with annotation: DF-30 (Context pill observed; 80% CTA not), DF-29, DF-25 (not evidenced), DF-23 (Active=latest observed but clone path undistinguished), DF-34 (screenshots predate the Phase 5 grammar), DF-4 (typed errors change what the operator will see; no PNG/MP4 recorded).
- Kept unchanged: DF-33, DF-24, DF-26, DF-27.
- New: DF-36 (packaged v2.2.9 chrome unproven - field checklist on a rebuilt installer), DF-37 (error kind prose-only on the wire), WN-8 (self-mutating benchmark fixture), WN-9 (5000ms load flakes, WN-2 class), MT-4 (no per-phase coverage percentage), MT-5 (publisher-map parity untested).

Other `docs/**/known-gaps.md` files: `docs/v1/*/known-gaps.md` are closed historical cycles (Status not in-progress); `docs/v2/v2.2/known-gaps.md` is the only in-progress tracker and was reconciled above.

## Living docs architecture

- Root `README.md`, `docs/DEVLOG.md` (release index; v2.2.9 entry lands at `/update release`), `docs/todos.md` (updated 2026-08-28: v2.2.9 release prepared, publication pending, open gaps finalized).
- Per-version tree `docs/v2/v2.2/` carries plans/, development/history/ (7 session-history files for v2.2.9), known-gaps.md.
- `npm run check:docs-layout` passes (quoted above). No `docs/testing/` or `docs/validation/` invented (self-gate respected).

## Git-tree hygiene

`scripts/check_release_preconditions.py` does not exist in this repository; report produced manually (report-only, nothing deleted):

```
git branch -r --merged develop
  origin/develop, origin/main, origin/feat/v1.8.0-installer-phase-6,
  origin/feat/v1.9.0-installer-phase-1, origin/feat/v1.10.0-nexus-hub-consumption,
  origin/feat/v1.11.0-installer-overhaul, origin/feat/v1.13.0-installer-reliability
```

Merged v1.x feature branches remain on the remote (candidates for cleanup; `branch-cleanup.yml` exists as a workflow). Local tree also carries historical v1.x feature branches plus `backup/pre-commitlint-reword`. Report only; no branch was deleted. Phase 7 ran on `develop`; release preparation runs on `release/v2.2.9` from feature boundary `9f155e5`; `v2.2.8` remains the published tag until separate approval.

## CI/CD coverage

- `ci.yml`: root vitest (test-ts), desktop vitest via `npm run test:shell` (Node 22 only, minutes-gated), `pytest (runtimes/)` job runs `python -m pytest tests/python -q` with no torch/GPU. All v2.2.9 test files sit inside these existing globs; the v2.2.9 (T014) contract comment was added to ci.yml. No live GPU and no live Hub clone anywhere (grep quoted the standing prohibitions).
- `installer-tests.yml`: path-gated `uv run pytest tests/` covers the new typed_catalog / model-pills / patient-tier / downloaded-first tests.
- Optimization present across workflows: `concurrency` + `cancel-in-progress` and path filters on every active workflow (grep count: 17 workflows, all with hits); expensive OS matrix gated to main pushes (shell-build.yml).
- `npm run check:tampering` after the ci.yml edit: `nexus-check: 0 findings`.
- Installer parity: v2.2.9 ships the complete Python provisioning installer only on Windows. macOS and Linux receive platform VSIXes but no standalone desktop package; raw Tauri bundles are withheld because they do not embed the pinned Node runtime and runtime manifest required by the sidecar (DF-38). DF-24 separately records the missing Unix selected-model snapshot write.

## Goal-vs-codebase review

Independent review (fresh agents, read-only, inspecting the tree not the session notes) against the plan Goal, clause by clause:

- Chatbot chrome (idle mic/persona, Context/picker split, full-word meta above bubble, caption rotator, selected row, persisted auto-title): LANDED with file:line evidence (ChatPage, ContextUsageBar/ComposerContextRow, MessageBubble/transcriptChrome, captionRotator/AgentStateOrb, FolderTree, titleGenerator/explorer rename).
- Image/Video history + visual meter: LANDED (header render-when-children both pages; StudioHistoryPane Chatbot copy; 12/12 studio rows carry visualTokenBudget; denominatorKind visual; DTO threaded). Note: 11/12 rows keep a pre-existing explicit `contextWindow: null` key - the locked reading is "do not invent an LLM window", and the root test pins `row.contextWindow ?? null` to be null, so LANDED under the intended reading. Built catalog copies (out/, sidecar dist/) are gitignored build artifacts regenerated by the installer rebuild below.
- Generate honesty: LANDED after one fix. The review found `allow_stub()` treated `NEXUS_DIFFUSION_ALLOW_STUB=1` as sufficient outside pytest (an OR-gate) with a test certifying the permissive behavior under a strict name - a genuine Goal miss. Fixed this phase: stub is pytest-only, flag alone refused, test asserts the refusal (BG-55). Typed kinds land at base.py/video_base.py/real_execute.py; resultGuard passes messages through verbatim; the combined string survives only as an envelope-less fallback. Residual: kind is prose-only on the wire (DF-37).
- Catalog identity: LANDED all five sub-clauses (pill order + omission discipline both surfaces, name-row placement in the DOM, Embeddings first both surfaces, Inkling-Small visible + never recommended, downloaded-first Settings vs pure installer order, dual-asserted fixtures). Watch items recorded as MT-5.
- Skills/Hub: LANDED (normalize at both compare sites, Sync-now row first, staged honest status, quarantine explainer, scanner on, one-pair waiver).
- Locks: LANDED (no thinking-orbs dependency; root `package.json` stayed 2.2.8 through Phase 7 and desktop stayed 1.5.0; release preparation later bumped only the root/Tauri product version to 2.2.9; no live-GPU CI job).

No unresolved Goal miss remains: the one MISS (stub gate) was fixed and tested; every PARTIAL is either resolved by the intended reading (contextWindow null keys), regenerated by the rebuild (built catalogs), or recorded as a known-gap (DF-37, MT-5).

## Human/manual testing suggestions

On the rebuilt unsigned Windows installer (DF-36 / plan operator field checklist):

1. Chatbot idle: no "Mic closed", no Persona label; Context bar wide, Gemma 4 12B fits the short picker.
2. Send `Hi`: rail title leaves "New chat" immediately; active row highlighted; "1 input token" + clock above the user text; assistant meta "N tokens (R reasoning + O output)" above the reply.
3. While composing: rotating Thinking/Searching/Working/Solving pill, no clock, no dash; reply replaces the pill.
4. Images/Videos: no empty top bar; history pane titled "Chats"; Context pill fills against the visual budget; attachment-free follow-up still img2imgs the last PNG.
5. Generate on this host: expect a typed message naming CUDA-missing vs weights-missing (the combined-only string is a miss); if CUDA torch and weights are present, expect a PNG (would close DF-4 - record it).
6. Installer Models vs Settings Models side by side: Embeddings tab first on both, identical name-row pills, Inkling-Small present on both, downloaded highlight + actions and downloaded-first order only in Settings.
7. Skills: no 3.21.0-to-v3.21.0 banner; Sync now at top; syncing shows the orb + staged status; Quarantined explains the scanner finding; scanner still on.

## Full-suite testing and stabilization

Final-phase runs (2026-08-27, after the stub-gate fix and ci.yml comment):

- `npm run lint:shell`: 0 errors.
- `python -m pytest tests/python -q`: 261 passed.
- Installer `uv run pytest tests/ -q -o "addopts="` (scripts/installer): exit 0 (1160 passed, 3 pre-existing opt-in skips) on the final release-preparation tree.
- `npm run test:shell`: `Test Files  182 passed (182)` / `Tests  1603 passed (1603)`.
- `npm test` (root): `Test Files  522 passed | 3 skipped (525)` / `Tests  5488 passed | 12 skipped (5500)`. (The WN-8 fixture mutation was restored afterward, as recorded.)
- `npm run check:tampering`: 0 findings.

## Release preparation (2026-08-28)

- Candidate feature boundary: `9f155e56f3243946b77cb3ead03f247deb865616`. The two later v2.3 planning commits on `develop` are intentionally excluded.
- Approved legacy integration exception: v2.2.9 feature commits landed directly on `develop` without a pull request. Release preparation records the exception and does not rewrite history.
- Approved field-QA deferral: the final unsigned Windows installer was rebuilt as `dist/NexusSetup.exe` (230.3 MB, SHA-256 `7C622166DED5EF5F3792D54A378DCE2E2A48E4DE751950A32E28389B5CC531F8`) and passed the version, bundled-registry, and embedded-desktop-payload probes. Archive inspection found exactly one embedded `nexus-coding-2.2.9-win32-x64.vsix`. Operator checklist items 1-7 were not observed and remain DF-36; live GPU generation remains DF-4.
- Amended release-note candidate: the previously approved feature notes remain unchanged, but packaging audits require two material compatibility disclosures before publication. The optional extension requires Microsoft stable VS Code 1.134.0 exactly and bundles `better-sqlite3` 12.11.1 for Electron 42.8.1; the Windows wizard offers and installs it only when that exact host is detected. The packaged desktop application is Windows-only in v2.2.9 because raw Tauri bundles do not embed the exact Node 22.11.0 runtime required by the sidecar; macOS and Linux receive the platform VSIX only. This amended note requires renewed approval at the publication gate. No opt-in capability or installer flag changes, and the Windows desktop application is unaffected by the VS Code host pin.
- Release packaging blocker fixed before publication: `.github/workflows/release.yml` and shippable VSIX jobs now call `scripts/build-vsix.ps1`, whose mandatory `@electron/rebuild` step emits a host-qualified archive for the one supported VS Code 1.134.0 Electron ABI before `vsce package`. The Electron target is fail-closed and cannot be overridden. Static installer packaging tests prevent workflows from returning to direct `vsce package --no-dependencies` or installers from selecting a generic or cross-host VSIX.
- Artifact-hygiene blocker fixed before publication: `.vscodeignore` excludes tracked `.nexus/` session state, agent/harness files, test caches, logs, and build-only configuration. `npx vsce ls` and the rebuilt archive report zero forbidden entries; 48 focused packaging tests pass.
- Fresh local gates: Windows bootstrap 5/5; root Vitest 522 files / 5488 tests with 88.56% lines, 83.61% branches, and 91.35% functions; desktop Vitest 182 files / 1603 tests with 88.61% lines, 83.15% branches, and 80.49% functions; Python 261 passed; installer 1160 passed / 3 skipped; Rust 18 passed plus check/clippy; shell lint/typecheck/sidecar/web builds; security, naming, prompts, docs-layout, dependency architecture, production audit, cleanup, and Tauri version-sync gates all pass. The package test run reproduced WN-8 timing drift, which was restored before commit.
- Local VSIX proof: `nexus-coding-2.2.9-win32-x64.vsix`, 160370603 bytes with 8843 archive entries, SHA-256 `096A212ECCA93624ACF5FBF3ABA971B226D4B65A55C8A1DC409836DF47C2FF60`. Both archive manifest surfaces report 2.2.9, the target is `win32-x64`, and the extension engine is exact VS Code 1.134.0. The required `extension/node_modules/better-sqlite3/build/Release/better_sqlite3.node` entry is 1920512 bytes, SHA-256 `24E2E3CA5A829572239718FBCA35B873BA4975655D29C56A93F1880E3775D9B8`, and was rebuilt for Electron 42.8.1 / ABI 146. The exact-host runtime smoke opened and queried an in-memory native SQLite database, activated the extension, and confirmed its commands were registered without safe mode or an ABI marker.
- Workflow contract proof: the manual Windows installer rehearsal now builds the exact current-version Tauri payload before freezing; macOS/Linux Python-installer workflows are manual non-release rehearsals with no tag trigger. The tag workflow retains the Windows Tauri bundle only as a private `NexusSetup.exe` input and publishes no raw Tauri bundle.
- Existing remote evidence at the feature boundary is green: full CI, Installer tests, and Shell Build at `ecf818d`; CI at `9f155e5`. Fresh remote checks for the release-metadata/workflow commit remain required before publication.
- Release asset contract: five attachments total - three OS/architecture-qualified VSIXes, `NexusSetup.exe`, and `SHA256SUMS.txt`. Raw Tauri bundles and incomplete macOS/Linux Python installer artifacts are excluded.
- Tagging, pushing, GitHub Release publication, main integration, and the develop backmerge remain pending separate approval.

### Publication handoff (pending approval)

1. Push `release/v2.2.9` and require the fresh CI, Installer Tests, and manual Shell Build checks to pass on the exact release-preparation commit.
2. Create and push annotated tag `v2.2.9` on that verified commit before integrating it into `main`; allow `release.yml` to publish only the five tag-bound assets listed above.
3. Integrate `release/v2.2.9` into `main` with a history-preserving merge commit. Do not squash or rebase the release commit because semantic-release must see `v2.2.9` in the resulting ancestry.
4. Verify `git merge-base --is-ancestor v2.2.9 origin/main` exits 0 before accepting semantic-release's `main` run, and confirm that run creates no additional version or tag for the already released commits.
5. Merge `main` back into `develop` with history preserved, resolve in favor of retaining the existing v2.3 planning commits, and rerun the post-merge branch checks.
