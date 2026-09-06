# Last-phase evidence - v2.4.6 Field Delivery, Density, and Session Identity

**Date**: 2026-09-03
**Branch**: `feat/v2.4.6-field-delivery-density-and-session-identity` (off `develop` at `3fb8a04f`)
**Plan**: `docs/v2/v2.4/plans/v2.4.6-field-delivery-density-and-session-identity.md`
**Phase**: 8 - Architecture refactor, known-gaps, CI/CD
**Commits under review**: `fb7d8ddd` (P1), `2637eb6e` (P2), `71cdec11` (P3), `0ef11b38` (P4), `b213ea66` (P5), `8ece62fd` (P6), `2ed66da9` (P7)
**HEAD**: `2ed66da91839`

---

## Architecture refactor

```
$ Get-ChildItem -Path core,modules,desktop/src,runtimes,scripts,docs -Recurse -Directory
  | Where-Object { -not $_.GetFileSystemInfos() -and $_.FullName -notmatch 'node_modules' }

modules\coding\skills\catalog\__nonexistent_user__
modules\coding\skills\catalog\__none__
```

Unchanged from v2.4.5: both are untracked byproducts of `SkillLoader` tests that point at nonexistent paths. `git ls-files` lists neither. Removing them would be churn; the next suite run recreates them.

**Deprecated / obsolete files**: none introduced by this cycle. **Redundant files or directories**: none. **Overcomplicated structure**: none introduced. Nothing moved, so no reference needed repair. This cycle added installer, VS Code, and desktop files inside existing trees, plus session histories, this evidence file, and plan/gap updates.

Finding: empty, with the scan quoted. Propose-then-apply: no moves requested.

---

## Known-gaps reconciliation

`docs/v2/v2.4/known-gaps.md` `## v2.4.6` holds 7 MT rows and 2 WN rows. None is closed on unit tests.

| Id | Disposition |
|---|---|
| v2.4.6 MT-1..MT-7 | Open. Packaged installer, VSIX, Sessions History, Settings cards, and four-tab chrome are not observed on the operator host. |
| v2.4.6 WN-1, WN-2 | Open. Stale-NSIS mtime hole; Electron ABI for 1.136 inferred from 1.134/1.135. |
| v2.4.5 MT-1, MT-2, WN-1 | Carry forward. Packaged wizard and live Ollama `/api/tags` still unobserved. |
| v2.4.4 MT-1..MT-6, DF-1, WN-1 | Carry forward until this cycle's rebuilt installer is observed. Do not close because source exists. |

Glob: 31 files at `docs/**/known-gaps.md`. Canonical `docs/releases/v<MAJOR>/v<MAJOR>.<MINOR>/known-gaps.md`: **0 files** (legacy two-level `docs/v*/v*/known-gaps.md` is the live layout).

Files with Status in-progress or remaining Open Items, read against this cycle: `docs/v2/v2.4`, `docs/v2/v2.3`, `docs/v2/v2.0`, `docs/v1/v1.20`, `docs/v1/v1.19`, `docs/v1/v1.8`, `docs/v1/v1.5`, `docs/v1/v1.3`. None had a row this cycle observed in a packaged artifact, so all are unchanged.

---

## Living docs architecture

```
docs/handbooks/{README.md, markdown/, html/, technical/}
docs/decisions/README.md
docs/README.md   docs/DEVLOG.md   docs/todos.md
$ npm run docs:handbooks:check
generate-handbooks: 5 source(s) match
$ Test-Path docs/testing, docs/validation
False False
```

Required shape present. This cycle changed installer wizard chrome and desktop pickers/runtime, not the provisioning runtime documented in `docs/handbooks/technical/installer-runtime.md`, so no handbook edit was required. Markdown and HTML match (`docs:handbooks:check` exit 0). `docs/testing/` and `docs/validation/` were not invented.

---

## Git-tree hygiene

```
$ python scripts/check_release_preconditions.py --branches --repo-settings
[branches]
current=feat/v2.4.6-field-delivery-density-and-session-identity
head=2ed66da91839
protected_checkout=no
working_tree=dirty
origin=https://github.com/bendourthe/Nexus-AI.git
upstream=(none)
local_count=24
merged_into_head_count=21

[repo-settings]
status=observed
repository=bendourthe/Nexus-AI
default_branch=main
private=false
archived=false
issues_enabled=true
delete_branch_on_merge=false
default_branch_protection=unavailable
protection_reason=gh: Branch not protected (HTTP 404)
```

