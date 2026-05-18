# Session History: v1.0.0 Phase 8 -- GpuScheduler + Local Model Status dashboard widget

**Date**: 2026-05-17
**Plan**: [docs/v1.0.0/plans/phase-08-gpu-scheduler-and-telemetry.md](../../plans/phase-08-gpu-scheduler-and-telemetry.md)
**Phase goal**: Cross-module FIFO queue resolving four-pillars-on-one-GPU contention; live telemetry feeds the always-visible Local Model Status panel (model, params, GPU%, free VRAM); hardware tier expanded with `DiffusionTier`.

## Sub-tasks completed

### 8.1 -- GpuScheduler

- New `core/scheduler/GpuScheduler.ts` -- cross-module FIFO scheduler. API: `enqueue(job: GpuJob): Promise<JobHandle>` where `GpuJob = { moduleId in {"coding", "chat", "image", "video"}, jobType, estimatedVramGB, priority in {"foreground", "background"}, run(signal: AbortSignal) => Promise<unknown> }`. Single-GPU ceiling: jobs serialize via an async pump that runs at most one entry at a time. Foreground-module-wins: `setForegroundModule(id)` reorders pending entries so jobs from `id` move to the head of the queue, preserving FIFO order among themselves and the bumped-down background jobs.
- VRAM gating: each `enqueue()` resolves free VRAM via an injected `vramProvider` (sync or async) and throws `InsufficientVramError` when `estimatedVramGB > freeGB`.
- Telemetry: every state transition publishes a `job.queued` / `job.started` / `job.completed` / `job.failed` event on the `TelemetryBus` with `source: "gpu-scheduler"`. `job.cancelled` is published with `kind: "job.failed"` and `payload.schedulerEvent: "job.cancelled"` (and an `InsufficientVramError` rejection also publishes `job.failed` with `payload.reason: "insufficient-vram"`) until the `TelemetryEventKind` union widens (known-gap `8.P2.YY`).
- Cancellation: `JobHandle.cancel()` drops pending entries from the queue immediately with a `JobCancelledError` rejection; for running jobs it aborts the AbortSignal and the run callback's own abort handling closes the loop.
- Snapshot: `snapshot()` returns `{ active, queued, foregroundModule }` for telemetry consumers.

### 8.2 -- GpuTelemetrySource (2 Hz nvidia-smi / system_profiler / CPU)

- New `core/telemetry/GpuTelemetrySource.ts` -- 2 Hz (500 ms default, overridable) poller. Composes a `GpuQueryResult` via an injected `GpuQueryFn`, decorates with active-job info from a caller-supplied `activeJobProvider()`, and publishes `gpu.sample` events on the `TelemetryBus`. Source name: `"gpu-telemetry"`. CPU degrade is automatic on query reject or null result.
- Pure parsers (drive unit tests without spawning a child process):
  - `parseNvidiaSmiCsv(text)` -- handles the `utilization.gpu, memory.total, memory.free, name` CSV line, tolerates an optional header row, tolerates CRLF line endings, clamps utilization to 0..100, converts MB to GB with `round(n * 100) / 100`.
  - `parseAppleSystemProfiler(text, fallbackTotalRamGB)` -- parses `system_profiler SPDisplaysDataType -json`, handles "16 GB" / "8192 MB" suffixes, falls back to the caller-supplied total-RAM hint when VRAM is unset.
  - `buildCpuFallbackSample(deviceName, totalRamGB, freeRamGB)` -- CPU-only fallback (`device: "cpu"`).
- The platform-specific `nvidia-smi -lms 500` long-lived child-process driver (Win / Linux) and the system_profiler one-shot + Metal Performance Shaders fallback (macOS) are deferred to the Phase 9 installer follow-on (known-gap `8.P1.UU`).

### 8.3 -- Local Model Status widget light-up

