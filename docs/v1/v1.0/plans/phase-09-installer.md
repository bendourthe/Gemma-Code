# Phase 9 - Single-binary installer overhaul

**Goal**: Windows `Nexus-1.0.0-Setup.exe` first - carries CUDA, Python venv (diffusion stack), Node 22, Ollama, recommended models, advanced model picker, PATH registration, first-launch migration. macOS / Linux ride one phase behind.
**Prerequisites**: Phase 5 (registry receives models post-install), Phase 2 (storage-path migration logic).
**Stability Gate**: A fresh Windows 11 VM with no Python / Node / CUDA / Ollama runs `Nexus-1.0.0-Setup.exe`, clicks through the wizard, picks "Recommended" models, lands on the dashboard, and all four pillars work on first launch with no extra steps.

---

## Sub-tasks

### 9.1 - Installer architecture decision: NSIS-based outer + Python wizard inner

**Objective**: Decide the installer technology stack and document the architecture.

**Prompt**:
> Decide the v1.0.0 Windows installer architecture and write `docs/versions/v1/v1.0.0/installer-architecture.md` documenting the choice. Two layers: (a) an outer NSIS-based installer (`Nexus-1.0.0-Setup.exe`) that handles UAC / system integration / uninstall registry + extracts the inner payload; (b) the inner wizard is the existing PyQt5 installer (renamed to `nexus_installer` in Phase 2.5), now expanded to provision CUDA / Python venv / Node / Ollama / models. This keeps the cross-platform Python core that already exists (works on macOS / Linux for those targets later) while giving Windows the proper NSIS UX. Bundle the Python interpreter itself with the PyQt5 GUI via PyInstaller -- the outer NSIS already provisions a "bootstrapper" Python venv at `%LOCALAPPDATA%\Nexus\python\` for the diffusion runtime. Acceptance: the architecture doc is reviewed, the build pipeline is sketched in `scripts/installer/build/windows-pipeline.md`, and a CI job placeholder for the eventual artifact is added to `.github/workflows/installer-build.yml`.

---

### 9.2 - CUDA toolkit bundling

**Objective**: Bundle the CUDA 12.1 runtime (not the full toolkit) into the installer; detect NVIDIA driver version on the host; warn / fallback to CPU if unsupported.

**Prompt**:
> Bundle CUDA 12.1 runtime libraries (cuDNN, cuBLAS, cuFFT, cuRAND, cuSPARSE) - approximately 1.5 GB compressed - into the inner installer payload at `payload/cuda-12.1-runtime/`. At install time, detect the host NVIDIA driver via `nvidia-smi --query-gpu=driver_version --format=csv,noheader` and verify >= 530.x (CUDA 12.1 requirement). If absent or too old, the wizard surfaces a "No CUDA-capable GPU detected. Install in CPU-only mode? Image / Video generation will be slow or disabled." dialog. CUDA runtime libraries deploy under `%LOCALAPPDATA%\Nexus\runtime\cuda\` and the Python sidecar's `LD_LIBRARY_PATH` / `PATH` includes that directory at launch. Acceptance: a manual test on a fresh Windows 11 VM with an NVIDIA GPU + driver 530+ installs CUDA libraries; a manual test on a CPU-only machine triggers the CPU-only fallback dialog correctly.

---

### 9.3 - Python venv + diffusion stack provisioning

**Objective**: Bundle an embeddable Python 3.11 + pre-built diffusion stack wheels. Avoid network installs at install time where possible.

**Prompt**:
> Bundle Python 3.11 (embeddable distribution, ~30 MB) into the installer at `payload/python/`. Pre-download all required wheels into `payload/python/wheels/`: `torch==2.4.0+cu121`, `torchvision`, `torchaudio`, `diffusers>=0.30`, `transformers`, `accelerate`, `safetensors`, `xformers`, `Pillow`, `imageio[ffmpeg]`, `controlnet_aux`, `opencv-python-headless`. Total wheel payload ~3-4 GB. At install time, the wizard runs `python -m venv %LOCALAPPDATA%\Nexus\python\venv` then `pip install --no-index --find-links %LOCALAPPDATA%\Nexus\python\wheels\ -r requirements.txt` against the bundled wheels. This is offline-first - no network calls during install. ffmpeg binary bundled at `payload/ffmpeg/ffmpeg.exe` + `ffprobe.exe` (for Phase 7's MP4 metadata). Acceptance: a manual install on a fresh VM produces a working venv at `%LOCALAPPDATA%\Nexus\python\venv\` with `python -c "import torch; print(torch.cuda.is_available())"` returning `True` on a CUDA host.

---

### 9.4 - Node + Ollama provisioning

**Objective**: Bundle Node 22 + the Ollama installer; auto-install Ollama if not present; register Ollama service.

**Prompt**:
> Bundle Node 22 portable distribution at `payload/node/` (~50 MB). Bundle the Ollama Windows installer (`OllamaSetup.exe`) at `payload/ollama/`. At install time, the wizard checks if Ollama is already installed; if not, runs `OllamaSetup.exe /S` silently. Verify the Ollama Windows service is running (`sc query Ollama` returns `RUNNING`). The Nexus app's Node sidecar runs on the bundled Node (not user-installed Node) to avoid version conflicts. Add `%LOCALAPPDATA%\Nexus\runtime\node\` to the user PATH so power users can invoke `nexus-check` from their shell. Acceptance: on a Windows VM without Ollama, the wizard installs and starts the Ollama service; on a VM with Ollama already, the wizard detects and skips.

---

### 9.5 - Recommended-models picker + downloader

**Objective**: After provisioning the runtime, the wizard presents the "Recommended Models" page with three preset bundles and an Advanced picker.

**Prompt**:
> Implement the model picker page in the wizard at `scripts/installer/pyqt/src/nexus_installer/pages/models.py`. Three preset bundles by GPU class detected via `nvidia-smi`: Light (8 GB VRAM: Gemma 4 E2B + SDXL Turbo + LTX-Video; total ~12 GB disk); Recommended (12 GB+ VRAM: Gemma 4 E4B + Llama 3.1 8B + SDXL Turbo + LTX-Video + SVD; total ~25 GB disk); Full (24 GB+ VRAM: Gemma 4 26B + Llama 3.1 8B + Qwen 2.5 Coder 7B + SDXL 1.0 + Flux Schnell + LTX-Video + SVD + CogVideoX 2B; total ~70 GB disk). Each preset has a checkbox so the user can deselect individual models. The Advanced tab lets the user browse the full catalog (from Phase 5) and pick arbitrary models. Show total disk + estimated download time at the bottom. Network mode: this is the one wizard step that DOES need network. If offline, the wizard offers to skip and provides a `nexus models install ...` CLI invocation the user can run later. Models download via the registry's downloader from 5.2 (resumable + SHA-verified). Acceptance: a manual install with "Recommended" on a 12 GB VRAM machine downloads all five models, populates `~/.nexus/models/`, registers manifests; an interrupted download resumes on retry.

---

### 9.6 - Frozen DevAI-Hub skill bundle

**Objective**: Bundle a frozen snapshot of the DevAI-Hub skill catalog into the installer payload; deploy on install so the Coding module has skills lit up immediately.

**Prompt**:
> At build time, the CI installer-build job runs `git clone --depth=1 --branch <pinned-tag> https://github.com/bendourthe/DevAI-Hub.git build/devai-hub-baseline/` then `tar czf payload/devai-hub-baseline.tar.gz build/devai-hub-baseline/{catalog,rules,data,extensions}`. The pinned tag is recorded in `scripts/installer/devai-hub-baseline.json` as `{tag: "v1.X.Y", sha: "<commit-sha>", contentHash: "<computed>"}`. At install time, the wizard extracts the tarball to `~/.nexus/skills/devai-hub/<tag>/`, registers the bundle in the local SkillCatalog via the Phase 10 namespace, and shows "N skills loaded from DevAI-Hub" in the completion page. The user's installed baseline can later be updated via the Phase 10 `nexus skills sync` command without re-installing the app. Acceptance: a manual install lands the baseline; `nexus skills list --namespace devai-hub` returns the expected skill count; the Coding module's slash-command dropdown shows them.

