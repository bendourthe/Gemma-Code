# v1.1.0 -- Operator actions

**Audience**: release operator (Benjamin Dourthe initially).
**Purpose**: consolidated checklist of items that require human action outside the codebase to close the v1.1.0 cycle. Each item references the originating known-gap or phase plan so the carry-forward path is traceable.

This file follows the structure established by `docs/v1.0.0/operator-actions.md`. Each operator-action item has a stable ID (`OA-NN`) that other docs reference. v1.1.0 OA ids continue the v1.0.0 numbering scheme; carry-forwards from v1.0.0 keep their original ids.

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

## References

- [v1.0.0 operator-actions](../v1.0.0/operator-actions.md) -- the upstream OA-NN list (OA-01 through OA-12).
- [v1.1.0 known-gaps](known-gaps.md) -- the source-of-truth gap log this file derives from.
- [Phase 12 plan](plans/phase-12-image-studio-sana.md) -- Image Studio + SANA family integration.
