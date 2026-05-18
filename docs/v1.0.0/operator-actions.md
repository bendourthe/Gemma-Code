# v1.0.0 -- Operator actions

**Audience**: release operator (Benjamin Dourthe initially).
**Purpose**: consolidated checklist of items that require human action outside the codebase to close the v1.0.0 cycle. Each item references the originating known-gap so the carry-forward path is traceable.

This file follows the structure established by `docs/v0.8.0/operator-actions.md` and `docs/v0.9.0/operator-actions.md`. Each operator-action item has a stable ID (`OA-NN`) that other docs reference.

---

## Pending operator actions

### OA-01 -- Procure EV Code Signing certificate and sign the Windows installer

- **Reference**: [release-signing.md](release-signing.md) Section 1; known-gap 11.OA.01 (this file).
- **What**: Purchase an EV Code Signing certificate from DigiCert / GlobalSign / Sectigo; procure a FIPS 140-2 Level 2 HSM (DigiCert hardware token / YubiKey 5 FIPS); populate GitHub secrets `WINDOWS_SIGNING_THUMBPRINT` + `WINDOWS_SIGNING_PIN`; run `installer-build.yml` against the `v1.0.0` tag; confirm the output `Nexus-1.0.0-Setup.exe` carries a valid Authenticode signature (`signtool verify /pa /v`).
- **Blocked by**: cert procurement lead time (typically 5-10 business days; vetting for the legal entity).
- **Status**: pending.

### OA-02 -- Monitor SmartScreen reputation accrual post-release

- **Reference**: [distribution.md](distribution.md) Section 1.4.
- **What**: After the v1.0.0 GitHub Release is published, watch the early-install experience. SmartScreen reputation accrues automatically as installs complete without user rollback; the "More info" warning above the "Run" button on the SmartScreen dialog should disappear within the first hundreds of downloads. Track any user-reported install issues via GitHub Issues.
- **Status**: pending.

### OA-03 -- Rotate placeholder SHA-256 digests in the model catalog

