# Phase 12 -- Image Studio upgrade (NVIDIA SANA family)

**Date**: 2026-05-20
**Plan**: [docs/v1.1.0/plans/phase-12-image-studio-sana.md](../../plans/phase-12-image-studio-sana.md)
**Cycle**: v1.1.0
**Outcome**: Landed. All 9 sub-tasks implemented and tested; OA-09 extended for real-GPU timing capture.

---

## Goal

Adopt the NVIDIA SANA family as the new default image stack across Image Studio and Video Lab, gated behind the v1.0.0 `DiffusionTier` policy and the deterministic CI stub. Specifically:

- SANA-1.6B replaces SDXL Turbo as the default 1024px image model (~2x faster, Apache-2.0 weights).
- Sana-Sprint adds a 1-step "Fast Preview" speed tier (~0.3 s on RTX 4090).
- SANA 2K + 4K appear in the Image Studio resolution dropdown gated by tier (`diffusion-mid+` and `diffusion-high+` respectively).
- SANA INT4 via SVDQuant / nunchaku lights up the `diffusion-low` 8 GB tier.
- SANA-ControlNet (pose / depth / canny) integrates with the existing Phase 6 preprocessors.
- SANA-Video 2B joins Video Lab as the Fast 720p tier.
- Flow-DPM-Solver becomes a first-class sampler option.
- Installer presets auto-tick SANA-1.6B + Sana-Sprint instead of SDXL Turbo.

---

## Sub-tasks

### 12.1 -- Catalog + DC-AE VAE

Added ten new entries to [core/registry/catalog.json](../../../../core/registry/catalog.json): `sana-1.6b-1024`, `sana-sprint-1024`, `sana-1.6b-2k`, `sana-1.6b-4k`, `sana-1.6b-int4`, `dc-ae-f32c32-sana-1.1` (the linked VAE), the three SANA-ControlNet weights (`-pose`, `-depth`, `-canny`), and `sana-video-2b-720p`. Each carries `releaseDate`, `uncensored: false`, `multimodal: false`, `contextWindow: null`, `license: "Apache-2.0"`, plus `linkedVAE` / `linkedFamily` / `runtimeDeps` where applicable. SHA-256 placeholders ride OA-V1.1.0-12A for rotation.

Extended `ModelType` in [core/registry/catalog.ts](../../../../core/registry/catalog.ts) to include `"controlnet"` and `"vae"`; widened the optional metadata fields. Mirrored in [desktop/src/pages/settings/modelsTypes.ts](../../../../desktop/src/pages/settings/modelsTypes.ts). Updated [core/registry/ModelStorage.ts](../../../../core/registry/ModelStorage.ts)'s `ModelManifest.type` + `runtime` unions and [core/registry/NexusModelRegistry.ts](../../../../core/registry/NexusModelRegistry.ts)'s runtime resolution to handle the new types. Added the two new icon labels (`C` + `A`) to `<ModelIcon>` in [desktop/src/pages/settings/ModelsSettings.tsx](../../../../desktop/src/pages/settings/ModelsSettings.tsx).

### 12.2 -- runtimes/diffusion/pipelines/sana.py

Registers `sana.txt2img` + `sana.img2img` through the standard `PipelineRunner`. The CI executor is the deterministic stub from `pipelines/base.py`. Exposes `resolve_vae(modelId, linkedVAE?)`, `is_sana_model(modelId)`, `is_sana_controlnet(modelId)`, `preprocessor_for_controlnet(modelId)`, and the `SANA_CONTROLNET_PREPROCESSORS` map (pose -> "pose", depth -> "depth", canny -> "canny"). Real-host diffusers swap is OA-09.

### 12.3 -- runtimes/diffusion/pipelines/sana_sprint.py

Registers `sana_sprint.txt2img` with planning size 6 GB. `overrides_for_sprint(request)` forces `steps=1` + `sampler="flow-dpm-solver"` regardless of caller form values; called by the dispatcher when the caller's `modelId` resolves to a `sana-sprint-*` entry.

### 12.4 -- runtimes/diffusion/pipelines/sana_int4.py + nunchaku

Registers `sana_int4.txt2img` with planning size 5 GB so `keep_on_gpu` holds on 8 GB hosts. `has_nunchaku()` probes the dep without crashing. License check: nunchaku is Apache-2.0 (MIT HAN Lab), verified via the upstream repo URL embedded in the module docstring. Added `nunchaku` to [runtimes/diffusion/requirements.txt](../../../../runtimes/diffusion/requirements.txt) (new file) and `REQUIRED_WHEEL_PREFIXES` in [scripts/installer/pyqt/src/nexus_installer/engine/diffusion_venv_provisioner.py](../../../../scripts/installer/pyqt/src/nexus_installer/engine/diffusion_venv_provisioner.py). Wheel + real-host verification deferred under 12.4.P2.GG.

### 12.5 -- runtimes/diffusion/pipelines/sana_video.py

Registers `diffusion.video.sana.text2video` + `.image2video` through `video_base.VideoPipelineRunner` with planning size 8 GB. The video runner's `_upgrade_for_video` steps to `model_cpu_offload` on 12 GB hosts.

### 12.6 -- SANA-ControlNet wiring

The three SANA-ControlNet catalog entries pair 1:1 with the v1.0.0 Phase 6 preprocessors via `SANA_CONTROLNET_PREPROCESSORS` in [runtimes/diffusion/pipelines/sana.py](../../../../runtimes/diffusion/pipelines/sana.py). The standard `controlNet` payload flows through `params.parse(...)` -> `workflow_metadata.build_workflow(...)` -> the embedded `nexus_workflow` PNG chunk unchanged. [desktop/src/modules/image/ImageStudioPage.tsx](../../../../desktop/src/modules/image/ImageStudioPage.tsx) surfaces the three SANA-ControlNet ids in the ControlNet model dropdown.

### 12.7 -- Image Studio UI

Five user-visible changes to [desktop/src/modules/image/ImagePromptForm.tsx](../../../../desktop/src/modules/image/ImagePromptForm.tsx):

1. **Fast Preview toggle** -- a checkbox below the parameter grid that flips `values.fastPreview`. `valuesToBaseRequest(...)` swaps `modelId` to `sana-sprint-1024`, forces `steps=1`, and forces `sampler="flow-dpm-solver"` when on.
2. **Multi-lang hint** -- an inline "i" badge next to the Prompt label with `aria-label="Supports English, Chinese, and Emoji (multilingual model)."`.
3. **Flow-DPM-Solver sampler** -- added to the `SAMPLERS` array; surfaces in the dropdown. The Python-side `_VALID_SAMPLERS` in [runtimes/diffusion/pipelines/params.py](../../../../runtimes/diffusion/pipelines/params.py) accepts it.
4. **Resolution dropdown** -- replaces the implicit width/height inputs (which remain for backward compat). Filters by `diffusionTier` via `tierMeets(actual, required)` (low=0, mid=1, high=2, pro=3): 2K appears at `diffusion-mid+`, 4K at `diffusion-high+`.
5. **Tier hint** -- when the form's resolution exceeds the host's tier (e.g., 4K on a `diffusion-low` rig from a `initial` prop), an inline "Requires diffusion-high tier" warning renders below the dropdown.

[desktop/src/modules/image/ImageStudioPage.tsx](../../../../desktop/src/modules/image/ImageStudioPage.tsx) accepts `diffusionTier` and forwards it to the form; the App-level wire-up to `useDiffusionTier()` is deferred under 12.7.P2.HH (today the page defaults to `diffusion-low` so gating still functions).

### 12.8 -- Installer presets

Rewired all three presets in [scripts/installer/pyqt/src/nexus_installer/pages/recommended_models.py](../../../../scripts/installer/pyqt/src/nexus_installer/pages/recommended_models.py):

