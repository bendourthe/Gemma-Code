# Session History - Phase 2: Model Availability End to End

**Date**: 2026-08-22
**Plan**: [v2.2.0-runtime-repair-and-ux-overhaul.md](../../plans/v2.2.0-runtime-repair-and-ux-overhaul.md) - Phase 2 of 8
**Outcome**: All 5 sub-tasks complete; all four quality gates green.

## Context

Phase 1 made the backend start. Phase 2 makes the app tell the truth about what it finds. The reference install had 9 of 10 models verified on disk while every studio reported "No models installed", Settings printed the raw `sidecar-not-running` token, and the GPU card showed a model that was never loaded.

## Sub-tasks

### 2.1 Probe reconciliation

- `safeDirName()` in `core/registry/installedProbe.ts` mirrors the installer's `_SAFE_DIR_CHAR_RE` rule; `isOnDisk()` prefers a `.nexus-model-id` marker, then falls back to sanitized-to-sanitized directory matching. Ids like `sam2:hiera-tiny` were previously unmatchable.
- `synthesizeInstalledFromProbe()` produces metadata-poor installed rows when the catalog failed to load, so a catalog problem no longer erases the user's models.
- Installer writes `.nexus-model-id` after verification (`write_model_id_marker`, best-effort, non-fatal).
- `defaultModelsRoot()` honours `NEXUS_MODELS_ROOT`, which Phase 1's boot hook fills from `runtime.json` - a custom `models_root` install was structurally invisible before.

### 2.2 Truthful sidecar / empty / error states

- New `desktop/src/lib/sidecarStatus.ts` (`useSidecarStatus`, `describeSidecarFailure`, `isSidecarFailureMessage`, `isBackendDownMessage`, `isCatalogFailure`) and `desktop/src/components/SidecarDownBanner.tsx`.
- `invokeCommand()` added to `lib/ipc.ts`: the status/restart commands must NOT travel over the sidecar JSON-RPC bridge, or they would fail for exactly the reason they exist to report.
- Wired into `ImageStudioPage`, `VideoLabPage`, `ModelsSettings`, `SkillsSettings`. `ipcSkillsClient.activeTag()` now throws on IPC failure instead of returning null.

### 2.3 Ollama version gate

- `ensure_ollama_supports()` (module scope in `ollama_installer.py`) checks a catalog entry's `minOllamaVersion` before pulling, upgrades the managed Ollama once, and returns an actionable reason on failure.
- `classify_pull_failure()` / `remedy_for_failure()` in `model_puller.py`; the router appends the class and remedy to the per-model failure reason.

### 2.4 Live GPU telemetry

- `desktop/sidecar/src/telemetry/gpuRuntime.ts` supplies the `nvidia-smi` / `system_profiler` query `GpuTelemetrySource` never had wired in production (it existed and was unit-tested since v1.0.0, but nothing ever constructed it).
- New `gpu.sample` IPC method (poll-based; `telemetry.subscribe` remains an unimplemented push channel).
- `createLiveTelemetryStream` is the App default; the mock is behind `VITE_NEXUS_MOCK_TELEMETRY=1`. Stale samples render `(stale)`.

### 2.5 Generation smoke

- `desktop/tests/generation-smoke.test.ts`: handler-layer routing plus the typed `runtime-unavailable` failure.
- `scripts/smoke/live-gpu-generation.mjs`: real render, gated behind `NEXUS_LIVE_GPU=1`, verified to skip cleanly (exit 2) without the gate. NOT executed this session (DF-4).

## Defects found by the new tests (and fixed)

1. **Synthesis emitted near-duplicate rows** - dedup compared directory names against unsanitized marker ids, so a marker-bearing directory was pushed twice.
2. **`useSidecarStatus` could never show the banner for some callers** - the polling effect depended on the injected `fetchFn` identity; an inline callback restarted the effect on every render and cleared the down-debounce timer before it fired. Fixed by holding the callbacks in refs.
3. **Over-broad backend-down classifier** - my first version treated ANY error message as backend-down, which replaced a page's real error text (e.g. "offline") with the backend banner. Narrowed to explicit shell tokens; `sidecar_status` stays authoritative. Caught by an existing SkillsSettings test, then pinned with a regression test.

## Gates

| Gate | Result |
|---|---|
| Root vitest | 5339 passed / 12 skipped / 0 failed |
| Desktop vitest | 1132 passed / 0 failed (140 files) |
| Desktop coverage | 89.95% lines / 82.79% branches (gate: 80%) |
| Installer pytest | all green |
| tsc -b / eslint / ruff (touched) | clean |

Three pre-existing desktop tests were updated to the new contracts (activeTag throwing, `gpu.sample` implemented, `models.list` carrying `catalogStatus`).

## Next steps

Phase 3 - Nexus-Hub Harness Provisioning and Skills Surface. The `skills.list` stub (`NHC.P6.B`) and the offline catalog snapshot land there; this phase only stopped the Skills page from lying about WHY it was empty.
