# Last-phase evidence - v2.4.7 Installer Wizard Density and Scope

**Date**: 2026-09-06
**Branch**: `feat/v2.4.7-installer-wizard-density-and-scope` (off `develop` at `8499c05d`)
**Plan**: `docs/v2/v2.4/plans/v2.4.7-installer-wizard-density-and-scope.md`
**Phase**: 5 - Evidence, known gaps, CI/CD, integration, and installer rebuild
**Commits under review**: `e11063f7` (P1), `b082ad2a` (P2), `c950c64f` (P3), `04b7ef12` (P4)

---

## Architecture refactor

```
$ find core modules desktop/src runtimes scripts docs -type d -empty | grep -v node_modules
modules/coding/skills/catalog/__nonexistent_user__
modules/coding/skills/catalog/__none__
```

Unchanged across v2.4.4 through v2.4.7: both are untracked byproducts of `SkillLoader` tests that deliberately point at nonexistent paths. `git ls-files` lists neither, and the next suite run recreates them.

**One real finding, fixed.** `docs/v2/v2.4/known-gaps.md` carried a stray empty `## v2.4.5` heading immediately above the real one, left by an earlier cycle. A duplicate heading in the ledger the next plan reads is a navigation defect, so it was removed. Section order is now clean:

```
11:## v2.4.7   56:## v2.4.6   136:## v2.4.5   181:## v2.4.4
259:## v2.4.3  325:## v2.4.2  384:## v2.4.1
```

**Deprecated / obsolete files**: none. **Redundant files or directories**: none. **Overcomplicated structure**: none introduced. Nothing moved, so no reference needed repair. This cycle added one engine module, two test modules, four session histories, one plan, and this evidence file, all inside existing trees.

Two untracked files from an earlier session sit at `docs/v2/v2.5/` (a comparison and an adoption plan for a diffusion-studio editor). They belong to no v2.4 cycle and were deliberately left untracked rather than swept into this plan's commits.

---

## Known-gaps reconciliation

`docs/v2/v2.4/known-gaps.md` gained a `## v2.4.7` section: 1 MT row, 2 DF rows, 1 resolved BG row.

**BG-1 is closed on code evidence.** The defect and its origin are both recorded plainly: the contradiction was introduced by this project in v2.4.5, and v2.4.5's own tests missed it because every fixture made the report cover exactly the selection, so catalog-wide and selection-scoped sizes coincided. The row names the guard property that now prevents a third occurrence - every fixture in `test_selection_scoped_sizing.py` uses a catalog strictly wider than the selection, and both pre-existing fixture helpers were rebuilt with the same property. Packaged confirmation is owed and stays open as MT-1.

Two DF rows record deliberate omissions rather than oversights: an already-installed Ollama still reads as "will be installed" (wording, not behavior - the step is idempotent), and category labels are not coloured chips (the counter row delivers the separation the operator asked for; recolouring carries a palette decision with no correctness content).

**Every earlier row carries forward.** v2.4.4, v2.4.5 and v2.4.6 operator items all remain unobserved, and the reason is the same one that has held since v2.4.4: no installer built since then has been field-tested. This rebuild is the first opportunity for all of them. v2.4.4 DF-1 (Wan and SDXL not re-smoked on the 0.36.0 Diffusers pin) remains the widest-blast-radius open item in the series.

The glob covered 32 `docs/**/known-gaps.md` files; the seven with `in-progress` status or remaining Open Items were read against this cycle's observations and none had a row this cycle observed.

---

## Living docs architecture

```
docs/handbooks/{README.md, markdown/, html/, technical/}
docs/decisions/README.md
docs/README.md   docs/DEVLOG.md   docs/todos.md
$ ls -d docs/testing docs/validation   ->   neither exists (correct)
```

Required shape present. `docs/handbooks/technical/installer-runtime.md` documents the provisioning runtime; this cycle changed wizard questions and layout, not provisioning, and the engine contract (`components_to_install` as the executed step list) is unchanged, so no handbook edit was warranted. Markdown and HTML did not disagree, so no regeneration was needed.

All new and edited documents pass `validate_unicode_safety.py --strict`.

---

## Git-tree hygiene

```
$ python scripts/check_release_preconditions.py --branches --repo-settings
[branches]
current=feat/v2.4.7-installer-wizard-density-and-scope
head=04b7ef12cc4a
protected_checkout=no
working_tree=dirty
origin=https://github.com/bendourthe/Nexus-AI.git
upstream=(none)
local_count=25
merged_into_head_count=22

[repo-settings]
status=observed
repository=bendourthe/Nexus-AI
default_branch=main
```

