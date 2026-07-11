# v1.1.0 -- Operator actions

**Audience**: release operator (Benjamin Dourthe initially).
**Purpose**: consolidated checklist of items that require human action outside the codebase to close the v1.1.0 cycle. Each item references the originating known-gap or phase plan so the carry-forward path is traceable.

This file follows the structure established by `docs/versions/v1/v1.0.0/operator-actions.md`. Each operator-action item has a stable ID (`OA-NN`) that other docs reference. v1.1.0 OA ids continue the v1.0.0 numbering scheme; carry-forwards from v1.0.0 keep their original ids.

---

## Pending operator actions

### OA-09 -- Live diffusion bench capture on real GPU (carried forward from v1.0.0 + extended for SANA in v1.1.0 Phase 12)

- **Reference**: v1.0.0 OA-09 (closes v1.0.0 known-gaps 6.P1.GG, 6.P1.II, 7.P1.MM, 7.P3.TT); v1.1.0 Phase 12 plan ([phase-12-image-studio-sana.md](plans/phase-12-image-studio-sana.md)) Stability Gate.
- **What**: On the RTX 4070 baseline rig, install the SANA-augmented PyTorch / diffusers / nunchaku stack (per the updated `runtimes/diffusion/requirements.txt`) and capture real timings + sample outputs for the following targets:

  | Pipeline | Target (RTX 4070) | Notes |
  |---|---|---|
  | SANA-1.6B 1024x1024 txt2img | <= 1.5 s | Replaces SDXL Turbo as the v1.1.0 default. |
  | Sana-Sprint 1024x1024 txt2img (1-step, Flow-DPM-Solver) | <= 0.5 s | Backs the Image Studio "Fast Preview" toggle. |
  | SANA 2K (2048x2048) txt2img | <= 8 s on `diffusion-mid` host | Gated to `diffusion-mid+`. |
  | SANA 4K (4096x4096) txt2img | <= 30 s on `diffusion-high` host | Gated to `diffusion-high+`. |
  | SANA INT4 (SVDQuant via nunchaku) | <= 2 s on RTX 3060 8 GB | Validates the `diffusion-low` tier path. |
  | SANA-ControlNet pose / depth / canny | preview cards render; conditioning preview round-trips | Reuses Phase 6 preprocessors. |
  | SANA-Video 2B 4 s @ 720p | <= 60 s | Adds the Fast 720p tier to Video Lab. |

  Drop a real diffusers-backed `_execute(ctx)` into each new pipeline module (`runtimes/diffusion/pipelines/sana*.py`) replacing the `base.select_executor(...)` stub, and commit a fixture clip + still under `tests/golden/v1.1.0/{image,video}/sana/` for each entry.

  Also continue to capture v1.0.0 OA-09 entries (SDXL Turbo, SDXL 1.0, img2img, inpaint, outpaint, LTX-Video, SVD, CogVideoX 5B) so the v1.0.0 known-gaps closure remains traceable.

- **Blocked by**: nothing (real-GPU rig). Phase 14 (cross-OS installer) prerequisite: the SANA wheel manifest must ship in the installer payload.
- **Status**: pending (open v1.1.0 known-gap 12.9.P1.* once the gap log records this).

### OA-V1.1.0-12A -- Rotate SANA placeholder SHA-256 digests in the model catalog

- **Reference**: v1.1.0 Phase 12 plan ([phase-12-image-studio-sana.md](plans/phase-12-image-studio-sana.md)) sub-task 12.1; folds into v1.0.0 OA-03.
- **What**: `core/registry/catalog.json` carries `"sha256": "0".repeat(64)` placeholders for the ten SANA-family entries (`sana-1.6b-1024`, `sana-sprint-1024`, `sana-1.6b-2k`, `sana-1.6b-4k`, `sana-1.6b-int4`, `dc-ae-f32c32-sana-1.1`, `sana-controlnet-{pose,depth,canny}`, `sana-video-2b-720p`). Capture each canonical digest from the upstream HuggingFace repos (`Efficient-Large-Model/*`, `mit-han-lab/dc-ae-f32c32-sana-1.1`) and update the catalog. `tests/unit/core/registry/catalog-digests.test.ts` recognizes the new entries and enumerates the placeholders; closure of OA-03 should make the placeholder list empty.
- **Blocked by**: nothing -- can run in parallel with OA-09.
- **Status**: pending.

