# Known Gaps - v2.1

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-20

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v2.1.0-adoption-open-local-ai-wave.md](plans/v2.1.0-adoption-open-local-ai-wave.md)

Phase 7 reconciliation plus the post-phase known-gaps sweep: hardware and product-backlog items stay deferred with next steps. Code-completeable rows from that sweep (Python iTXt, Chat video sampling, Chat episodic hub, PDF extract port, JSON CLI bind, Video Lab VRAM knobs, vault notice, desktop `tool.call`) are resolved below. Comparison backlog A13 (minimal mask canvas) and A14 (frame-anchored video comments) remain deferred. DiffusionGemma remains DF-1 with both flip conditions. Status stays in-progress until `/update release` bumps the version.

## v2.1.0

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 15 | 9 |
| Bugs / regressions (BG) | 0 | 0 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

### Open Items

#### Deferred

##### DF-1 - DiffusionGemma is a watch item, not a catalog entry

- **Source phase**: Phase 1 - Unsloth Dynamic quant references + capability flags + watch item (1.4 / A4b)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 1.4)
- **Comparison**: `docs/v2/v2.1/comparisons/v2.1.0-comparison-open-local-ai-wave.md` Section 7 (DG1/DG4)
- **Reason**: Discrete-diffusion text generation at 26B-A4B needs llama.cpp PR #24423 mainlined into a shipped Ollama release, AND sub-16 GB quants published. Stock Ollama support is incomplete. Shipping it today would add a second installer-provisioned runtime for one experimental model.
- **Flip conditions** (both required):
  1. llama.cpp PR #24423 is mainlined into a shipped Ollama release.
  2. Sub-16 GB quants are published.
- **Suggested next step**: Re-open as a catalog entry only when both flip conditions hold. Gate `diffusion: true` and `codingEligible: false` so it never becomes a coding-harness default.

##### DF-2 - Live golden-task re-verification of Muse Glimmer and Nemotron Lightning was not run

- **Source phase**: Phase 1 - Local benchmark re-verification (1.5)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 1.5)
- **Reason**: This cycle had no proven 24 GB-tier host with either model loaded. Catalog `localEval.status` is `not_run`. Vendor-reported SWE-Bench Verified 76.0 stays in `vendorReported` only. `recommended.json` was not changed.
- **Suggested next step**: On a 24 GB-tier machine, run `runCatalogModelEval` against Muse Glimmer K-Quant-17GB and Lightning Q4_K_M, persist the blocks, and only then propose a default-route change.

##### DF-4 - Routing swap does not prefetch or unload Ollama weights

- **Source phase**: Phase 2 - GPU scheduler integration (2.3)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 2.3)
- **Reason**: `evaluateModelSwap` / `GpuScheduler.evaluateRoutingSwap` return honor / defer / `keepWorkerResident`. They do not call Ollama load or unload. Prefetch of a predicted swap is not implemented.
- **Suggested next step**: After an honored swap with `keepWorkerResident: false`, invoke the existing model-unload path so the worker actually leaves VRAM.

##### DF-5 - VS Code AgentLoop is not on the routing path

- **Source phase**: Phase 2 - Escalation policy engine (2.2)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 2.2)
- **Reason**: Routing is wired through `DAGExecutor` / `Orchestrator` when a `DAGRoutingContext` is supplied. `src/tools/AgentLoop.ts` still uses the session's single model. Importing AgentLoop from `modules/coding/orchestration` would cross the vscode host boundary. VS Code AgentLoop also still does not publish `tool.call` telemetry.
- **Suggested next step**: Project AgentLoop tool results into `RoutingTurnEvent` inside the VS Code host and call `routeTurn` per iteration, or route VS Code coding through the same DAG host the desktop sidecar uses.

##### DF-7 - Live 20-job GPU restart and interactive pump path are unproven

- **Source phase**: Phase 3 - Persistent generation job queue (3.2)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 3.2)
- **Reason**: Restart recovery is unit-tested (`running` -> `interrupted` -> `queued`, id-stable). Interactive Image Studio / Video Lab clicks still go through the existing dispatcher and then record into the queue; only `generation.queue.enqueue` batches drain via `pumpOnce` + `GpuScheduler`. A 20-job batch surviving a real app restart on a GPU host was not run this cycle.
- **Suggested next step**: Route interactive jobs through `pumpOnce` as well, then soak a 20-job seed sweep across a sidecar restart on a diffusion-capable machine.

