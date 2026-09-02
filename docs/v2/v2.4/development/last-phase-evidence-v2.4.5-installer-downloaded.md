# Last-phase evidence - v2.4.5 Installer Already-Downloaded Models

**Date**: 2026-09-01
**Branch**: `feat/v2.4.5-installer-downloaded-models` (off `develop` at `e78d9d5a`)
**Plan**: `docs/v2/v2.4/plans/v2.4.5-installer-already-downloaded-models.md`
**Phase**: 5 - Evidence, known gaps, CI/CD, integration, and installer rebuild
**Commits under review**: `dedee998` (P1), `bffeb71b` (P2), `11f5a405` (P3), `afe86686` (P4)

---

## Architecture refactor

```
$ find core modules desktop/src runtimes scripts docs -type d -empty | grep -v node_modules
modules/coding/skills/catalog/__nonexistent_user__
modules/coding/skills/catalog/__none__
```

Unchanged from v2.4.4: both are untracked byproducts of running the test suite, created by `SkillLoader` tests that deliberately point at nonexistent paths. `git ls-files` lists neither. Removing them would be churn, since the next suite run recreates them.

**Deprecated / obsolete files**: none. **Redundant files or directories**: none. **Overcomplicated structure**: none introduced. Nothing moved, so no reference needed repair. This cycle added one engine module, two test files, four session histories, one plan, and this evidence file, all inside existing trees.

Finding: empty, with the scan quoted.

---

## Known-gaps reconciliation

`docs/v2/v2.4/known-gaps.md` gained a `## v2.4.5` section: 2 MT rows, 1 WN row, and 1 resolved BG row.

**BG-1 is the only thing closed, and it is closed on code evidence rather than observation.** The guard demonstrably now sizes the remaining download: `test_field_case_passes_the_guard` runs the exact reproduction (194.4 GB selected, 176.4 GB present, 201.0 GB free, reserve 10) and passes, while `test_the_same_selection_was_refused_before_the_fix` pins the old `204.4 GB` message so a regression is unambiguous. Packaged confirmation is still owed and is recorded as MT-1, so the row is resolved as a defect and open as an observation.

Two rows are new. **MT-1** covers everything this cycle built being unobserved in the packaged wizard. **MT-2** notes that the Ollama `/api/tags` branch is covered by an injected fake rather than a live daemon; a response-shape change would silently fall back to the manifest path, which is correct but slower.

**Every v2.4.4 row carries forward unchanged** - MT-1 through MT-6, DF-1, and WN-1. This is deliberate and worth stating plainly: v2.4.4's work has still never been observed, because the installer built at the end of that cycle could not be installed. That is precisely the defect this cycle fixes, so this rebuild is the first opportunity to observe any of it. v2.4.4 DF-1 (Wan and SDXL not re-smoked on the 0.36.0 Diffusers pin) remains the widest-blast-radius open item.

Glob over 32 `docs/**/known-gaps.md` files. The seven with `in-progress` status or remaining Open Items (`docs/v2/v2.3`, `docs/v2/v2.0`, `docs/v1/v1.20`, `docs/v1/v1.19`, `docs/v1/v1.8`, `docs/v1/v1.5`, `docs/v1/v1.3`) were each read against this cycle's observations; none had a row this cycle observed, so all are unchanged. No historical GPU or visual row was closed without new observation.

---

## Living docs architecture

```
docs/handbooks/{README.md, markdown/, html/, technical/}
docs/decisions/README.md
docs/README.md   docs/DEVLOG.md   docs/todos.md
$ ls -d docs/testing docs/validation   ->   neither exists (correct)
```

Required shape present and unchanged. `docs/handbooks/technical/installer-runtime.md` describes the installer runtime; this cycle changed installer *wizard* behavior (picker, Review, guard) rather than the provisioning runtime that document covers, so no handbook edit was required. Markdown and HTML did not disagree, so no regeneration was needed.

All new and edited documents pass `validate_unicode_safety.py --strict`.

---

## Git-tree hygiene

```
$ python scripts/check_release_preconditions.py --branches --repo-settings
[branches]
current=feat/v2.4.5-installer-downloaded-models
head=afe866861a2d
protected_checkout=no
working_tree=clean
origin=https://github.com/bendourthe/Nexus-AI.git
upstream=(none)
local_count=23
merged_into_head_count=20

[repo-settings]
status=observed
repository=bendourthe/Nexus-AI
default_branch=main
```

Report only; no branch deleted. `working_tree=clean` this cycle (the inherited benchmark-fixture edit is stashed on the previous branch, not carried here). `upstream=(none)` is expected for a branch not yet pushed.

---

## CI/CD coverage

Provider: GitHub Actions, 19 workflows. This is a **conformance re-check**, not an authoring pass; v2.4.4 performed the terminal reconciliation.

