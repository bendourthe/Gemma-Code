# v1.1.0 RTM smoke checklist -- macOS Sequoia (Apple Silicon)

Manual smoke run for the cross-OS installer DMG on macOS. Source: Phase 14
sub-tasks 14.1 through 14.12. Phase 15 sign-off requires this checklist to
pass end-to-end on a fresh macOS Sequoia (14.x) Apple Silicon VM.

## Test host

- [ ] Fresh macOS 14.x VM (UTM / Parallels) on Apple Silicon (M-series)
- [ ] No Homebrew, no Python > 3.9 (system Python is fine), no Node, no Ollama
- [ ] At least 100 GB free on the install volume
- [ ] Network reachable to `huggingface.co`, `github.com`, `ollama.com`

## Step-by-step (~30 minutes)

### Pre-launch

1. [ ] Download `Nexus-1.1.0.dmg`. Verify Gatekeeper accepts it (notarization ticket stapled).
2. [ ] Mount the DMG; drag `Nexus.app` to `/Applications/`.
3. [ ] Launch `Nexus.app`. macOS shows the standard "downloaded from the internet" prompt the first time; accept.

### Welcome + prerequisites

4. [ ] Welcome page renders.
5. [ ] Prerequisites page runs `host_detect()`. Verify: OS family = "macos", arch = "arm64", GPU vendor = "apple", GPU model includes "M2"/"M1"/"M3"/"M4", metal_compatible = True.

### GPU detection + install path

6. [ ] GPU detection page shows the Apple GPU and a model tier recommended for the unified-memory budget (~75% of RAM).
7. [ ] Install path defaults to `~/Applications/Nexus.app` (or `/Applications/Nexus.app`).

### Recommended models tabs

8. [ ] Recommended Models page renders four tabs.
9. [ ] Text + Image + Video + Audio tabs match the same pre-ticked set as Windows.
10. [ ] Tick the SANA family + LTX-Video. Confirm the disk-aware footer recomputes.

### Disk-aware footer

11. [ ] Footer text + color behave identically to the Windows checklist.

### VS Code extension add-on

12. [ ] If `code` (or `code-insiders`) is on PATH, the checkbox is pre-ticked. Skip if no VS Code.

### Storage review page

13. [ ] Storage Review shows all rows. Verify `Required for runtime` excludes CUDA (CUDA not provisioned on macOS).

### Install click guard

14. [ ] With a fitting selection, Install proceeds. Re-run with a too-large selection and confirm the error dialog + bounce back.

### Provisioner chain

15. [ ] Watch the log: provisioners run -- `metal` (no-op MPS wheel install) -> `macos-python` -> `node` -> `ollama-macos` (copies Ollama.app + opens once) -> `ffmpeg` -> `devai-hub`.

### First-launch migration

16. [ ] If `~/.gemma-code/` exists, after install `~/.nexus/` is populated and `~/.gemma-code/` becomes a POSIX symlink pointing to `~/.nexus/`.

### App functional smoke

17. [ ] Nexus app first launch renders the dashboard.
18. [ ] Coding session against `gemma4:e4b` returns a response.
19. [ ] Image Studio renders a SANA image at 1024px on MPS (verify by toggling diagnostics that the backend is "mps", not "cpu").
20. [ ] Video Lab renders an LTX-Video clip.
21. [ ] VS Code extension visible if installed.

### Uninstall

22. [ ] Drag `Nexus.app` to Trash. Verify `~/.nexus/` is preserved (user data).
23. [ ] Re-install: every step is idempotent.

## Sign-off

- Smoked by: ___________________
- Date: ___________________
- Result: PASS / FAIL
- Notes:
