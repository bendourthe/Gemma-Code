# v1.9.0 Phase 6 (FINAL) -- Cross-platform rehearsal + docs + close-out

**Date**: 2026-07-04
**Plan**: [installer-and-app-experience-overhaul.md](../../plans/installer-and-app-experience-overhaul.md) (Phase 6, T601-T603)
**Scope**: verification + close-out only -- no feature code. Re-prove the single-artifact installer build a second time, disposition every "-> Phase 6" known gap, defer the environmentally-blocked legs, and land the whole-plan close-out (plan status, known-gaps, DEVLOG, install.md, todos).

## Summary

Phase 6 closes the v1.9.0 cycle. The Windows single-artifact build was re-proven from scratch (a second independent proof after Phase 1): a clean PyInstaller onefile rebuild produced exactly one `dist/NexusSetup.exe` and the packaging smoke was all-green. The installer pytest suite is green (651 passed / 2 skipped / 0 failed). Every open known gap was reviewed: the Windows build leg of `IAE.P1.B` is re-closed, and the remaining items are all environmentally blocked in this headless, single-OS, no-egress sandbox -- the 3-OS on-device visual/behavioral rehearsal (no mac/Linux hardware, no clean VM, no GUI surface) and the post-freeze CI legs (Actions freeze until 2026-08-01) -- so they stay recorded operator/dispatch rehearsals, the same disposition as v1.8.0's `OSI006.P6.A/C`. The whole-plan DoD (Section 0's seven observables) is met locally + by construction.

## What was done

### T601 -- Windows single-artifact build re-proof

- **Full rebuild from scratch.** A clean PyInstaller onefile build (`pyinstaller build/nexus-installer.spec --distpath dist --workpath build/work --clean --noconfirm`, run in the `scripts/installer/pyqt` project env via `uv run`) produced exactly one artifact: `dist/NexusSetup.exe`, **75,624,237 bytes (~72.1 MB)**. The size delta vs. Phase 1's ~65 MB is normal onefile variance from the freshly `uv sync`'d dependency set + UPX compression; it is not a regression (the smoke proves the bundle is complete and functional).
- **Packaging smoke all-green** (`smoke-windows-exe.ps1`): single artifact present; **no leftover `nexus-installer.exe`** two-artifact wizard (the dropped-NSIS contract holds); `NexusSetup.exe --version` exit 0 (bootloader probe); `NexusSetup.exe --check-registry` exit 0 (the bundled `core/registry/catalog.json` + `recommended.json` resolve inside the frozen `sys._MEIPASS` bundle -- the `OSI004.P4.C` regression guard).
- **VSIX note**: the local rebuild did not bundle a VS Code extension (no `nexus-coding-*.vsix` in the working tree). Bundling the VSIX is a release-pipeline step (the root workspace packages it in CI); its absence does not affect the T601 build proof (the smoke does not exercise extension bundling), and it is recorded honestly rather than masked.
- **Build-invocation note (environment)**: `build-windows.ps1` uses `... 2>&1 | Select-String` under `$ErrorActionPreference = 'Stop'`, which is correct under `pwsh` (PowerShell 7, as CI and the Phase 1 build use) but trips Windows PowerShell 5.1's native-stderr-as-terminating-error behavior on PyInstaller's `INFO:`-to-stderr banner. This sandbox has no `pwsh` on PATH, so the build was invoked directly (`uv run pyinstaller ...`, no `2>&1` pipe) to get an authoritative exit code. The build script itself was **not modified** -- it is correct for its intended shell; the workaround was invocation-only.

### T602 -- Post-freeze CI legs (deferred)

The rewritten installer workflows + release upload paths + the desktop-bundle build (with the new title bar/icons + spaced `productName`) are wired and their upload globs corrected (Phases 1 and 5). Running them, plus the audio-weights sha256 pin rotation and the one-artifact-per-OS + `SHA256SUMS.txt` verification, is **dispatch-gated post-freeze**: the GitHub Actions freeze runs until 2026-08-01 (today 2026-07-04) and the sandbox has no Hugging Face egress. Recorded as the T602 rehearsal + `IAE.P4.C` / `IAE.P5.D`.

### T603 -- Docs + close-out

- **Plan** ([installer-and-app-experience-overhaul.md](../../plans/installer-and-app-experience-overhaul.md)): status -> COMPLETE (Phases 1-6); T601 `[~]` (Windows leg done, mac/Linux + clean-VM = operator rehearsal), T602 `[~]` (deferred post-freeze), T603 `[x]`; whole-plan DoD annotated observable-by-observable.
- **Known-gaps** ([known-gaps.md](../known-gaps.md)): header -> COMPLETE; a Phase 6 section dispositions every open item into operator-on-device / post-freeze-CI / deliberate-deferral buckets; Section 3 summary updated to 6/6 complete.
- **install.md** ([docs/install.md](../../../../versions/install.md)): freshened the release-provenance line to the v1.9.0 single-window flow (the single-installer flow, "Nexus AI Studio" naming, SmartScreen/Gatekeeper notes, and SHA256SUMS verification were already documented in Phase 1). The before/after screenshot archive rides the on-device operator rehearsal (no GUI surface here).
- **DEVLOG** ([docs/DEVLOG.md](../../../../versions/DEVLOG.md)): Phase 6 close-out entry.
- **todos.md** ([docs/todos.md](../../../../versions/todos.md)): the v1.9.0 cycle row added to the v1.x line table + the current-state header updated.
- **README / CHANGELOG narrative + the npm version tag**: semantic-release-owned; cut automatically on merge to `main` (the established model -- see the v1.6.0/v1.7.0/v1.8.0 close-outs). Not hand-edited here.

