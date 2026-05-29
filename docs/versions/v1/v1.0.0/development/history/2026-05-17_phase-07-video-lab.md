# Session History: v1.0.0 Phase 7 -- Video Lab MVP

**Date**: 2026-05-17
**Plan**: [docs/versions/v1/v1.0.0/plans/phase-07-video-lab.md](../../plans/phase-07-video-lab.md)
**Phase goal**: Text-to-video (LTX-Video default), image+text-to-video (SVD default), CogVideoX opt-in. Timeline previewer + granular generation controls. VRAM lifecycle scope frees the GPU between jobs and publishes telemetry the Phase 8 scheduler can subscribe to. MP4 outputs carry an embedded workflow JSON for round-tripping through Copy Workflow.

## Sub-tasks completed

### 7.1 -- VideoRuntime extension (LTX-Video / SVD / CogVideoX)

- New `runtimes/diffusion/pipelines/video_params.py` -- strict validator for video request shape (mode in `{text2video, image2video}`, duration 1..10 s, fps in `{12, 16, 24}`, resolution `854x480` or `1280x720`, plus shared sampler / steps / cfg / seed). `image2video` requires a `sourceImage` field. Includes a `frame_count()` helper so the dispatcher can bucket thumbnails by second without re-deriving the formula.
- New `runtimes/diffusion/pipelines/video_base.py` -- `VideoPipelineRunner` orchestrates validation -> offload decision (video-upgraded one tier conservative via `_upgrade_for_video`) -> `vram_scope` -> execute -> workflow JSON build. Stub executor emits one base64 JPEG thumbnail per generated second so the UI's thumbnail strip is exercisable in CI. `select_executor` swaps in a real diffusers-backed executor when `torch + diffusers + imageio` are importable.
- New `runtimes/diffusion/pipelines/video_text2video.py` and `video_image2video.py` -- register the two methods (`diffusion.video.text2video`, `diffusion.video.image2video`) with planning model sizes 12 GB and 9 GB. Method name carries the pipeline routing; `params.model_id` (e.g. `ltx-video`, `cogvideox-5b`, `svd`, `cogvideox-5b-i2v`) selects the diffusers pipeline at execution time.
- New `runtimes/diffusion/pipelines/video_workflow_metadata.py` -- builds the video workflow JSON (mirrors the image-side schema plus `kind: "video"`, `mode`, `durationSeconds`, `fps`, `frameCount`, optional `sourceImageHash`).
- `runtimes/diffusion/registry.py` -- added the two video modules to `_PIPELINE_MODULES`.
- Output directory canonicalised to `~/.nexus/outputs/videos/<jobId>.mp4`, overridable via `NEXUS_VIDEO_OUTPUT_DIR` so tests stay hermetic.

### 7.2 -- Video Lab UI

- New `desktop/src/modules/video/VideoPromptForm.tsx` -- controlled form (mode toggle, prompt + negative, model dropdown filtered to the active mode, duration, fps, resolution, steps, CFG, seed, advanced sampler). Multi-field updates (mode switch picks first compatible model) compose atomically via the functional `setValues` updater; parent propagation happens through a `useEffect`.
- New `desktop/src/modules/video/TimelinePreviewer.tsx` -- wraps an HTML5 `<video>` with prev / next frame buttons (advance by 1/fps via `currentTime` mutation), play, pause, and a `<input type="range">` scrubber. The scrubber's upper bound falls back to 60 s when metadata has not yet loaded so the control stays interactive in jsdom where `loadedmetadata` never fires.
- New `desktop/src/modules/video/VideoLabPage.tsx` -- top-level page: left sidebar with the prompt form + image upload (image2video) + Generate / Cancel + progress; center thumbnail strip (one cell per generated second, filled in by progress events with base64 JPEG previews) and a TimelinePreviewer for completed clips; bottom Outputs gallery with Open + Copy Workflow per item.
- New `desktop/src/modules/video/videoClient.ts` -- typed `VideoClient` interface (`text2video`, `image2video`, `drainEvents`, `extractWorkflow`); `createIpcVideoClient` is the production binding to the Node sidecar; `InMemoryVideoClient` lets tests script progress events.
- `desktop/src/App.tsx` -- `/videos` now routes to `<VideoLabPage>` instead of the module placeholder.

