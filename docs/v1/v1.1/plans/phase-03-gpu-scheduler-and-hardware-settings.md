# Phase 3 -- GpuScheduler integration + Hardware Settings + DiffusionTier defaults

**Goal**: Wire the v1.0.0 `GpuScheduler` into every call site that consumes GPU; add the Settings -> Hardware page; have Image Studio + Video Lab read their form defaults from the resolved `DiffusionTier`; widen the `TelemetryEventKind` union with `job.cancelled`.
**Prerequisites**: Phase 2 (IPC).
**Stability Gate**: `npm run test` includes the multi-module GPU-scheduler integration test passing against live processes; Settings -> Hardware shows the detected tier with an override dropdown; Image Studio defaults to the tier's recommended values; `job.cancelled` appears on the bus when a job is cancelled.

---

## Sub-tasks

### 3.1 -- `nexus.gpu.scheduler` IPC into Coding StreamingPipeline

**Objective**: Coding's token-generation call enqueues a job through `GpuScheduler`; tool calls (CPU only) bypass the scheduler.

**Prompt**:
> Construct a single `GpuScheduler` instance in [desktop/sidecar/src/runtime/codingBootstrap.ts](../../../../desktop/sidecar/src/runtime/codingBootstrap.ts). Pass it to the sidecar-side `StreamingPipeline` constructor via the `resolveKeepAlive` argument (which Phase 2's IPC widening lets us route from one place). Each `streamGeneration(modelId, prompt)` call wraps in `scheduler.enqueue({jobType: "llm.stream", modelId, vramEstimate})` and yields the stream when the scheduler grants the slot. Tool calls (CPU work) stay outside the scheduler. Acceptance: a multi-pillar test (run a Coding chat + Image generate concurrently) shows the scheduler queues correctly and the foreground module (whichever has focus) wins on contention.

---

### 3.2 -- `nexus.gpu.scheduler` IPC into diffusion pipelines

**Objective**: Image + Video pipelines route every generation through the scheduler.

**Prompt**:
> Add a `scheduler.enqueue` JSON-RPC method to the Python sidecar that proxies into the TS-side `GpuScheduler` via the Node sidecar (one channel; the Python sidecar speaks JSON-RPC to Node, Node speaks to the scheduler). Modify [runtimes/diffusion/pipelines/base.py](../../../versions/runtimes/diffusion/pipelines/base.py) `runner.run(...)` to call `scheduler.enqueue(...)` before `_execute(ctx)`. Same for [runtimes/diffusion/pipelines/video_base.py](../../../versions/runtimes/diffusion/pipelines/video_base.py). Acceptance: an image and a video generation submitted back-to-back queue in scheduler order; cancellation propagates through both directions.

---

### 3.3 -- Settings -> Hardware page

**Objective**: Build `HardwareSettings.tsx` with the tier readout and override dropdown.

**Prompt**:
> Add [desktop/src/pages/settings/HardwareSettings.tsx](../../../../desktop/src/pages/settings/HardwareSettings.tsx). Show: detected GPU model + driver version (from `telemetry.subscribe`), total VRAM, classified tier (`classifyDiffusionTier(totalVramGB)`), and an "Override tier" dropdown ("Auto / diffusion-low / diffusion-mid / diffusion-high / diffusion-pro"). Persist the override via `SettingsStore` key `nexus.diffusion.tierOverride`. The Image Studio and Video Lab forms read the resolved tier in their initial state (3.4 covers that). Add the Hardware tab to the existing tabbed Settings shell ([desktop/src/pages/settings/SettingsPage.tsx](../../../../desktop/src/pages/settings/SettingsPage.tsx)). Acceptance: opening Settings -> Hardware on an RTX 4070 shows "Detected: NVIDIA GeForce RTX 4070, 12 GB VRAM, tier: diffusion-mid"; switching the override to "diffusion-low" persists and re-renders.

---

### 3.4 -- DiffusionTier defaults in Image Studio + Video Lab forms

**Objective**: Forms accept a `defaultsFor: DiffusionTierConfig` prop and use the resolved tier as the initial state.

**Prompt**:
> Modify [desktop/src/modules/image/ImagePromptForm.tsx](../../../../desktop/src/modules/image/ImagePromptForm.tsx) and [desktop/src/modules/video/VideoPromptForm.tsx](../../../../desktop/src/modules/video/VideoPromptForm.tsx) so each accepts a `defaultsFor: DiffusionTierConfig` prop. The parent passes the resolved tier from `SettingsStore.get("nexus.diffusion.tierOverride")` + `classifyDiffusionTier(lastSample.totalVramGB)`. Form initial values pull from `DIFFUSION_TIER_CONFIGS[tier].image` / `.video`. Acceptance: a `diffusion-mid` host opens Image Studio at 1024x1024 SDXL Turbo defaults (until Phase 12 swaps to SANA); a `diffusion-low` host opens at 512x512 SD 1.5 with video disabled.

---

### 3.5 -- `TelemetryEventKind` widen with `job.cancelled`

**Objective**: Add `job.cancelled` as a first-class event kind.

**Prompt**:
> Widen the `TelemetryEventKind` union in [core/telemetry/TelemetryBus.ts](../../../../core/telemetry/TelemetryBus.ts) with `"job.cancelled"`. Update `GpuScheduler._publish` to use the dedicated kind for cancellations instead of overloading `job.failed`. Subscribers that inspect `payload.schedulerEvent` stay correct; add a new test that filters by kind and asserts cancellations land there. Acceptance: cancel a running image job; the test fixture sees one `job.cancelled` event and zero `job.failed`.

---

### 3.6 -- Multi-module GPU-scheduler integration test

**Objective**: A single test exercises Coding + Image + Video sharing the same `GpuScheduler` against live processes.

**Prompt**:
> Add `tests/integration/gpu-scheduler-multi-module.test.ts` that: (a) starts the sidecar with a mock GPU query reporting 12 GB total / 8 GB free, (b) starts a Coding streaming generation, (c) submits an Image generate while the Coding stream is still running, (d) submits a Video generate too, (e) asserts the scheduler queues all three, foreground-module-wins logic respects the focus state, and the events arrive in the right order on the bus. Acceptance: the test is green on Windows + macOS + Linux CI.

---

### 3.7 -- Phase 3 lint, build, test gate

**Objective**: Verify the scheduler + Hardware Settings + DiffusionTier-default integration is CI-green.

**Prompt**:
> Re-run the four-step gate; verify the Phase 1.10 sub-task's curator-scheduler-only-entry test stays green; assert the multi-module integration test passes. Acceptance: 0 failures across all OS legs.
