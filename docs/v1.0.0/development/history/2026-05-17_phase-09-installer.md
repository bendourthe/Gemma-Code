# Session History: v1.0.0 Phase 9 -- Single-binary installer overhaul (Windows-first)

**Date**: 2026-05-17
**Plan**: [docs/v1.0.0/plans/phase-09-installer.md](../../plans/phase-09-installer.md)
**Phase goal**: Lay the foundation for `Nexus-1.0.0-Setup.exe` -- a two-layer Windows installer (NSIS outer + PyQt wizard inner) that provisions CUDA 12.1 runtime, an offline Python venv with the diffusion stack, Node 22, Ollama, recommended models, and the frozen DevAI-Hub skill baseline. macOS DMG + Linux AppImage scoped and deferred to v1.0.1 / v1.0.2.

## CI-blocker fix (Phase 9 opens by unblocking `shell-build.yml`)

The previous push had a failing `shell-build.yml` (`Shell windows-latest`, `Shell ubuntu-latest`, `Shell macos-latest`). Two root causes:

1. **Missing icon assets** -- `desktop/src-tauri/tauri.conf.json` references `icons/32x32.png`, `icons/128x128.png`, `icons/128x128@2x.png`, `icons/icon.icns`, `icons/icon.ico` but the `desktop/src-tauri/icons/` directory was empty (the assets were a Phase 1 placeholder per `1.P2.E`). `tauri-build` could not resolve the icon set on Windows (`icons/icon.ico not found; required for generating a Windows Resource file`) and `tauri::generate_context!` panicked on Linux (`failed to open icon ... /icons/32x32.png`).
2. **Missing `tauri::Manager` import** -- `desktop/src-tauri/src/sidecar.rs:77` calls `app.path().resolve(...)` to resolve the bundled sidecar script. `app.path()` requires the `tauri::Manager` trait in scope. The trait was imported in `lib.rs` but not in `sidecar.rs`; the v2.11 toolchain on `dtolnay/rust-toolchain@stable` is stricter than the previous local toolchain and surfaced this as `error[E0599]: no method named path found for reference &AppHandle`.

Both fixes land in this phase as collateral:

- `scripts/desktop/generate-icons.py` (new) -- reproducible icon generator using Pillow. Renders a teal-on-charcoal rounded square with the letter "N" at every size Tauri / Windows Store / .icns / .ico expects. Output: `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png`, `Square30/44/71/89/107/142/150/284/310x*.png`, `StoreLogo.png`, `icon.ico`, `icon.icns`. The final designer-authored art is now tracked as `9.P2.BBB`.
- `desktop/src-tauri/icons/` (new) -- the generated set, committed.
- `desktop/src-tauri/src/sidecar.rs` -- `use tauri::AppHandle;` extended to `use tauri::{AppHandle, Manager};`. No other behavioral change.

Resolves known gap `1.P2.E`.

## Phase 9 sub-tasks completed

### 9.1 -- Installer architecture decision (NSIS outer + PyQt wizard inner)

- **`docs/v1.0.0/installer-architecture.md`** -- canonical decision doc. Two-layer architecture: outer NSIS-compiled `.exe` handles UAC / registry / Start Menu / file association / URL handler; inner PyQt5 wizard (already cross-platform under `scripts/installer/pyqt/`) handles every per-OS provisioning step (CUDA, Python venv, Node, Ollama, recommended models, DevAI-Hub baseline). Includes decision matrix (NSIS vs WiX/MSI/Inno; PyQt vs rewriting in Tauri/Electron; offline wheels vs live PyPI; pre-bundled CUDA runtime vs full toolkit installer; bundled Node 22 vs system Node; etc.) and a sub-task -> code-file map for 9.2-9.9.
- **`scripts/installer/build/windows-pipeline.md`** -- the build pipeline sketch: pin versions, hydrate payload, compute SHA-256 manifest, PyInstaller-freeze the wizard, run `makensis`, sign, upload artifact. Documents the 5.5-6.5 GB payload budget and the local-dev build sequence.
- **`.github/workflows/installer-build.yml`** (new) -- CI placeholder for the Windows build. Gated behind `workflow_dispatch` until the payload-fetch script (`9.P1.ZZ`) lands. Job steps are present but currently `Write-Host TODO ...` stubs that the Phase 9 follow-on commit fills in.

### 9.2 -- CUDA toolkit detection + provisioner

