# Nexus v1.0.0 Installer Architecture

**Version**: v1.0.0
**Status**: design (Phase 9.1 land)
**Target binary**: `Nexus-1.0.0-Setup.exe` (Windows first; macOS / Linux follow in v1.0.1+)

## TL;DR

A two-layer installer:

1. **Outer shell** -- an NSIS-compiled `.exe` that handles UAC elevation, file association, Start Menu integration, the Windows Uninstall registry entry, and the URL handler. It is small (< 200 KB) and ships under `scripts/installer/build/nsis/`. Its only job is to elevate, register, and launch the inner wizard with the payload extracted to a writable working directory.
2. **Inner wizard** -- the existing PyQt5 wizard at `scripts/installer/pyqt/src/nexus_installer/` (renamed from `gemma_installer` in Phase 2.5). Phase 9 expands it from a "VS Code extension" wizard into a full v1.0.0 provisioner: CUDA runtime, Python venv + diffusion wheels, Node 22, Ollama, recommended models, DevAI-Hub baseline skills.

The cross-platform Python wizard is the load-bearing layer; the NSIS shell is a thin Windows-only wrapper. macOS will ship the same wizard inside a `.dmg`; Linux ships it inside an `AppImage`. The platform shells handle OS conventions only.

## Why two layers

| Concern | Outer NSIS shell | Inner PyQt wizard |
|---|---|---|
| UAC elevation | Yes (`RequestExecutionLevel admin`) | No (runs as the elevated user) |
| Start Menu / Desktop / file-assoc / `nexus://` URL | Yes | No |
| `HKLM\...\Uninstall\Nexus` registry entry | Yes | No |
| Cross-platform UI (CUDA detect, venv, model picker) | No | Yes |
| Offline-first wheel install (`pip --no-index`) | No | Yes |
| Resumable SHA-verified model download | No | Yes |
| Bundles Python interpreter | No (uses PyInstaller-frozen wizard exe) | n/a (the wizard *is* Python) |

NSIS gives us the OS-correct Windows shell behaviours that an embedded Python wizard cannot replicate without writing platform-specific Win32 code. The Python wizard gives us the cross-platform provisioning logic we already have working under PyQt5 -- carried forward, not re-implemented.

## Top-level layout

```
Nexus-1.0.0-Setup.exe                          NSIS outer installer (~200 KB)
  |
  +-> extracts payload to %TEMP%\Nexus-Setup\
  |     +-> nexus-installer.exe                PyInstaller-frozen PyQt wizard
  |     +-> payload\
  |     |     +-> cuda-12.1-runtime\           cuDNN, cuBLAS, cuFFT, cuRAND, cuSPARSE
  |     |     +-> python\                       embeddable Python 3.11
  |     |     |     +-> wheels\                 torch+cu121, diffusers, etc.
  |     |     +-> node\                         portable Node 22
  |     |     +-> ollama\OllamaSetup.exe        upstream Ollama Windows installer
  |     |     +-> ffmpeg\                       ffmpeg.exe + ffprobe.exe
  |     |     +-> devai-hub-baseline.tar.gz     pinned DevAI-Hub catalog snapshot
  |     +-> manifest.json                      payload checksums + version
  |
  +-> spawns nexus-installer.exe (the wizard)
  |
  +-> wizard provisions:
        %LOCALAPPDATA%\Nexus\python\venv\       offline pip install --no-index
        %LOCALAPPDATA%\Nexus\runtime\cuda\      copied from payload\cuda-12.1-runtime
        %LOCALAPPDATA%\Nexus\runtime\node\      copied from payload\node
        %LOCALAPPDATA%\Nexus\runtime\ffmpeg\    copied from payload\ffmpeg
        ~\.nexus\models\                        downloaded by the picker page
        ~\.nexus\skills\devai-hub\<tag>\        extracted DevAI-Hub baseline
  |
  +-> wizard exits; NSIS writes:
        HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\Nexus
        Start Menu\Programs\Nexus\Nexus.lnk
        (optional) Desktop\Nexus.lnk
        HKCR\.nexus-workflow.json
        HKCR\nexus
```

## Component responsibilities

### Outer NSIS installer (`scripts/installer/build/nsis/nexus-setup.nsi`)