##### DF-8 - Muse Glimmer hf.co GGUF is gated vision:false

- **Source phase**: Phase 4 - Chat attachment ingestion + visual-token budgeting (4.1)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 4.1)
- **Reason**: Native Muse is multimodal. The catalog pull is `ollama://hf.co/meta-models/Muse-Glimmer-30B-GGUF:...`. This cycle did not prove that GGUF ships mmproj. `vision` is false so Chat will not send image bytes to a text-only serving path.
- **Suggested next step**: After a local Ollama load of the K-Quant-17GB tag, check for a vision projector. If present, set `vision: true` and a visual-token budget. If absent, keep the gate and leave the native library tag as a follow-up.

##### DF-10 - Ambiguous SAM2 phrases have no one-tap candidate picker

- **Source phase**: Phase 4 - Replace the X chat-native editing (4.3)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 4.3)
- **Reason**: Two or more candidates produce a chat message asking the user to paint a mask or rephrase. There is no overlay picker.
- **Suggested next step**: Render candidate mask overlays in the Studio thread and inpaint the tapped one.

##### DF-12 - Required Unsloth zoo is LGPL, not Apache-only

- **Source phase**: Phase 5 - License-boundary verification (5.1)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 5.1)
- **Reason**: `unsloth` 2026.8.18 is Apache-2.0 but requires `unsloth-zoo` 2026.8.13 (LGPL-3.0-or-later). The plan STOP condition is AGPL on a required component; zoo is not AGPL. Studio/CLI extras stay excluded. Decision record: `docs/v2/v2.1/development/unsloth-license-boundary.md`.
- **Suggested next step**: Revisit if Unsloth publishes an Apache-licensed zoo, or document the LGPL dynamic-link posture in the installer EULA copy.

##### DF-13 - Live Unsloth QLoRA was not run on GPU

- **Source phase**: Phase 5 - QLoRA orchestration (5.4 / 5.5)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 5.4)
- **Reason**: CI uses `stubTrainer` and `runtimes/tuning/train.py --stub`. `NEXUS_TUNING_LIVE=1` is documented. No 16 GB NVIDIA host ran a real `import unsloth` train this cycle. not_run != pass.
- **Suggested next step**: On a supported host, provision from Settings, run a tiny JSONL job with `NEXUS_TUNING_LIVE=1`, and record the wall-clock plus peak VRAM.

##### DF-15 - Training runtime is not on the default installer chain

- **Source phase**: Phase 5 - Installer provisioning (5.2)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 5.2)
- **Reason**: `UnslothVenvProvisioner` is opt-in (`opt_in=False` by default) and is not listed in `chain_for`. Settings > Fine-tuning can provision post-install. A clean-machine NVIDIA harness run was not executed this cycle.
- **Suggested next step**: Add an installer checkbox that sets `opt_in=True` and appends the provisioner to `chain_for` when the host passes `training_supported`.

##### DF-16 - Eval gate uses an injected stub, not GoldenTaskRunner

- **Source phase**: Phase 5 - QLoRA eval gate (5.4)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 5.4)
- **Reason**: `core/tuning` must not import `modules/coding`. The sidecar injects `EvalPort` with equal stub scores (or `NEXUS_TUNING_EVAL_*`). Regression quarantine is unit-tested; live golden-task comparison is not.
- **Suggested next step**: Sidecar-only adapter that calls `GoldenTaskRunner` on base vs adapter tags after GGUF import.

##### DF-17 - GGUF-to-Ollama import is opt-in

- **Source phase**: Phase 5 - QLoRA re-import (5.4)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 5.4)
- **Reason**: Default sidecar runtime does not spawn `ollama create`. Jobs can reach `done` with an export path and no registry row. An injected `OllamaImportPort` covers the export-failed path in tests.
- **Suggested next step**: After a passing eval, write a Modelfile and run `ollama create`, then reuse v1.15.0 registry reconciliation.

##### DF-21 - Live GPU layer-streaming OOM rescue is unproven