- **Reference**: known-gap 5.P2.CC.
- **What**: `core/registry/catalog.json` currently carries `"sha256": "0".repeat(64)` placeholders for every HTTP-sourced model (SDXL Turbo, SDXL 1.0, FLUX Schnell, SD 1.5, LTX-Video, SVD, CogVideoX 5B / 2B). Capture the canonical digest for each weights file from the upstream host (HuggingFace's `lfs.sha256` field) and update the catalog. Add `core/registry/catalog-digests.test.ts` that asserts every non-Ollama entry has a non-zero digest.
- **Blocked by**: nothing -- can run in parallel with OA-01.
- **Status**: pending (open known-gap 5.P2.CC).

### OA-04 -- Execute the RTM smoke test

- **Reference**: [rtm-smoke.md](rtm-smoke.md) Section 12 (the recording template).
- **What**: Provision a clean Windows 11 VM with an RTX 4070 (or 12 GB+ NVIDIA GPU); run through every step of `rtm-smoke.md`; record the result + timings in the table below. Any anomalies become P3 known-gaps for v1.0.1.
- **Blocked by**: OA-01 (need the signed installer first).
- **Status**: pending.

#### RTM smoke results table (populate after execution)

```
## RTM smoke -- YYYY-MM-DD

| Phase | Time | Notes |
|---|---|---|
| Installer (UAC -> Done) | NN min | |
| First launch -> Dashboard | NN s | |
| Coding /create hello.py | NN s | first-token at NN ms |
| Chat 2+2 round-trip | NN s | |
| Image SDXL Turbo 1024x1024 | NN s | |
| Video LTX 4s @ 24fps @ 480p | NN min | |
| Skills sync | NN s | tag: <commit-sha> |
| Restart + persistence | passed | |
| Uninstall preserve-data | passed | |
| Uninstall delete-data | passed | |

**Anomalies**:
**Result**: PASS / FAIL
```

### OA-05 -- Stand up a direct-download landing page (v1.0.1)

- **Reference**: [distribution.md](distribution.md) Section 3.
- **What**: `https://nexus.bendourthe.com/download` (or equivalent) -- one-page download landing site with platform-aware CTAs. Out of scope for v1.0.0; logged here so it does not slip.
- **Blocked by**: nothing; explicit v1.0.1 work.
- **Status**: deferred to v1.0.1.

### OA-06 -- Cut the `DevAI-Hub@v1.0.0-baseline` upstream tag and rotate the baseline SHAs

- **Reference**: known-gap 9.P1.AAA.
- **What**: In the upstream `bendourthe/DevAI-Hub` repository, cut a tag named `v1.0.0-baseline`. Update `scripts/installer/devai-hub-baseline.json` with the real `{tag, sha, contentHash}` triple (currently `"0...".repeat(64)` placeholders). Also rotate `OLLAMA_WINDOWS_SHA256` and `OLLAMA_LINUX_SCRIPT_SHA256` in `scripts/installer/pyqt/src/nexus_installer/engine/ollama_installer.py` to the pinned upstream Ollama release. Add a CI assertion that the manifest content_hash matches `sha256sum payload/devai-hub-baseline.tar.gz`.
- **Status**: pending (open known-gap 9.P1.AAA).

### OA-07 -- Replace procedurally-rendered Tauri icons with designer art (v1.0.1)

- **Reference**: known-gap 9.P2.BBB.
- **What**: The Tauri icon set under `desktop/src-tauri/icons/` is a procedurally-rendered teal-on-charcoal "N". Commission or author the final v1.0.0 brand art, render to the same filenames via `scripts/desktop/generate-icons.py` (or export from the design tool). Operator action because it requires a designer / brand decision.
- **Status**: deferred to v1.0.1.

### OA-08 -- Live golden-task capture against the three LLM backends

- **Reference**: known-gap 3.P2.T.
- **What**: On a machine with `gemma4:e4b`, `llama3.1:8b`, and `qwen2.5-coder:7b` resident (~22 GB total), run `nexus check golden --model <id>` for each. Capture the resulting `read_file -> apply_edit` trajectory and commit the fixture under `tests/golden/v1.0.0/multi-llm/<model-id>.fixture.json`. This becomes the regression baseline for v1.1.0+.
- **Status**: pending (open known-gap 3.P2.T).

### OA-09 -- Live diffusion bench capture on real GPU

- **Reference**: known-gaps 6.P1.GG, 6.P1.II, 7.P1.MM, 7.P3.TT.
- **What**: Install the real PyTorch / diffusers / controlnet-aux / OpenCV stack on the RTX 4070 baseline rig. Drop a real diffusers-backed `_execute(ctx)` into each pipeline module (replacing the `base.stub_execute(mode)` / `video_base.stub_execute(method)` calls). Capture timings for: SDXL Turbo 1024x1024 (target <= 30 s), SDXL 1.0 1024x1024 (target <= 60 s), img2img / inpaint / outpaint, LTX-Video 4s @ 24fps @ 480p (target <= 5 min), SVD 4s (target <= 4 min), CogVideoX 5B opt-in. Sample one of each ControlNet preprocessor (pose / depth / canny) to `docs/v1.0.0/operator-actions.md`. Fixture clips committed under `tests/golden/v1.0.0/{image,video}/`.
- **Status**: pending (open known-gaps).

### OA-10 -- Live DevAI-Hub sync smoke

- **Reference**: known-gap 10.P1.FFF.
- **What**: On a clean Windows 11 VM, run `nexus skills sync --tag <pinned>` against the real `bendourthe/DevAI-Hub` upstream. Verify clone latency, tarball-fallback when git is unavailable (uninstall git, retry), and the resulting `~/.nexus/skills/devai-hub/<tag>/manifest.json`. Failures fold back into v1.0.1 as `[v1.0.0:10.P1.FFF]` carryovers.
- **Status**: pending (open known-gap 10.P1.FFF).

### OA-11 -- macOS DMG notarization (v1.0.1)

- **Reference**: [release-signing.md](release-signing.md) Section 2; known-gap 9.P2.EEE.
- **What**: At v1.0.1 cycle open, enroll in the Apple Developer Program (if not already), procure Developer ID Application + Developer ID Installer certs, follow the notarization workflow in Section 2 of release-signing.md, publish the signed + stapled DMG to GitHub Releases.
- **Status**: deferred to v1.0.1.

### OA-12 -- Linux AppImage build (v1.0.2)

- **Reference**: known-gap 9.P2.EEE.
- **What**: Stand up the AppImage outer-shell build in `installer-linux.yml`, run the Linux smoke checklist, publish to GitHub Releases.
- **Status**: deferred to v1.0.2.

---

## Resolved operator actions

| Item | Resolution | Phase / commit |
|---|---|---|
| _(carryover from v0.9.0 -- v0.9.0 operator-actions list closed at finalization; future v1.0.0 closures land here)_ | | |

---

## Inheritance notes

The v0.9.0 operator-actions list closes at the same time `docs/v0.9.0/known-gaps.md` flips to `finalized` (Phase 11.8). Any v0.9.0 operator action that was not picked up rolls forward into the equivalent v1.0.0 entry above:

| v0.9.0 OA | v1.0.0 disposition |
|---|---|
| Live Ollama golden-task capture | Rolled into OA-08 |
| Live GPU diffusion bench | Rolled into OA-09 |
| EV cert procurement (was v0.9.0 deferred) | Rolled into OA-01 |
