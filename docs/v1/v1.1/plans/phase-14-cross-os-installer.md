# Phase 14 -- Cross-OS installer (Windows + macOS + Linux) with hardware + disk-aware model picker

**Goal**: Turn the v1.0.0 Windows-only installer into the canonical **cross-platform installer**. Auto-detect host OS at first launch, provision platform-correct tooling (CUDA on Windows + Linux-NVIDIA, Metal Performance Shaders on Apple Silicon, ROCm-aware fallback on Linux-AMD, CPU-only fallback elsewhere), offer the Nexus VS Code extension as an opt-in add-on, and deliver the **hardware-aware multi-model picker** with **free-disk-space awareness**.
**Prerequisites**: Phase 11 (Nexus VS Code extension exists to be offered), Phase 12 + 13 (SANA weights in catalog).
**Stability Gate (Windows)**: Fresh Windows 11 VM, no Python / Node / CUDA / Ollama -- installer auto-detects "Windows 11 x64 + RTX 4070", picks CUDA 12.1, presents the recommended-models picker with Text / Image / Video / Audio tabs, top items auto-ticked, free disk shown; user clicks five more models totalling >free-disk-10GB and picker greys out further selections with tooltip; user finishes wizard; first-launch dashboard renders; Nexus VS Code extension is installed if box was ticked.
**Stability Gate (macOS Apple Silicon)**: Fresh macOS Sequoia VM, no Homebrew -- installer detects "macOS 14.x arm64 + M2 Pro", switches to Metal Performance Shaders provisioning, downloads same models (no CUDA libraries), installs Ollama for macOS via official binary, completes wizard, dashboard renders.
**Stability Gate (Linux NVIDIA)**: Fresh Ubuntu 24.04 VM with RTX 3060 -- installer detects, provisions CUDA, downloads models, installs Ollama via official Linux script, completes wizard, dashboard renders.
**Stability Gate (Linux AMD)**: Same VM with AMD RX 7600 -- installer detects no NVIDIA driver, offers ROCm-aware path (or CPU-only fallback if ROCm not present), provisions accordingly.
**Stability Gate (disk-aware)**: With 90 GB free, user ticks four models totalling 60 GB; picker disables every checkbox that would push total selection beyond `90 - 10 = 80 GB`. Storage footer always shows `free / total` and per-selection delta.
**Stability Gate (model metadata)**: Each model card shows name, type, size on disk, hardware compatibility check, release date, in-context / out-context windows (for text models), multimodality flag, censored / uncensored flag. Latest-top recommended models auto-ticked per type.

**Closes**: 9.P1.ZZ, 9.P1.AAA (via OA-06), 9.P2.BBB (via OA-07), 9.P1.CCC, 9.P2.DDD, 9.P2.EEE (macOS + Linux outer shells), 6.P1.HH, 7.P1.NN, 7.P1.OO from `docs/versions/v1/v1.0.0/known-gaps.md`.

---

## Sub-tasks

### 14.1 -- Cross-platform host detection module

**Objective**: A single Python module reads platform, arch, GPU vendor + model, total RAM, total VRAM, free disk space, and surfaces them to the wizard's state.

**Prompt**:
> Add [scripts/installer/pyqt/src/nexus_installer/engine/host_detect.py](../../../../scripts/installer/pyqt/src/nexus_installer/engine/host_detect.py) that returns a `HostProfile` dataclass:
> - `os_family`: `"windows" | "macos" | "linux"`
> - `os_version`: string (e.g. `"Windows 11 23H2"`, `"macOS 14.5"`, `"Ubuntu 24.04"`)
> - `arch`: `"x86_64" | "arm64"`
> - `cpu_model`: string (read from `wmic cpu get name` on Win, `sysctl -n machdep.cpu.brand_string` on macOS, `/proc/cpuinfo` on Linux)
> - `total_ram_gb`: int
> - `gpu_vendor`: `"nvidia" | "amd" | "apple" | "intel" | "none"`
> - `gpu_model`: string (e.g. `"NVIDIA GeForce RTX 4070"`)
> - `total_vram_gb`: int (0 if integrated / unavailable)
> - `driver_version`: string (NVIDIA driver, Metal version, ROCm version)
> - `cuda_compatible`: bool (NVIDIA + driver >= 530 -> True)
> - `metal_compatible`: bool (macOS arm64 -> True)
> - `rocm_compatible`: bool (Linux + AMD with rocm-smi present -> True)
> - `free_disk_gb`: int (free space on the target install volume)
> - `target_install_path`: string (`%LOCALAPPDATA%\Nexus` on Win, `~/Applications/Nexus.app` on Mac, `~/.local/share/nexus` on Linux)
>
> Detection commands per OS:
> - Windows: `wmic`, `nvidia-smi`, `powershell Get-PSDrive`, `wmic os get caption`
> - macOS: `system_profiler SPDisplaysDataType`, `sysctl -n machdep.cpu.brand_string`, `df -h /`
> - Linux: `lspci | grep -i vga`, `nvidia-smi` (NVIDIA), `rocm-smi` (AMD), `lscpu`, `free -m`, `df -B1 ~`
>
> Each detection is fault-tolerant: if a command is missing, the field is `null` / `0` / `"unknown"` rather than throwing. Acceptance: a pytest suite mocks each OS's commands and asserts the right `HostProfile` is built; cross-platform CI exercises the real detection in a job matrix.

---

### 14.2 -- OS-aware provisioner dispatch

**Objective**: At wizard launch, the engine reads `HostProfile` and dispatches the right provisioner chain.

**Prompt**:
> Refactor [scripts/installer/pyqt/src/nexus_installer/engine/installer.py](../../../../scripts/installer/pyqt/src/nexus_installer/engine/installer.py) to:
> ```
> if profile.os_family == "windows":
>     run([cuda_provisioner if profile.cuda_compatible else cpu_only_provisioner,
>          windows_python_provisioner, node_provisioner, ollama_windows_provisioner,
>          ffmpeg_windows_provisioner, devai_hub_provisioner])
> elif profile.os_family == "macos":
>     run([metal_provisioner if profile.metal_compatible else cpu_only_provisioner,
>          macos_python_provisioner, node_provisioner, ollama_macos_provisioner,
>          ffmpeg_macos_provisioner, devai_hub_provisioner])
> elif profile.os_family == "linux":
>     if profile.cuda_compatible:
>         run([cuda_linux_provisioner, ...])
>     elif profile.rocm_compatible:
>         run([rocm_provisioner, ...])
>     else:
>         run([cpu_only_provisioner, ...])
>     run([linux_python_provisioner, node_provisioner, ollama_linux_provisioner, ffmpeg_linux_provisioner, devai_hub_provisioner])
> ```
> Each provisioner is a small class with `name`, `estimated_time_s`, `run(state)`, `verify(state)`. Acceptance: a pytest matrix runs each provisioner chain in isolation against mocked platform commands; the integration test mocks a full host profile + asserts the chain runs in order.

---

### 14.3 -- macOS provisioners (Metal + Homebrew-style Ollama + ffmpeg)

**Objective**: Provision Metal Performance Shaders backend for diffusion, install Ollama for macOS, drop ffmpeg.

**Prompt**:
> Add [scripts/installer/pyqt/src/nexus_installer/engine/metal_provisioner.py](../../../../scripts/installer/pyqt/src/nexus_installer/engine/metal_provisioner.py): on Apple Silicon, this is a no-op for "install Metal" (Metal is part of macOS) -- the provisioner runs `pip install -r requirements-mac.txt --no-index --find-links payload/python/wheels-mac/` to install the `torch-mps` variant of PyTorch (bundled in the macOS payload). On Intel Macs, falls back to CPU-only PyTorch. Add [scripts/installer/pyqt/src/nexus_installer/engine/ollama_macos_provisioner.py](../../../../scripts/installer/pyqt/src/nexus_installer/engine/ollama_macos_provisioner.py) that runs the official Ollama macOS binary (`payload/ollama/Ollama.app/Contents/MacOS/Ollama install`) and registers the launchd agent. Add [scripts/installer/pyqt/src/nexus_installer/engine/ffmpeg_macos_provisioner.py](../../../../scripts/installer/pyqt/src/nexus_installer/engine/ffmpeg_macos_provisioner.py) that copies `payload/ffmpeg-mac/ffmpeg` + `ffprobe` (universal binaries) into `~/Applications/Nexus.app/Contents/Resources/ffmpeg/` and sets `NEXUS_FFMPEG_PATH` in the Nexus launch agent plist. Acceptance: on a clean macOS Sequoia VM, the provisioners run successfully and the Nexus app's first launch can run a CPU-only test image (real Metal acceleration verified via OA-09).

---

### 14.4 -- Linux provisioners (NVIDIA CUDA + AMD ROCm + CPU fallback)

**Objective**: Provision the right diffusion backend for Linux's GPU landscape.

**Prompt**:
> Add [scripts/installer/pyqt/src/nexus_installer/engine/cuda_linux_provisioner.py](../../../../scripts/installer/pyqt/src/nexus_installer/engine/cuda_linux_provisioner.py): installs the same CUDA 12.1 runtime libraries as the Windows path, but unpacks them into `~/.local/share/nexus/runtime/cuda/` and sets `LD_LIBRARY_PATH` in the launch shim. Add [scripts/installer/pyqt/src/nexus_installer/engine/rocm_provisioner.py](../../../../scripts/installer/pyqt/src/nexus_installer/engine/rocm_provisioner.py): installs `torch-rocm` wheels from `payload/python/wheels-rocm/`. Add [scripts/installer/pyqt/src/nexus_installer/engine/cpu_only_provisioner.py](../../../../scripts/installer/pyqt/src/nexus_installer/engine/cpu_only_provisioner.py): installs CPU-only PyTorch + surfaces a "Heavy GPU workloads disabled (no GPU detected). Text models work; image / video may be slow or limited." dialog. Add [scripts/installer/pyqt/src/nexus_installer/engine/ollama_linux_provisioner.py](../../../../scripts/installer/pyqt/src/nexus_installer/engine/ollama_linux_provisioner.py) that runs `curl -fsSL https://ollama.com/install.sh | sh` (with SHA-pinning of the install script -- v1.0.0 OA-06 rotation covers this) on first launch only. Acceptance: matrix CI (NVIDIA / AMD / CPU-only) confirms the right provisioner fires; manual smoke on each.

---

### 14.5 -- Free-disk-space watcher + 10 GB OS reserve

**Objective**: A live disk-aware widget at the bottom of every page in the wizard.

**Prompt**:
> Add [scripts/installer/pyqt/src/nexus_installer/widgets/disk_aware_footer.py](../../../../scripts/installer/pyqt/src/nexus_installer/widgets/disk_aware_footer.py) -- a footer that always shows `Free: <free_disk_gb> GB / Selected: <selection_gb> GB / Remaining after install: <free - selection> GB`. The footer is reactive: it re-renders on every selection change. The footer is constructed once at wizard launch and passed down via the existing state machine. A new `state.disk_reserve_gb = 10` field (configurable via `--disk-reserve-gb` CLI flag, default 10) defines the floor. The state's `state.can_select_model(model_gb)` helper returns `False` when `free_disk_gb - selection_gb - model_gb < disk_reserve_gb`. Acceptance: pytest matrix tests assert the footer's text on 4 scenarios (small selection / large selection / boundary case / boundary +1 case); the model picker greys out checkboxes correctly.

---

### 14.6 -- Typed catalog UI: Text / Image / Video / Audio tabs

**Objective**: Recommended-models picker becomes a four-tab UI with per-tab metadata-rich model cards.

**Prompt**:
> Refactor [scripts/installer/pyqt/src/nexus_installer/pages/recommended_models.py](../../../../scripts/installer/pyqt/src/nexus_installer/pages/recommended_models.py) into a `QTabWidget` with four tabs: Text / Image / Video / Audio. Each tab renders a scrollable list of model cards filtered to that type from `core/registry/catalog.json`. Each card shows:
> - **Name** + **release date** ("SANA-1.6B - released 2025-11" type label)
> - **Type icon** (text bubble / picture / film / waveform)
> - **Size on disk** ("3.2 GB" or "2.8 GB int4")
> - **Compatibility badge**: based on `HostProfile`:
>   - Green "Compatible" if `total_vram_gb >= requiredVramGB`
>   - Yellow "Requires X GB VRAM (you have Y)" if VRAM is short
>   - Yellow "Requires X GB RAM (you have Y)" if RAM is short (CPU-only models)
>   - Red "Not compatible with your GPU" if `gpu_vendor` is incompatible
> - **Context window**: "Context: 128k tokens in / 8k out" (text only; null for image/video/audio -- field hidden in those tabs)
> - **Multimodal**: "Multimodal: text + image" badge if `multimodal=true`
> - **Censored**: "Uncensored" badge if `uncensored=true`, else hidden (default safe assumption)
> - **License**: "Apache-2.0" / "MIT" / "OpenRAIL-M" small text
> - **Checkbox**: ticked-by-default for the "Recommended top per type" set; greys out when `state.can_select_model(model_gb)` returns False (with a tooltip "Would dip below the 10 GB OS reserve. Free up disk or untick another model.")
>
> The "Recommended top per type" set is defined in `core/registry/recommended.json`:
> - Text: `gemma4:e4b`, `llama3.1:8b`, `qwen2.5-coder:7b`
> - Image: `sana-1.6b-1024`, `sana-sprint-1024`
> - Video: `ltx-video` (kept as v1.0.0 default; `sana-video-2b-720p` is opt-in additional in the Full preset)
> - Audio: (empty in v1.1.0 -- the tab shows "No audio models recommended yet")
>
> Acceptance: pytest renders the page in each preset; the rendering snapshot is stable; the disk-aware greying behaves correctly.