## Verification / gates

- **Build**: `dist/NexusSetup.exe` (75,624,237 bytes) built end-to-end from a clean tree; single artifact.
- **Smoke**: `smoke-windows-exe.ps1` 4/4 assertions PASS (single artifact, no stray wizard, `--version` exit 0, `--check-registry` exit 0).
- **Installer suite**: `pytest` **651 passed / 2 skipped / 0 failed / 0 errors** (653 collected, ~2.5s; JUnit XML: `tests=653 failures=0 errors=0 skipped=2`). Unchanged from Phase 4 -- Phases 5/6 touched no installer code.
- **TS / desktop suites**: unchanged since their last green runs (root Vitest 4573/6/0 at Phase 4; desktop Vitest 515/0 at Phase 5) -- Phase 6 changed only docs, so no TS/desktop source was touched.

## Known gaps opened

None. Phase 6 opened no new gaps; it dispositioned the existing "-> Phase 6" items (see [known-gaps.md](../known-gaps.md) Phase 6 section).

## Build-structure flatten + outdated-installer cleanup (operator request, 2026-07-05)

During close-out the operator asked to remove outdated installers and simplify the installer/build directory structure (fewer subdirectories, more intuitive build locations). Two things landed:

**Outdated-artifact cleanup**: removed 131 MB of stale gitignored build output -- the deep-path `scripts/installer/pyqt/dist/NexusSetup.exe` (68 MB, 2026-07-03) and the pre-Phase-1 two-artifact `nexus-installer.exe` (68 MB), plus the PyInstaller `work/` scratch. The single canonical output is repo-root `dist/NexusSetup.exe`.

**Directory flatten**: the wizard tree moved up one level and the two `build/` dirs merged into one.
- `scripts/installer/pyqt/{src,tests,pyproject.toml,VERSIONS.md}` -> `scripts/installer/{src,tests,pyproject.toml,VERSIONS.md}` (the `pyqt/` layer is gone).
- `scripts/installer/pyqt/build/*` merged into the existing `scripts/installer/build/`, so one build dir now holds the build scripts + `nexus-installer.spec` + `hooks/` + `smoke-windows-exe.ps1` alongside `pin-hf-weights.py` / `versions.lock.json` / `windows-pipeline.md`.

Every file moved via `git mv` (history preserved; ~120 renames). Depth-encoded paths were corrected for the shallower tree: the spec's `REPO_ROOT` (now `INSTALLER_ROOT.parent.parent`), the three build scripts + the smoke script (one fewer `..`), and four test helpers (`parents[4]` -> `parents[3]`; `PYQT_ROOT` -> `INSTALLER_ROOT`). The walk-up resolvers (`registry_paths.py`, `float_logo.py`, `title_bar.py`) are depth-independent and unchanged. Notably, `main.py` and `desktop_provisioner.py` carried fixed-depth icon paths that were previously one level short (resolving to a non-existent `scripts/assets/`); the flatten *corrects* them (that code was written for the shallower layout before the `pyqt/` layer was inserted). References updated across the 7 CI workflows, the dependabot pip `directory`, `.gitignore`, the smoke + integration test scripts, `pyproject`/module comments, and `ARCHITECTURE.md` / `AGENTS.md` / `SECURITY.md` / `CONTRIBUTING.md`. The retired NSIS scripts stay archived under `scripts/installer/legacy/` by design.

Verified: `uv sync` + installer pytest **651 passed / 2 skipped / 0 failed** at the new root; a clean PyInstaller rebuild from `scripts/installer/build/` produced one `dist/NexusSetup.exe` (~72.1 MB) and `smoke-windows-exe.ps1` is 4/4 green -- including `--check-registry`, which proves the spec's new `REPO_ROOT` resolution still bundles `catalog.json` / `recommended.json` inside the frozen exe.

## Whole-plan acceptance

Section 0's seven observables are met locally + by construction (Windows build proven twice; the branded frameless installer, `NexusAI` path + zero-Gemma, scannable model cards, Gemma-4-first Agentic tab, populated Audio pillar, and the branded desktop shell all delivered across Phases 1-5). The residual verification -- the 3-OS on-device visual/behavioral rehearsal and the post-freeze CI legs -- is recorded in [known-gaps.md](../known-gaps.md), consistent with the plan's "verified locally now and via the post-freeze CI/pre-release rehearsal". v1.9.0 is ready for release; the version tag + CHANGELOG cut on merge to `main` via semantic-release.
