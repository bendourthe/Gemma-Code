# v1.1.0 RTM smoke checklist -- Windows 11 x64

Manual smoke run for the cross-OS installer on Windows. Source: Phase 14
sub-tasks 14.1 through 14.12. Phase 15 sign-off requires this checklist to
pass end-to-end on a fresh Windows 11 VM.

## Test host

- [ ] Fresh Windows 11 23H2 x64 VM, no Python / Node / CUDA / Ollama / Git
- [ ] Discrete NVIDIA GPU surfaced to the VM (RTX 3060 minimum; RTX 4070 preferred)
- [ ] At least 120 GB free on the install volume
- [ ] Network reachable to `huggingface.co`, `github.com`, `ollama.com`

## Step-by-step (~30 minutes)

### Pre-launch

1. [ ] Download `Nexus-1.1.0.exe` (the NSIS outer shell). Verify Authenticode signature is "Valid" with the trusted Nexus signer.
2. [ ] Launch the installer. UAC prompt appears once; accept.

### Welcome + prerequisites

3. [ ] Welcome page renders without errors. Version footer shows `Nexus 1.1.0`.
4. [ ] Prerequisites page runs `host_detect()`. Verify the detected fields:
       OS = "Windows 11 23H2", arch = "x86_64", GPU vendor = "nvidia",
       GPU model includes "RTX", driver version >= 530, total VRAM > 0.

### GPU detection + install path

5. [ ] GPU detection page shows the NVIDIA GPU + recommended model tier.
6. [ ] Install path defaults to `%LOCALAPPDATA%\Nexus`. Override to a custom path; confirm the disk-aware footer recomputes free disk space on the new volume.

### Recommended models tabs (Phase 14.6)

7. [ ] Recommended Models page renders four tabs: Text / Image / Video / Audio.
8. [ ] Text tab: `gemma4:e4b`, `llama3.1:8b`, `qwen2.5-coder:7b` pre-ticked.
9. [ ] Image tab: `sana-1.6b-1024` and `sana-sprint-1024` pre-ticked.
10. [ ] Video tab: `ltx-video` pre-ticked.
11. [ ] Audio tab shows "No audio models recommended yet."
12. [ ] Each card displays size on disk, compatibility badge, release date, license, multimodality flag, censored flag. Text cards include context window.
13. [ ] Tick five additional large models so total selection exceeds `free_disk_gb - 10 GB`. Confirm further checkboxes grey out with the tooltip "Would dip below the 10 GB OS reserve. Free up disk or untick another model."

### Disk-aware footer (Phase 14.5)

14. [ ] Footer at bottom always shows `Free: X GB / Selected: Y GB / Remaining after install: Z GB`.
15. [ ] Color goes red when remaining drops below 10 GB, yellow below 20 GB, green otherwise.

### VS Code extension add-on (Phase 14.7)

16. [ ] If `code` is on PATH, the checkbox is pre-ticked. Otherwise unticked.
17. [ ] Untick and continue: no extension install happens at the end of the wizard.

### Storage review page (Phase 14.11)

18. [ ] Storage Review shows Free, Required for runtime, Required for selected models, Required for DevAI-Hub baseline, OS reserve, and Net after install (color matches the math).

### Install click guard (Phase 14.8)

19. [ ] Click "Begin Installation" with a selection that fits: install proceeds.
20. [ ] Re-run the installer; on the Storage page, externally fill the disk so free drops below selection + 10 GB. Click Install -- expect a "Insufficient disk space (need X GB free, have Y GB)" dialog and a bounce back to the model picker.

### Provisioner chain (Phases 14.2, 14.3, 14.4)

21. [ ] Watch the log: provisioners run in this order -- `cuda` -> `windows-python` -> `node` -> `ollama-windows` -> `ffmpeg` -> `devai-hub`.

### First-launch migration (Phase 14.12)

22. [ ] If `~/.gemma-code/` (Windows: `%USERPROFILE%\.gemma-code\`) exists from v1.0.0, verify that after install `%USERPROFILE%\.nexus\` is populated and the legacy directory contains `MOVED-TO-NEXUS.txt`.
23. [ ] Without the legacy dir, the new `.nexus` is created empty (`fresh-install`).

### App functional smoke

24. [ ] Nexus app first launch renders the dashboard.
25. [ ] Open Coding module; ask a simple question; verify a response from `gemma4:e4b`.
26. [ ] Open Image Studio; generate a 1024px image with SANA; verify it lands in the Library tab.
27. [ ] Open Video Lab; render a short clip with LTX-Video; verify it plays.
28. [ ] Open VS Code; the Nexus Coding extension is visible (if the box was ticked); the side panel connects to the local sidecar.

### Uninstall

29. [ ] Uninstall via Add/Remove Programs. Verify `%LOCALAPPDATA%\Nexus` is removed; verify `%USERPROFILE%\.nexus\` is **preserved** (user data).
30. [ ] Re-install on top of the previous run: every step is idempotent; no duplicate models downloaded.

## Sign-off

- Smoked by: ___________________
- Date: ___________________
- Result: PASS / FAIL
- Notes:
