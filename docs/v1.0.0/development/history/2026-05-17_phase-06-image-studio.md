# Session History: v1.0.0 Phase 6 -- DiffusionRuntime + Image Studio MVP

**Date**: 2026-05-17
**Plan**: [docs/v1.0.0/plans/phase-06-image-studio.md](../../plans/phase-06-image-studio.md)
**Phase goal**: Native Python diffusion runtime with smart VRAM offload + TAESD latent previews; Image Studio module ships txt2img + img2img + inpaint + outpaint mask editor + LoRA + ControlNet (pose / depth / canny) + workflow-in-PNG metadata. Forms-driven UX; node graph deferred.

## Sub-tasks completed

### 6.1 -- Python diffusion runtime + bootstrap

- New `runtimes/diffusion/main.py` JSON-RPC 2.0 stdio dispatcher with `health` / `version` methods.
- New `runtimes/diffusion/device.py` -- `detect()` returns `DeviceInfo` (torch / cuda / device / vramTotalGB / vramFreeGB) with CPU fallback; `choose_offload(free_vram_gb, model_size_gb)` ports ComfyUI's `comfy/model_management.py` heuristic as a pure function (keep_on_gpu / model_cpu_offload / sequential_cpu_offload / insufficient_vram).
- New `runtimes/diffusion/registry.py` -- lazy import of pipeline modules with structured-error fallback when import fails.
- New `runtimes/diffusion/version.py` -- runtime + protocol versions.
- New `desktop/sidecar/src/diffusion/runtimeClient.ts` -- `DiffusionRuntimeClient` interface + `InMemoryDiffusionRuntime` (CI / tests) + `ChildProcessDiffusionRuntime` (production stdio bridge with per-request timeouts, job-id-keyed event queue).
- Extended `desktop/sidecar/src/protocol.ts` with 8 diffusion methods + Zod schemas.

### 6.2 -- txt2img pipeline + smart VRAM offload

- New `runtimes/diffusion/pipelines/base.py` -- `PipelineRunner` coordinates validation -> offload decision -> execute -> workflow embed; `stub_execute(mode)` returns a deterministic 1x1 PNG; `select_executor(mode, real)` swaps to the real diffusers executor when `torch + diffusers` are importable.
- New `runtimes/diffusion/pipelines/params.py` -- pure-Python validator with `ParamsError`s.
- New `runtimes/diffusion/pipelines/txt2img.py` -- registers handler.
- TAESD latent previews path: the JSON-RPC contract carries a base64 `preview` field on progress events; the real decoder lands with the GPU executor.

### 6.3 -- img2img / inpaint / outpaint pipelines

- New `runtimes/diffusion/pipelines/img2img.py`, `inpaint.py`, `outpaint.py` -- each registers a runner against the shared base.
- Mode-specific params validation: img2img requires `sourceImage` + `strength`; inpaint requires both + `mask`; outpaint requires `sourceImage` + `direction` + `pixels`.

### 6.4 -- LoRA + ControlNet support

- New `runtimes/diffusion/preprocessors/canny.py` (OpenCV lazy import + stub), `pose.py` (controlnet_aux.OpenposeDetector lazy import + stub), `depth.py` (MidasDetector lazy import + stub).
- LoRA and ControlNet fields validated end-to-end through the Node + Python contracts.

### 6.5 -- Image Studio UI

- New `desktop/src/modules/image/ImageStudioPage.tsx` -- mode tabs (Text -> Image / Image -> Image / Inpaint / Outpaint), left sidebar with the prompt form, center canvas (latent preview / source upload / mask editor / outpaint controls per mode), bottom outputs gallery with Copy Workflow + Use as Source actions per item.
- New `desktop/src/modules/image/ImagePromptForm.tsx` -- controlled form with collapsible Advanced for LoRAs + ControlNet.
- New `desktop/src/modules/image/MaskEditor.tsx` -- HTML5-canvas mask editor with brush size slider, undo / redo, clear.
- New `desktop/src/modules/image/diffusionClient.ts` -- `DiffusionClient` interface + `InMemoryDiffusionClient` (tests inject scripted progress events) + `createIpcDiffusionClient` (production binding).
- `desktop/src/App.tsx` now routes `/images` to `<ImageStudioPage>`.

### 6.6 -- Workflow-in-PNG read/write

- New `core/image/WorkflowMetadata.ts` -- `embedWorkflow(pngBuffer, workflow)` + `extractWorkflow(pngBuffer)` against the PNG tEXt chunk format (RFC 11.3.4.3). Writes both `nexus_workflow` AND `workflow` (ComfyUI compat) chunks; extraction tries `nexus_workflow` first then falls back. Hand-rolled CRC32; zero third-party dependencies.
- Python mirror at `runtimes/diffusion/pipelines/workflow_metadata.py` (writer + extractor) so runtime-produced PNGs round-trip through the TS reader.
- New `bin/nexus-image.mjs` -- `nexus image extract-workflow <file.png>` CLI; loads compiled module from `out/` when present, falls back to an inline JS port. Registered in `package.json` `bin`.

### 6.7 -- Testing + stabilization

- 51 new TS tests + 44 new Python tests.
- TS coverage: 94.24% lines / 85.65% branches / 80.75% functions / 94.24% statements -- all above the 80/80/70 gate.
- All 280 desktop tests pass; all 44 Python tests pass.

## Test results

```
npm run test:shell           : 33 files, 280 tests, all passing
npm run test:shell:coverage  : 94.24 / 85.65 / 80.75 / 94.24
pytest tests/python -q       : 44 / 44 passing
npm run lint:shell           : clean
npm run lint                 : clean
npx tsc --noEmit (desktop)   : clean
npx tsc --noEmit (root)      : clean
```

## Deviations from the plan

1. **Pipeline executors run stubs in CI** (known-gap `6.P1.GG`). The plan called for a fixture txt2img run on SDXL Turbo against a CUDA-equipped CI runner; the implementing host has no GPU. The runner orchestration (params -> offload -> execute -> workflow embed) is fully exercised through `base.stub_execute`; the diffusers-backed `_execute(ctx)` callback is the operator action.

2. **Tauri Rust core does not spawn Python yet** (known-gap `6.P1.HH`). The Python runtime is reachable from the Node sidecar via `ChildProcessDiffusionRuntime` once the Rust core spawns the process; this is bundled with the Phase 9 installer rework that provisions the Python venv.

3. **ControlNet preprocessors are stubbed in CI** (known-gap `6.P1.II`). `cv2` / `controlnet_aux` import lazily and fall back to tagged stub buffers when absent.

4. **Image Studio dropdowns hard-coded** (known-gap `6.P2.JJ`). The model / LoRA / ControlNet shortlist lives in `ImageStudioPage.tsx` as inline constants until the `models.list` IPC bridge from `5.P1.BB` lands.

5. **Progress events polled, not streamed** (known-gap `6.P2.KK`). The ImageStudioPage polls `diffusion.job.drainEvents` every 100 ms; the Tauri Channel-based stream is deferred alongside the same blocker that gates `coding.session.event`.

## Next steps

- Phase 7 (Video Lab): reuse the DiffusionRuntime patterns + the workflow metadata shape, add LTX-Video / SVD / CogVideoX pipelines.
- Operator: capture SDXL Turbo / SDXL 1.0 1024x1024 timings on the RTX 4070 baseline rig in `docs/v1.0.0/operator-actions.md`.
- Phase 8: wire `diffusion.job.events` through the new Tauri Channel; remove the polling loop.
- Phase 9 installer: provision the Python venv + spawn the diffusion runtime alongside the Node sidecar.