- Extended `desktop/src/components/LocalModelStatus.types.ts` with optional `vramTotalGB`, `vramAllocatedGB`, `queuedJobs[]`, `idle` fields (back-compat additive). `LocalModelQueuedJob` carries `id | moduleId | jobType | modelId? | estimatedVramGB?`.
- Rewrote `desktop/src/components/LocalModelStatus.tsx` so the widget surface is a `<button>` (clickable + focusable + ARIA-labelled); the `title` attribute carries a multi-line tooltip (device / total VRAM / allocated VRAM / free VRAM / queued-jobs); the idle state renders "Idle" with a muted accent; clicking opens an in-place modal (`role="dialog"`, `aria-modal="true"`) that lists every queued job by module + type + VRAM estimate or shows an empty-state.
- New `desktop/src/components/LocalModelStatusDock.tsx` -- floating fixed-position dock at the bottom-right (width 280, `zIndex: 50`). `desktop/src/App.tsx` mounts the dock on every non-dashboard route via a `useLocation()` gate (Dashboard's inline placement is unchanged).
- New `desktop/src/lib/telemetryStream.ts` -- bridge between the sidecar-side `GpuTelemetrySource` (raw `gpu.sample` events) and the widget's `LocalModelTelemetry` contract. `createTelemetryStream({ source, scheduler, resolver })` translates each raw sample with: model display name + param size resolved via a `ModelMetadataResolver` (default heuristic strips `B`-suffix tokens; custom resolvers can hit `ModelRegistry`); the scheduler snapshot drives `idle` + `queuedJobs`; reference-counted upstream subscriptions detach when the last consumer leaves.

### 8.4 -- DiffusionTier

- New `core/config/DiffusionTier.ts` -- classifies VRAM in GB into one of `diffusion-low` (4-8 GB) / `diffusion-mid` (8-12 GB) / `diffusion-high` (12-20 GB) / `diffusion-pro` (20+ GB) and ships per-tier `image` defaults (width / height / steps / sampler / model / allowControlNet / allowControlNetStacking / allowLoRA) plus `video` defaults (model / clipSeconds / fps / dimensions / enabled). Low ships SD 1.5 at 512x512 with video disabled; mid ships SDXL Turbo at 1024x1024 with single ControlNet + LTX-Video 4 s @ 480p; high adds ControlNet stacking + LTX 8 s @ 720p; pro ships Flux + CogVideoX 5B with `parallelJobs: true`.
- `classifyDiffusionTier(gb)` is the auto-detector; `resolveDiffusionTier(gb, override)` fuses an auto-detected tier with an optional user override and reports whether the override was applied (`overridden` boolean).
- Settings UI surface (Hardware page) + Image Studio / Video Lab form default-wiring deferred to Phase 9 (known-gaps `8.P2.WW`, `8.P2.XX`).

### 8.5 -- Testing + stabilization

- 16 `GpuScheduler` unit tests (`tests/unit/core/scheduler/GpuScheduler.test.ts`) covering FIFO + foreground bump + VRAM gating + queued-cancel + running-cancel + double-cancel + failure-surface + snapshot + custom id generator + caller-supplied id + foreground getter + foreground-priority enqueue + `setForegroundModule(null)` no-op + multi-module no-overlap.
- 21 `GpuTelemetrySource` unit tests (`tests/unit/core/telemetry/GpuTelemetrySource.test.ts`) covering nvidia-smi CSV parsing (happy + header + CRLF + clamp + malformed + missing-fields), Apple system_profiler parsing (explicit VRAM + MB suffix + RAM fallback + malformed + empty), CPU fallback shape, runtime sample-now + decorate + clamp + reject-fallback + null-fallback + start-idempotent + stop-safe + lastSample + default-no-query.
- 26 `DiffusionTier` unit tests (`tests/unit/core/config/DiffusionTier.test.ts`) covering classification across the four tier ranges + edge cases + override fusion + invalid-override fall-through + each tier's image + video defaults.
- 3 integration tests (`tests/integration/gpu-scheduler-multi-module.test.ts`) driving Coding + Image + Video sequence with no-overlap assertion + mid-flight foreground switch reorder + scheduler-driven telemetry decoration.
- 20 new desktop tests: 7 on `telemetryStream` adapter (idle / decorate / default resolver / custom resolver / ref-count unsub / stop / default-scheduler); 6 new `LocalModelStatus` widget tests (idle, tooltip, click-to-open modal, empty-state modal, 0->80% sweep); 2 `LocalModelStatusDock` tests.
- Caught + fixed during the test loop:
  1. `LocalModelStatus.tsx` click handler initially fell out of React's synthetic event tree when triggered via `dispatchEvent(new MouseEvent("click"))` in the test (modal state never updated). Switched the test helper to `fireEvent.click(el)` from `@testing-library/react`.
- The pre-existing 4 CRLF/LF snapshot failures in `tests/unit/agents/SubAgentManager.characterization.test.ts` are unchanged from the Phase 2 baseline and tracked as known-gap `2.P3.L`. Phase 8 did not touch those files.

## Test results

```
npm test                              : 2960 tests, 2951 pass, 5 skipped, 4 fail (pre-existing 2.P3.L)
npm run test --workspace @nexus/desktop: 42 files, 351 tests, all passing
new Phase 8 tests                     : 66 main + 20 desktop = 86 / 86 pass
npm run lint                          : clean
npm run lint --workspace @nexus/desktop: clean
npx tsc --noEmit (main + desktop)     : clean
coverage core/scheduler /telemetry/config: 99.02 lines / 89.76 branches / 100 functions
coverage desktop LocalModelStatus     : 99.59 lines (Dock 100, telemetryStream 100)
```

## Deviations from the plan

1. **`job.cancelled` telemetry envelope** -- The plan describes four event kinds (`scheduler.job.queued`, `scheduler.job.started`, `scheduler.job.completed`, `scheduler.job.cancelled`). The shared `TelemetryEventKind` union in `core/telemetry/TelemetryBus.ts` only carries `job.queued | job.started | job.completed | job.failed | ...`. Rather than open a Phase-2.6-shared widening commit, the scheduler publishes cancellations as `kind: "job.failed"` with `payload.schedulerEvent: "job.cancelled"` discriminator (and the canonical `reason: "insufficient-vram"` / `"dequeued"` / `"abort-signal"` / `"run-threw"` payloads stay distinguishable). Tracked as known-gap `8.P2.YY` for a Phase 9 follow-on.

2. **Sidecar `nvidia-smi -lms 500` driver deferred** -- The plan calls for "a long-lived `nvidia-smi -lms 500` stream" on Win / Linux and "system_profiler once + Metal Performance Shaders" on macOS. `core/telemetry/GpuTelemetrySource.ts` ships the pure parsers + an injection point (`GpuQueryFn`) so the runtime can be driven by the platform-specific spawner once the Tauri Rust core spawns the sidecar (same blocker as known-gap `7.P1.OO`). The widget therefore still falls back to the deterministic mock stream from `desktop/src/lib/telemetryMock.ts` on developer machines. Tracked as known-gap `8.P1.UU`.

3. **Scheduler call-site wiring deferred** -- Per the plan: "Coding's `AgentLoop` does NOT go through the scheduler for tool calls (those are CPU); only the streaming-LLM-token-generation call enqueues a job. Image / Video pipelines route every generation through the scheduler." The `GpuScheduler` ships as a shared-core service with full coverage; the Coding `StreamingPipeline` and Python sidecar `runtimes/diffusion/pipelines/base.py` / `video_base.py` still serialize jobs through the sidecar request loop pending the Tauri Rust spawn (`7.P1.OO`). Tracked as known-gap `8.P1.VV`.

4. **Settings -> Hardware page deferred** -- Per the plan: "The tier display surfaces in Settings -> Hardware with a 'your GPU classifies as ...' readout and an 'override to ...' dropdown". `core/config/DiffusionTier.ts` ships `classifyDiffusionTier` + `resolveDiffusionTier`; the Settings UI page lands in Phase 9 polish (known-gap `8.P2.WW`).

5. **Image Studio / Video Lab default-wiring deferred** -- Per the plan: "Default form values in Image Studio + Video Lab are derived from the tier". The `DIFFUSION_TIER_CONFIGS` table ships the defaults; the form-level `defaultsFor: DiffusionTierConfig` prop wiring lands alongside the Settings page in Phase 9 (known-gap `8.P2.XX`).

## Known gaps added

See [docs/v1.0.0/known-gaps.md](../../known-gaps.md) `8.P1.UU` through `8.P2.YY`. One gap resolved: `1.P3.F` (real telemetry source wired in Phase 8) moved to Resolved.

## Next steps

- Phase 9 (installer overhaul) wires the platform-specific `nvidia-smi -lms 500` / `system_profiler` spawn into the sidecar (`8.P1.UU`) and ships a `telemetry.subscribe` IPC that the desktop App swaps for the mock stream.
- Phase 9 polish pass adds the Settings -> Hardware page (`8.P2.WW`), the Image Studio + Video Lab tier-driven form defaults (`8.P2.XX`), and widens the `TelemetryEventKind` union to include `job.cancelled` (`8.P2.YY`).
- The `GpuScheduler` call-site wiring at the four pillar runtimes (`8.P1.VV`) lands once the Tauri Rust core spawns the Python sidecar (upstream blocker `7.P1.OO`).