Report only; no branch deleted. `working_tree=dirty` is the unrelated fixture `tests/fixtures/memory-tier-benchmark-results/2026-05-26/results.json` (not part of this plan). `upstream=(none)` is expected until the first push. `default_branch_protection=unavailable` is the same GitHub 404 observed in v2.4.5.

---

## CI/CD coverage

Provider: GitHub Actions. This is a **conformance re-check**, not an authoring pass. `git diff develop --name-only -- .github` is empty. No pipeline file changed in Phases 1-7.

| Field | Status this cycle |
|---|---|
| Detect | GitHub Actions (ci.yml, shell-build.yml, installer-tests.yml, coverage-diff.yml, pr-quality.yml, installer-build.yml, release.yml, nightly.yml, and siblings) |
| Develop-targeted PR coverage | Still in force from v2.4.4 QG-1 (`develop` on `pull_request` for ci, shell-build, installer-tests, coverage-diff, pr-quality) |
| Path scoping | Desktop tests are already run by ci.yml `npm run test:shell` (Node 22). Installer tests already scope `scripts/installer/**`. VS Code tests are existing `npx vitest` / test-ts paths |
| Always-resolving aggregate required check | Still absent in `ci.yml`. Carried from v2.4.4. Not applied here without explicit approval |
| Top-level `permissions:` in `ci.yml` | Still absent. Carried from v2.4.4. Not applied here without explicit approval |
| Immutable action refs, concurrency, caching | Unchanged from the v2.4.4 / v2.4.5 comparison |
| Cross-installer parity | Silent no-op for a field-by-field rewrite. One Windows `NexusSetup.exe` plus platform VSIX artifacts; no second wizard topology. Real OS installer execution is the Phase 8 rebuild after merge, not a mid-phase pipeline edit |

**No pipeline file was edited.** The two open structural findings (aggregate required check, top-level permissions) remain declined/carried unless the operator approves them before the integration PR.

---

## Tier 3 deep pass

### Tier 3 blast-radius verdict

- **Verdict**: run
- **Diff evidence**: installer Python/Qt (`scripts/installer/**`), VS Code owned-agentic picker (`src/activation`, `modules/coding/config`, `core/registry/ownedSelection.ts`), desktop Chat/Agents/Image/Video/Settings (`desktop/src/**`, `desktop/sidecar/**`), living docs
- **Reason**: user-facing UI, installer wizard, extension picker, and persistence/scheduler boundaries changed
- **Ambiguity check**: none; classification is run

### Inventory (operator Goal slices)

| Feature | Source | Artifact | Real boundary | Evidence status |
|---|---|---|---|---|
| Maximized first show | P1 | `present_installer_window` / `showMaximized` | NexusSetup.exe | unit only (MT-1) |
| Stale desktop payload fail-closed | P1 | `build-windows.ps1` fingerprint | installer build | unit only (MT-1) |
| Setup two-column + GPU one-liner | P2 | `prerequisites.py`, `gpu_detection.py` | wizard Setup | unit only (MT-2) |
| Unsloth Compatible default-on | P3 | `configuration.py` | wizard Configuration | unit only (MT-3) |
| VS Code 1.136 Features checkbox | P3 | `extension_installer.py` | wizard + VSIX | unit only (MT-3) |
| Review grouped by catalog | P3 | `review.py` | wizard Review | unit only (MT-3) |
| VS Code owned agentic picker | P4 | `ownedAgenticPicker.ts`, `ownedSelection.ts` | VSIX command | unit only (MT-4) |
| Sessions History chrome | P5 | `FolderTree.tsx`, `Sidebar.tsx` | packaged desktop | unit only (MT-5) |
| Settings compact cards | P6 | `ModelsSettings.tsx` | packaged Settings | unit only (MT-6) |
| Four-tab allowlist + recommend order | P7 | `selectionPolicy.ts`, `QuickModelSwitcher.tsx` | packaged pickers | jsdom (MT-7) |
| Stop, captions, Advanced, RealVis | P7 | `MediaComposer.tsx`, `mapping.ts`, `ImageStudioPage.tsx` | packaged studios | jsdom (MT-7) |
| GPU busy + System32 nvidia-smi | P7 | `gpuRuntime.ts`, `liveTelemetry.ts`, `handlers.ts` | packaged footer | jsdom + sidecar unit (MT-7) |