### 7.3 -- MP4 workflow metadata

- New `core/video/WorkflowMetadata.ts` -- `embedWorkflow(mp4Path, workflow, ctx)` calls `ffmpeg -i <in> -c copy -metadata comment=<sorted-json> <out>` to a temp sibling and renames atomically. `extractWorkflow(mp4Path, ctx)` calls `ffprobe -show_format -of json` and parses `format.tags.comment` (or `COMMENT`). `extractCommentRaw` exposes the raw tag for diagnostics. Both functions accept a `FfmpegContext { ffmpegPath, ffprobePath, spawnFn? }` injection seam so tests stub spawn and the production caller resolves ffmpeg via the `NEXUS_FFMPEG_PATH` / `NEXUS_FFPROBE_PATH` env vars (set by the Phase 9 installer).
- IPC contract -- added `diffusion.video.text2video`, `diffusion.video.image2video`, `diffusion.video.workflow.extract` to `desktop/sidecar/src/protocol.ts` with zod schemas; the new `DiffusionVideoWorkflow` schema validates the embedded JSON shape. `HandlerContext` carries a `ffmpeg: FfmpegContext` field with a `DEFAULT_FFMPEG_CONTEXT` derived from env vars.
- New `desktop/sidecar/src/diffusion/videoDispatcher.ts` -- `buildVideoJobRequest(mode, request, client)` mirrors the image dispatcher; deterministic `video-*` job IDs with `setVideoJobIdFactory` test seam.
- New `bin/nexus-video.mjs` -- `nexus-video extract-workflow <file.mp4>` CLI. Loads the compiled module from `out/` when present, falls back to an inline ffprobe wrapper otherwise. Registered in root `package.json` `bin`.

### 7.4 -- VRAM lifecycle + scheduler integration hooks

- New `runtimes/diffusion/vram_lifecycle.py` -- `vram_scope(model_id, model_size_gb)` is a context manager that publishes a `vram_acquired` event on entry and a `vram_released` event on exit (each carrying `modelId`, `modelSizeGB`, `bytes` from `torch.cuda.memory_allocated()` when available, ISO timestamp). On exit it clears the yielded state dict, then runs `torch.cuda.empty_cache() + gc.collect()` so the next image / video / LLM job claims freed memory.
- `set_publisher(fn)` / `set_publisher(None)` installs a telemetry publisher; `CapturingPublisher` is a test helper that accumulates events.
- `VideoPipelineRunner.run` invokes the user-supplied `execute(ctx)` inside the scope so the cleanup path fires even when the executor raises.
- Phase 8 scheduler hook: once `GpuScheduler` lands, it subscribes to `vram_released` to flip its FIFO queue from "occupied" to "available". Until the scheduler is wired, the video module falls back to the existing in-process serialization through the sidecar's request loop (no concurrent video jobs).

### 7.5 -- Testing + stabilization

- 56 new Python tests: `test_video_params.py` (17), `test_video_base.py` (14), `test_vram_lifecycle.py` (11), `test_video_workflow_metadata.py` (6), `test_video_pipeline_registration.py` (6), plus augmenting checks.
- 56 new TS tests: `video-protocol.test.ts` (8), `videoDispatcher.test.ts` (5), `video-workflowMetadata.test.ts` (9), `VideoLabPage.test.tsx` (11), `TimelinePreviewer.test.tsx` (8), `videoClient.test.ts` (10), plus 5 new sidecar-handler video assertions and 1 App route assertion.
- Caught + fixed during the test loop:
  1. `VideoPromptForm` chained-update bug: two `setValues` calls in one event handler had stale captures and lost the first update. Refactored to functional updaters + `useEffect`-based onChange propagation.
  2. `TimelinePreviewer` `videoRef.current?.play()?.catch` failed in jsdom because `HTMLMediaElement.play` returns `undefined`. Guarded with a `typeof result.catch === "function"` check; `pause()` wrapped in try/catch for the same reason.
  3. `VideoPromptForm.updateMode` attempted to mutate a `readonly` field on `VideoFormValues`. Rewrote to construct the new value via spread.

## Test results

```
npm run test:shell           : 40 files, 337 tests, all passing
npm run test:shell:coverage  : 94.71 / 85.5 / 81.42 (lines / branches / functions)
pytest tests/python -q       : 100 / 100 passing
npm run lint:shell           : clean
npm run typecheck (desktop)  : 0 new Phase 7 errors (3 pre-existing baseline errors, unchanged)
```

## Deviations from the plan

1. **Video pipeline executors run stubs in CI** (known-gap `7.P1.MM`). The plan called for fixture tests on each pipeline with tiny step counts on a CUDA runner; the implementing host has no GPU + diffusers + imageio. The runner orchestration (params -> video-upgraded offload -> vram_scope -> execute -> workflow JSON build) is fully exercised through `video_base.stub_execute`; the diffusers-backed `_execute(ctx)` is the operator action.

2. **ffmpeg / ffprobe are not bundled** (known-gap `7.P1.NN`). Resolved via injected `FfmpegContext` -- production currently falls through to `ffmpeg` / `ffprobe` on `$PATH`. The Phase 9 installer drops bundled binaries under `~/.nexus/runtimes/ffmpeg/` and sets `NEXUS_FFMPEG_PATH` / `NEXUS_FFPROBE_PATH`.

3. **Tauri Rust core does not spawn Python yet** (known-gap `7.P1.OO`, same blocker as `6.P1.HH`). Bundled with the Phase 9 installer rework that provisions the Python venv.

4. **Video Lab model dropdown hard-coded** (known-gap `7.P2.PP`). The five video checkpoints (LTX-Video / CogVideoX 5B / 2B / SVD / CogVideoX-I2V) ship as inline constants until the `models.list` IPC bridge from `5.P1.BB` lands.

5. **MP4-as-URL Tauri allow-list deferred** (known-gap `7.P2.QQ`). The `resolveMp4Url` prop is a placeholder identity mapping; Phase 9 installer adds `~/.nexus/outputs/videos/` to the Tauri filesystem allow-list and the default resolver uses `convertFileSrc()`.

6. **Save As / Use Last Frame gallery actions deferred** (known-gap `7.P2.RR`). Open + Copy Workflow shipped; the other two need a Tauri dialog plugin call + a sidecar IPC for last-frame export. Bundled into Phase 8 polish.

7. **Progress events polled, not streamed** (known-gap `7.P2.SS`, same blocker as `6.P2.KK`). VideoLabPage polls `diffusion.job.drainEvents` every 100 ms; the Tauri Channel-based stream is deferred alongside the existing image-side blocker.

8. **Operator acceptance on real GPU rig deferred** (known-gap `7.P3.TT`). The <= 5 minute LTX-Video / <= 4 minute SVD timing targets are operator actions documented in `docs/versions/v1/v1.0.0/operator-actions.md` once that file is opened (currently scheduled for Phase 11).

## Next steps

- Phase 8: GpuScheduler + Local Model Status dashboard widget. The `vram_lifecycle` publisher is the scheduler's primary input; the scheduler bridges into the existing telemetry IPC.
- Operator follow-ons: `7.P1.MM` (live PyTorch + diffusers + imageio executors), `7.P3.TT` (RTX 4070 timing capture).
- Phase 9 follow-ons: `7.P1.NN` (bundled ffmpeg), `7.P1.OO` (Tauri Rust spawn of Python), `7.P2.QQ` (file allow-list).
- Phase 5 follow-on: `7.P2.PP` (models.list bridge -> VideoLabPage model dropdown).