---

### 14.7 -- Nexus VS Code extension add-on step

**Objective**: After model download, ask the user whether to install the Nexus VS Code extension. If yes, install it from the bundled VSIX (which the build pipeline packages alongside the installer payload).

**Prompt**:
> Add [scripts/installer/pyqt/src/nexus_installer/pages/vscode_extension.py](../../../../scripts/installer/pyqt/src/nexus_installer/pages/vscode_extension.py): a single-question page with checkbox "Install the Nexus VS Code extension (uses local models for agentic coding inside VS Code)" -- ticked by default if `code` (the VS Code CLI) is detected on PATH. If unticked, skip. If ticked, run `code --install-extension payload/nexus-coding-1.1.0.vsix` (or the platform-appropriate VS Code variant: `code-insiders`, `cursor`, etc. -- detect once at install time). Add the page to the wizard chain after the model picker and before the completion page. Acceptance: pytest mocks the VS Code CLI and verifies the install command fires when the box is ticked.

---

### 14.8 -- Hardware-compatibility check + 10 GB reserve at "Install" click

**Objective**: One last guard before kicking off the download / install: re-read `HostProfile.free_disk_gb` and assert the selection still fits, with a 10 GB reserve. Display an error and bounce back to the picker if not.

**Prompt**:
> The wizard's "Begin Installation" handler ([scripts/installer/pyqt/src/nexus_installer/window.py](../../../../scripts/installer/pyqt/src/nexus_installer/window.py)) re-runs `host_detect()` (in case the user freed up disk in another app) and asserts `total_selection_gb < free_disk_gb - 10`. If not, shows an error dialog "Insufficient disk space (need X GB free, have Y GB)" and returns the user to the picker. Acceptance: a pytest fixture sets `free_disk_gb = 50`, selects 45 GB of models, clicks Install -> sees the error dialog; with `free_disk_gb = 100`, the install proceeds.

---

### 14.9 -- macOS DMG + Linux AppImage outer shells

**Objective**: Wrap the cross-platform PyQt wizard in the right outer shell per OS.

**Prompt**:
> Implement the macOS DMG packaging in [.github/workflows/installer-macos.yml](../../../../.github/workflows/installer-macos.yml) (was workflow_dispatch; promote to `push: tags`):
> - PyInstaller-freeze the wizard to `nexus-installer.app/Contents/MacOS/nexus-installer`
> - Sign with Developer ID Application cert (OA-11 provides the cert + creds)
> - `xcrun notarytool submit --wait` for notarization (OA-11)
> - `xcrun stapler staple`
> - Build the DMG via `create-dmg` with the layout from [docs/versions/v1/v1.0.0/installer-macos-and-linux.md](../../v1.0/installer-macos-and-linux.md)
>
> Implement the Linux AppImage in [.github/workflows/installer-linux.yml](../../../../.github/workflows/installer-linux.yml):
> - PyInstaller-freeze the wizard
> - `appimagetool` assembly with the PyQt + Python + CUDA / ROCm runtimes
> - Statically-linked glibc 2.31+ requirement documented in the AppImage `.desktop`
>
> Acceptance: both CI jobs produce artifacts on a workflow_dispatch run; the artifacts launch on the respective OS VMs.

---

### 14.10 -- Build-payload script for cross-OS payloads

**Objective**: Close the v1.0.0 `9.P1.ZZ` carryforward: the `scripts/installer/build/fetch-payload.py` script that downloads CUDA / Python / wheels / Node / Ollama / ffmpeg / DevAI-Hub baseline + the SANA model weights + the local embedder weights -- per-OS.

**Prompt**:
> Add [scripts/installer/build/fetch-payload.py](../../../../scripts/installer/build/fetch-payload.py) parameterized by `--os <win|mac|linux>` and `--arch <x64|arm64>`. The script reads `versions.lock.json` (per-OS + per-arch pin file) and downloads:
> - CUDA 12.1 runtime libs (Win + Linux x64 only)
> - Python 3.11 embeddable (per OS + arch)
> - Wheels: torch (+cu121 on NVIDIA / +mps on Mac / +rocm on AMD / +cpu fallback), torchvision, torchaudio, diffusers, transformers, accelerate, safetensors, xformers (NVIDIA only), Pillow, imageio[ffmpeg], controlnet_aux, opencv-python-headless, nunchaku (if S4 adopted)
> - Node 22 portable per OS
> - Ollama installer per OS (`OllamaSetup.exe`, `Ollama-darwin.zip`, `ollama-linux-amd64.tgz`)
> - ffmpeg + ffprobe universal binaries per OS
> - DevAI-Hub baseline tarball (sparse clone of pinned tag)
> - SANA-1.6B + Sana-Sprint + DC-AE VAE weights (HuggingFace; placed under `payload/models/`)
> - Local embedder ONNX weights (`Xenova/all-MiniLM-L6-v2`, ~80 MB; placed at `payload/models/embedder/all-MiniLM-L6-v2/`)
> - Nexus VS Code extension VSIX (built earlier in the workflow)
>
> Each download is SHA-pinned via `versions.lock.json`; mismatches abort the build. Acceptance: the script runs end-to-end on a Linux CI runner for each OS target; output payload sizes are reasonable (~3-4 GB per OS, dominated by the wheels + SANA weights).

---

### 14.11 -- Storage-page UI: continuous free-disk + per-selection delta

**Objective**: The footer from 14.5 is also exposed as a full Storage page that shows per-model rows with disk delta.

**Prompt**:
> Add [scripts/installer/pyqt/src/nexus_installer/pages/storage.py](../../../../scripts/installer/pyqt/src/nexus_installer/pages/storage.py) -- a read-only review page right before the Install Begin click. Shows:
> - Free disk: `<free_disk_gb> GB`
> - Required for runtime (CUDA + Python venv + Node + Ollama + ffmpeg): `<runtime_gb> GB`
> - Required for selected models: `<models_gb> GB` (list each one with its size)
> - Required for DevAI-Hub baseline: `<devai_gb> GB`
> - Reserve (10 GB OS): `10 GB`
> - **Net after install**: `<remaining_gb> GB` (red if < 10, yellow if < 20, green otherwise)
>
> Acceptance: pytest renders the page with various selection states; the colors match the math.

---

### 14.12 -- First-launch migration carry-over (`~/.gemma-code/` -> `~/.nexus/`)

**Objective**: On every OS, the first launch migrates the legacy `~/.gemma-code/` (or platform equivalent) to `~/.nexus/`, idempotently.

**Prompt**:
> The migration code lives in [core/storage/StorageMigration.ts](../../../../core/storage/StorageMigration.ts) from v1.0.0. The cross-OS installer's launch shim per OS runs this once on first launch (or via `nexus migrate-storage` CLI). On POSIX, the migration creates a symlink for backwards compat; on Windows, the legacy directory is preserved alongside. Acceptance: an integration test creates a fake `~/.gemma-code/` on each OS, runs the migration, asserts the new `~/.nexus/` contains the right files and the legacy directory either becomes a symlink (POSIX) or stays in place (Win).

---

### 14.13 -- RTM smoke checklist per OS

**Objective**: Three new smoke checklists (Windows / macOS / Linux) that the Phase 15 release gate exercises.

**Prompt**:
> Add [docs/versions/v1/v1.1.0/installer-smoke-windows.md](../installer-smoke-windows.md), [docs/versions/v1/v1.1.0/installer-smoke-macos.md](../installer-smoke-macos.md), [docs/versions/v1/v1.1.0/installer-smoke-linux.md](../installer-smoke-linux.md). Each checklist has ~30 manual steps (fresh VM, run installer, walk through every wizard page, finish, launch app, verify dashboard, run a coding session, run an image generate, run a video generate, install the VS Code extension, run a VS Code session). Acceptance: each checklist exists, references the Phase 14 sub-tasks, and is signed off in Phase 15.

---

### 14.14 -- Phase 14 lint, build, test gate

**Objective**: Verify the cross-OS installer is CI-green across all three OS workflows.

**Prompt**:
> Re-run the four-step gate plus the three installer-build workflows on workflow_dispatch. Acceptance: every installer artifact builds (signing + notarization can be deferred to Phase 15 / OA-01 / OA-11); pytest matrix on the wizard is green.