- Request administrator privileges (`RequestExecutionLevel admin`).
- Extract the payload to `%TEMP%\Nexus-Setup\` using NSIS's `File /r`.
- Verify the manifest checksum before launching the wizard (defence against partial download / corruption).
- Spawn `nexus-installer.exe` and wait for it to exit. If the wizard returns a non-zero exit code, the NSIS shell rolls back the Start Menu entries and the registry write.
- On success, write:
  - `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\Nexus` with `DisplayName`, `InstallLocation`, `UninstallString`, `DisplayVersion`, `Publisher=Nexus`, `EstimatedSize` (computed from payload size), `NoModify=1`, `NoRepair=0`.
  - `Start Menu\Programs\Nexus\Nexus.lnk` pointing at `%LOCALAPPDATA%\Nexus\nexus.exe`.
  - `Desktop\Nexus.lnk` (gated by a checkbox on the wizard's Welcome page; default off).
  - `HKCR\.nexus-workflow.json` -> `Nexus.Workflow` -> `shell\open\command`.
  - `HKCR\nexus` -> URL handler for `nexus://` deep links.
- Provide an uninstaller that:
  - Removes `%LOCALAPPDATA%\Nexus\` (the program runtime).
  - Prompts whether to preserve `~\.nexus\` (user data, models, skills). Default: KEEP.
  - Removes the registry entries above.

### Inner PyInstaller-frozen wizard (`nexus-installer.exe`)

Built from `scripts/installer/pyqt/` via PyInstaller in the CI installer-build job. The wizard already has:

- `scripts/installer/pyqt/src/nexus_installer/window.py` -- step controller
- `scripts/installer/pyqt/src/nexus_installer/pages/` -- welcome, prerequisites, GPU detection, install path, model selection, configuration, review, installing, complete
- `scripts/installer/pyqt/src/nexus_installer/engine/` -- ollama, venv, extension, model puller engines

Phase 9.2-9.6 adds:

- **9.2** CUDA detection + runtime copy (`engine/cuda_provisioner.py`).
- **9.3** Offline pip wheel install against `payload\python\wheels\` (`engine/venv_installer.py` extends the existing implementation to add a `--no-index` mode driven by a bundled wheel directory).
- **9.4** Node 22 portable copy + Ollama silent install (`engine/node_provisioner.py`, `engine/ollama_installer.py` -- extends existing).
- **9.5** Recommended-models picker page (`pages/recommended_models.py`) with Light / Recommended / Full presets plus an Advanced tab.
- **9.6** DevAI-Hub baseline extractor (`engine/devai_hub_provisioner.py`) sourced from `scripts/installer/devai-hub-baseline.json`.

## Build pipeline (`scripts/installer/build/windows-pipeline.md`)

Sketched in [windows-pipeline.md](../../../scripts/installer/build/windows-pipeline.md). Summary:

1. CI job `installer-build-windows` triggers on tag `v1.0.0*` or `workflow_dispatch`.
2. Job pulls the DevAI-Hub pinned tag, packages it into `payload/devai-hub-baseline.tar.gz`.
3. Job downloads pinned upstream binaries (CUDA, Python embeddable, Node 22, Ollama setup, ffmpeg) into `payload/`.
4. Job runs `pip download -r requirements.txt -d payload/python/wheels --platform win_amd64 --only-binary=:all:` to populate the offline wheel cache.
5. Job runs PyInstaller against `scripts/installer/pyqt/src/nexus_installer/main.py` -> `nexus-installer.exe`.
6. Job runs `makensis scripts/installer/build/nsis/nexus-setup.nsi` -> `Nexus-1.0.0-Setup.exe`.
7. Job uploads the `.exe` as a release artifact attached to the GitHub release.

The CI placeholder for this lives in [`.github/workflows/installer-build.yml`](../../../.github/workflows/installer-build.yml), gated behind `workflow_dispatch` until Phase 9.2-9.6 land.

## Why not Tauri's own installer (`tauri build --target msi`)?

Tauri ships an MSI for the desktop shell, but MSI cannot bundle a 3-4 GB payload (the diffusion wheels). MSI also lacks first-class support for offline pip installs and Ollama's MSI installer is not available. NSIS sits in a sweet spot: large payload OK, full Win32 registry control, deterministic + scriptable.

The Tauri-emitted MSI (when we eventually need it) becomes the no-payload "stub" for users who already have CUDA + Python + Node + Ollama; the NSIS outer installer is the v1.0.0 default.

## macOS + Linux (Phase 9.8 stub)

Documented separately in [installer-macos-and-linux.md](installer-macos-and-linux.md). Same PyQt wizard, different outer shell (`.dmg` / `AppImage`), and different GPU detection (Metal Performance Shaders on Apple Silicon; CUDA detect same as Windows on Linux).

## Decision summary

| Decision | Chosen | Rejected | Reason |
|---|---|---|---|
| Outer shell technology | NSIS | WiX/MSI, Inno Setup | Large payload support, scriptable, no MSI bundle-size limits |
| Inner wizard technology | PyQt5 (frozen with PyInstaller) | Re-write in Tauri, in Electron | Already built and tested cross-platform; one wizard for all three OSes |
| Python interpreter delivery | Embeddable Python 3.11 bundled in payload | System Python, conda | Predictable; no host pollution; works offline |
| Wheel delivery | Pre-bundled wheels + `pip --no-index` | Live PyPI | Offline-first; deterministic; ~3-4 GB one-time |
| CUDA delivery | Bundled CUDA 12.1 runtime libraries | Full CUDA toolkit install | ~1.5 GB vs 5 GB; runtime is all the app needs |
| Node delivery | Bundled Node 22 portable | System Node, nvm | Avoid version conflicts with user-installed Node |
| Ollama delivery | Bundled Ollama installer + silent install | Skip Ollama, require manual | First-launch must "just work" on a fresh VM |
| Model delivery | Network download via the registry's resumable downloader | Bundle models in payload | Models are 12-70 GB; bundling balloons the .exe to unsharable size |
| DevAI-Hub skills | Frozen tarball snapshot in payload | Live git clone at install time | Determinism; works offline; faster install |

## Phase 9 sub-task -> code map

| Sub-task | New file(s) |
|---|---|
| 9.1 (this doc) | [docs/versions/v1/v1.0.0/installer-architecture.md](installer-architecture.md), [scripts/installer/build/windows-pipeline.md](../../../scripts/installer/build/windows-pipeline.md), [.github/workflows/installer-build.yml](../../../.github/workflows/installer-build.yml) |
| 9.2 (CUDA) | [scripts/installer/pyqt/src/nexus_installer/engine/cuda_provisioner.py](../../../scripts/installer/pyqt/src/nexus_installer/engine/cuda_provisioner.py) |
| 9.3 (Python venv) | extends [venv_installer.py](../../../scripts/installer/pyqt/src/nexus_installer/engine/venv_installer.py) with offline-wheels mode |
| 9.4 (Node + Ollama) | [scripts/installer/pyqt/src/nexus_installer/engine/node_provisioner.py](../../../scripts/installer/pyqt/src/nexus_installer/engine/node_provisioner.py) |
| 9.5 (Recommended models) | [scripts/installer/pyqt/src/nexus_installer/pages/recommended_models.py](../../../scripts/installer/pyqt/src/nexus_installer/pages/recommended_models.py) |
| 9.6 (DevAI-Hub baseline) | [scripts/installer/devai-hub-baseline.json](../../../scripts/installer/devai-hub-baseline.json), [engine/devai_hub_provisioner.py](../../../scripts/installer/pyqt/src/nexus_installer/engine/devai_hub_provisioner.py) |
| 9.7 (Registry / Start Menu) | [scripts/installer/build/nsis/nexus-setup.nsi](../../../scripts/installer/build/nsis/nexus-setup.nsi) |
| 9.8 (macOS / Linux) | [docs/versions/v1/v1.0.0/installer-macos-and-linux.md](installer-macos-and-linux.md), [.github/workflows/installer-macos.yml](../../../.github/workflows/installer-macos.yml), [.github/workflows/installer-linux.yml](../../../.github/workflows/installer-linux.yml) |
| 9.9 (Tests) | new tests under [scripts/installer/pyqt/tests/](../../../scripts/installer/pyqt/tests) and [docs/versions/v1/v1.0.0/installer-smoke-checklist.md](installer-smoke-checklist.md) |

## Sibling references

- [docs/versions/v1/v1.0.0/architecture.md](architecture.md) -- v1.0.0 system architecture
- [docs/versions/v1/v1.0.0/plans/phase-09-installer.md](plans/phase-09-installer.md) -- the active plan
- [docs/versions/v1/v1.0.0/pivot-brief.md](pivot-brief.md) -- the strategic context for v1.0.0
- [scripts/installer/legacy/README.md](../../../scripts/installer/legacy/README.md) -- the v0.x NSIS installer this rev supersedes