- **Light** (~10 GB): SDXL Turbo replaced by `sana-1.6b-1024` + `sana-sprint-1024`.
- **Recommended** (~22 GB): SDXL Turbo replaced by the same SANA pair.
- **Full** (~75 GB): adds `sana-1.6b-2k` + `sana-1.6b-4k` + `sana-video-2b-720p` on top of the existing SDXL / FLUX / SVD / CogVideoX entries.

Test cases in [test_recommended_models.py](../../../../scripts/installer/pyqt/tests/test_recommended_models.py) assert: SANA-1.6B + Sana-Sprint auto-ticked across all three presets; SDXL Turbo removed from Light / Recommended; the new `gemma4:e4b + sana-1.6b-1024` total-GB sum.

### 12.9 -- Lint, build, test, operator action

Operator action OA-09 (real-GPU rig validation) extended in the new [docs/v1.1.0/operator-actions.md](../../operator-actions.md) with the seven Phase 12 timing targets. OA-V1.1.0-12A opened for the SHA-256 placeholder rotation across the ten SANA catalog entries.

---

## Quality gate

- Desktop `npx tsc --noEmit`: clean for Phase 12 surfaces (the 5 pre-existing errors in `sidecar/src/handlers.ts` + `tests/slashCommands.test.ts` are unchanged Phase 11 known gaps).
- Desktop vitest: 402 passing / 2 pre-existing failures (Phase 11 known gap, not Phase 12).
- Root vitest registry suite: 88 / 88 (added 5 new cases between [catalog.test.ts](../../../../tests/unit/core/registry/catalog.test.ts) and the new [catalog-digests.test.ts](../../../../tests/unit/core/registry/catalog-digests.test.ts)).
- Python pytest: 23 / 23 in [test_pipelines_sana.py](../../../../tests/python/diffusion/test_pipelines_sana.py) + [test_pipelines.py](../../../../tests/python/diffusion/test_pipelines.py).
- Desktop ESLint on changed surfaces: clean.

---

## Deviations from the plan

- 12.7 dropdown: the plan implies a single resolution dropdown driven by `DiffusionTier`. The implementation keeps both the new dropdown (the primary surface) and the existing width / height number inputs (kept for backward compat with existing tests + parameter parity with the params validator). The two are now linked: changing the dropdown updates width + height; manually editing width / height surfaces an inline "Requires diffusion-high tier" hint when the value exceeds the resolved tier.
- 12.7 sampler: the plan specifies adding `flow-dpm-solver` to the sampler dropdown. The implementation also widens the Python-side `_VALID_SAMPLERS` in [runtimes/diffusion/pipelines/params.py](../../../../runtimes/diffusion/pipelines/params.py) so the IPC validator accepts the new sampler -- without this widening, every SANA-Sprint payload would have been rejected with `invalid sampler: flow-dpm-solver` before reaching the runner.

---

## Known gaps opened

- 12.2.P1.FF -- real diffusers `_execute(ctx)` callback deferred to OA-09.
- 12.4.P2.GG -- nunchaku wheel + license verification on diffusion-low 8 GB rig.
- 12.7.P2.HH -- `<ImageStudioPage diffusionTier={...}>` mount-site wire-up to `useDiffusionTier()`.

See [docs/v1.1.0/known-gaps.md](../../known-gaps.md) for the canonical list.

---

## Next steps

- Phase 13 (Video Lab fast tier) lands SANA-Video 2B as the "Fast 720p" tier between LTX-Video and CogVideoX; the catalog entry + Python pipeline already exist in this commit, so Phase 13 will surface the preset in Video Lab UI and document the ControlNet carry-over.
- Phase 14 (cross-OS installer) consumes the SANA wheel manifest into the Light / Recommended / Full presets and re-tests them against the typed-catalog UI.
- Operator runs OA-09 on the RTX 4070 baseline rig to capture real-GPU timings and swap the stub executor for the diffusers-backed `_execute(ctx)`.
