# Nexus macOS + Linux installer scope (Phase 9.8)

**Version**: v1.0.0
**Status**: scoped + deferred -- Windows ships v1.0.0; macOS + Linux ship one phase behind (v1.0.1 / v1.0.2)
**Owners**: same as the v1.0.0 installer (Phase 9.1-9.7)

This document outlines what the macOS DMG and Linux AppImage need to do, and why we defer the implementation rather than block v1.0.0 on cross-platform parity.

## Why one phase behind

The Windows installer is the v1.0.0 "stability gate" target (see [docs/versions/v1/v1.0.0/plans/phase-09-installer.md](plans/phase-09-installer.md) "Stability Gate"). Adding macOS + Linux to the same milestone would multiply the testing surface by three on a deadline where the Windows binary alone has nine sub-tasks. We carry forward the cross-platform Python wizard so the macOS / Linux work is **outer-shell only** -- the provisioning logic is already platform-aware in Phase 9.2-9.6.

Carrying the macOS + Linux installers to v1.0.1 + v1.0.2 gives us:

- A real first user cohort on Windows giving feedback that we can fold into the cross-platform builds.
- Time to provision the Apple Developer ID + notarization workflow without rushing.
- AppImage packaging time that can be done alongside the v1.0.1 hardening cycle.

## macOS: `Nexus-1.0.0.dmg`

### Outer shell

- Format: signed + notarized DMG (universal binary).
- Apple Developer ID required. Tracked as a v1.0.1 hardening item (no cert in v1.0.0).
- Architecture: ship a Universal binary (`arm64` + `x86_64`). The PyQt wizard is interpreted Python; we PyInstaller-bundle one wizard per arch.
- Drag-to-Applications affordance (the standard DMG UX).

### GPU detection

- Apple Silicon (M-series): switch the diffusion stack to **MPS** (`torch-mps`). No CUDA path on Apple Silicon.
- Intel Mac: CPU-only fallback. Image / video generation is slow or disabled. We do **not** support eGPU CUDA on Intel Macs because the macOS NVIDIA driver story is dead since 10.14.

### Wheel set differences

Apple Silicon needs different wheels than Windows:

| Wheel | Windows (CUDA 12.1) | Apple Silicon (MPS) | Intel Mac (CPU) |
|---|---|---|---|
| `torch` | `torch==2.4.0+cu121` | `torch==2.4.0` (built-in MPS support) | `torch==2.4.0` (CPU) |
| `xformers` | bundled | NOT bundled (no MPS build) | NOT bundled |
| All others | same | same | same |

The CI installer-build-macos job produces two wheel bundles: `payload/python/wheels-arm64/` and `payload/python/wheels-x86_64/`. The wizard picks based on `platform.machine()`.

### Native integration

- Spotlight: register Nexus.app so `Nexus` is searchable.
- Launchpad: ships automatically when the .app lands in /Applications.
- Open With: `.nexus-workflow.json` opens Nexus.app via `LSItemContentTypes` in `Info.plist`.
- URL scheme: `nexus://` via `LSHandlerRoleAll` in `Info.plist`.

## Linux: `Nexus-1.0.0.AppImage`

### Outer shell

- Format: AppImage (single executable, no install step).
- Statically-linked to glibc 2.31+ (the lowest still-supported LTS major distros).
- Bundles libQt5 inside the AppImage so the user does not need a system Qt.

### GPU detection

- NVIDIA: same CUDA 12.1 path as Windows. Driver check via `nvidia-smi`. Same `payload/cuda-12.1-runtime/` libraries.
- AMD: ROCm path NOT supported in v1.0.0 / v1.0.1; tracked as v1.1.0+ work.
- Apple GPU: n/a on Linux.
- CPU fallback: same dialog as Windows.

### Wheel set differences

Linux needs Linux wheels. The CI installer-build-linux job runs `pip download -d payload/python/wheels-linux/ --platform manylinux_2_31_x86_64 --only-binary=:all:`.

### Native integration

- `.desktop` file under `~/.local/share/applications/nexus.desktop`.
- File association: `application/x-nexus-workflow` MIME type registered in the .desktop file.
- URL scheme: `x-scheme-handler/nexus` registered via the same .desktop entry.

## Cross-platform invariants

The PyQt wizard at `scripts/installer/pyqt/src/nexus_installer/` is the source of truth for:

- Per-platform GPU detection ([pages/gpu_detection.py](../../../scripts/installer/pyqt/src/nexus_installer/pages/gpu_detection.py))
- CUDA runtime copy on Windows / Linux ([engine/cuda_provisioner.py](../../../scripts/installer/pyqt/src/nexus_installer/engine/cuda_provisioner.py))
- Python venv + offline wheel install ([engine/diffusion_venv_provisioner.py](../../../scripts/installer/pyqt/src/nexus_installer/engine/diffusion_venv_provisioner.py))
- Node 22 portable copy ([engine/node_provisioner.py](../../../scripts/installer/pyqt/src/nexus_installer/engine/node_provisioner.py))
- Recommended-models picker UI ([pages/recommended_models.py](../../../scripts/installer/pyqt/src/nexus_installer/pages/recommended_models.py))
- DevAI-Hub baseline extraction ([engine/devai_hub_provisioner.py](../../../scripts/installer/pyqt/src/nexus_installer/engine/devai_hub_provisioner.py))

The platform-shell deltas are:

| Concern | Windows (v1.0.0) | macOS (v1.0.1) | Linux (v1.0.2) |
|---|---|---|---|
| Outer shell | NSIS | DMG | AppImage |
| Signing | Authenticode (v1.1) | Apple Developer ID + notarization | n/a (AppImage signs itself) |
| GPU compute | CUDA | MPS / CPU | CUDA / CPU |
| File association | HKCR registry | Info.plist LSItemContentTypes | .desktop MIME |
| URL handler | HKCR registry | Info.plist LSHandlerRoleAll | .desktop x-scheme-handler |
| Uninstall | HKLM Uninstall entry | drag-to-Trash | delete the .AppImage + ~/.nexus prompt |

## CI placeholders

- [`.github/workflows/installer-macos.yml`](../../../.github/workflows/installer-macos.yml) -- workflow_dispatch only; the job stub mirrors `installer-build.yml` but runs on `macos-latest`.
- [`.github/workflows/installer-linux.yml`](../../../.github/workflows/installer-linux.yml) -- workflow_dispatch only; the job stub runs on `ubuntu-latest`.

Both files exist so that Phase 11 release hardening can flip them from `workflow_dispatch` to `push: tags: v1.0.[12]*` once the wizard is verified end-to-end on each platform.

## Acceptance criteria for this doc

- [x] Scope written for both macOS and Linux outer shells.
- [x] Cross-platform wizard invariants enumerated.
- [x] CI placeholders wired (gated behind workflow_dispatch).
- [x] Hardware / wheel deltas documented.
- [ ] (deferred to v1.0.1) Apple Developer ID cert provisioned.
- [ ] (deferred to v1.0.1) PyQt wizard verified on a Linux runner with `xvfb`.

## Phase 9.8 sub-task `-> code map

| Item | File |
|---|---|
| macOS + Linux scope | this file |
| macOS CI stub | [.github/workflows/installer-macos.yml](../../../.github/workflows/installer-macos.yml) |
| Linux CI stub | [.github/workflows/installer-linux.yml](../../../.github/workflows/installer-linux.yml) |
| Cross-platform PyQt wizard | [scripts/installer/pyqt/src/nexus_installer/](../../../scripts/installer/pyqt/src/nexus_installer) (unchanged) |
