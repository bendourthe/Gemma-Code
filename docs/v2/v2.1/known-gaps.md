# Known Gaps - v2.1

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-20

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v2.1.0-adoption-open-local-ai-wave.md](plans/v2.1.0-adoption-open-local-ai-wave.md)

## v2.1.0

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 6 | 1 |
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
- **Reason**: Routing is wired through `DAGExecutor` / `Orchestrator` when a `DAGRoutingContext` is supplied. `src/tools/AgentLoop.ts` still uses the session's single model. Importing AgentLoop from `modules/coding/orchestration` would cross the vscode host boundary.
- **Suggested next step**: Project AgentLoop tool results into `RoutingTurnEvent` inside the VS Code host and call `routeTurn` per iteration, or route VS Code coding through the same DAG host the desktop sidecar uses.

##### DF-6 - Python PNG writer still emits tEXt only

- **Source phase**: Phase 3 - Embedded generation metadata (3.1)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 3.1)
- **Reason**: `core/image/WorkflowMetadata.ts` writes uncompressed iTXt plus tEXt. `runtimes/diffusion/pipelines/workflow_metadata.py` still writes Latin-1 tEXt chunks with UTF-8 payloads. TS extract reads both, so Python outputs still recall, but a strict PNG decoder that ignores invalid tEXt UTF-8 would miss them.
- **Suggested next step**: Mirror `makeITxtChunk` in the Python embedder and keep tEXt as a ComfyUI compat alias.

##### DF-7 - Live 20-job GPU restart and interactive pump path are unproven

- **Source phase**: Phase 3 - Persistent generation job queue (3.2)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 3.2)
- **Reason**: Restart recovery is unit-tested (`running` -> `interrupted` -> `queued`, id-stable). Interactive Image Studio / Video Lab clicks still go through the existing dispatcher and then record into the queue; only `generation.queue.enqueue` batches drain via `pumpOnce` + `GpuScheduler`. A 20-job batch surviving a real app restart on a GPU host was not run this cycle.
- **Suggested next step**: Route interactive jobs through `pumpOnce` as well, then soak a 20-job seed sweep across a sidecar restart on a diffusion-capable machine.

### Resolved

##### DF-3 - Unsloth Dynamic 2.0 GGUF audit found no strict-better swap

- **Source phase**: Phase 1 - Unsloth Dynamic quant references (1.4 / A4)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 1.4)
- **Reason**: Ollama-library LLM entries cannot move onto Unsloth `hf.co` GGUF paths (v1.15.0 known-broken Gemma HTTP 400 invariant). Inkling-Small already ships the established Unsloth UD-IQ1_S GGUF. No other bundled GGUF LLM pick was strictly better at its tier without violating `official: true` or the broken-ref guard.
- **Resolved**: 2026-08-20 (audit recorded; catalog artifact references unchanged)
