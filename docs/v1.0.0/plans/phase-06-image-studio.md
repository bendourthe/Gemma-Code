# Phase 6 - DiffusionRuntime + Image Studio MVP

**Goal**: Native diffusion runtime with smart VRAM offload + TAESD latent previews; Image Studio module ships txt2img + img2img + inpaint + outpaint mask editor + LoRA + ControlNet (pose/depth/canny) + workflow-in-PNG metadata. Forms-driven UX; node graph deferred.
**Prerequisites**: Phase 5 (registry feeds models), Phase 1 (shell), Phase 8 (scheduler - soft dep, falls back to single-job mode if scheduler not yet landed).
**Stability Gate**: On an RTX 4070 (12 GB VRAM), a 1024x1024 SDXL Turbo txt2img completes in <= 30 seconds; img2img + inpaint + outpaint work end-to-end; saved PNG carries embedded workflow metadata.

---

## Sub-tasks

### 6.1 - Python diffusion runtime spec + bootstrap

**Objective**: Choose the Python stack (PyTorch 2.x + diffusers + custom orchestration), define the runtime process boundary, and bootstrap a long-running Python sidecar separate from the Node sidecar.

**Prompt**:
> The diffusion runtime cannot run inside Node (PyTorch is Python-only). Stand up a long-running Python sidecar process at `runtimes/diffusion/main.py` packaged into the Python venv that the installer (Phase 9) provisions. Dependencies: PyTorch 2.4 with CUDA 12.1, `diffusers` 0.30+, `transformers`, `accelerate`, `safetensors`, `xformers` (optional but auto-enabled if available), `Pillow`. Communication: JSON-RPC 2.0 over a Unix socket (`~/.nexus/sockets/diffusion.sock`) on POSIX; named pipe (`\\.\pipe\nexus-diffusion`) on Windows. The Tauri Rust core spawns the Python sidecar at app launch alongside the Node sidecar. Bootstrap implements only `health` and `version` IPC methods this sub-task. Acceptance: `npm run dev:shell` launches both sidecars; the dashboard's debug button rounds a `diffusion.health` call to `{ok: true, torch: "2.4.x", cuda: "12.1", device: "RTX 4070"}` on a test rig with CUDA.

---

### 6.2 - DiffusionRuntime: txt2img + smart VRAM offload

**Objective**: Implement the txt2img pipeline with the ComfyUI-derived smart-offload technique (sequential CPU offload, model CPU offload, full model offload).

**Prompt**:
> Implement the txt2img pipeline at `runtimes/diffusion/pipelines/txt2img.py` against `diffusers.StableDiffusionXLPipeline` + `StableDiffusionXLImg2ImgPipeline`. IPC method `diffusion.txt2img({modelId, prompt, negativePrompt, width, height, steps, cfgScale, sampler, seed, batchSize, latentPreview: true})` returns a `jobId` and streams `diffusion.job.progress` events. Smart offload: at job start, query free VRAM via `torch.cuda.mem_get_info`; if free < `model_size * 1.5`, enable sequential CPU offload (`pipe.enable_sequential_cpu_offload`); if free < `model_size`, error out. Reverse-engineer ComfyUI's strategy (see ComfyUI's `comfy/model_management.py`) but write the implementation natively in our codebase. Latent previews via TAESD: every 5 steps, decode the latent through the tiny TAESD VAE and emit a preview PNG as a base64 blob in the progress event. Acceptance: a fixture test runs txt2img on SDXL Turbo against a synthetic prompt on a CUDA-equipped CI runner (skip on non-CUDA hosts), validates output PNG exists; an operator-driven acceptance on RTX 4070 verifies <= 30 s end-to-end for 1024x1024.

---

### 6.3 - img2img + inpaint + outpaint pipelines

**Objective**: Implement img2img, inpaint (mask-driven), outpaint (canvas extension).

