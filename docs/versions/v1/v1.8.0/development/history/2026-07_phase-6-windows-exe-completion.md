# v1.8.0 Phase 6 -- Windows .exe Completion + Rehearsal Staging (T601 + T605; T602-T604 recorded)

**Date**: 2026-07-03
**Plan**: [../../plans/one-shot-installer.md](../../plans/one-shot-installer.md) (Phase 6, closes gap G5's buildable half)
**Branch**: `feat/v1.8.0-installer-phase-6`

## Scope note

Phase 6 has five tasks; two are buildable in this environment and three are rehearsals the environment cannot host. T601 (the Windows pipeline) and T605 (download docs + close-out) shipped; T602 (Windows clean VM), T603 (CI legs, freeze-blocked until 2026-08-01), and T604 (mac/linux hardware) are recorded as `OSI006.P6.A/B/C` in [known-gaps](../../known-gaps.md) per the plan's own design ("every phase below is local-first-verifiable; CI legs land as dispatch-gated rehearsals after the reset").

## What shipped

### T601 -- the Windows one-shot pipeline is real

**The product decision that shaped it**: the exe is *slim*. The v1.0.0-era design baked a ~6 GB payload (CUDA, Python, wheels, Ollama, ffmpeg) into the installer; the current architecture (operator decision 2026-07-03, plan header) downloads everything at install time, SHA-256-verified, with every engine provisioner degrading gracefully when `payload/` is absent. The NSIS outer is therefore a shell whose whole job is: extract the wizard, launch it, register an uninstaller, support silent mode.

- **[installer-build.yml](../../../../../.github/workflows/installer-build.yml)**: the v1.0.0 TODO skeleton (six `Write-Host "TODO Phase 9.x"` steps) becomes the real pipeline -- NSIS availability check -> resolve pinned versions -> **root-workspace VSIX build** (`npm ci` + `npm run build` + `npx vsce package --no-dependencies`, exactly release.yml's recipe) -> optional `include_payload` fetch (dispatch input, default false; see the payload note below) -> `build-windows.ps1` -> `smoke-windows-exe.ps1` -> artifact upload. Dispatch-only while the freeze holds; T603 adds the tag trigger after the first green run.
- **[nexus-setup.nsi](../../../../../scripts/installer/build/nsis/nexus-setup.nsi)** rewritten from the stale v1.1.0 template. Fixed en route: the old template invoked `nexus-installer.exe --verify-only`, a flag the wizard never implemented (argparse exits 2 -- the outer would have aborted every install); it registered a `nexus://` URL handler and a `.nexus-workflow.json` file association pointing at `$INSTDIR\nexus.exe`, a binary that never exists there (those registrations belong to the desktop app the wizard installs); and it hardcoded version 1.1.0 + admin elevation. The rewrite: per-user (`RequestExecutionLevel user`, `$LOCALAPPDATA\Nexus\Setup`), `/DAPP_VERSION` parameterized (VIProductVersion metadata included), MUI2 welcome/license/directory/instfiles/finish with a "Run the Nexus Setup wizard now" finish checkbox, HKCU uninstall entry with computed EstimatedSize, silent mode = extract-only (no GUI launch), and an uninstaller that prompts about `~/.nexus` interactively but **always preserves it when silent**.
- **[build-windows.ps1](../../../../../scripts/installer/pyqt/build/build-windows.ps1)**: gains the makensis stage. PyInstaller now emits `dist/nexus-installer.exe` (the spec's win32 `APP_NAME` renamed from `NexusSetup`); NSIS wraps it into `dist/NexusSetup.exe` -- the same path `release.yml` already uploads, so the release workflow needed no change while its artifact silently upgraded from "bare frozen wizard" to "real installer". VSIX glob fixed to prefer `nexus-coding-*.vsix` (vsce emits the root package name; the old `gemma-code-*` glob matched nothing).
- **[smoke-windows-exe.ps1](../../../../../scripts/installer/pyqt/build/smoke-windows-exe.ps1)** (new): silent install to a scratch dir -> assert wizard + uninstaller present -> wizard `--version` boot probe -> wizard `--check-registry` bundled-data probe -> silent uninstall -> assert file/dir cleanup. Runs identically in CI and locally.
- **mac/linux mirror alignment** ([installer-macos.yml](../../../../../.github/workflows/installer-macos.yml), [installer-linux.yml](../../../../../.github/workflows/installer-linux.yml)): both workflows hand-rolled their own `pyinstaller --name ...` commands, bypassing the spec -- and with it the bundled VSIX and registry datas; both also built the VSIX via `cd extensions/nexus-coding`, a directory that has never existed (the repo root IS the extension package). Both now call the canonical build scripts (`build-macos.sh` / `build-linux.sh`), package the VSIX from the root, and drop the v1.0.0-era payload fetch/embed (which would hard-fail today on the lock file's placeholder `example.invalid` devai_hub URL). The macOS workflow's notarization step now re-creates the DMG after stapling (the old flow shipped the pre-staple image).

### OSI004.P4.C closed -- a packaged wizard now carries its catalog

New [registry_paths.py](../../../../../scripts/installer/pyqt/src/nexus_installer/registry_paths.py): one Qt-free resolver for `core/registry/{catalog,recommended}.json` -- `sys._MEIPASS` first when frozen, then the source-tree walk-up, then the tolerant relative fallback. Both prior resolvers ([engine/model_router.py](../../../../../scripts/installer/pyqt/src/nexus_installer/engine/model_router.py) `default_catalog_path`, [pages/typed_catalog.py](../../../../../scripts/installer/pyqt/src/nexus_installer/pages/typed_catalog.py) `_registry_file`) delegate to it. The spec bundles both JSON files under `core/registry/`, and a new `--check-registry` CLI flag (Qt-free, windowed-safe: exit code is the signal when stdout is None) lets the packaging smoke assert the fix inside the actual frozen exe.

### T605 -- end-user download/install page

[docs/install.md](../../../../install.md): per-OS download + install steps, the SmartScreen "More info -> Run anyway" and Gatekeeper right-click-Open click-throughs for the unsigned binaries (`OSI001.P1.D`, deliberate deferral), AppImage FUSE + glibc 2.31 caveats with the `--appimage-extract` fallback, `SHA256SUMS.txt` verification commands, silent/headless usage, what the installer actually does, and uninstall + data-preservation notes. README's Quick Start intro (stale "installers ship in v1.1.0 Phase 14") now points here.

## Local DoD proof (dev box, 2026-07-03)

| Step | Result |
|---|---|
| `uv run pyinstaller build/nexus-installer.spec` | `dist/nexus-installer.exe`, 65.2 MB (SHA256 `50365F59E37E752C...`) |
| `makensis /DAPP_VERSION=2.1.0 nexus-setup.nsi` | `dist/NexusSetup.exe`, 64.7 MB lzma (SHA256 `195CDABD72C05FC7...`), exit 0 |
| `NexusSetup.exe /S /D=<scratch>` | exit 0; wizard + Uninstall.exe present |
| `nexus-installer.exe --version` (frozen) | exit 0 (bootloader + bundle boot) |
| `nexus-installer.exe --check-registry` (frozen) | exit 0 (bundled catalog.json + recommended.json resolve) |
| `Uninstall.exe /S _?=<scratch>` | exit 0; files gone; HKCU uninstall key + Start Menu shortcut verified absent |

Environment notes: the dev box has no `pwsh` (PowerShell 7), so the proof ran the script's exact stages in sequence rather than `build-windows.ps1` itself -- the script targets the pwsh-equipped CI runners (Windows PowerShell 5.1 turns PyInstaller's stderr INFO stream into terminating errors under `$ErrorActionPreference = 'Stop'` + `2>&1`). No VSIX existed locally, so the local exe took the documented warn-and-skip path; the workflows build + bundle it (spec glob unit-asserted), and the bundled-artifact leg rides the `OSI006.P6.A` VM rehearsal.

## Gates

- Installer pytest suite: **590 passed / 2 skipped / 0 failed** (+26 over Phase 5's 564: `test_registry_paths.py` -- source-tree/frozen/fallback resolution incl. monkeypatched `sys.frozen`/`_MEIPASS`, `check_registry` exit codes + windowed no-stdout survival, CLI flag wiring; `test_packaging.py` -- spec registry datas + renamed-VSIX glob + wizard-name assertions, NSIS invariants incl. the `--verify-only` regression guard + silent data preservation, smoke-script presence, workflow reality checks).
- `registry_paths.py` coverage: **100% lines**.
- ruff: **0 new findings** (repo-suite baseline unchanged).
- `tsc -b` clean; root Vitest **4569 passed / 6 skipped / 0 failed** (unchanged -- no TS surface touched).
- `.gitignore`: PyInstaller workpath `scripts/installer/pyqt/build/work/` re-excluded (the pyqt build-inputs allow-rule was re-including it).

## Known-gaps movements

- **Closed**: `OSI004.P4.C` (registry packaging; end-to-end proof above).
- **New**: `OSI006.P6.A` (T602 Windows clean-VM rehearsal, operator), `OSI006.P6.B` (T603 CI legs + pre-release tag + `shell-build.yml` re-enable, post-freeze), `OSI006.P6.C` (T604 mac/linux rehearsals + docs true-up, operator), `OSI006.P6.D` (include_payload path blocked on the lock-file rotation; devai_hub placeholder URL + payload-layout mismatch documented).
- **Dispositions**: `OSI001.P1.B` (sidecar packaging: assessed as a T601 rider, deferred -- desktop-bundle-side, blocked on `RT.P7.B`), `OSI002.P2.D` (standalone pages stay unwired; no flow rework this phase), `OSI005.P5.A` (dependency-step progress not threaded; engine untouched), `OSI005.P5.B` (fonts decision: NOT bundled -- TTFs are not repo assets; bundling would add an outbound build fetch for a cosmetic gain).

## What the next session picks up

1. **Post-freeze (>= 2026-08-01)**: run `OSI006.P6.B` -- dispatch the three installer workflows, push the pre-release rehearsal tag, re-pin `NEXUS_DESKTOP_PINNED_TAG`, re-enable `shell-build.yml`, verify SHA256SUMS coverage.
2. **Operator, any time**: `OSI006.P6.A` Windows clean-VM double-click rehearsal; `OSI006.P6.C` mac/linux rehearsals + docs/install.md true-up; the standing pin-rotation / GPU-box chain (`OSI003.P3.A/B/C`, `OSI004.P4.A/B/E`).
3. **Release**: after the rehearsals hold, the consolidated `/update release` flow cuts the version/changelog/tag (never automatic; freeze + rehearsals gate it today).
