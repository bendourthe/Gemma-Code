# v1.9.0 installer + app UI rework -- Phase 5: installer chrome (taskbar/window icon, scrollbars, checkbox)

**Date**: 2026-07-08
**Plan**: [installer-and-app-ui-rework.md](../../plans/installer-and-app-ui-rework.md) Phase 5 (T018-T021)
**Branch**: `feat/v1.9.0-installer-phase-1` (installer PR line)
**Model**: claude-opus-4-8 (plan recommended workhorse/sonnet high; ran on the current stronger model for the packaging/frozen-path nuance, no downshift)

## Goal

Make the taskbar icon reliable in the frozen (PyInstaller) build and modernize the scrollbars and the per-model checkbox. Highest-risk phase: the frozen-path resolution must be proven in the built exe.

## What changed

- **T018 -- frozen-path icon**: `asset_file(name)` + `resolve_window_icon()` added to [registry_paths.py](../../../../../scripts/installer/src/nexus_installer/registry_paths.py) (`_MEIPASS`-first, same as `registry_file`). [main.py](../../../../../scripts/installer/src/nexus_installer/main.py) drops the fixed-depth `../../../../assets/icon.ico` walk (missed in the onefile) and resolves bundle-first; icon set app-wide + on the window ([window.py](../../../../../scripts/installer/src/nexus_installer/window.py) `setWindowIcon`). Prefers `.ico` -> `.png` -> mark; `None` -> skip. Removed the now-unused `import os`. `AppUserModelID` kept.
- **T019 -- staging**: [nexus-installer.spec](../../../../../scripts/installer/build/nexus-installer.spec) stages `icon.ico` + `icon.png` + the mark under `assets/` (one loop); comment corrected FloatingLogo -> StaticLogo.
- **T020 -- scrollbars** ([theme.py](../../../../../scripts/installer/src/nexus_installer/theme.py)): transparent track, slim 10px pill handle (subtle `TEXT_MUTED` -> `TEXT_SECONDARY` hover), zero arrows, horizontal rule.
- **T021 -- checkbox**: custom-painted [ModelCheckBox](../../../../../scripts/installer/src/nexus_installer/widgets/model_checkbox.py) (rounded box + painted crisp glyph, configurable `accent`, all states) replaces the per-card `_CHECKBOX_QSS`; the glyph is painted (not a QSS `image: url()`) so it resolves in the frozen bundle. Base `QCheckBox` QSS modernized (20px, rounded, hover/checked-hover/disabled/locked).

## Verification

- **Frozen build (the crux)**: `pyinstaller build/nexus-installer.spec` -> `NexusSetup.exe` (73.7 MB) boots (`--version` -> `nexus-ai-studio-installer 1.1.0`) and `--check-registry` resolves from the real `_MEIPASS` (exit 0); the Analysis TOC confirms `icon.ico` + `icon.png` + the mark are collected under `assets\`. The icon resolver uses the same `_MEIPASS` path `--check-registry` proves, so the frozen taskbar icon resolves.
- Unit tests: `asset_file` / `resolve_window_icon` (source / mocked `_MEIPASS` / not-frozen / missing-fallback); `ModelCheckBox` all states; spec-staging assertion (`icon.ico`).
- Installer suite: **670 passed / 2 skipped / 0 failed** (+14). Offscreen QSS smoke: pill scrollbars + checkbox states, no leaked tokens. ruff clean.

## Carryovers

- `UIR.P5.A` (P1): actual OS taskbar/window icon render + scrollbar/checkbox look need a real desktop -> Phase 7 visual QA (DoD 4 + 6).
- `main.py` half of `UIR.P3.B` (stray ruff) resolved by committing it here; `storage/vscode/disk_aware` remainder stays out of scope.
- `build-windows.ps1` stderr baseline edit (PS 5.1 robustness) is outside T018-T021; unstaged.
- See [known-gaps.md](../../known-gaps.md) Section 4.