**Prompt**:
> Extend the diffusion runtime with three more pipelines. `diffusion.img2img({modelId, prompt, sourceImage, strength, ...})` -> takes a source image (base64 PNG) and runs SDXL img2img with the provided `strength` (0.0 - 1.0). `diffusion.inpaint({modelId, prompt, sourceImage, mask, ...})` -> uses `StableDiffusionXLInpaintPipeline` with the user-provided mask (base64 PNG, alpha channel as mask). `diffusion.outpaint({modelId, prompt, sourceImage, direction: "left" | "right" | "top" | "bottom", pixels})` -> extends the canvas + uses inpaint internally on the new region with a feathered edge mask. All three produce a `jobId`, stream progress, and embed the request parameters as PNG metadata using `PIL.PngImagePlugin.PngInfo` (workflow-in-PNG, reverse-engineered from ComfyUI's `tEXt` chunk format). Acceptance: round-trip test: generate -> save -> reload -> read embedded metadata -> verify all parameters match.

---

### 6.4 - LoRA + ControlNet support

**Objective**: Load LoRA adapters at inference time; support ControlNet conditioning with pose / depth / canny preprocessors.

**Prompt**:
> LoRA support: `diffusion.txt2img({..., loras: [{id: "<modelId>", weight: 0.8}, ...]})`. The Python runtime calls `pipe.load_lora_weights` + `pipe.set_adapters` per the diffusers LoRA API. Multiple LoRAs blend by weight. LoRA models surface in the catalog with `type: "lora"` and `family: <compatible base, e.g. sdxl>`. ControlNet support: `diffusion.txt2img({..., controlNet: {modelId, conditionImage, weight, preprocessor: "pose" | "depth" | "canny"}})`. Preprocessors: `pose` via `controlnet_aux.OpenposeDetector`, `depth` via `controlnet_aux.MidasDetector`, `canny` via OpenCV's Canny edge detector (no extra model needed). The conditioning image is preprocessed by the runtime; the preprocessed image is emitted as a progress event for the UI to show. Catalog entries: SDXL ControlNet pose, depth, canny. Acceptance: fixture test runs txt2img with one LoRA + one ControlNet conditioning image on SDXL Turbo + a ControlNet checkpoint and validates the output.

---

### 6.5 - Image Studio UI (forms-driven)

**Objective**: Build the Image Studio frontend with a forms-driven UX (sidebar with prompt / negative / dims / sampler / seed / advanced; canvas in the center; outputs gallery at the bottom).

**Prompt**:
> Build `desktop/src/modules/image/ImageStudioPage.tsx` per the forms-driven UX from the ComfyUI comparison (Section 4). Layout: left sidebar with the prompt form (Prompt, Negative Prompt, Model dropdown, Width, Height, Steps, CFG, Sampler, Seed, plus collapsible "Advanced" for LoRAs and ControlNet); center canvas showing the current job's latent preview as it streams in; bottom gallery of generated outputs (thumbnail + click-to-enlarge). Mode tabs at the top: `Text -> Image | Image -> Image | Inpaint | Outpaint`. For Image -> Image and Inpaint, an upload zone replaces the canvas to drop the source image. Inpaint mode shows a brush + mask editor (HTML5 canvas, brush size slider, undo / redo, clear). Outpaint mode shows the source image with arrow buttons on each edge. Generate button shows a progress bar and the live latent preview. Cancel button. Output gallery items have a context menu: Open, Save As..., Copy Workflow (extracts embedded PNG metadata + copies as JSON), Use as Source. Acceptance: UI test runs a fake job end-to-end (mocked IPC), asserts progress UI updates, preview renders, output lands in gallery; mask editor brush events recorded and exported as base64 PNG.

---

### 6.6 - Workflow-in-PNG read/write

**Objective**: Embed and extract workflow JSON in PNG `tEXt` chunks; this is the reverse-engineered ComfyUI pattern.

**Prompt**:
> In `core/image/WorkflowMetadata.ts` implement `embedWorkflow(pngBuffer: Buffer, workflow: object): Buffer` and `extractWorkflow(pngBuffer: Buffer): object | null`. Write workflow JSON into a `tEXt` chunk with key `nexus_workflow` (and a compatibility `workflow` alias for ComfyUI). Read by scanning chunks. The schema for `workflow` is the full generation request: `{tool: "nexus", version: "1.0.0", mode: "txt2img" | "img2img" | "inpaint" | "outpaint", prompt, negativePrompt, modelId, width, height, steps, cfgScale, sampler, seed, loras, controlNet, timestamp}`. The Image Studio UI's "Copy Workflow" button reads this back. Add `nexus image extract-workflow <file.png>` CLI subcommand. Acceptance: round-trip test embeds + extracts + asserts equality; ComfyUI-format PNGs decode correctly when their workflow key is `workflow`.

---

### 6.7 - Testing and Stabilization

**Objective**: Generate and run all tests for Phase 6. Iterate until stable.

**Prompt**:
> Generate comprehensive tests for everything built in Phase 6. Include: Python unit tests for each pipeline (txt2img / img2img / inpaint / outpaint) using small fixture models or mocked diffusers calls; integration tests for the Node <-> Python IPC contract; unit tests for `WorkflowMetadata.embed/extract`; UI tests for `ImageStudioPage` (form submit, mode switching, mask editor); operator-driven acceptance on a real GPU rig captured in `docs/v1.0.0/operator-actions.md` (RTX 4070: SDXL Turbo 1024x1024 <= 30 s; SDXL 1.0 standard <= 90 s; img2img / inpaint / outpaint smoke); coverage gate at lines >= 80, functions >= 80 across `core/image/`, `desktop/src/modules/image/`, and the Python runtime (use `pytest --cov`). Run the test suite, fix all failures, iterate. After all tests pass, run `/generate-session-history` to document Phase 6.

---

### Phase 6 Exit Checklist

- [ ] All sub-tasks completed
- [ ] Python diffusion sidecar boots cleanly
- [ ] Smart VRAM offload verified (test rig with 8 GB VRAM still runs SDXL)
- [ ] txt2img / img2img / inpaint / outpaint all work
- [ ] LoRA + ControlNet (pose / depth / canny) verified
- [ ] Workflow-in-PNG round-trips
- [ ] Forms-driven UI passes interaction tests
- [ ] Coverage gate green (TS + Python)
- [ ] Operator acceptance recorded
- [ ] Session history generated for Phase 6
- [ ] Ready to advance to Phase 7