- **Source phase**: Phase 6 - Diffusion VRAM-budget knobs (6.3)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 6.3)
- **Reason**: Unit and Python tests cover validation plus a constrained-VRAM runner path that upgrades `insufficient_vram` to sequential CPU offload when streaming is on. No diffusion-capable host ran a real OOM-then-complete generation this cycle. not_run != pass.
- **Suggested next step**: On a 8-12 GB GPU, set a VRAM cap below the model minimum with layer streaming enabled and record whether the job completes.

##### DF-23 - Minimal mask-layer canvas is not in Advanced settings (A13)

- **Source phase**: Phase 7 - Known-gaps reconciliation (7.2)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 7.2)
- **Comparison**: `docs/v2/v2.1/comparisons/v2.1.0-comparison-open-local-ai-wave.md` A13 / IV4
- **Reason**: Paint/erase mask plus bounding-box region was P3, gated on A9 (replace-the-X) proving demand for manual refinement. Phase 4 shipped SAM2 phrase editing; this cycle did not add a second mask canvas behind Advanced.
- **Suggested next step**: After users hit DF-10 (ambiguous candidates) often enough, add a paint/erase mask layer in Image Studio Advanced, not a four-layer-type node graph.

##### DF-24 - Frame-anchored Video Lab comments are not implemented (A14)

- **Source phase**: Phase 7 - Known-gaps reconciliation (7.2)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 7.2)
- **Comparison**: `docs/v2/v2.1/comparisons/v2.1.0-comparison-open-local-ai-wave.md` A14 / BZ6
- **Reason**: Frame-anchored comments for iterating on generations were comparison backlog (P3). Video Lab still uses chat-style history plus Advanced settings.
- **Suggested next step**: Add per-frame comment markers on the Video Lab timeline that round-trip into the next generation request, without a networked review surface.

### Resolved

##### DF-3 - Unsloth Dynamic 2.0 GGUF audit found no strict-better swap

- **Source phase**: Phase 1 - Unsloth Dynamic quant references (1.4 / A4)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 1.4)
- **Reason**: Ollama-library LLM entries cannot move onto Unsloth `hf.co` GGUF paths (v1.15.0 known-broken Gemma HTTP 400 invariant). Inkling-Small already ships the established Unsloth UD-IQ1_S GGUF. No other bundled GGUF LLM pick was strictly better at its tier without violating `official: true` or the broken-ref guard.
- **Resolved**: 2026-08-20 (audit recorded; catalog artifact references unchanged)

##### DF-6 - Python PNG writer still emits tEXt only

- **Resolved**: 2026-08-20. `runtimes/diffusion/pipelines/workflow_metadata.py` writes uncompressed iTXt plus tEXt (ComfyUI alias). Extract prefers iTXt.

##### DF-9 - Production Chat has no ffmpeg video-frame sampler

- **Resolved**: 2026-08-20. `media.sampleVideoFrames` IPC plus `core/chat/sampleVideoFrames.ts`. `App.tsx` wires it into `ChatPage`.

##### DF-11 - Production Chat does not persist multimodal surrogates

- **Resolved**: 2026-08-20. `App.tsx` passes a session-scoped `InMemoryMemoryHub`. STT transcripts are also recorded as redacted episodic rows (`chat-stt`).

##### DF-14 - Dataset builder skips PDF files

- **Resolved**: 2026-08-20. Optional `extractPdf` port on `buildDataset`. Sidecar routes PDFs through the shared OCR/`parse_document` spine, then `redactSecrets`.

##### DF-18 - JSON CLI needs the Local API listener bound

- **Resolved**: 2026-08-20. Sidecar `sync()` sets `jsonCliEnabled: true` so `/nexus/*` binds on loopback even when `/v1` is off. No extra port.

##### DF-19 - Video Lab Advanced does not surface diffusion VRAM knobs

- **Resolved**: 2026-08-20. `VideoPromptForm` Advanced mirrors Image Studio VRAM knobs; fields ride the video IPC payload.

##### DF-20 - Vault-unavailable signing keys stay in process memory

- **Resolved**: 2026-08-20. Settings > Security shows a vault-unavailable notice. Keys still never land in plaintext files; untrusted rows stay visible.

##### DF-22 - Production AgentLoop does not emit tool.call telemetry

- **Resolved**: 2026-08-20 for the desktop coding-session path (`toolCallHeader` publishes `tool.call`). VS Code AgentLoop remains a host-boundary follow-up under DF-5.
