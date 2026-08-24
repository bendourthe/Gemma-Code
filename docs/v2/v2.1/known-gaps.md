# Known Gaps - v2.1

**Project**: Nexus AI Studio
**Status**: finalized
**Last updated**: 2026-08-20 (develop follow-up after tag `v2.1.0`; no retag)

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v2.1.0-adoption-open-local-ai-wave.md](plans/v2.1.0-adoption-open-local-ai-wave.md)

Phase 7 reconciliation plus post-cut known-gaps sweeps: hardware, license, and live-GPU items stay deferred with next steps. Code-completeable rows from those sweeps are resolved below. Status is finalized at the v2.1.0 cut. Remaining open DFs carry into the next `/plan`. No version bump.

## v2.1.0

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 6 | 18 |
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

##### DF-7 - Live 20-job GPU restart soak is unproven

- **Source phase**: Phase 3 - Persistent generation job queue (3.2)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 3.2)
- **Reason**: Interactive Image Studio / Video Lab clicks now enqueue `priority: "interactive"` and fire-and-forget `pumpOnce` (same GPU slot as batches). Restart recovery remains unit-tested (`running` -> `interrupted` -> `queued`, id-stable). A 20-job batch surviving a real app restart on a GPU host was not run. not_run != pass.
- **Suggested next step**: Soak a 20-job seed sweep across a sidecar restart on a diffusion-capable machine.

##### DF-8 - Muse Glimmer hf.co GGUF is gated vision:false

- **Source phase**: Phase 4 - Chat attachment ingestion + visual-token budgeting (4.1)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 4.1)
- **Reason**: Native Muse is multimodal. The catalog pull is `ollama://hf.co/meta-models/Muse-Glimmer-30B-GGUF:...`. This cycle did not prove that GGUF ships mmproj. `vision` is false so Chat will not send image bytes to a text-only serving path.
- **Suggested next step**: After a local Ollama load of the K-Quant-17GB tag, check for a vision projector. If present, set `vision: true` and a visual-token budget. If absent, keep the gate and leave the native library tag as a follow-up.

##### DF-13 - Live Unsloth QLoRA was not run on GPU

- **Source phase**: Phase 5 - QLoRA orchestration (5.4 / 5.5)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 5.4)
- **Reason**: CI uses `stubTrainer` and `runtimes/tuning/train.py --stub`. `NEXUS_TUNING_LIVE=1` is documented. No 16 GB NVIDIA host ran a real `import unsloth` train this cycle. not_run != pass.
- **Suggested next step**: On a supported host, provision from Settings, run a tiny JSONL job with `NEXUS_TUNING_LIVE=1`, and record the wall-clock plus peak VRAM.

##### DF-21 - Live GPU layer-streaming OOM rescue is unproven

- **Source phase**: Phase 6 - Diffusion VRAM-budget knobs (6.3)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 6.3)
- **Reason**: Unit and Python tests cover validation plus a constrained-VRAM runner path that upgrades `insufficient_vram` to sequential CPU offload when streaming is on. No diffusion-capable host ran a real OOM-then-complete generation this cycle. not_run != pass.
- **Suggested next step**: On a 8-12 GB GPU, set a VRAM cap below the model minimum with layer streaming enabled and record whether the job completes.

### Resolved

##### DF-4 - Routing swap does not prefetch or unload Ollama weights

- **Resolved**: 2026-08-20 (develop follow-up). After an honored swap with `keepWorkerResident: false`, `routeTurn` calls `onEvictWorker` or `unloadOllamaModel`. Prefetch of a predicted swap is still not implemented.

##### DF-5 - VS Code AgentLoop is not on the routing path

- **Resolved**: 2026-08-20 (develop follow-up). `AgentLoop` calls `routeTurn` per iteration, dispatches `parseAgentToolCalls` by catalog `toolFormat`, and publishes `tool.call` telemetry. Gemma's path stays `gemma4-xml`.

##### DF-10 - Ambiguous SAM2 phrases have no one-tap candidate picker

- **Resolved**: 2026-08-20 (develop follow-up). Image Studio renders `image-sam-candidates` and inpaints the tapped mask.

##### DF-12 - Required Unsloth zoo is LGPL, not Apache-only

- **Resolved**: 2026-08-20 (develop follow-up). Installer extras checkbox copies that `unsloth-zoo` is LGPL-3.0-or-later and dynamically linked. Zoo remains LGPL; Studio/CLI extras stay excluded. Decision record unchanged.

##### DF-15 - Training runtime is not on the default installer chain

- **Resolved**: 2026-08-20 (develop follow-up). Extras checkbox sets `state.install_unsloth`. `InstallEngine` runs `UnslothVenvProvisioner(opt_in=True)` only then. Default `chain_for(..., include_unsloth=False)` is unchanged. Live NVIDIA provision remains DF-13.

##### DF-16 - Eval gate uses an injected stub, not GoldenTaskRunner

- **Resolved**: 2026-08-20 (develop follow-up). Sidecar `createGoldenEvalPort` is selected when `NEXUS_TUNING_EVAL=golden`. CI keeps the equal-score stub. Live golden-task comparison is unproven.

##### DF-17 - GGUF-to-Ollama import is opt-in

- **Resolved**: 2026-08-20 (develop follow-up). Production sidecar uses `createOllamaCreatePort` after a passing eval. Vitest skips the spawn (`VITEST=true`). Live `ollama create` is unproven.

##### DF-23 - Minimal mask-layer canvas is not in Advanced settings (A13)

- **Resolved**: 2026-08-20 (develop follow-up). Image Studio Advanced hosts `MaskEditor` (`image-mask-layer`). Not a node graph.

##### DF-24 - Frame-anchored Video Lab comments are not implemented (A14)

- **Resolved**: 2026-08-20 (develop follow-up). Timeline markers append `Frame notes:` onto the next generation prompt.

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

- **Resolved**: 2026-08-20 for the desktop coding-session path (`toolCallHeader` publishes `tool.call`). VS Code `AgentLoop` also publishes `tool.call` as of the DF-5 follow-up.
