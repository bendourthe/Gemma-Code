# Phase 12 -- Image Studio upgrade (NVIDIA SANA family)

**Goal**: Adopt SANA as the new default 1024px image model and expose Sana-Sprint, 2K/4K, 4-bit, ControlNet, and Flow-DPM-Solver.
**Prerequisites**: Phase 3 (DiffusionTier defaults), Phase 14 (installer ships SANA weights).
**Stability Gate**: On an RTX 4070, a 1024x1024 SANA-1.6B txt2img completes in <= 1.5 s; Sana-Sprint completes in <= 0.5 s; 2K (2048x2048) completes on a `diffusion-mid` host in <= 8 s; 4K (4096x4096) completes on a `diffusion-high` host in <= 30 s; SANA 4-bit completes on a `diffusion-low` (8 GB) host in <= 2 s; SANA-ControlNet pose / depth / canny preview cards render; sampler dropdown lists Flow-DPM-Solver; multi-language prompt note appears; PNG workflow metadata round-trips.

**Adopts**: SANA S1, S2, S3, S4, S7, S8, S9, S10 (see [comparison-sana.md](../comparison-sana.md) Section 11.1).

---

## Sub-tasks

### 12.1 -- Add SANA family to `core/registry/catalog.json`

**Objective**: Register every SANA variant + DC-AE VAE in the catalog with full metadata.

**Prompt**:
> Open [core/registry/catalog.json](../../../../core/registry/catalog.json). Add the following entries with `type: "image"` (or `"video"` for the video variant):
> - `sana-1.6b-1024` (`Efficient-Large-Model/SANA1.5_1.6B_1024px_diffusers`): default 1024px; tier `diffusion-low+`; size ~3.2 GB
> - `sana-sprint-1024` (`Efficient-Large-Model/sana-sprint`): speed tier; tier `diffusion-low+`; size ~3.5 GB
> - `sana-1.6b-2k` (`Efficient-Large-Model/Sana_1600M_2Kpx_BF16`): `diffusion-mid+`; size ~3.2 GB
> - `sana-1.6b-4k` (`Efficient-Large-Model/Sana_1600M_4Kpx_BF16`): `diffusion-high+`; size ~3.2 GB
> - `sana-1.6b-int4` (`Efficient-Large-Model/SANA1.5_1.6B_1024px_int4`): `diffusion-low`; size ~1.4 GB; requires `nunchaku` runtime dep
> - `sana-controlnet-pose` / `-depth` / `-canny`: `type: "controlnet"`; linked to SANA family
> - `dc-ae-f32c32-sana-1.1` (`mit-han-lab/dc-ae-f32c32-sana-1.1`): `type: "vae"`; auto-loaded by SANA pipelines
> - `sana-video-2b-720p` (`Efficient-Large-Model/SANA-Video-2B`): `type: "video"`; tier `diffusion-mid+`; size ~4 GB
>
> Each entry carries: `displayName`, `description`, `sizeGB`, `requiredVramGB`, `releaseDate`, `uncensored: false`, `multimodal: false`, `contextWindow: null` (n/a for image), `license: "Apache-2.0"`, `source: {protocol: "huggingface", url, sha256: "<placeholder until verified>"}`. The SHA-256 placeholders are filled by Phase 15 operator action OA-03.
> Acceptance: `core/registry/catalog-digests.test.ts` recognizes the new entries; `tests/unit/registry/ModelCatalog.test.ts` is green.

---

### 12.2 -- `runtimes/diffusion/pipelines/sana.py` integration

**Objective**: A diffusers-backed SANA pipeline module that the existing runner infrastructure dispatches into.

