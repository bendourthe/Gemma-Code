# Session History - v2.1.0 Phase 3: Image Studio Provenance + Generation Queue

**Date**: 2026-08-20
**Version**: v2.1.0
**Plan**: [../../plans/v2.1.0-adoption-open-local-ai-wave.md](../../plans/v2.1.0-adoption-open-local-ai-wave.md)
**Phase**: 3 of 7 - Image Studio Provenance + Generation Queue
**Outcome**: Complete. PNG/video provenance round-trips via embedded metadata plus a content-hash index; a persistent SQLite queue supports seed/prompt batches, restart recovery, and recall actions. Live 20-job GPU restart remains deferred.

## Goal

Every generation carries embedded, recallable provenance. Generations run through a persistent job queue that supports fire-and-forget batches and seed/prompt sweeps without deadlocking the GPU scheduler under coding load.

## Pre-flight

`is_final_phase` = **false**. Model routing: plan recommended strong / medium. Cursor cannot script a switch; this session stayed on Cursor Grok 4.6 (same-or-stronger). Visible degrade: map refresh not re-run; proceeded on the plan tier. The user pre-authorized Phases 1-7 with local commits after 1-6, then Phase 7 commit and push.

## 1. Starting State

- **Branch**: `develop`
- **Starting commit**: `081d2229` (Phase 2 cheap-first routing)
- **Package version**: 2.0.0 (bump waits for `/update release`)

## 2. Chronological Steps

### 2.1 Embedded metadata + recall (3.1)

TS writer emits `schemaVersion` (default 1), uncompressed iTXt, and tEXt (nexus_workflow plus ComfyUI `workflow` alias). Extract prefers iTXt then tEXt, ignores unknown fields, and returns null for external images. Python `build_workflow` now includes `schemaVersion: 1` but still writes tEXt only (DF-6). Video completion embeds when `mp4Path`+`workflow` exist; ffmpeg failure still indexes by content hash.

Recall actions: Use Prompt / Use Seed / Use All / Remix. Hidden when extract is null. Index fallback on `diffusion.workflow.extract`. Prompts run through `redactSecrets` before SQLite insert.

**Key files**: `core/image/WorkflowMetadata.ts`, `runtimes/diffusion/pipelines/workflow_metadata.py`, `desktop/src/shared/studio/RecallActions.tsx`, `desktop/sidecar/src/handlers.ts`

### 2.2 Persistent queue + batch expansion (3.2)

Store at `~/.nexus/generations/studio.db`. States: queued / running / interrupted / done / failed. `recover()` maps leftover running to interrupted then queued without duplicating ids. Interactive sorts ahead of batch. `claimNext()` is atomic SELECT+UPDATE; `nextQueued()` is peek-only. Expansion: seed-range, prompt-matrix, combined; cap 64. `pumpOnce` goes through GpuScheduler (interactive = foreground, batch = background). Interactive studio clicks still use the existing dispatcher then record (DF-7). IPC: `generation.queue.list|enqueue|cancel|reorder|pendingCount`. UI: pending count, cancel, reorder, seed-sweep button.

**Key files**: `core/generations/*`, `desktop/sidecar/src/generations/studioRuntime.ts`, `desktop/src/shared/studio/GenerationQueueBar.tsx`

### 2.3 Tests and CI (3.3)

Root: WorkflowMetadata + studioStore (30 tests). Desktop: ImageStudioPage / VideoLabPage / RecallActions / generation-queue-handlers / sidecar-handlers. Python workflow_metadata 7 passed. Coverage on `core/generations` + WorkflowMetadata: 93.3% lines. No new CI job: `ci.yml` `test-ts` already runs root + desktop Vitest. Sidecar imports from `desktop/sidecar/src/generations/` need four `../` to reach `core/`.

## 3. Verification Gate

| Check | Result |
|---|---|
| Root generations + WorkflowMetadata | PASS 30 tests |
| Desktop sidecar + Studio pages | PASS |
| Python `test_workflow_metadata` | PASS 7 |
| `tsc -b` | PASS |
| ESLint on changed sidecar/Studio files | PASS |
| Coverage (generations + WorkflowMetadata) | 93.3% lines |

## 4. Deviations

- Python PNG writer is tEXt-only (DF-6).
- Interactive jobs skip `pumpOnce`; batches drain through it (DF-7).
- Live 20-job GPU restart was not run.
- Two `:memory:` better-sqlite3 connections are separate databases; production uses one `studio.db` file with WAL.

## 5. Known gaps appended

DF-6, DF-7. DF-1, DF-2, DF-4, DF-5 remain open.

## 6. Next

Phase 4 multimodal chat attachments + SAM2. Local commit only.
