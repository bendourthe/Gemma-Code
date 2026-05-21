# Phase 13 -- Video Lab fast tier (SANA-Video 2B)

**Date**: 2026-05-21
**Plan**: [docs/v1.1.0/plans/phase-13-video-lab-sana-video.md](../../plans/phase-13-video-lab-sana-video.md)
**Cycle**: v1.1.0
**Outcome**: Landed. All 4 sub-tasks implemented and tested; the SANA-Video 2B "Fast 720p" tier is selectable end-to-end through the Video Lab UI; the dispatcher round-trips the request through `sana_video.py`'s stub executor; the installer recommended-models picker exposes SANA-Video as an opt-in checkbox across every preset.

---

## Goal

Make the SANA-Video 2B catalog entry (registered in Phase 12.1) user-visible in the Video Lab as the "Fast 720p" tier between LTX-Video (default) and CogVideoX (longer clips). Specifically:

- Add a Preset selector to the Video Lab prompt form that, when set to "Fast 720p (SANA-Video 2B)", populates the form with the SANA-Video defaults (1280x720, 4 s, 24 fps, flow-dpm-solver).
- Add a dedicated `test_sana_video.py` that exercises registration, the IPC round-trip through the stub executor, and the workflow-JSON build -- coverage on `sana_video.py` >= 80% lines.
- Update the installer recommended-models picker so SANA-Video appears as an opt-in checkbox (unticked by default in Light + Recommended; ticked by default in Full).
- Re-run the four-step gate; SANA-Video already rides OA-09 (added in Phase 12) so no new operator-action row opens.

---

## Sub-tasks

### 13.1 -- Video Lab UI "Fast 720p" preset

Added a Preset selector to [desktop/src/modules/video/VideoPromptForm.tsx](../../../../desktop/src/modules/video/VideoPromptForm.tsx) with two entries: `Custom` (no patch) and `Fast 720p (SANA-Video 2B)` (binds `modelId: "sana-video-2b-720p"`, `mode: "text2video"`, `width: 1280`, `height: 720`, `durationSeconds: 4`, `fps: 24`, `sampler: "flow-dpm-solver"`). The new exported `VIDEO_PRESETS` catalog drives both the rendered dropdown and the unit tests. The sampler dropdown widens to include `flow-dpm-solver` so the Fast 720p preset's sampler value is selectable manually too.

Added the `sana-video-2b-720p` entry to [desktop/src/modules/video/VideoLabPage.tsx](../../../../desktop/src/modules/video/VideoLabPage.tsx)'s `DEFAULT_VIDEO_MODELS` array (`{id, displayName: "SANA-Video 2B 720p (Fast)", mode: "text2video"}`) so the preset's chosen modelId resolves under the existing `modelsForMode` filter and Generate dispatches to `diffusion.video.sana.text2video`. The static array is a documented deviation that clusters with the existing live-registry wire-up backlog (see 13.1.P2.JJ).

Widened [runtimes/diffusion/pipelines/video_params.py](../../../../runtimes/diffusion/pipelines/video_params.py)'s `_VALID_SAMPLERS` to include `flow-dpm-solver` so the validator does not reject the SANA-Video preset's request before the dispatcher schedules it.

### 13.2 -- SANA-Video stub-mode integration test

Added [tests/python/diffusion/test_sana_video.py](../../../../tests/python/diffusion/test_sana_video.py) with 18 cases mirroring the shape of [tests/python/diffusion/test_video_base.py](../../../../tests/python/diffusion/test_video_base.py):

- Registration shape: both `diffusion.video.sana.text2video` and `.image2video` install + are callable; `_MODEL_SIZE_GB == 8.0`.
- IPC round-trip through the stub executor (text2video + image2video; workflow JSON carries `prompt` / `sampler` / `modelId`; the workflow re-serializes the request fields verbatim; frame previews are one-per-second for a 4 s clip).
- Envelope validation: missing jobId / missing mode / invalid params / image2video without sourceImage / `None` params all return the expected structured error.
- Insufficient-VRAM path: forced a 2 GB host; 8 GB planning size produces `free < model/2`, returns `insufficient-vram`.
- Outputs directory respects the `NEXUS_VIDEO_OUTPUT_DIR` env override (autouse fixture seeds tmp_path).
- Offload reporting: envelope carries `offloadStrategy` + `offloadReason`; on a 12 GB RTX-4070 host the strategy is one of the four known video-side tiers.
- Module-level surface: `register` is callable; `sana_video.video_base` is identity-equal to the canonical `video_base` module (so the dispatcher path remains uniform).

Coverage on [runtimes/diffusion/pipelines/sana_video.py](../../../../runtimes/diffusion/pipelines/sana_video.py) is **100%** (9/9 statements; well above the 80% Phase 13.2 acceptance).