**Prompt**:
> Add [runtimes/diffusion/pipelines/sana.py](../../../versions/runtimes/diffusion/pipelines/sana.py): registers `register(handlers)` with `txt2img` and `img2img` modes pointing at a `_execute(ctx)` body that builds a `diffusers.SanaPipeline.from_pretrained(modelId, vae=DCAE)` and runs the standard runner pipeline (param validation -> `device.choose_offload` -> execution -> PIL-free PNG workflow embed). The model id comes from `ctx.modelId`; the VAE id is auto-derived from the SANA model card (or from the catalog entry's `linkedVAE` field). Acceptance: an in-CI stub-mode test verifies the registration + the IPC round-trip; a real-host operator action (OA-09) records the SDXL Turbo vs SANA-1.6B timing comparison on the RTX 4070 rig.

---

### 12.3 -- `runtimes/diffusion/pipelines/sana_sprint.py` (speed tier)

**Objective**: A Sana-Sprint pipeline that uses the 1-step distilled config.

**Prompt**:
> Add [runtimes/diffusion/pipelines/sana_sprint.py](../../../versions/runtimes/diffusion/pipelines/sana_sprint.py): similar to `sana.py` but configures `num_inference_steps=1` and the Flow-DPM-Solver scheduler. Image Studio's "Fast Preview" toggle on the Generate button picks this pipeline. Acceptance: in-CI stub-mode test; operator action records <= 0.5 s on RTX 4090, <= 1 s on RTX 4070.

---

### 12.4 -- `runtimes/diffusion/pipelines/sana_int4.py` (4-bit / SVDQuant)

**Objective**: A 4-bit quantized SANA pipeline for `diffusion-low` (8 GB VRAM) hosts.

**Prompt**:
> Verify the SVDQuant quantization library license (`nunchaku` or equivalent) is Apache-2.0 or MIT. If not, drop S4 from v1.1.0 and update the cycle plan + known-gaps. If yes, add `nunchaku` to [runtimes/diffusion/requirements.txt](../../../versions/runtimes/diffusion/requirements.txt) and [runtimes/diffusion/pipelines/sana_int4.py](../../../versions/runtimes/diffusion/pipelines/sana_int4.py). The pipeline loads the int4 weights and runs through the same runner. Acceptance: stub-mode test + operator action records ~2 s on RTX 3060 8 GB.

---

### 12.5 -- `runtimes/diffusion/pipelines/sana_video.py` (video tier)

**Objective**: SANA-Video 2B integration for the Video Lab fast-720p tier.

**Prompt**:
> Add [runtimes/diffusion/pipelines/sana_video.py](../../../versions/runtimes/diffusion/pipelines/sana_video.py) with `txt2video` and `img2video` modes; matches the shape of [runtimes/diffusion/pipelines/video_base.py](../../../versions/runtimes/diffusion/pipelines/video_base.py)'s LTX-Video integration. Acceptance: stub-mode test + operator action records <= 60 s for a 4 s 720p clip on RTX 4070.

---

### 12.6 -- SANA-ControlNet wiring

**Objective**: Reuse the existing pose / depth / canny preprocessors against SANA-ControlNet weights.

**Prompt**:
> Add the SANA-ControlNet weight references to `core/registry/catalog.json` (already in 12.1) and wire them into the `sana.py` pipeline as `controlnet=ControlNetModel.from_pretrained(...)` when the user picks a ControlNet variant. The Phase 6 (v1.0.0) preprocessor wiring (`controlnet_aux.OpenposeDetector` / `MidasDetector` / OpenCV Canny) carries over unchanged. Acceptance: an Image Studio session with pose ControlNet enabled renders the conditioning preview and the SANA-conditioned output.

---

### 12.7 -- Image Studio UI: Fast Preview toggle, Multi-lang note, Flow-DPM-Solver sampler

**Objective**: Surface the SANA-specific UX in [desktop/src/modules/image/ImagePromptForm.tsx](../../../../desktop/src/modules/image/ImagePromptForm.tsx).

**Prompt**:
> (a) Add a "Fast Preview" toggle next to the Generate button; when on, the generate request uses `sana-sprint-1024` instead of the selected model. (b) Add a small "i" tooltip next to the prompt textarea: "Supports English, Chinese, and Emoji (multilingual model)." (c) Add `flow-dpm-solver` to the sampler dropdown. (d) Add `2048x2048` and `4096x4096` to the resolution dropdown, gated by `DiffusionTier`: 2K visible when tier >= `diffusion-mid`, 4K visible when tier >= `diffusion-high`. Acceptance: form renders correctly on each tier; selecting Fast Preview swaps the model; selecting 4K on a `diffusion-low` host shows a tooltip "Requires diffusion-high tier".

---

### 12.8 -- Make SANA-1.6B the new installer default

**Objective**: Update the recommended-models picker preset to auto-tick SANA-1.6B (+ Sana-Sprint) instead of SDXL Turbo.

**Prompt**:
> Update [scripts/installer/pyqt/src/nexus_installer/pages/recommended_models.py](../../../../scripts/installer/pyqt/src/nexus_installer/pages/recommended_models.py) so the Light / Recommended / Full presets auto-tick `sana-1.6b-1024` and `sana-sprint-1024` instead of `sdxl-turbo` (SDXL Turbo remains an opt-in alternative). The Phase 14 cross-OS installer integrates this preset list. Acceptance: a smoke-test of the installer page in `pytest` shows the new defaults.

---

### 12.9 -- Phase 12 lint, build, test, operator-action handoff

**Objective**: Verify the SANA integration is CI-green (stub-mode) and flag the operator action for real-GPU timings.

**Prompt**:
> Re-run the four-step gate. Operator-action handoff to OA-09 (real-GPU rig validation) in [docs/versions/v1/v1.1.0/operator-actions.md](../operator-actions.md). Acceptance: 0 CI failures; OA-09 entry is created for the operator to fill in.
