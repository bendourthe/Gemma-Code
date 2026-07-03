# v1.8.0 Phase 2 -- Desktop provisioner: the installer installs Nexus (T201-T204)

**Date**: 2026-07-02
**Branch**: `feat/v1.8.0-installer-phase-2` (stacked on `feat/v1.8.0-installer-phase-1`)
**Plan**: [../../plans/one-shot-installer.md](../../plans/one-shot-installer.md) (Phase 2 of 6)
**Constraint honored**: GitHub Actions freeze ($0 until 2026-08-01) -- the release-fetch path is fully unit-tested but exercised live only in the Phase 6 / T603 post-freeze rehearsal; the local proof runs against the T104 fixture bundle.

## What shipped

### T201 -- `engine/desktop_provisioner.py` (new, 264 stmts, 89% line coverage)

Follows the `ollama_installer.py` download / verify / install structure:

- **Asset resolution** (`resolve_asset_name`): pinned tag `NEXUS_DESKTOP_PINNED_TAG = "v2.1.0"` (documented in [VERSIONS.md](../../../../../scripts/installer/pyqt/VERSIONS.md)); URL template `https://github.com/bendourthe/Nexus-AI/releases/download/{tag}/{asset}`; per-OS/arch mapping to the canonical Phase 1 asset names (`Nexus-Desktop_{version}_x64-setup.exe` / `_universal.dmg` / `_amd64.AppImage`). Fail-closed on unsupported arches (Windows ARM64, Linux non-x86_64); the macOS DMG is universal.
- **Resumable download**: `.partial` file + `Range` header; 206 appends, 200 (server ignored Range) restarts, 416 promotes an already-complete partial; cancellation (wired to `InstallEngine.cancel`) keeps the partial for resume; per-chunk progress callbacks feed the wizard's progress band.
- **Fail-closed verification**: fetches the release's `SHA256SUMS.txt` (T102's asset) first -- a missing manifest, a missing per-asset entry, or a digest mismatch each abort *before* any install dispatch; a mismatched download is deleted. `parse_sha256sums` accepts both `sha256sum` text and binary (`*`) separators.
- **Per-OS install**: Windows NSIS silent (`/S`, plus `/D=<dir>` as the mandatory-last unquoted arg when `desktop_install_dir` is set); macOS `hdiutil attach -nobrowse -readonly` -> `ditto` the `.app` to `/Applications/Nexus.app` -> `hdiutil detach` in a `finally`; Linux AppImage to `~/.local/bin/nexus-desktop.AppImage` (0755) + `~/.local/share/applications/nexus-desktop.desktop` entry + best-effort icon staging.
- **Windows exe resolution** (`_resolve_windows_exe`): the T104 bundle ships `nexus-shell.exe` (the Tauri crate's binary name), not a product-named exe -- discovered when the first fixture run failed on a `Nexus.exe` assumption. Resolution prefers `Nexus.exe` (future-proof for a Phase 6 rename), then `nexus-shell.exe`, then any non-`uninstall.exe` binary in the install dir.
- **Local bundle override**: `InstallerState.desktop_bundle_override` (CLI: `--desktop-bundle`) installs a locally-built bundle with the release fetch and checksum skipped (logged loudly as a warn) -- the freeze-era wizard path and the T204 integration fixture path.

### T202 -- step 5 "Nexus Desktop" + component threading

- [engine/installer.py](../../../../../scripts/installer/pyqt/src/nexus_installer/engine/installer.py): step 5 appended after the model pull, gated on `"desktop" in state.components_to_install`, with its own progress band and `--- Installing Nexus Desktop ---` log banner; `InstallEngine.cancel()` now also cancels an in-flight desktop download. **Fixed en passant**: the model step's progress base hardcoded "model is the final step" (`(total_steps - 1) / total_steps`) -- with a fifth step that band was wrong, so both steps now derive their base from `steps_done` at step start.
- [installer_state.py](../../../../../scripts/installer/pyqt/src/nexus_installer/installer_state.py): `"desktop"` added to the default components; new fields `desktop_install_dir`, `desktop_bundle_override`, `desktop_installed`, `desktop_health_ok`, `desktop_exe_path`, `launch_desktop_on_finish`.
- Components choice: a default-checked "Install the Nexus desktop app (recommended)" toggle on the ConfigurationPage (the wizard's wired components surface, alongside the ollama/venv toggles); the ReviewPage renders friendly component labels ("Nexus Desktop app", "VS Code extension", "Python environment").
- Headless main: the desktop step runs in `--headless` mode; new `--skip-desktop` flag, passed by all three smoke scripts ([tests/smoke/](../../../../../tests/smoke/)) -- CI smoke runs from source checkouts with no published release and must not install a GUI app.

### T203 -- first-run health check + "Launch Nexus"

- `first_run_health_check` (in the provisioner module): launches the installed binary once with `--version`; pass = clean exit 0 **or** still-alive after a 5 s grace (a GUI that launched without crashing; it is then terminated). Missing binary, spawn failure, or early nonzero exit fail the check. Result lands on `state.desktop_health_ok` -- a failed check does **not** fail the install step (the app may still work from the OS menu); it is surfaced as a warn log and on the complete page.
- [pages/complete.py](../../../../../scripts/installer/pyqt/src/nexus_installer/pages/complete.py): a "Nexus Desktop" services row (health passed / failed / not installed) and a default-checked "Launch Nexus when I click Finish" checkbox (disabled + unchecked when the desktop did not install). `on_finish()` launches `state.desktop_exe_path`; [window.py](../../../../../scripts/installer/pyqt/src/nexus_installer/window.py)'s Finish branch now invokes the last page's `on_finish` hook before closing.

### T204 -- tests (39 new in `test_desktop_provisioner.py` + suite updates)

- Unit: asset resolution per OS/arch, SHA256SUMS parsing, real-tempfile download+verify (match, mismatch-deletes, missing-entry-never-downloads, offline manifest), resume semantics (Range/206 append, 200 restart, 416 promote, cancel-keeps-partial), per-OS dispatch (NSIS args incl. `/D` last-unquoted, hdiutil/ditto/detach-in-finally, AppImage + .desktop content), exe resolution (shell name, product-name preference, uninstaller skip), orchestration (override skips fetch, failed download never dispatches, health-fail-still-succeeds), health check (all four verdicts), state threading.
- Suite updates: engine ordering (5 steps), desktop skip, desktop-failure isolation, cancel propagation; state defaults; ConfigurationPage toggle; review labels; complete-page checkbox/on_finish/services row; window Finish hook.
- **Integration (env-gated, `NEXUS_DESKTOP_FIXTURE_TEST=1`, Windows-only)**: installs the T104 fixture via the override into a pytest tmp dir, asserts install + resolved binary + **health check passed** (the real app launched and survived the grace period), then silently uninstalls in a `finally`.

## Local proof (DoD evidence, dev box, 2026-07-02)

| Check | Result |
|---|---|
| Fixture NSIS silent install (`/S /D=<tmp>`) | exit 0; `nexus-shell.exe` + `uninstall.exe` landed |
| Start menu | `%APPDATA%\...\Start Menu\Programs\Nexus.lnk` present after install, gone after uninstall |
| First-run health check | **passed** (app launched, alive past grace, terminated cleanly) |
| Silent uninstall | clean (no leftover files, no `HKCU` uninstall entry) |
| Integration test | `TestWindowsFixtureIntegration` green with `NEXUS_DESKTOP_FIXTURE_TEST=1` |

## Quality gates

| Gate | Result |
|---|---|
| Installer pytest suite | **433 passed / 1 skipped / 0 failed** (+42 new; the skip is the env-gated fixture test, run green separately) |
| New-module coverage | `desktop_provisioner.py` 89% lines; `installer_state.py` 100%; `installer.py` 88% |
| Ruff (changed files) | 0 new findings (3 remaining are pre-existing lines shifted by edits) |
| Root Vitest suite | **4565 passed / 6 skipped / 0 failed** (unchanged -- no TS surface touched) |

## Decisions

- **Health check is a launch-probe, not a sidecar ping**: the bundle still ships the shell only (`OSI001.P1.B`), so a sidecar ping would fail by construction. The launch-probe satisfies the phase DoD's observable ("launches, health check passes"); the deeper sidecar ping is recorded as `OSI002.P2.B` and lands with the sidecar packaging.
- **Health failure does not fail the install step**: the app is on disk and launchable from the OS; the wizard surfaces the warning instead of reporting a failed install.
- **`--desktop-bundle` skips checksum verification by design**: it is an operator-invoked local path (the file never crossed the network via the installer) and logs a loud warn; the release-fetch path stays fail-closed.
- **Download dir is persistent** (`%TEMP%/nexus-installer-downloads`): partials survive a wizard restart, making the 4-23 GB-class downloads resumable across runs.