The plan path `runtimes/diffusion/tests/test_sana_video.py` was not followed because the project's Python tests already centralize under `tests/python/diffusion/` (every sibling diffusion test lives there). The deviation is tracked in [docs/v1.1.0/known-gaps.md](../../known-gaps.md) under 13.2.P3.II.

### 13.3 -- SANA-Video installer opt-in

Added a `default_checked: bool = True` field to `ModelEntry` in [scripts/installer/pyqt/src/nexus_installer/pages/recommended_models.py](../../../../scripts/installer/pyqt/src/nexus_installer/pages/recommended_models.py) (backwards-compatible default keeps every pre-Phase-13 entry checked). Added `sana-video-2b-720p` to LIGHT_PRESET and RECOMMENDED_PRESET with `default_checked=False` (visible-but-unticked opt-in for the extra 4 GB); FULL_PRESET keeps the entry ticked by default (creator-tier user opted into the heaviest payload).

Updated `_PresetCard` to honour the new field via `box.setChecked(model.default_checked)`. Updated `RecommendedModelsPage.__init__` so the initial `selected_models` is seeded from `{m.model_id for m in default.models if m.default_checked}` -- unchecked opt-in rows render but are not pre-selected.

Added 8 new tests in [scripts/installer/pyqt/tests/test_recommended_models.py](../../../../scripts/installer/pyqt/tests/test_recommended_models.py): SANA-Video visible in every preset; default_checked False on Light + Recommended, True on Full; ModelEntry default_checked defaults to True; per-VRAM render asserts SANA-Video is excluded from / included in the initial selection on each preset.

### 13.4 -- Four-step gate, operator-action handoff

- **Lint**: `npm run lint:shell` exits 0 (ESLint clean across `desktop/src`, `desktop/sidecar/src`, `desktop/tests`).
- **Build**: `npm run lint:shell` and the test suites build the project as a side effect (TS errors would surface here).
- **Test (npm)**: 7 new VideoPromptForm tests pass; 11 existing VideoLabPage tests stay green; the two pre-existing `tests/sidecar-handlers.test.ts` failures (`declared-but-unimplemented methods throw NotImplementedError`, `handlers covers every declared method`) reproduce against `main` without the Phase 13 patch applied (confirmed via `git stash`) and trace to a Phase 11 IPC-protocol widening unrelated to Phase 13.
- **Test (pytest)**: 135 / 135 passing across all 13 Python diffusion test files; 23 / 23 passing on the installer pyqt page suite. Coverage on `sana_video.py` is 100%.
- **Operator-action handoff**: OA-09 in [docs/v1.1.0/operator-actions.md](../../operator-actions.md) already carries the SANA-Video 4 s 720p <= 60 s timing target (added in Phase 12). No new operator-action row opens.

---

## Test signals

| Suite | Result |
|---|---|
| `npm run lint:shell` | clean (0 warnings, 0 errors) |
| `npm run test:shell -- tests/VideoPromptForm.test.tsx tests/VideoLabPage.test.tsx` | 18 / 18 passing |
| Python `pytest tests/python/diffusion` | 135 / 135 passing |
| Python `pytest tests/python/diffusion/test_sana_video.py --cov=runtimes.diffusion.pipelines.sana_video` | 18 / 18 passing; 100% line coverage on `sana_video.py` |
| Installer `pytest tests/test_recommended_models.py` | 23 / 23 passing |

---

## Known gaps + deferrals

Recorded in [docs/v1.1.0/known-gaps.md](../../known-gaps.md):

- **13.2.P3.II** (NI, P3): `test_sana_video.py` lives under `tests/python/diffusion/` rather than the plan's `runtimes/diffusion/tests/` path. The acceptance ("mirror the structure of `test_video_base.py`") is satisfied at the test-shape level; the directory deviation keeps the new test alongside every other Python diffusion test.
- **13.1.P2.JJ** (DF, P2): `DEFAULT_VIDEO_MODELS` is still a static array. The live `videoClient.listModels()` wiring clusters with the Phase 2 IPC widening (open under 10.1.P1.Z) and the Image Studio model-dropdown registry hook-up (open under 11.1.P2.CC). The Fast 720p preset still binds to the canonical `sana-video-2b-720p` id, so the wire-up will be a pure plumbing change.

---

## Operator-action handoff

OA-09 already carries the SANA-Video 4 s 720p <= 60 s timing target on the RTX 4070 baseline rig (added in Phase 12). The Phase 13 commit adds no new operator-action row -- the real-host swap of the diffusers-backed `_execute(ctx)` callback continues to ride under 12.2.P1.FF.

---

## Adopts

- SANA S5 (SANA-Video 2B Fast 720p tier) -- see [docs/v1.1.0/comparison-sana.md](../../comparison-sana.md) Section 11.1.