| Field | Status this cycle |
|---|---|
| Develop-targeted PR coverage | **Still in force.** v2.4.4 QG-1 added `develop` to the `pull_request` filter of ci, shell-build, installer-tests, coverage-diff, and pr-quality. Confirmed unchanged; this branch's PR will run the full merge-result gate |
| Path scoping for this cycle's changes | `installer-tests.yml` already scopes `scripts/installer/**`, which covers every file this plan touched | 
| Always-resolving aggregate required check | **Still absent** in `ci.yml` (17 top-level jobs, no aggregate). Carried from v2.4.4 |
| Top-level `permissions:` in `ci.yml` | **Still absent.** Carried from v2.4.4 |
| Everything else | Unchanged from the v2.4.4 comparison |

**No pipeline file was edited in this cycle.** The two open findings are carried v2.4.4 items, not new drift, and the plan's own rule is that a pipeline fix belongs to the phase that owns CI/CD reconciliation rather than a release-time rewrite. Cross-installer parity was not executed here; this cycle changes wizard logic shared by all three installers, so parity is unaffected by construction, but that is reasoning rather than an executed gate and is recorded as such.

---

## Goal-vs-codebase review

**Plan Goal, restated**: the installer counts only what it still has to download; models already present in either store are detected, auto-selected, and marked in the picker and on Review; Review lists models in two columns with a distinct mark for pending downloads and an estimate computed from pending alone; and the final guard is fed the remaining-download size, so re-running an install on a host that already holds its models is never blocked over bytes it will not fetch.

Inspected against the tree rather than the checklists:

| Goal slice | Artifact | Verdict |
|---|---|---|
| Counts only what it must download | `pending_download_gb` in `installed_models.py`, read by `window.py`, `disk_aware_footer.py`, and `can_select_model` | Landed |
| Detects both stores | `probe_installed_models` routes on `protocol_for`; huggingface via `model_weights_dir` + `.nexus-model-id`, ollama via `/api/tags` with a manifest fallback | Landed |
| Auto-selected | `_apply_downloaded_autoselect`, first-load only, deferring to `_user_touched` | Landed |
| Marked in the picker | Downloaded pill in `_ModelCard`, additional to the status badge | Landed |
| Two columns on Review | `_model_columns` renders a 50/50 table split down the middle | Landed |
| Distinct mark for pending | check vs down-arrow, differing in shape not only color, with a legend | Landed |
| Estimate from pending, under the models | `_estimate_html` in the models column; `facts_html` no longer carries it | Landed |
| Guard fed remaining size | `window.py:545` passes `pending_download_gb(self._state)` | Landed |
| Never blocked for bytes it will not fetch | `test_field_case_passes_the_guard` | Landed in code |

**Gaps found**: none where the code fails the Goal. Every slice has an artifact and a test that fails against the previous behavior.

**The honest limit is the same one v2.4.4 hit.** The Goal is about an installer a person runs, and nothing here has run in the packaged wizard. Nine of nine slices are proven only against pytest. That is recorded as MT-1 rather than counted as a pass, and it is why this plan's last sub-task is a rebuild rather than a release.

---

## Human/manual testing suggestions

The rebuilt installer carries v2.4.1 through v2.4.5. Items 5-10 are v2.4.4's, unobserved because that cycle's installer could not be installed.

1. **The blocked install.** Open the wizard with the same 14-model selection that previously refused. The Review page should report a small download, and Install should proceed. This is the whole point of the cycle.
2. **Marks and preselection.** On the Models step, already-downloaded models should appear checked with a **Downloaded** pill. Uncheck one, move to another tab and back: it must stay unchecked.
3. **Review layout.** Two columns; a check on each already-downloaded model and a down-arrow on the rest; a legend; and under the list, an estimate that names only the remaining download plus the already-downloaded total.
4. **Guard not merely disabled.** Select several large models you do **not** have, enough to exceed free space, and confirm the wizard still refuses. Then stop Ollama and reopen the picker: chat models must still show as Downloaded (the manifest fallback).
5. **Chat/Agents pending chrome** on the assistant gutter, glow uncropped at 100% and 150% zoom.
6. **Sidebar history**: hairline centered under Videos, selected title tight to the blue rail, Archive All / Delete All confirm and act on the whole list including collapsed folders.
7. **Image restyle**: generate a puppy, then send "Make the puppy black." with the period. Black fur, same composition, not a reprint.
8. **SANA and the pin**: SANA-Video plays a clip or fails with a written `diffusers-missing` sentence naming the class and version, never a raw ImportError. Then **re-smoke Wan 1.3B and one SDXL model** on the 0.36.0 pin (v2.4.4 DF-1).
9. **Wan liveness**: the window stays clickable, the orb keeps moving, the caption reads Creating / Crafting / Generating, and the turn ends in a clip or a written error.
10. **Settings Models**: tabs and search on one row, one centered action row, cards hugging their content, Details showing pills plus a Best for list and nothing else.