---

## Phase 15 release-gate operator actions

### OA-V1.1.0-15A -- Live deep review chain (`/run-deep-review`)

- **Reference**: v1.1.0 Phase 15 plan ([phase-15-hardening-and-release.md](plans/phase-15-hardening-and-release.md)) sub-task 15.1.
- **What**: Run `/run-deep-review` (which internally chains `analyze-codebase` + `review-codebase` + `run-security-audit` + `run-penetration-test --depth=deep`) against the v1.1.0 delta. Output under [docs/versions/v1/v1.1.0/review/](review) mirroring the v1.0.0 layout. The static portion ships in this commit (`synthesis.md` Section 8); the live chain is operator-gated because the active host lacks the full DevAI-Hub skill harness wiring + the network egress + the headed display. Triage every finding: P0 / P1 -> close in this phase before the v1.1.0 tag pushes; P2 / P3 -> log into `docs/versions/v1/v1.1.0/known-gaps.md`.
- **Expected outputs**: `docs/versions/v1/v1.1.0/review/analyze-codebase.md`, `docs/versions/v1/v1.1.0/review/review-codebase.md`, `docs/versions/v1/v1.1.0/review/security-audit.md`, `docs/versions/v1/v1.1.0/review/penetration-test.md` (overlays the static `synthesis.md`).
- **Blocked by**: operator host with the full skill chain available.
- **Status**: pending.

### OA-V1.1.0-15B -- Live signing, notarization, AppImage smoke (OA-01 / OA-11 / OA-12 invocation)

- **Reference**: v1.1.0 Phase 15 plan sub-task 15.2 (rolls up the three live operator actions inherited from v1.0.0).
- **What**:
  1. **OA-01 (Windows EV signing)**: procure the EV Code Signing certificate + HSM (one-time), populate `WINDOWS_SIGNING_THUMBPRINT` + `WINDOWS_SIGNING_PIN` GitHub secrets, run `installer-build.yml` on the `v1.1.0` tag, confirm `Nexus-1.1.0-Setup.exe` is Authenticode-signed. SmartScreen reputation builds over time per OA-02.
  2. **OA-11 (macOS notarization)**: enroll the Apple Developer Program (if not already), procure Developer ID Application + Installer certs, populate the macOS workflow secrets, run `installer-macos.yml` on the tag, verify notarization succeeds and `Nexus-1.1.0.dmg` launches on a fresh macOS VM.
  3. **OA-12 (Linux AppImage smoke)**: run `installer-linux.yml` on the tag and verify `Nexus-1.1.0-x86_64.AppImage` launches on Ubuntu 22.04 + 24.04 + Fedora 40.
- **Acceptance**: signed Windows installer; notarized macOS DMG; tested Linux AppImage; the three OA entries in `docs/versions/v1/v1.0.0/operator-actions.md` are signed off with v1.1.0 timestamps.
- **Blocked by**: live signing key material + macOS host + three Linux VMs.
- **Status**: pending.

### OA-V1.1.0-15C -- SHA rotations + final brand icons (OA-06 / OA-07 invocation)

- **Reference**: v1.1.0 Phase 15 plan sub-task 15.3.
- **What**:
  1. Cut the `v1.1.0-baseline` tag in the upstream `bendourthe/DevAI-Hub` repo, fill the SHA-256 + commit SHA in `scripts/installer/devai-hub-baseline.json`, rotate `OLLAMA_WINDOWS_SHA256` / `OLLAMA_MACOS_SHA256` / `OLLAMA_LINUX_SCRIPT_SHA256` in `scripts/installer/pyqt/src/nexus_installer/engine/ollama_installer.py` per OS. Add CI assertion that the manifest content_hash matches `sha256sum payload/devai-hub-baseline.tar.gz`.
  2. Replace the procedurally-rendered Tauri icons under `desktop/src-tauri/icons/` with the final designer-authored set; the source asset committed under `assets/design/`; re-run `scripts/desktop/generate-icons.py` to regenerate the sized variants.
