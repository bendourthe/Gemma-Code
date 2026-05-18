# Nexus v1.0.0 -- operator smoke checklist (Phase 9.9)

**Audience**: the operator who builds and validates `Nexus-1.0.0-Setup.exe` on a fresh Windows 11 VM.
**Frequency**: once per release candidate, plus any time the payload version pins change in `scripts/installer/build/windows-pipeline.md`.

The unit tests under `scripts/installer/pyqt/tests/` cover the wizard logic, but the end-to-end "fresh VM with no Python / Node / CUDA / Ollama" path can only be validated by running the installer on a real (or VM) Windows 11 box. This checklist is the manual gate. Record the result under `## Latest Run` and link the date in `docs/v1.0.0/operator-actions.md`.

## Pre-flight

- [ ] VM is Windows 11 22H2 or 23H2 fully patched.
- [ ] VM has **no** prior Nexus install (delete `%LOCALAPPDATA%\Nexus\` if present).
- [ ] VM has **no** Python 3.x on PATH.
- [ ] VM has **no** Node on PATH.
- [ ] VM has **no** Ollama service installed.
- [ ] For the GPU path: VM has an NVIDIA GPU with driver 530.x or newer.
- [ ] For the CPU path: VM has no NVIDIA GPU (or the driver is below 530.x).

## Installer run

1. [ ] Download `Nexus-1.0.0-Setup.exe` from the GitHub release.
2. [ ] Right-click -> Properties -> Digital Signatures: confirm Authenticode signature is **Valid** (signed by Nexus). (Tracked as v1.1 hardening if not yet provisioned.)
3. [ ] Double-click. UAC prompt appears.
4. [ ] Accept UAC. Welcome page renders.
5. [ ] Accept the license, click Next.
6. [ ] Install path defaults to `%LOCALAPPDATA%\Nexus`. Leave default.
7. [ ] GPU Detection page detects GPU (or shows the CPU-only fallback dialog).
8. [ ] On the **Recommended Models** page, the default preset matches the VM's VRAM class (Light <8 GB, Recommended 12 GB+, Full 24 GB+).
9. [ ] Either accept the default preset or pick "Light" to keep the test under 15 GB.
10. [ ] Optional: toggle on the "Add Desktop shortcut" checkbox.
11. [ ] Review page lists exactly what will be installed.
12. [ ] Hit **Install**.

## Provisioning expectations

| Step | Expected behavior |
|---|---|
| CUDA copy | `%LOCALAPPDATA%\Nexus\runtime\cuda\` populated (~1.5 GB). Skipped on CPU-only VMs. |
| Python embeddable | `%LOCALAPPDATA%\Nexus\python\` populated. |
| Wheels install | `%LOCALAPPDATA%\Nexus\python\venv\` exists; `python -c "import torch; print(torch.cuda.is_available())"` returns `True` (GPU VM) or `False` (CPU VM). |
| Node 22 | `%LOCALAPPDATA%\Nexus\runtime\node\node.exe --version` prints `v22.x.y`. |
| Ollama | `sc query Ollama` returns `STATE: 4 RUNNING`. |
| Models | `~/.nexus/models/` contains the chosen models with valid SHA-256 (registry verifies). |
| DevAI-Hub baseline | `~/.nexus/skills/devai-hub/<tag>/catalog/` exists. |
| Start Menu | `Start -> All apps -> Nexus -> Nexus` launches the app. |
| Desktop shortcut | (if enabled) Double-clicking `Desktop\Nexus.lnk` launches the app. |
| File association | Double-click any `.nexus-workflow.json` -> Nexus opens it. |
| URL handler | `start nexus://test` in cmd opens the app with `test` as a CLI arg. |
| Uninstall registry | `appwiz.cpl` lists Nexus with the correct version + Publisher. |

## First-launch app smoke

1. [ ] Launch Nexus from the Start Menu.
2. [ ] Dashboard renders. All four pillars show "Ready".
3. [ ] Coding module: open a folder, send a `> Hello` prompt; the agent responds.
4. [ ] Chatbot module: send a `> Hello`; the model streams a response.
5. [ ] Image module: enter a prompt, run; the image generates within reasonable time (GPU VM: <60 s for 512x512).
6. [ ] Video module: same; check the produced MP4 has metadata via `ffprobe -i`.
7. [ ] Settings -> Models: the registry lists every installed model.
8. [ ] Quit Nexus. Confirm the sidecar process exits cleanly (no orphan `node.exe`).

## Uninstall path

1. [ ] Open `appwiz.cpl`.
2. [ ] Select Nexus, click Uninstall.
3. [ ] Confirm UAC.
4. [ ] On the data-preservation prompt, pick **Yes (preserve)**.
5. [ ] After uninstall:
   - [ ] `%LOCALAPPDATA%\Nexus\` removed.
   - [ ] `~/.nexus/` preserved (models + skills + settings).
   - [ ] Start Menu shortcut removed.
   - [ ] Desktop shortcut removed (if it existed).
   - [ ] Registry: `HKLM\...\Uninstall\Nexus` removed.
   - [ ] File association removed (`HKCR\.nexus-workflow.json`).
   - [ ] URL handler removed (`HKCR\nexus`).
6. [ ] Re-run the uninstaller flow on a fresh install but this time pick **No (delete)**:
   - [ ] `~/.nexus/` is removed.

## Result

| Field | Value |
|---|---|
| VM image | (e.g. Windows 11 23H2 build 22631.4602) |
| GPU + driver | (e.g. RTX 3070 driver 551.86) or `CPU-only` |
| Installer size | (bytes) |
| Install time | (start -> dashboard, hh:mm:ss) |
| Outcome | PASS / FAIL |
| Failures | (list each failed step + the screenshot path) |

## Latest Run

_Not yet executed. The first scheduled run is the v1.0.0-rc1 build (Phase 11 release hardening)._

## Cross-links

- [installer-architecture.md](installer-architecture.md)
- [installer-macos-and-linux.md](installer-macos-and-linux.md)
- [plans/phase-09-installer.md](plans/phase-09-installer.md)
- [plans/phase-11-hardening-and-release.md](plans/phase-11-hardening-and-release.md) -- where the release dry-run hooks into the smoke gate.
