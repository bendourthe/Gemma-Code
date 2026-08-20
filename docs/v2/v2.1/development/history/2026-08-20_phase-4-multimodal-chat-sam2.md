# Session History - v2.1.0 Phase 4: Multimodal Chat + Segmentation-Assisted Editing

**Date**: 2026-08-20
**Version**: v2.1.0
**Plan**: [../../plans/v2.1.0-adoption-open-local-ai-wave.md](../../plans/v2.1.0-adoption-open-local-ai-wave.md)
**Phase**: 4 of 7 - Multimodal Chat + Segmentation-Assisted Editing
**Outcome**: Complete. Chat vision is catalog-gated with a visual-token budget. SAM2 is a utility model. Replace-the-X segments then inpaints. Live Muse projector, ffmpeg sampling, candidate picker, and production memory wiring remain deferred.

## Goal

The Chat pillar accepts image and video attachments with visual-token budgeting. Image Studio gains SAM2-driven maskless editing ("replace the X").

## Pre-flight

`is_final_phase` = **false**. Model routing: plan recommended strong / high. Cursor cannot script a switch; this session stayed on Cursor Grok 4.6 (same-or-stronger). Visible degrade: map refresh not re-run; proceeded on the plan tier. The user pre-authorized Phases 1-7 with local commits after 1-6, then Phase 7 commit and push.

## 1. Starting State

- **Branch**: `develop`
- **Starting commit**: `24211393` (Phase 3 studio provenance + queue)
- **Package version**: 2.0.0 (bump waits for `/update release`)

## 2. Chronological Steps

### 2.1 Chat vision flag + budget (4.1)

`vision` is not implied by every `modalities: image` row. `normalizeSpec` defaults true only for `type: llm` with image modality. Muse Glimmer is explicit `vision: false`. Gemma 4 12B has `vision: true` and a 1 / 1e6 / 8 / 8 budget. Chat validates PNG/JPEG/WebP/GIF magic, skips over-budget pixels, caps video frames, and rejects non-vision attachments with switch-or-text guidance. `recordMultimodalTurn` stores a `redactSecrets` caption; production App does not pass `memoryHub` (DF-11). Video sampling is an injected prop (DF-9).

**Key files**: `core/chat/vision.ts`, `core/chat/attachments.ts`, `core/chat/visualBudget.ts`, `core/memory/multimodalSurrogate.ts`, `desktop/src/modules/chat/ChatPage.tsx`

### 2.2 SAM2 catalog + runtime (4.2)

`sam2:hiera-tiny` is type `image`, Apache-2.0, `codingEligible: false`, `diffusion: false`, `vision: false`, tags `sam2` / `utility` / `segmentation`. Image Studio filters `utility` out of the generator picker. Python stub returns `weights_missing` without a checkpoint; `stub: true` or a `.pt` in `weightsDir` returns a 1x1 mask. Ambiguous phrases (`cars`, `people`, ...) return two candidates. Sidecar `diffusion.segment` enqueues through GpuScheduler when studio runtime exists.

**Key files**: `core/registry/catalog.json`, `runtimes/diffusion/pipelines/sam2.py`, `desktop/sidecar/src/handlers.ts`

### 2.3 Replace-the-X (4.3)

`parseReplaceIntent` covers replace / remove / recolor. One candidate auto-inpaints. Zero candidates or `weights_missing` leave the original in the thread. Two-plus candidates ask the user to paint a mask or rephrase (DF-10).

**Key files**: `core/image/replaceIntent.ts`, `desktop/src/modules/image/ImageStudioPage.tsx`

### 2.4 Tests and CI (4.4)

Root: vision, budget, replaceIntent, surrogate, catalog (including origin copy for SAM2). Desktop: ChatPage vision (real PNG, video sampler, malformed magic), ImageStudioPage replace / missing-weights / multi-candidate / utility filter, segment handler. Python sam2 94% lines. Installer invariants: Muse `vision is False`, SAM2 present. No new CI job: `ci.yml` `test-ts` plus `pytest tests/python` already cover the new files.

## 3. Verification Gate

| Check | Result |
|---|---|
| Root Phase 4 unit + catalog | PASS 69+ tests; 100% lines on new core chat/intent/surrogate files |
| Desktop Chat + Studio + segment | PASS |
| Python `test_sam2` | PASS 5, 94% lines |
| Installer `test_catalog_invariants` | PASS |
| `tsc -b` | PASS |
| ESLint on changed desktop files | PASS |

## 4. Deviations

- Muse GGUF projector not proven (DF-8).
- No production ffmpeg sampler (DF-9).
- No one-tap candidate picker (DF-10).
- Production Chat does not pass `memoryHub` (DF-11).
- SAM2 `source.sha256` / weights pin is still all zeros (OA-03 class).

## 5. Known gaps appended

DF-8, DF-9, DF-10, DF-11. DF-1, DF-2, DF-4, DF-5, DF-6, DF-7 remain open.

## 6. Next

Phase 5 local fine-tuning (license gate first). Local commit only.
