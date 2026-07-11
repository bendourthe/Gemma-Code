# Phase 8 - GpuScheduler + Local Model Status dashboard widget

**Goal**: Cross-module FIFO queue resolving four-pillars-on-one-GPU contention; live telemetry feeds the always-visible Local Model Status panel; hardware tier expanded with `DiffusionTier`.
**Prerequisites**: Phase 1 (shell), Phase 3 (Coding engine telemetry source), Phase 6 (Image), Phase 7 (Video).
**Stability Gate**: User submits a Video Lab job, switches to Image Studio and queues an img2img, switches to Chatbot and starts a long generation; the scheduler enforces foreground-module-wins, the dashboard reflects live GPU% and free VRAM, no OOM. Two contending modules show a "queued" state, not a crash.

---

## Sub-tasks

### 8.1 - GpuScheduler design + implementation

**Objective**: Implement the cross-module GPU scheduler as a shared-core service. FIFO queue + foreground-module priority + per-job VRAM-availability check.

**Prompt**:
> In `core/scheduler/GpuScheduler.ts` implement a cross-module job scheduler. API: `enqueue(job: GpuJob): Promise<JobHandle>` where `GpuJob = {moduleId: "coding" | "chat" | "image" | "video", jobType: string, estimatedVramGB: number, priority: "foreground" | "background", run: (signal: AbortSignal) => Promise<unknown>}`. The scheduler maintains a FIFO queue and serializes job execution (single-GPU ceiling). Foreground-module-wins: when the user switches to module X, every pending job from X is bumped to the head of the queue ahead of background jobs from other modules. A job that estimates more VRAM than is free is rejected immediately with `InsufficientVram`. Active job exposes a `cancel()`. The scheduler publishes `scheduler.job.queued`, `scheduler.job.started`, `scheduler.job.completed`, `scheduler.job.cancelled` events on the `TelemetryBus`. Module integration: Coding's `AgentLoop` does NOT go through the scheduler for tool calls (those are CPU); only the streaming-LLM-token-generation call enqueues a job. Image / Video pipelines route every generation through the scheduler. Acceptance: integration test enqueues three jobs from three modules, asserts FIFO order, switches "active module" via `setForegroundModule(id)` and asserts re-ordering; insufficient-VRAM is rejected; cancel works.

---

### 8.2 - Live GPU + VRAM telemetry source

**Objective**: Implement a telemetry source that polls `nvidia-smi` (Windows / Linux) or `system_profiler SPDisplaysDataType` (macOS) at 2 Hz and publishes events.

**Prompt**:
> In `core/telemetry/GpuTelemetrySource.ts` poll the host GPU every 500 ms (2 Hz) for: GPU utilization %, total VRAM, free VRAM, active model name (resolved from the scheduler's currently-active job's `modelId`), device name. On Windows + Linux, shell out to `nvidia-smi --query-gpu=utilization.gpu,memory.total,memory.free,name --format=csv,noheader,nounits` (cached child process re-used via long-lived `nvidia-smi -lms 500` stream). On macOS (Apple Silicon), parse `system_profiler SPDisplaysDataType` once for static info + use Metal Performance Shaders metrics for utilization (or fall back to `top -l 1 -stats command,gputime` for compute time). On CPU-only hosts, publish `device: "cpu"` with `utilization: 0` and rely on system RAM as the VRAM analog. The source publishes `telemetry.gpu` events at 2 Hz on the TelemetryBus. Resilient to nvidia-smi missing (returns CPU mode). Acceptance: integration test on a CUDA runner verifies events fire at ~2 Hz with sensible values; unit test against `nvidia-smi` stub fixtures covers parsing.

---

### 8.3 - Local Model Status widget light-up

**Objective**: Wire the Phase 1.6 `<LocalModelStatus>` widget to the real telemetry stream.

**Prompt**:
> Replace the mocked telemetry stream in Phase 1.6's `<LocalModelStatus>` with the real `telemetry.gpu` subscription from 8.2. The widget renders the active model name (from the scheduler's foreground job, or "Idle" when no job is running), parameter size (looked up via `ModelRegistry.metadata(modelId).paramSize`), GPU%, and free VRAM in GB. Add a hover tooltip showing the full breakdown (device name, total VRAM, allocated VRAM, queued job count). The widget appears on the dashboard AND in the bottom-right corner of every module page (consistent placement per the UI mockup). Click the widget opens a modal showing the full scheduler queue. Acceptance: a synthetic mocked telemetry stream drives the widget through 0% -> 80% utilization sweeps; the queue modal renders three queued jobs correctly.

---

### 8.4 - HardwareTier expanded with DiffusionTier

**Objective**: Extend the existing 3-tier hardware classification (constrained / balanced / full) with a `DiffusionTier` that gates image / video defaults by VRAM.

**Prompt**:
> The existing `core/config/HardwareTier.ts` classifies LLM inference into constrained (4-6 GB) / balanced (8-16 GB) / full (24 GB+). Add `DiffusionTier` enum: `diffusion-low` (4-8 GB VRAM, SD 1.5 only, 512x512 max, video disabled), `diffusion-mid` (8-12 GB, SDXL Turbo, 1024x1024, LTX-Video 4 s @ 480p), `diffusion-high` (12-20 GB, SDXL standard, ControlNet stacking, LTX 8 s @ 720p, SVD), `diffusion-pro` (24 GB+, Flux, CogVideoX 5B, parallel jobs). Tier is auto-detected at first launch and stored in settings; user can override. Default form values in Image Studio + Video Lab are derived from the tier. The tier display surfaces in Settings -> Hardware with a "your GPU classifies as ..." readout and an "override to ..." dropdown. Acceptance: unit tests cover tier classification across the four ranges; integration test verifies Image Studio defaults reflect the tier (1024x1024 on mid, 512x512 on low).

---

### 8.5 - Testing and Stabilization

**Objective**: Generate and run all tests for Phase 8. Iterate until stable.

**Prompt**:
> Generate comprehensive tests for everything built in Phase 8. Include: unit tests for `GpuScheduler` (enqueue / FIFO / foreground bump / cancel / insufficient-VRAM rejection); unit tests for `GpuTelemetrySource` parsing (nvidia-smi, macOS, CPU-only); UI tests for `<LocalModelStatus>` against a real-but-mocked telemetry stream; integration test driving a Coding token-streaming job + an Image txt2img job + a Video text2video job through the scheduler in sequence and asserting no overlap; tier-classification unit tests; coverage gate at lines >= 80, functions >= 80 across `core/scheduler/`, `core/telemetry/`, `core/config/`. Run the test suite, fix all failures, iterate. After all tests pass, run `/generate-session-history` to document Phase 8.

---

### Phase 8 Exit Checklist

- [ ] All sub-tasks completed
- [ ] Scheduler enforces FIFO + foreground-wins + VRAM gating
- [ ] Telemetry source works on Windows / macOS / Linux
- [ ] Local Model Status widget lit up on dashboard + every module
- [ ] DiffusionTier classification drives defaults
- [ ] Multi-module job test passes (Coding + Image + Video sequential)
- [ ] Coverage gate green
- [ ] Session history generated for Phase 8
- [ ] Ready to advance to Phase 9