Rendered-surface delegates for the packaged Tauri window: `NOT COVERED: [[browser-testing-with-devtools]] / detect_visual_defects.py unavailable against Nexus.exe`. Adversarial pass: `NOT COVERED: [[adversarial-verifier]] unavailable - whole-plan hostile stress testing`. Hostile leftover-id exclusion is covered by `owned-picker-allowlist.test.tsx` and VS Code owned-agentic tests, which is a unit boundary, not a packaged attack.

Plan sufficiency: the operator-item table has an artifact per row. The remaining miss is packaged observation, recorded as MT-1..MT-7 rather than a Goal-review pass.

---

## Goal-vs-codebase review

**Plan Goal, restated**: The installer opens maximized and is dense on Setup, Configuration, and Review; Unsloth is checked when Compatible; the VS Code extension is a default-on feature that installs on current VS Code and uses the same installer-or-Settings-owned agentic models as the desktop; the packaged desktop that this installer writes is the desktop from this tree; Sessions History is always labeled Session (except the Chatbot tab); Settings cards are compact with no Details accordion; Chat, Agents, Image, Video, and VS Code pickers show only models the user selected in the installer or installed later in Settings > Models, in recommend order, plus a Stop control, equal gutters, assistant token counts, rotating studio captions, Advanced settings on the Context/Model row, and a GPU footer that is busy when a request is running.

Inspected against the tree rather than the checkboxes:

| Goal slice | Artifact | Verdict |
|---|---|---|
| Maximized installer | `scripts/installer/src/nexus_installer/main.py` `showMaximized` | Landed in code |
| Dense Setup | two-column prereqs, title-row Re-check, one-line GPU | Landed in code |
| Unsloth Compatible checked | `configuration.py` first `showEvent` | Landed in code |
| VS Code 1.136 Features default-on | `extension_installer.py` | Landed in code |
| No Gemma/Video2X Configuration copy | configuration page tests | Landed in code |
| Categorized Review | `review.py` group headings | Landed in code |
| Fingerprinted desktop payload | `build-windows.ps1` + Settings fingerprint | Landed in code |
| VS Code owned agentic picker | `ownedSelection` + picker command | Landed in code |
| Sessions History / Session nouns | `FolderTree.tsx` | Landed in code |
| Compact Settings, no Details | `ModelsSettings.tsx` | Landed in code |
| Four-tab allowlist + recommend order | `ownedIdSet` empty-on-null, `QuickModelSwitcher` | Landed in code |
| Assistant tokens | `ChatPage.tsx` persist `messageUsage` | Landed in code |
| Stop on four tabs | `MediaComposer` / `CodingInput` `onStop` | Landed in code |
| Creating/Generating not Shaping | `mapping.ts` labels | Landed in code |
| Advanced on context row | `ComposerContextRow.trailing` | Landed in code |
| Image default RealVis when owned | `resolveDefaultId` + ImageStudioPage test | Landed in code |
| GPU busy while a job is active | scheduler enqueue + `idle = active === null` | Landed in code |

**Gaps found**: none where source fails the Goal. Every slice has an artifact and tests. **The honest limit is packaged observation.** The Goal is about NexusSetup.exe and the frozen desktop. That is MT-1 through MT-7, not a silent pass. Juggernaut (`juggernaut-xl-v9`) is a real catalog id that the wizard may auto-tick because weights are on disk; it is not a ghost picker row.

---

## Human/manual testing suggestions

The rebuilt installer must use a **fresh** `desktop` `npm run build:shell` immediately before `build-windows.ps1`. After a VSIX rebuild, `npm rebuild better-sqlite3` before Node tests. Confirm `process.versions.electron` on VS Code 1.136.0 before pinning ABI (WN-2).

1. Installer first show is maximized; About/Settings fingerprint matches the payload manifest.
2. Setup: two-column prereqs, Re-check icon on the title row, GPU name/vendor/VRAM on one line.
3. Configuration: Unsloth checked when Compatible; VS Code Features checked for 1.136; no Gemma sampling or Video2X paragraph.
4. Review: models grouped by catalog section; `juggernaut-xl-v9` under Image if ticked.
5. `code --install-extension` the rebuilt VSIX on Microsoft VS Code 1.136.0; Select Agentic Model has no leftover Ollama tags; default Gemma 4 12B when owned.
6. Empty and filled Sessions History: title visible, centered hairline, Session copy, Chatbot tab unchanged.
7. Settings Gemma 4 12B three-line card, no Details, one centered action row.
8. Chat: equal gutters, assistant `(N tokens)`, Stop while streaming, leftover ids absent, Gemma 4 12B before LFM and gpt-oss among owned ids.
9. Image: RealVis selected on this 16 GB host when owned; Creating/Crafting/Generating (never Shaping); Advanced on the Context/Model row; Stop cancels the job.
10. GPU footer is not Idle 0% during a live Chat or Image turn. Composer Context 0% on an empty session may stay.