---

## Full-suite testing and stabilization

```
$ npm run lint                                    PASS
$ npx tsc -b                                      PASS
$ python -m pytest tests/python -q                292 passed
$ python -m ruff check scripts/installer          All checks passed!
$ PYTHONPATH=scripts/installer/src pytest scripts/installer/tests -q
                                                  100%, 0 failed, no fatal exception
$ npx vitest run --config configs/vitest.config.ts
  Test Files  526 passed | 3 failed | 3 skipped (532)
  Tests       5734 passed | 3 failed | 12 skipped (5749)
$ npx vitest run <those three files>              18 passed (3 files)
```

**Two environment findings, both disclosed rather than buried.**

**The VSIX build leaves `node_modules` unusable by the Node test suite.** The first root-vitest run of this phase reported **495 failures across 64 files**, every one an ABI mismatch:

```
better_sqlite3.node was compiled against a different Node.js version using
NODE_MODULE_VERSION 146. This version of Node.js requires NODE_MODULE_VERSION 137.
```

The cause is not a defect in this cycle's code. `scripts/build-vsix.ps1` rebuilds the native module **for Electron 42.8.1** (ABI 146) so the packaged extension works; Node 24 needs ABI 137. Building an installer therefore breaks the Node suite until `npm rebuild better-sqlite3` is run. This also retroactively explains the 33 failures observed at the start of the v2.4.4 session, which followed an earlier VSIX build. After rebuilding, failures dropped from 495 to 3.

**The remaining 3 are contention-sensitive performance budgets, not defects.** They are a 15-second consolidation budget, a p50/p99 retrieval latency budget, and one golden-runner case. Re-run in isolation on the same tree, all 18 tests in those three files pass. They failed only while heavy builds were running concurrently on this host.

---

## Publication and integration

Published once, with the operator's `/implement in-full` instruction as the authorization, and integrated on green.

```
$ gh pr checks 61
     42 pass
      1 skipping     (init.ps1 (Windows) -- path-gated, not applicable)
      0 fail
      0 pending

$ gh pr view 61 --json mergeable,mergeStateStatus
MERGEABLE / CLEAN
```

**[PR 61](https://github.com/bendourthe/Nexus-AI/pull/61) passed all 42 checks on the first push.** No red check, so the reopen-and-reproduce loop was not exercised this cycle. That is a direct benefit of v2.4.4's QG-1 fix: a develop-targeted pull request now runs the full merge-result gate, so 42 checks are meaningful where the same PR would previously have run only commitlint.

Merged into `develop` as `6fb7e1c2`.

---

## Installer rebuild

Rebuilt from the integrated branch, not from the feature branch, so the artifact is the merge result.

| Fact | Value |
|---|---|
| Artifact | `dist\NexusSetup.exe` (unsigned) |
| Size | 251,013,715 bytes (239.4 MB) |
| SHA-256 | `4BC5AACB445251C06D46E50B1244FEEF276E34E3D608AC50E8E190BF63EA1F24` |
| Source commit | `6fb7e1c2` (`develop`, merge of PR 61) |
| Contains | v2.4.1 through v2.4.5 |

Smoke passed all five assertions: single artifact, no leftover two-artifact wizard, and `--version` / `--check-registry` / `--check-desktop-payload` each exit 0.

**Verified by extracting the embedded archive, not by grepping the exe.** The v2.4.4 lesson was that a byte-grep of a PyInstaller onefile finds nothing and proves nothing, because the payload is compressed. Two checks were run against the actual embedded content:

```
installer-build\versions.lock.json   ->  diffusers==0.36.0
runtimes\diffusion\runtime-lock.json ->  diffusers==0.36.0

PYZ modules: nexus_installer.engine.installed_models   (this cycle's probe)
             nexus_installer.engine.install_guard
```

The lock files are CArchive data entries; the probe is Python bytecode inside `PYZ.pyz`, which is why a TOC-only search reported it missing before the PYZ was read. Both are present, so the artifact carries this cycle's fix and still carries v2.4.4's Diffusers pin.

**No version bump, tag, or release.** The package version stays 2.4.1. Nothing in the 2.4 series releases until the operator confirms field testing passed, and this repository's semantic-release automation on `main` makes a manual bump actively harmful (see the v2.4.4 last-phase evidence for the measured 2.4.0-vs-2.4.1 conflict).

Two build-time warnings, both pre-existing and by design:

- **Hub catalog snapshot refused** -- local catalog tag 4.3.0 is not latest (v4.4.0). `build-windows.ps1` deliberately refuses to embed a stale snapshot; the installer syncs latest at install time.
- **`sam2:hiera-tiny` remains an unpinned HF weight**, so that one download skips hash verification.
