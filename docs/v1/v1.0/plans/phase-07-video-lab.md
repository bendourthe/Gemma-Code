# Phase 7 - Video Lab MVP

**Goal**: Text-to-video (LTX-Video default), image+text-to-video (SVD default), CogVideoX opt-in. Timeline previewer + granular generation controls.
**Prerequisites**: Phase 5 (registry), Phase 6 (DiffusionRuntime patterns reused).
**Stability Gate**: On an RTX 4070, a 4-second LTX-Video clip generates in <= 5 minutes; an SVD image+prompt -> 4-second clip works; CogVideoX runs when explicitly enabled.

---

## Sub-tasks

### 7.1 - VideoRuntime: reuse DiffusionRuntime sidecar, add video pipelines

**Objective**: Extend the Python sidecar from Phase 6 with three video pipelines: LTX-Video (T2V default), SVD (I2V default), CogVideoX (opt-in alt).

**Prompt**:
> Extend the Python diffusion sidecar (`runtimes/diffusion/main.py`) with video pipelines. The same process hosts both image and video pipelines so model state and VRAM management share infrastructure. New methods: `diffusion.video.text2video({modelId, prompt, negativePrompt, durationSeconds, fps, width, height, steps, cfgScale, seed})`, `diffusion.video.image2video({modelId, prompt, sourceImage, durationSeconds, fps, ...})`. Implementations: LTX-Video via `diffusers.LTXPipeline` (default for text2video); SVD (Stable Video Diffusion) via `diffusers.StableVideoDiffusionPipeline` (default for image2video, accepts an image conditioning); CogVideoX via `diffusers.CogVideoXPipeline` (opt-in, 5B or 2B variants). VRAM strategy: video models are larger than image diffusion - apply more aggressive sequential offload by default; refuse to start if predicted VRAM usage exceeds free. Output: MP4 file written to `~/.nexus/outputs/videos/<jobId>.mp4` using `imageio[ffmpeg]`. Stream progress with frame-level latents as small JPEG previews. Acceptance: fixture tests against each pipeline with tiny step counts on a CUDA runner (skip otherwise); operator acceptance on RTX 4070 (LTX <= 5 min for 4 s @ 24 fps).

---

### 7.2 - Video Lab UI (timeline previewer + controls)

**Objective**: Build the Video Lab frontend with the timeline previewer, generation form, and outputs gallery.

**Prompt**:
> Build `desktop/src/modules/video/VideoLabPage.tsx`. Layout: left sidebar with generation form (Mode: Text -> Video | Image -> Video; Prompt; Negative Prompt; Model dropdown filtered to video models; Duration in seconds (1-10); FPS (12 / 16 / 24); Resolution (480p / 720p); Steps; CFG; Seed; advanced toggle for sampler choice). For Image -> Video mode, an upload zone replaces a section of the form. Center area: when no job is running, show a placeholder; when generating, show the live latent frame previews as a video-thumbnail-strip (one thumbnail per second of generated content). Below the canvas, a timeline previewer scrubber (HTML5 video element with frame-accurate stepping) for completed clips. Bottom outputs gallery: thumbnails of generated clips, each click loads into the previewer. Output context menu: Open, Save As..., Copy Workflow (workflow embedded in the MP4 via ffmpeg metadata), Use Last Frame as Image (sends to Image Studio). Generate button + Cancel button. Acceptance: UI test runs a fake job, asserts the thumbnail strip updates, the timeline previewer scrubs a fixture MP4.

---

### 7.3 - Workflow metadata for MP4

**Objective**: Embed generation parameters in MP4 metadata (analog of Phase 6's workflow-in-PNG).

**Prompt**:
> In `core/video/WorkflowMetadata.ts` implement `embedWorkflow(mp4Path: string, workflow: object): Promise<void>` (uses ffmpeg's `-metadata` flag to write a `comment` tag containing the JSON workflow) and `extractWorkflow(mp4Path: string): Promise<object | null>` (uses ffprobe to read the comment tag). Bundled ffmpeg / ffprobe come from the installer (Phase 9). The workflow schema mirrors Phase 6's plus video-specific fields (`durationSeconds, fps, mode: "text2video" | "image2video", sourceImage?`). Add `nexus video extract-workflow <file.mp4>` CLI subcommand. Acceptance: round-trip test embeds + extracts + asserts equality on a fixture clip.

---

### 7.4 - Memory + scheduler integration

**Objective**: Make video jobs schedulable via the GpuScheduler (Phase 8 prerequisite - if scheduler not yet landed, default to single-job mode); ensure VRAM is freed between jobs.

**Prompt**:
> The video pipelines stress the GPU more than image diffusion. The Python runtime must explicitly call `del pipe; torch.cuda.empty_cache(); gc.collect()` after each completed video job to free VRAM for the next job (image, video, or LLM). Add `runtimes/diffusion/vram_lifecycle.py` that wraps each job in a `with vram_scope(model_id):` context manager handling load + release. The scope publishes telemetry events (`telemetry.publish` IPC) for "vram_acquired" / "vram_released" with `bytes` and `modelId`. Soft-dependency on Phase 8: if the GpuScheduler is available, jobs go through it; otherwise the video module falls back to a single-job mutex local to the diffusion sidecar (no concurrent video jobs). Acceptance: integration test runs two consecutive video jobs against a small fixture model and asserts VRAM is freed between them (measured via `torch.cuda.memory_allocated`).

---

### 7.5 - Testing and Stabilization

**Objective**: Generate and run all tests for Phase 7. Iterate until stable.

**Prompt**:
> Generate comprehensive tests for everything built in Phase 7. Include: Python unit tests for each video pipeline against tiny fixture models; integration tests for the IPC contract; integration test for VRAM lifecycle; unit tests for MP4 workflow metadata embed/extract; UI tests for `VideoLabPage` (timeline scrubber, thumbnail strip, mode switching); operator-driven acceptance on a real GPU rig in `docs/versions/v1/v1.0.0/operator-actions.md` (RTX 4070: LTX-Video 4 s @ 24 fps @ 480p in <= 5 min; SVD image+prompt to 4 s clip in <= 4 min; CogVideoX opt-in works); coverage gate at lines >= 80, functions >= 80. Run the test suite, fix all failures, iterate. After all tests pass, run `/generate-session-history` to document Phase 7.

---

### Phase 7 Exit Checklist

- [ ] All sub-tasks completed
- [ ] LTX-Video, SVD, CogVideoX all work
- [ ] Timeline previewer functions
- [ ] Workflow metadata in MP4 round-trips
- [ ] VRAM lifecycle verified
- [ ] Coverage gate green
- [ ] Operator acceptance recorded
- [ ] Session history generated for Phase 7
- [ ] Ready to advance to Phase 8
