# Phase 13 -- Video Lab fast tier (SANA-Video 2B)

**Goal**: Add SANA-Video 2B as the "Fast 720p" video tier between LTX-Video and CogVideoX.
**Prerequisites**: Phase 12 (SANA family integration), Phase 14 (installer payload).
**Stability Gate**: On RTX 4070 (12 GB VRAM with offload), SANA-Video 2B produces a 4-second 720p clip in <= 60 s; the Video Lab "Fast 720p" preset is visible and selectable; workflow JSON round-trips; the timeline previewer plays the clip.

**Adopts**: SANA S5 (see [comparison-sana.md](../comparison-sana.md) Section 11.1).

---

## Sub-tasks

### 13.1 -- Video Lab UI "Fast 720p" preset

**Objective**: Add the preset to [desktop/src/modules/video/VideoPromptForm.tsx](../../../desktop/src/modules/video/VideoPromptForm.tsx).

**Prompt**:
> Add "Fast 720p" preset to the Video Lab prompt form's preset selector. The preset binds to `sana-video-2b-720p` (catalog entry from Phase 12.1). Acceptance: selecting the preset populates the form with the right defaults (resolution: 1280x720, duration: 4 s, fps: 24, sampler: flow-dpm-solver); submit dispatches to `sana_video.py`.

---

### 13.2 -- SANA-Video stub-mode integration test

**Objective**: An in-CI test verifies the pipeline registration + IPC round-trip + workflow JSON shape.

**Prompt**:
> Add [runtimes/diffusion/tests/test_sana_video.py](../../../runtimes/diffusion/tests/test_sana_video.py) that exercises the registration, the stub executor, and the workflow-JSON build. Mirror the structure of the existing [runtimes/diffusion/tests/test_video_base.py](../../../runtimes/diffusion/tests/test_video_base.py). Acceptance: the test passes; coverage on `sana_video.py` >= 80% lines.

---

### 13.3 -- Make SANA-Video an installer opt-in

**Objective**: Add SANA-Video as an opt-in checkbox in the recommended-models picker (not auto-ticked; users opt in for the extra 4 GB).

**Prompt**:
> Update [scripts/installer/pyqt/src/nexus_installer/pages/recommended_models.py](../../../scripts/installer/pyqt/src/nexus_installer/pages/recommended_models.py) so SANA-Video appears in the Video tab as an opt-in checkbox (unticked by default in Light + Recommended presets; ticked by default in Full preset). Acceptance: pytest smoke confirms the new entry behaves correctly.

---

### 13.4 -- Phase 13 lint, build, test, operator-action handoff

**Objective**: Verify the SANA-Video integration is CI-green and flag OA-09 for real-GPU timings.

**Prompt**:
> Re-run the four-step gate. Append SANA-Video to OA-09. Acceptance: 0 CI failures.