Report only; no branch deleted. `working_tree=dirty` is this evidence file being written plus the inherited `tests/fixtures/memory-tier-benchmark-results/2026-05-26/results.json` timing rewrite, which is deliberately left unstaged - no line of it traces to this plan. `upstream=(none)` is expected for a branch not yet pushed.

---

## CI/CD coverage

Provider: GitHub Actions, 19 workflows. This is a **conformance re-check**, not an authoring pass; v2.4.4 performed the terminal reconciliation.

| Field | Status this cycle |
|---|---|
| Develop-targeted PR coverage | **Still in force.** v2.4.4 QG-1 added `develop` to the `pull_request` filter of ci, shell-build, installer-tests, coverage-diff and pr-quality. Confirmed unchanged; this branch's PR runs the full merge-result gate |
| Path scoping for this cycle | `installer-tests.yml` already scopes `scripts/installer/**`, which covers every file this plan touched plus both new test modules |
| Always-resolving aggregate required check | **Still absent** in `ci.yml` (17 top-level jobs, no aggregate). Carried from v2.4.4 |
| Top-level `permissions:` in `ci.yml` | **Still absent.** Carried from v2.4.4 |
| Everything else | Unchanged from the v2.4.4 comparison |

**No pipeline file was edited in this cycle.** The two open findings are carried v2.4.4 items, not new drift. Cross-installer parity was not executed: this cycle changes wizard logic shared by all three installers, so parity is unaffected by construction, but that is reasoning rather than an executed gate and is recorded as such.

---

## Goal-vs-codebase review

**Plan Goal, restated**: the installer states one consistent size for a selection, asks only the questions a user can meaningfully answer, and presents Install Path, Configuration and Review at a density that fits the window.

Inspected against the tree rather than the checklists:

| Goal slice | Artifact | Verdict |
|---|---|---|
| One consistent size | `state.pending_models_gb`, written in `_update_selection_state` beside `selected_models_gb` | Landed |
| Guard sizes the selection | `pending_download_gb` returns the state field; `window.py` unchanged | Landed |
| Footer and per-model affordability agree | `disk_aware_footer` and `can_select_model` read the same figure | Landed |
| Install time from the corrected size | `_estimate_html` keys off pending; the "under 5 minutes" band now fires | Landed |
| Only answerable questions | `engine/required_components.py` + the read-only list; two settings toggles removed | Landed |
| No silent breakage | Ollama and the Python env derive from the selection, with a stated reason each | Landed |
| Full-width path with Browse inside | `install_path.py` overlays `_browse_btn` on `_path_input`, repositioned on resize | Landed |
| Ollama URL in the column | `_ollama_url` is a child of `_components_col`; heading removed, accessible name kept | Landed |
| No VS Code paragraph | Hidden in compact mode; text preserved as the disabled checkbox's tooltip | Landed |
| Facts left, one-line storage | `_estimate_html` renders into `facts_html`; the already-downloaded total trails on the same line | Landed |
| Summary distinct from categories | `_summary_counters_html` at `FS_H2` above the category groups | Landed |

**Gaps found**: none where the code fails the Goal. Every slice has an artifact and a test that fails against the previous behavior.

**The limit is the same one every cycle since v2.4.4 has hit.** The Goal describes a wizard a person operates, and none of it has rendered in the packaged window - Qt geometry and rich-text layout do not resolve headlessly. That is MT-1, not a pass, and it is why this plan ends in a rebuild rather than a release.

---

## Human/manual testing suggestions

The rebuilt installer carries v2.4.1 through v2.4.7. Items 6-11 are inherited and have never been observed, because no installer since v2.4.4 has been field-tested successfully.

