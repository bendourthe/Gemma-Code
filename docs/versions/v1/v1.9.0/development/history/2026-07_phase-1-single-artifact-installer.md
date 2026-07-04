# v1.9.0 Phase 1 -- Single-artifact installer build (drop NSIS)

**Date**: 2026-07-04
**Plan**: [../../plans/installer-and-app-experience-overhaul.md](../../plans/installer-and-app-experience-overhaul.md) (Phase 1)
**Scope**: build-architecture simplification -- eliminate the two-installer experience (NSIS outer shell + PyQt wizard) and the two-artifact/deep-path build. The PyInstaller onefile becomes the distributable directly.

## What landed

The v1.8.0 Windows installer shipped `NexusSetup.exe` as an **NSIS MUI2 outer shell** whose only job was to extract `nexus-installer.exe` (the PyInstaller-frozen PyQt wizard) to `%LOCALAPPDATA%\Nexus\Setup` and launch it from the NSIS Finish page. Running the download therefore showed a generic old-style Windows (NSIS) dialog first, and only then the modern wizard -- two installers. The Windows build also emitted two `.exe` files into a deep `scripts/installer/pyqt/dist/` folder plus a convenience hand-copy to the repo root.

Phase 1 removes the NSIS layer entirely: the PyInstaller onefile IS `NexusSetup.exe`, so double-clicking the downloaded file opens exactly one window (the PyQt wizard), and one build command produces exactly one artifact per OS in one easy-to-find location (the repo-root `dist/`, gitignored).

### Tasks

- **T101** -- [nexus-installer.spec](../../../../../scripts/installer/pyqt/build/nexus-installer.spec): Windows `APP_NAME` `nexus-installer` -> `NexusSetup` so PyInstaller emits `NexusSetup.exe` directly; macOS `Nexus Installer` -> `Nexus AI Studio Setup`; Linux stays `nexus-setup`. Onefile + windowed + icon unchanged.
- **T102** -- [build-windows.ps1](../../../../../scripts/installer/pyqt/build/build-windows.ps1) rewritten from a 6-step (PyInstaller + NSIS + hand-copy) flow to a 4-step single-onefile flow that writes straight to the repo-root `dist/NexusSetup.exe` (no NSIS stage, no two-artifact loop, no `pyqt/dist` hand-copy; the `-PayloadDir` param, which only fed the NSIS embed, is gone). [build-macos.sh](../../../../../scripts/installer/pyqt/build/build-macos.sh) / [build-linux.sh](../../../../../scripts/installer/pyqt/build/build-linux.sh) aligned to the same contract: freeze the onefile into a `build/stage` staging dir, then package exactly one artifact (`NexusSetup.dmg` / `NexusSetup-x86_64.AppImage`) into the repo-root `dist/`.
- **T103** -- retired the NSIS shell to [scripts/installer/legacy/nexus-setup.nsi](../../../../../scripts/installer/legacy/nexus-setup.nsi) (git-moved, with a RETIRED banner + a legacy-README entry) and removed the now-empty `scripts/installer/build/nsis/` dir. Fixed the artifact upload paths in [installer-build.yml](../../../../../.github/workflows/installer-build.yml) (dropped the "Verify NSIS" step, the Fetch-payload step, and the `include_payload` input), [installer-macos.yml](../../../../../.github/workflows/installer-macos.yml), [installer-linux.yml](../../../../../.github/workflows/installer-linux.yml), and [release.yml](../../../../../.github/workflows/release.yml) to the single repo-root `dist/` artifact (dropped the stray raw-binary uploads on mac/linux). The macOS notarize step now signs the staged onefile payload and notarizes/staples the DMG directly (best-effort, unchanged deferral).
- **T104** -- [docs/install.md](../../../../install.md): documented the single-window flow, replaced the NSIS `/S /D=` extract-then-run silent example with a direct `NexusSetup.exe --headless --json-output`, and recorded that the installer no longer self-registers an uninstaller or a Start-menu shortcut (the product's uninstaller ships with the desktop-app bundle). SmartScreen/Gatekeeper unsigned-binary note kept. macOS artifact name updated to "Nexus AI Studio Setup".
- **T105** -- rewrote [smoke-windows-exe.ps1](../../../../../scripts/installer/pyqt/build/smoke-windows-exe.ps1) to assert a single artifact (and no leftover `nexus-installer.exe`) then boot the frozen exe (`--version` + `--check-registry`), dropping the NSIS silent install/uninstall round-trip. Rewrote the NSIS-coupled assertions in [test_packaging.py](../../../../../scripts/installer/pyqt/tests/test_packaging.py) into single-artifact / no-NSIS / repo-root-dist-upload checks. Rewrote the stale v1.0.0-era [windows-pipeline.md](../../../../../scripts/installer/build/windows-pipeline.md) to the actual single-onefile pipeline. `VERSIONS.md` had no NSIS / artifact-path content, so it needed no change.

## Verification (DoD proof)

- **Single-artifact build (local, dev box)**: `pyinstaller nexus-installer.spec --distpath dist` produced exactly one artifact, `dist/NexusSetup.exe` (68,506,718 bytes, ~65.3 MB), exit 0. No NSIS, no second exe.
- **Smoke (against the real frozen exe)**: all four assertions green -- `NexusSetup.exe` present, no leftover `nexus-installer.exe`, `--version` exit 0, `--check-registry` exit 0.
- **Boot probes from source** (identical code path): `--version` and `--check-registry` both exit 0; the bundled `catalog.json` / `recommended.json` resolve.
- **Installer test suite**: `pytest tests/` -> **591 passed, 2 skipped, 0 failed** (offscreen Qt).
- **Lint**: `ruff check tests/test_packaging.py` clean; **0 new findings** (the spec's `F821` PyInstaller-injected globals are pre-existing and `.spec` files are not directory-scanned; CI has no ruff step).
- **TypeScript**: none changed -- `tsc -b` / root Vitest unaffected.
- **Working tree**: matches Phase 1 scope exactly; build scratch (`dist/`, `build/work`, `build/stage`) is gitignored.

## Carryovers / known gaps

- `IAE.P1.A` (P2, DF): offline payload embed dropped -- it was an NSIS-only capability; `fetch-payload.py` remains but is uninvoked. Supersedes v1.8.0 `OSI006.P6.D`.
- `IAE.P1.B` (P1, DF): macOS DMG + Linux AppImage single-artifact builds and the Windows clean-VM double-click rehearsal re-run in Phase 6 (CI freeze until 2026-08-01; no mac/linux hardware here). Windows is proven locally; mac/linux are proven-by-construction.
- The wizard's `--version` string (`gemma-code-installer`) and `QApplication`/argparse names ("Nexus Installer") are unchanged here -- the "Nexus AI Studio" rebrand is scheduled in Phase 3 (T304), not a Phase 1 gap.

See [../../known-gaps.md](../../known-gaps.md) for the full ledger.