- **Acceptance**: CI passes the new hash assertions; the v1.1.0 build carries the final icons; the v1.0.0 carryforward 1.P2.C closes.
- **Blocked by**: upstream DevAI-Hub baseline tag + designer-authored icon asset.
- **Status**: pending.

### OA-V1.1.0-15D -- Golden task + GPU bench + live DevAI-Hub sync (OA-08 / OA-09 / OA-10 invocation)

- **Reference**: v1.1.0 Phase 15 plan sub-task 15.4.
- **What**:
  1. **OA-08**: with the three resident Ollama models (~22 GB total) on the operator rig, run `nexus-check golden --model <id>` against each of `gemma4:e4b`, `llama3.1:8b`, `qwen2.5-coder:7b`; commit the new trajectory fixtures under `tests/golden/v1.1.0/multi-llm/`.
  2. **OA-09**: with the four resident diffusion models (~17 GB total), run timing benchmarks for SANA-1.6B / Sana-Sprint / 2K / 4K / int4 / SANA-Video / LTX-Video / SVD; commit timings to `docs/versions/v1/v1.1.0/operator-actions.md` and verify they meet Phase 12 / 13 stability gates within +/-10%.
  3. **OA-10**: run `nexus skills sync` against the live upstream DevAI-Hub, verify the resulting `~/.nexus/skills/devai-hub/<tag>/manifest.json`, commit a redacted log to `docs/versions/v1/v1.1.0/operator-actions.md`.
- **Acceptance**: all three actions are completed and signed off; any timing regressions outside +/-10% open a known-gap entry.
- **Blocked by**: live GPU rig + live network egress + resident model weights.
- **Status**: pending.

### OA-V1.1.0-15E -- RTM smoke on Windows + macOS + Linux

- **Reference**: v1.1.0 Phase 15 plan sub-task 15.5; consumes the three Phase 14.13 RTM checklists.
- **What**: On a Windows 11 fresh VM, a macOS Sequoia fresh VM, and an Ubuntu 24.04 fresh VM, run through each `docs/versions/v1/v1.1.0/installer-smoke-{windows,macos,linux}.md` checklist top-to-bottom. Record results in `docs/versions/v1/v1.1.0/installer-smoke-{windows,macos,linux}-rtm.md`.
- **Acceptance**: every checklist signs off green; any partial-pass items either fix-and-re-test or open a tracked known-gap.
- **Blocked by**: three fresh VMs + signed installer artifacts from OA-V1.1.0-15B.
- **Status**: pending.

### OA-V1.1.0-15F -- semantic-release dry-run verification

- **Reference**: v1.1.0 Phase 15 plan sub-task 15.8.
- **What**: Run `npx semantic-release --dry-run` against the v1.1.0 tag. Verify it appends a new entry above the v1.0.0 block in `CHANGELOG.md` without overwriting it. If not, add a `@semantic-release/changelog` `changelogTitle` override.
- **Acceptance**: dry-run output matches the manually-written CHANGELOG entry from Phase 15.7 modulo formatting.
- **Blocked by**: `npm install` populated on the operator host (the active static-review host has not run `npm ci` in this session and the upstream `@semantic-release/*` plugins are not on the dependency path here).
- **Status**: pending.

---

## References

- [v1.0.0 operator-actions](../v1.0/operator-actions.md) -- the upstream OA-NN list (OA-01 through OA-12).
- [v1.1.0 known-gaps](known-gaps.md) -- the source-of-truth gap log this file derives from.
- [Phase 12 plan](plans/phase-12-image-studio-sana.md) -- Image Studio + SANA family integration.
- [Phase 15 plan](plans/phase-15-hardening-and-release.md) -- Hardening + release gate.
- [marketplace-transition.md](marketplace-transition.md) -- Phase 10 Marketplace transition checklist (OA-V1.1.0-10A + OA-V1.1.0-10B).
- [distribution.md](distribution.md) -- Phase 15.10 distribution channels.
- [release-notes.md](release-notes.md) -- Phase 15.7 user-facing release notes.
- [review/synthesis.md](review/synthesis.md) -- Phase 15.1 static deep-review synthesis.