- **`scripts/installer/pyqt/src/nexus_installer/engine/cuda_provisioner.py`** (new) --
  - `detect_driver_version()` -- probes `nvidia-smi --query-gpu=driver_version --format=csv,noheader`, returns `(major, minor, raw)`. Falls back to `C:\Windows\System32\nvidia-smi.exe` on Windows when the PATH lookup misses. Returns zeros on CPU-only hosts.
  - `is_cuda_12_1_supported(driver_major)` -- gate at `>= 530`.
  - `decide_install_mode(driver_major, has_payload)` -- ternary: `"gpu"` / `"cpu-fallback"` / `"missing-payload"`.
  - `cpu_fallback_dialog_text()` -- user-facing copy for the CPU-only confirmation dialog.
  - `CudaProvisioner(payload_dir).install(log)` -- copies `payload/cuda-12.1-runtime/*` into `%LOCALAPPDATA%\Nexus\runtime\cuda\` (or the platform equivalent). Replaces any pre-existing target. Returns success bool.
- **`scripts/installer/pyqt/tests/test_cuda_provisioner.py`** (new, 15 tests, all passing): driver-version parsing, CUDA 12.1 driver gate, decision table, dialog copy, no-payload path, happy-path copy, replace-existing-target.

### 9.3 -- Python venv + diffusion stack (offline wheels)

- **`scripts/installer/pyqt/src/nexus_installer/engine/diffusion_venv_provisioner.py`** (new) --
  - `REQUIRED_WHEEL_PREFIXES` -- the 12 wheel distributions the diffusion stack needs (`torch`, `torchvision`, `torchaudio`, `diffusers`, `transformers`, `accelerate`, `safetensors`, `xformers`, `Pillow`, `imageio`, `controlnet_aux`, `opencv_python_headless`).
  - `find_missing_wheels(wheels_dir)` -- returns the prefixes with no matching wheel. Matches `prefix-` (with trailing hyphen) to avoid `torch` shadowing `torchvision` / `torchaudio` in the prefix scan.
  - `DiffusionVenvProvisioner(payload_dir).preflight()` -- early fail if any wheel or `requirements.txt` is missing.
  - `.create_venv(log)` -- runs `python -m venv ...` against the bundled embeddable Python interpreter from the payload.
  - `.install_wheels(log)` -- runs `pip install --no-index --find-links <wheels> -r requirements.txt --disable-pip-version-check` against the venv's pip. Fully offline.
  - `cuda_smoke_test_command(venv_path)` -- returns argv that prints `True` when `torch.cuda.is_available()` (the manual smoke gate from the Phase 9.3 acceptance criterion).
- **`scripts/installer/pyqt/tests/test_diffusion_venv_provisioner.py`** (new, 9 tests, all passing): missing-wheels detection, prefix-collision guard, preflight pass/fail, venv-create subprocess plumbing, install-wheels failure handling, smoke-test command shape.

### 9.4 -- Node + Ollama provisioner

- **`scripts/installer/pyqt/src/nexus_installer/engine/node_provisioner.py`** (new) --
  - `runtime_root()` / `node_executable()` -- platform-aware target paths under `%LOCALAPPDATA%\Nexus\runtime\node\` (or equivalent).
  - `NodeProvisioner(payload_dir).install(log)` -- copies `payload/node/` into the runtime tree, replacing any prior install. `.verify(log)` runs `node --version` against the bundled executable.
  - `add_to_user_path_windows(directory, log)` -- non-destructively prepends a directory to the user's HKCU\Environment\Path. Reads-then-writes so existing entries survive; uses `REG_EXPAND_SZ` to match Windows' canonical PATH variable type. No-op on non-Windows hosts (returns `True`).
  - `ollama_service_running_windows()` -- returns `True` when `sc query Ollama` reports `STATE: RUNNING`.
  - `offline_ollama_installer_path()` / `run_bundled_ollama_setup()` -- runs the bundled `payload/ollama/OllamaSetup.exe /S` silently; Windows-only; gracefully short-circuits on non-Windows hosts.
- **`scripts/installer/pyqt/tests/test_node_provisioner.py`** (new, 12 tests, all passing): runtime-root resolution, platform-specific executable suffix, install + replace flow, verify failure when binary missing, PATH non-Windows short-circuit, Ollama helper guards.

### 9.5 -- Recommended-models picker page

- **`scripts/installer/pyqt/src/nexus_installer/pages/recommended_models.py`** (new) -- new wizard page. Three preset bundles:
  - **Light** (8 GB VRAM, ~12 GB on disk): Gemma 4 E2B + SDXL Turbo + LTX-Video.
  - **Recommended** (12 GB+ VRAM, ~25 GB on disk): Gemma 4 E4B + Llama 3.1 8B + SDXL Turbo + LTX-Video + Stable Video Diffusion.
  - **Full** (24 GB+ VRAM, ~70 GB on disk): Gemma 4 26B MoE + Llama 3.1 8B + Qwen 2.5 Coder 7B + SDXL 1.0 + Flux Schnell + LTX-Video + SVD + CogVideoX 2B.
  - `pick_default_preset(vram_gb)` picks the largest fitting preset; the page renders three radio-button "preset cards" with per-model checkboxes inside each.
  - An "Advanced" tab can be populated with the full registry catalog (currently empty + a placeholder message; wired in by Phase 10 sync).
  - `estimate_download_minutes(total_gb, mbps=200.0)` shows a live total + download-time estimate at the bottom.
  - A "Skip download" checkbox lets the user finish the install and run `nexus models install ...` later.
  - `ModelSelection` dataclass carries `preset | selected_models | skipped` for the InstallEngine to consume.
- **`scripts/installer/pyqt/tests/test_recommended_models.py`** (new, 16 tests, all passing): preset data integrity, increasing VRAM, default-preset picker across the VRAM spectrum, download-time estimator (zero-size short-circuit, default throughput, faster-pipe-fewer-minutes), `ModelSelection.total_gb()` sums correctly, page renders with default state for high-end + low-end VRAM.

Note: the new page is not yet inserted into the wizard's `window.py` step controller (the legacy `pages/model_selection.py` is still the step's renderer). The `InstallerState` schema needs a small extension (`selected_models: list[str]`) before wiring. Tracked as `9.P2.DDD`.

### 9.6 -- Frozen DevAI-Hub baseline bundle

- **`scripts/installer/devai-hub-baseline.json`** (new) -- the pinned-baseline manifest. Fields: `source.repo`, `source.tag`, `source.sha`, `source.subtree_paths`, `artifact.filename`, `artifact.contentHash`, `artifact.approxSizeBytes`, `install.targetDir`, `install.namespace`, `install.registerWithSkillCatalog`, `updateChannel.command`. Currently has placeholder zeros for `sha` + `contentHash`; tracked as `9.P1.AAA`.
- **`scripts/installer/pyqt/src/nexus_installer/engine/devai_hub_provisioner.py`** (new) --
  - `DevAIBaselineManifest.from_json(path)` -- loads + parses the manifest.
  - `sha256_file(path)` -- returns the `sha256:<hex>` content hash of a file.
  - `DevAIHubProvisioner(payload_dir, manifest_path).install(log)` -- verifies the tarball SHA against the manifest (skips when the manifest's hash is the placeholder zero string), then extracts via a path-traversal-hardened `_safe_extract()` that resolves every member path and rejects entries outside the target root (CVE-2007-4559 mitigation). Uses Python 3.12's `tarfile.extractall(filter="data")` to also pick up the standard-library hardening.
- **`scripts/installer/pyqt/tests/test_devai_hub_provisioner.py`** (new, 7 tests, all passing): manifest parsing, no-tarball warning path, happy-path extract + log, replace-existing target, content-hash mismatch is fatal, correct-hash succeeds, **path-traversal evil-tarball is rejected before any file is written**.

### 9.7 -- NSIS outer installer template + Settings registry + Start Menu

- **`scripts/installer/build/nsis/nexus-setup.nsi`** (new) -- the canonical NSIS template. Sections:
  - UAC elevation (`RequestExecutionLevel admin`), MUI2 wizard pages.
  - Payload extraction to `$TEMP\Nexus-Setup\` with `File /r`.
  - Manifest pre-flight verification step that runs `nexus-installer.exe --verify-only`.
  - Wizard launch with `--install-dir "$INSTDIR"`.
  - `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\Nexus` registry entry with `DisplayName / DisplayVersion / Publisher / URLInfoAbout / InstallLocation / UninstallString / NoModify / NoRepair / EstimatedSize`.
  - Start Menu shortcut at `$SMPROGRAMS\Nexus\Nexus.lnk`.
  - Optional Desktop shortcut (gated by a checkbox component).
  - `.nexus-workflow.json` -> `Nexus.Workflow` ProgID -> `shell\open\command`.
  - `nexus://` URL handler under `HKCR\nexus\shell\open\command`.
  - Uninstaller that prompts to preserve `~\.nexus\` (default keep), removes `%LOCALAPPDATA%\Nexus\`, the wizard cache, all shortcuts, and every registry entry.

End-to-end build of `Nexus-1.0.0-Setup.exe` is not yet exercised in CI (deferred to the Phase 9 follow-on once the payload-fetch script lands). Tracked as `9.P1.CCC`.

### 9.8 -- macOS + Linux installer scope (v1.0.1 / v1.0.2)

- **`docs/v1.0.0/installer-macos-and-linux.md`** (new) -- scope + sequencing for the cross-platform installers. Documents the macOS DMG (Universal binary, Apple Developer ID + notarization, MPS path on Apple Silicon, CPU fallback on Intel) and the Linux AppImage (statically linked to glibc 2.31+, same CUDA detection as Windows, ROCm deferred to v1.1.0+). Cross-platform invariants -- the PyQt wizard is reused unchanged; only the outer-shell packaging differs.
- **`.github/workflows/installer-macos.yml`** (new) -- workflow_dispatch CI placeholder.
- **`.github/workflows/installer-linux.yml`** (new) -- workflow_dispatch CI placeholder; preinstalls `fuse / libfuse2 / appimagetool`.

### 9.9 -- Tests + smoke checklist

- **`docs/v1.0.0/installer-smoke-checklist.md`** (new) -- operator-facing manual checklist for the fresh-VM install gate (Phase 9 acceptance "A fresh Windows 11 VM with no Python / Node / CUDA / Ollama runs `Nexus-1.0.0-Setup.exe`..."). Sections: pre-flight, installer-run, provisioning expectations, first-launch app smoke, uninstall path, a "Latest Run" result table.
- 59 new installer unit tests across `tests/test_cuda_provisioner.py`, `tests/test_diffusion_venv_provisioner.py`, `tests/test_node_provisioner.py`, `tests/test_recommended_models.py`, `tests/test_devai_hub_provisioner.py`. All pass.

## Test results

```
Installer suite:        245 / 245 passing
Desktop vitest suite:   351 / 351 passing
Frontend lint:          clean (eslint --max-warnings=0)
Frontend typecheck:     clean (tsc --noEmit)
```

The Tauri `cargo check` leg of `shell-build.yml` cannot be exercised on this host (no Rust toolchain installed), but the two CI errors that broke the previous push -- missing icon assets and the missing `Manager` import -- are both addressed. The next push runs the workflow end-to-end on the GitHub-hosted matrix runners.

## Deviations from the plan

- The recommended-models picker (9.5) lands as a standalone page + tests, but is not yet wired into the wizard step flow. Reason: `InstallerState` needs a small schema extension to carry the multi-model list. Tracked as `9.P2.DDD` rather than blocking Phase 9 close.
- The payload-fetch script (`scripts/installer/build/fetch-payload.py`) referenced by `installer-build.yml` is not yet implemented. Phase 9 lands the architecture, the provisioners, the NSIS template, and the CI workflow stubs; the payload-fetch script + first end-to-end installer artifact is a Phase 9 follow-on. Tracked as `9.P1.ZZ`.

## Known gaps added (see `docs/v1.0.0/known-gaps.md`)

- `9.P1.ZZ` -- installer payload-fetch script not yet implemented (P1, DF).
- `9.P1.AAA` -- DevAI-Hub baseline + Ollama pinned SHAs are placeholder zeros (P1, DF).
- `9.P2.BBB` -- Tauri icon assets are functional placeholders (P2, DF).
- `9.P1.CCC` -- NSIS outer installer not yet built end-to-end (P1, DF).
- `9.P2.DDD` -- recommended-models picker not yet wired into the wizard step flow (P2, NI).
- `9.P2.EEE` -- macOS + Linux installers deferred to v1.0.1 / v1.0.2 (P2, DF).

## Known gaps resolved

- `1.P2.E` -- Tauri icons placeholder. Generated icon set + `scripts/desktop/generate-icons.py` reproducible generator commits in this phase, unblocking the `shell-build.yml` matrix.

## Next phase

Phase 10 -- DevAI-Hub sync (`docs/v1.0.0/plans/phase-10-devai-hub-sync.md`): wire `nexus skills sync` against the bundled baseline this phase deploys, expose the SkillCatalog through the Coding slash-command dropdown, and round-trip an update without re-installing the app.