1. **The contradiction is gone.** With everything already downloaded, Review must show `TO DOWNLOAD 0` and an overhead-only storage figure (~2 GB), never a large number beside a zero count. Install should proceed.
2. **The guard was fixed, not disabled.** Select several large models you do **not** have, enough to exceed free space, and confirm the wizard still refuses. This matters more than item 1: a relaxation that always says yes would pass item 1 perfectly.
3. **Install Path.** The field spans the window with Browse inside it at the right edge. Type a long path and confirm the text does not run under the button.
4. **Configuration.** A "Will be installed" list with a reason per line, three real checkboxes (VS Code extension, Start Menu shortcut, Unsloth), the Ollama URL directly under Ollama at column width with no heading, and no thinking-mode or persistent-memory toggles. Deselect all Image/Video/Audio models and confirm the Python environment drops off the list.
5. **Review density.** Install path, components, GPU, storage and time in the left column; storage on one line; a counter row (SELECTED / READY / TO DOWNLOAD) visually distinct from the category groups beneath it.
6. **Chat/Agents pending chrome** on the assistant gutter, glow uncropped at 100% and 150% zoom.
7. **Sidebar history**: hairline centered under Videos, selected title tight to the blue rail, Archive All / Delete All acting on the whole list including collapsed folders.
8. **Image restyle**: generate a puppy, then "Make the puppy black." with the period. Black fur, same composition, not a reprint.
9. **SANA and the pin**: a clip or a written `diffusers-missing` sentence naming the class and version, never a raw ImportError. Then **re-smoke Wan 1.3B and one SDXL model** on the 0.36.0 pin (v2.4.4 DF-1).
10. **Wan liveness**: the window stays clickable, the orb keeps moving, the caption reads Creating / Crafting / Generating, and the turn ends in a clip or a written error.
11. **Settings Models**: tabs and search on one row, one centered action row, cards hugging their content, Details showing pills plus a Best for list.

---

## Full-suite testing and stabilization

```
$ npm rebuild better-sqlite3                      rebuilt (Electron ABI from the last VSIX build)
$ npm run lint                                    PASS
$ npx tsc -b                                      PASS
$ npm run check                                   0 error, 54 warning; baseline 56 matched, 0 stale
$ npx vitest run --config configs/vitest.config.ts
  Test Files  534 passed | 3 skipped (537)
  Tests       5782 passed | 12 skipped (5794)
$ desktop: npm run lint, npm run typecheck        PASS
$ desktop: npx vitest run
  Test Files  212 passed (212)
  Tests       1979 passed | 1 skipped (1980)
$ python -m pytest tests/python -q                292 passed
$ PYTHONPATH=scripts/installer/src pytest scripts/installer/tests -q
                                                  100%, 0 failed, no fatal exception
$ python -m ruff check scripts/installer          All checks passed!
```

**Zero failures across every suite this cycle** - the first time in the 2.4 series that the root suite came back clean on the first attempt. `npm rebuild better-sqlite3` was run up front rather than after a confusing failure, applying the lesson recorded in v2.4.5: `build-vsix.ps1` leaves the native module compiled for Electron (ABI 146) and Node 24 needs 137.

**One self-inflicted failure worth recording.** The Phase 4 tests initially returned `ReviewPage` objects from a helper, and the full installer suite died at teardown with `Windows fatal exception: code 0x80010108` (COM `RPC_E_DISCONNECTED`). That is the identical trap v2.4.5 Phase 2 hit by storing a `QWidget` on a card record: Qt objects outliving `QApplication`. The helper now returns extracted text, so nothing holds a widget past the test that made it.

---

## Publication and integration

Published as [PR 63](https://github.com/bendourthe/Nexus-AI/pull/63) against `develop`.

**The first merge-result run was red on one check, and it caught a real gap.**

`Installer tests + lint + smoke` failed on `TestWizardDensityV247::test_detection_still_drives_the_checkbox`: the checkbox was disabled but its tooltip was empty.

Reproduced locally before any re-push, by injecting an unsupported detection:

```
enabled: False   tooltip: ''
```

The cause was mine. Phase 3 set the compact tooltip inside the detection *refresh*, but the checkbox's enabled state is also set at *construction*. On a host with no VS Code the page could therefore present a disabled control with no explanation at all -- which is exactly the failure the tooltip was introduced to prevent. Both paths now call one `_apply_detection_tooltip` helper.

**The test itself was the second defect, and the more instructive one.** It was written as `if not checkbox.isEnabled(): assert checkbox.toolTip()`, reading real host detection. On this machine VS Code is installed, so the branch never executed and the test passed while verifying nothing; it only ran on the Linux runner. It now injects both a supported and an unsupported detection and asserts both outcomes, so it runs identically on every host.

After the fix, locally:

```
$ PYTHONPATH=scripts/installer/src pytest scripts/installer/tests -q
100%, 0 failed, no fatal exception
$ python -m ruff check scripts/installer
All checks passed!
```

Required-check results are quoted below once terminal.

---

## Installer rebuild

*(Recorded after integration; the rebuild is this cycle's deliverable to the operator.)*
