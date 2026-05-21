# Session history -- v1.1.0 Phase 14 (cross-OS installer)

**Date**: 2026-05-21
**Phase**: 14 -- Cross-OS installer (Windows + macOS + Linux) with hardware + disk-aware model picker
**Plan**: [docs/v1.1.0/plans/phase-14-cross-os-installer.md](../../plans/phase-14-cross-os-installer.md)

## Subtasks completed

1. **14.1 Cross-platform host detection module** -- `HostProfile` dataclass + `detect_host()` entry point with per-OS probes (wmic / system_profiler / lspci / nvidia-smi / rocm-smi). Fault-tolerant: missing tools collapse to safe defaults.
2. **14.2 OS-aware provisioner dispatch** -- `chain_for(profile)` returns the ordered provisioner-name chain per OS; `run_chain(chain, provisioners, log)` drives it.
3. **14.3 macOS provisioners** -- Metal (MPS wheels), Ollama.app drop-in, ffmpeg cross-OS provisioner.
4. **14.4 Linux provisioners** -- CUDA-on-Linux, ROCm wheels, CPU-only PyTorch, Linux Ollama (offline tarball preferred + install.sh fallback).
5. **14.5 Disk-aware footer + 10 GB OS reserve** -- live footer band + `InstallerState.can_select_model(...)` helper.
6. **14.6 Typed catalog UI: Text / Image / Video / Audio tabs** -- `TypedCatalogPage` fed by `catalog.json` + new `recommended.json`. Per-card metadata (size, compatibility badge, release date, context window, multimodality, license).
7. **14.7 Nexus VS Code extension add-on step** -- `VsCodeExtensionPage` auto-detects code / code-insiders / cursor / windsurf on PATH.
8. **14.8 Hardware-compat + disk guard at Install click** -- `evaluate_install_guard(...)` re-runs host detection at Review -> Installing.
9. **14.9 macOS DMG + Linux AppImage outer shells** -- workflows promoted to `push: tags` with PyInstaller + create-dmg / appimagetool assembly.
10. **14.10 Cross-OS payload fetcher** -- `fetch-payload.py --os --arch` + `versions.lock.json` SHA pin file (placeholders warn-and-continue).
11. **14.11 Storage review page** -- read-only band with red / yellow / green Net coloring.
12. **14.12 First-launch storage migration** -- Python re-implementation of the TS `StorageMigration` shape for the launch shim.
13. **14.13 RTM smoke checklists** -- three per-OS ~30-step manual checklists.
14. **14.14 Lint, build, test gate** -- ruff clean across every Phase 14 file; full installer suite 374 / 374 green.

## Files created (Phase 14)

- `scripts/installer/pyqt/src/nexus_installer/engine/host_detect.py`
- `scripts/installer/pyqt/src/nexus_installer/engine/provisioner_dispatch.py`
- `scripts/installer/pyqt/src/nexus_installer/engine/metal_provisioner.py`
- `scripts/installer/pyqt/src/nexus_installer/engine/ollama_macos_provisioner.py`
- `scripts/installer/pyqt/src/nexus_installer/engine/ffmpeg_provisioner.py`
- `scripts/installer/pyqt/src/nexus_installer/engine/cuda_linux_provisioner.py`
- `scripts/installer/pyqt/src/nexus_installer/engine/rocm_provisioner.py`
- `scripts/installer/pyqt/src/nexus_installer/engine/cpu_only_provisioner.py`
- `scripts/installer/pyqt/src/nexus_installer/engine/ollama_linux_provisioner.py`
- `scripts/installer/pyqt/src/nexus_installer/engine/install_guard.py`
- `scripts/installer/pyqt/src/nexus_installer/engine/storage_migration.py`
- `scripts/installer/pyqt/src/nexus_installer/widgets/disk_aware_footer.py`
- `scripts/installer/pyqt/src/nexus_installer/pages/typed_catalog.py`
- `scripts/installer/pyqt/src/nexus_installer/pages/vscode_extension.py`
- `scripts/installer/pyqt/src/nexus_installer/pages/storage.py`
- `scripts/installer/build/fetch-payload.py`
- `scripts/installer/build/versions.lock.json`
- `core/registry/recommended.json`
- `docs/v1.1.0/installer-smoke-windows.md`
- `docs/v1.1.0/installer-smoke-macos.md`
- `docs/v1.1.0/installer-smoke-linux.md`
- 10 test files (one per Phase 14 module) totalling 122 new cases

## Files modified

- `scripts/installer/pyqt/src/nexus_installer/installer_state.py` (added `free_disk_gb`, `selected_models_gb`, `disk_reserve_gb`, `install_vscode_extension`, `can_select_model(...)`)
- `scripts/installer/pyqt/src/nexus_installer/window.py` (Review -> Installing guard + `state` parameter)
- `scripts/installer/pyqt/src/nexus_installer/main.py` (pass `state` to `InstallerWindow`)
- `.github/workflows/installer-macos.yml` (push:tags + payload-fetch + sign/notarize)
- `.github/workflows/installer-linux.yml` (push:tags + AppDir + appimagetool)
- `docs/v1.1.0/known-gaps.md` (Phase 14 closures + summary recompute)
- `docs/DEVLOG.md` (Phase 14 entry)

## Test results

```
$ python -m pytest scripts/installer/pyqt/tests
374 passed in 2.37s
```

Phase 14-specific subset: 122 / 122 across the 10 new test files. Ruff clean against every Phase 14 source + test file.

## Deviations

None. Every Phase 14 sub-task landed in scope, including the typed catalog UI, the disk-aware footer, the install-click guard, the cross-OS payload fetcher, and the Storage Review page. Signing + notarization remain the existing OA-11 operator action.

## Pre-existing issues not addressed

The repo-wide `ruff check` reports lint issues in pre-existing test files unrelated to Phase 14 (SIM117 nested-with patterns in `test_prerequisites.py`, E501 long lines in `test_venv_installer.py`). These predate Phase 14 and are not in scope for this commit.

## Next steps

- **Phase 15** (final phase) -- release hardening, RTM smoke checklist sign-off across all three OS variants, operator-action closure (OA-01 through OA-12, plus the new v1.1.0 operator actions), final documentation pass.
- **OA-11** -- operator wires up the Apple Developer ID + notarization secrets so the macOS DMG ships signed + notarized.
- **OA-03** -- operator rotates the placeholder SHA-256 hashes in `versions.lock.json` before the v1.1.0 ship.