Carry v2.4.4 / v2.4.5 items that this rebuild is the first chance to see: downloaded marks and remaining-download guard (v2.4.5), restyle identity, SANA-Video, Wan/SDXL pin (v2.4.4 DF-1).

---

## Full-suite testing and stabilization

Phase 7 (desktop, 2026-09-03):

```
$ npm run lint --workspace @nexus/desktop     PASS (max-warnings 0)
$ npm run typecheck --workspace @nexus/desktop PASS
$ npm run test:coverage --workspace @nexus/desktop
  Test Files  212 passed (212)
  Tests       1979 passed | 1 skipped (1980)
  All files   lines 86.89%
$ npm run test --workspace @nexus/desktop     1979 passed | 1 skipped (8.2 re-run)
```

Installer and extension suites were green at their phase commits (`fb7d8ddd` through `0ef11b38`). A VSIX rebuild on this host still requires `npm rebuild better-sqlite3` before Node tests (Electron ABI 146 vs Node 137). Do not treat a post-VSIX ABI storm as a product defect.

---

## Publication and integration

PR: https://github.com/bendourthe/Nexus-AI/pull/62 against `develop` (opened 2026-09-04). Branch published at `e1f399c6`. Package remains 2.4.1. `/update release` is held until this PR is merged. Required checks on the stabilization push are green (installer tests, Shell ubuntu-latest, production npm audit included). `init.ps1 (Windows)` is skipped on `pull_request` by design. Merged into `develop` as `8499c05d` on 2026-09-06 after explicit operator approval, with 42 checks pass / 0 fail / 1 path-gated skip and `MERGEABLE / CLEAN`.

First merge-result run was red on three checks. Each was reproduced locally before the re-push (`e1f399c6`):

1. `Installer tests + lint + smoke` -- compact GPU elide truncated `'16 GB VRAM'` mid-token, leaving `16 G` plus a rendered ellipsis. Fix: elide the GPU name, keep vendor + VRAM. Local: 9 GPU page tests passed.
2. `Shell ubuntu-latest` -- Vite `build:web` failed on `readFileSync` from `desktopPayload.ts`. Fix: Node I/O in `desktopPayloadFs.ts`. Local: `npm run build:web` 1792 modules.
3. `npm audit (production deps)` -- `qs` CVE-2026-82562 (6.16.0) and `fast-uri` GHSA-qw65-cvwx-89v3 (3.1.7). In-range overrides. Local: `check:audit-prod` 0 blocking.

---

## Installer rebuild

Local field-test freeze from the implemented feature tip (not from merged `develop`; PR 62 is green and unmerged). Sequence: `scripts/build-vsix.ps1 -SkipTests`, then immediately `cd desktop; npm run build:shell`, then `scripts/installer/build/build-windows.ps1 -SkipSign`, then `scripts/installer/build/smoke-windows-exe.ps1`. After the VSIX, `npm rebuild better-sqlite3` restored the Node ABI.

| Fact | Value |
|---|---|
| Artifact | `dist\NexusSetup.exe` (unsigned) |
| Size | 251,048,432 bytes (239.4 MB) |
| SHA-256 | `17DD4CA5A2E2C1AB8BD140761FD2C74D5C429CD8A329D6D6F24C3ECEE9052021` |
| Source commit | `e1f399c6` (`feat/v2.4.6-field-delivery-density-and-session-identity`) |
| Staged desktop NSIS | `Nexus AI Studio_2.4.1_x64-setup.exe` |
| Payload sha256 | `5d55ffb1903f4c39626a3702dbedc4c3b8420ef1e5bab2f2531af57444d992fa` |
| Payload source_mtime_utc | `2026-09-04T04:49:57Z` |
| VSIX | `nexus-coding-2.4.1-win32-x64.vsix` |

Smoke passed all four assertions: single artifact, no leftover two-artifact wizard, `--version` / `--check-registry` / `--check-desktop-payload` each exit 0.

Build-time warnings, both pre-existing and by design:

- Hub catalog snapshot refused (local catalog tag 4.4.0 reported as not latest). The installer syncs Hub at install time.
- Placeholder HF weight pins remain (`dist/pin-check.log`); those downloads skip hash verification (`sam2:hiera-tiny` class).

**No version bump, tag, or GitHub Release.** Package version stays 2.4.1.