---

### 9.7 - Settings registry + Start Menu / Uninstall integration

**Objective**: Register the app in Windows: Start Menu shortcut, Uninstall registry entry, file associations for `.nexus-workflow.json`, URL handler for `nexus://`.

**Prompt**:
> The NSIS outer installer writes the standard Windows registry entries: `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\Nexus` (DisplayName, InstallLocation, UninstallString, DisplayVersion, Publisher, EstimatedSize, NoModify=1, NoRepair=0), Start Menu shortcut at `Programs\Nexus\Nexus.lnk` pointing at `%LOCALAPPDATA%\Nexus\nexus.exe`, Desktop shortcut (optional checkbox). File association: `.nexus-workflow.json` opens with Nexus. URL handler: `nexus://` URLs open the app with the URL passed as an arg (for skill installs, model installs, future deep-links). Uninstaller: cleanly removes `%LOCALAPPDATA%\Nexus\` (with a confirm prompt for `~/.nexus/` data preservation - default keep). Acceptance: a manual install + uninstall cycle on a fresh VM works end-to-end; the registry entries are correct; the Start Menu / Desktop shortcuts work; the uninstaller offers data preservation.

---

### 9.8 - macOS + Linux installers (one phase behind, scoped to v1.0.1+)

**Objective**: Define what the macOS DMG and Linux AppImage need to do; document but defer the actual implementation.

**Prompt**:
> Write `docs/versions/v1/v1.0.0/installer-macos-and-linux.md` outlining the macOS + Linux installer scope, sequenced for v1.0.1 / v1.0.2 milestone releases. macOS: `Nexus-1.0.0.dmg` (Universal binary), Apple Developer ID signing + notarization, Apple Silicon uses Metal Performance Shaders instead of CUDA (the diffusion stack switches to `torch-mps`), Intel falls back to CPU-only. Linux: AppImage with bundled Python + CUDA libraries; the AppImage is statically-linked to glibc 2.31+; CUDA detection same as Windows. Both reuse the cross-platform `nexus_installer` Python wizard from 9.1 - the differences are the outer-shell packaging (DMG / AppImage) and platform-specific GPU detection. Add CI job stubs (`.github/workflows/installer-macos.yml` + `.github/workflows/installer-linux.yml`) gated behind workflow_dispatch for now. Acceptance: the document exists, the CI stubs are wired, and the v1.0.0 Windows installer's PyQt code is portable (passes `pytest` on a Linux runner with `xvfb`).

---

### 9.9 - Testing and Stabilization

**Objective**: Generate and run all tests for Phase 9. Iterate until stable.

**Prompt**:
> Generate comprehensive tests for everything built in Phase 9. Include: PyQt unit tests for the wizard pages (driver detection, CUDA-fallback dialog, model picker UI, disk-space calculator); integration tests for the venv provisioning script (run against a Windows runner in CI with a smaller test wheel set); a manual smoke checklist at `docs/versions/v1/v1.0.0/installer-smoke-checklist.md` covering the operator-driven end-to-end install on a fresh Windows 11 VM (CUDA-equipped + CPU-only); the existing `tests/smoke/verify-components.py` (from v0.3.0) is updated to verify the new layout under `%LOCALAPPDATA%\Nexus\`. Operator action: run the smoke checklist on a fresh VM and record the result in `docs/versions/v1/v1.0.0/operator-actions.md`. Coverage gate at lines >= 80, functions >= 80 across `scripts/installer/pyqt/`. After all tests pass, run `/generate-session-history` to document Phase 9.

---

### Phase 9 Exit Checklist

- [ ] All sub-tasks completed
- [ ] Architecture doc reviewed
- [ ] CUDA runtime bundled + detected
- [ ] Python venv + diffusion wheels bundled
- [ ] Node + Ollama provisioning works
- [ ] Recommended-models picker + downloader works
- [ ] Frozen DevAI-Hub baseline deploys
- [ ] Windows registry / Start Menu / Uninstall integration works
- [ ] macOS + Linux installer scope documented for v1.0.1+
- [ ] Coverage gate green
- [ ] Operator smoke checklist green on fresh Windows VM
- [ ] Session history generated for Phase 9
- [ ] Ready to advance to Phase 10
