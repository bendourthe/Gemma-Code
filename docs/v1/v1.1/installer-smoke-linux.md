# v1.1.0 RTM smoke checklist -- Linux (Ubuntu 24.04)

Manual smoke run for the cross-OS installer AppImage on Linux. Source: Phase
14 sub-tasks 14.1 through 14.12. Phase 15 sign-off requires this checklist
to pass end-to-end on both an NVIDIA host and an AMD/CPU host.

## Test hosts

- [ ] Ubuntu 24.04 LTS VM, glibc 2.31+
- [ ] Variant A: NVIDIA RTX 3060+ with driver >= 530
- [ ] Variant B: AMD RX 7600+ with ROCm installed (or no AMD GPU)
- [ ] At least 120 GB free
- [ ] Network reachable to `huggingface.co`, `github.com`, `ollama.com`

## Step-by-step (~30 minutes per variant)

### Pre-launch

1. [ ] Download `Nexus-1.1.0.AppImage`. `chmod +x Nexus-1.1.0.AppImage`.
2. [ ] Run `./Nexus-1.1.0.AppImage`. If FUSE is missing, the AppImage shows a clear error pointing to `libfuse2`.

### Welcome + prerequisites

3. [ ] Welcome page renders.
4. [ ] Prerequisites runs `host_detect()`. Verify OS = "Ubuntu 24.04", arch = "x86_64".
       Variant A: GPU vendor = "nvidia", cuda_compatible = True.
       Variant B: GPU vendor = "amd", rocm_compatible = True (or `gpu_vendor = "none"` if no AMD GPU).

### GPU detection + install path

5. [ ] GPU detection page shows the right vendor.
6. [ ] Install path defaults to `~/.local/share/nexus/`.

### Recommended models tabs

7. [ ] Four tabs render with the same pre-ticked sets as Windows / macOS.
8. [ ] Tick the SANA family + LTX-Video.

### Disk-aware footer

9. [ ] Footer behaves identically to Windows / macOS.

### VS Code extension add-on

10. [ ] If `code` is on PATH, the checkbox is pre-ticked.

### Storage review page

11. [ ] Storage Review shows runtime cost that includes CUDA (Variant A) or excludes it (Variant B / CPU-only).

### Install click guard

12. [ ] Same as Windows / macOS: pass on a fitting selection, fail with a dialog on a too-large one.

### Provisioner chain

13. [ ] Variant A: `cuda-linux` -> `linux-python` -> `node` -> `ollama-linux` -> `ffmpeg` -> `devai-hub`.
14. [ ] Variant B with ROCm: `rocm` -> `linux-python` -> `node` -> `ollama-linux` -> `ffmpeg` -> `devai-hub`.
15. [ ] Variant B without ROCm: `cpu-only` -> `linux-python` -> `node` -> `ollama-linux` -> `ffmpeg` -> `devai-hub`. Confirm the CPU-fallback dialog appears.

### Ollama install

16. [ ] If the bundled tarball is present (`payload/ollama/ollama-linux-amd64.tgz`), it is extracted to `/usr/local/`.
17. [ ] Otherwise, `install.sh` is downloaded with SHA-256 verification and executed.

### First-launch migration

18. [ ] If `~/.gemma-code/` exists, after install `~/.nexus/` is populated and `~/.gemma-code/` becomes a POSIX symlink.

### App functional smoke

19. [ ] Nexus app first launch renders the dashboard.
20. [ ] Coding session works.
21. [ ] Image Studio renders a SANA image (CUDA on Variant A, CPU-only fallback elsewhere; expect slower iteration time).
22. [ ] Video Lab renders an LTX-Video clip.
23. [ ] VS Code extension visible if installed.

### Uninstall

24. [ ] Delete the AppImage + `~/.local/share/nexus/`. Verify `~/.nexus/` is preserved.
25. [ ] Re-install: every step is idempotent.

## Sign-off

- Smoked by: ___________________
- Date: ___________________
- Variant: A (NVIDIA) / B-ROCm / B-CPU only
- Result: PASS / FAIL
- Notes:
