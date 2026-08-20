# Session history -- v2.0.0 Phase 3 (Video Lab continuation + avatar)

**Date**: 2026-08-19
**Plan**: `docs/v2/v2.0/plans/v2.0.0-adoption-governed-autonomy-multimodal.md`
**Phase**: 3 -- Video Lab continuation + `audio2video` avatar tier

## What shipped

- **Continuation (3.1)**: `planVideoContinuation` splits a requested length into per-tier clips (`clipSeconds` from `DiffusionTier`). Each segment after the first carries `continueFrom` (prior job id + index). Python stub records `conditionedOnPriorEndingFrames`. `TimelinePreviewer` plays a playlist and labels Segment i/n. Seam quality is labelled `prototype-unmeasured` (honest: no GPU A/B this cycle).
- **Avatar (3.2)**: `diffusion.video.audio2video` IPC + dispatcher gate + Python adapter. Catalog entry `longcat-video-avatar-1.5` is official `meituan-longcat` INT8, sha256-pinned (7 files). Gated to `diffusion-pro` with a 20 GB VRAM preflight and an explicit confirm checkbox. Provenance (`neverLeftDevice`) is on the workflow JSON.
- **Scan**: [2026-08-19_phase-3-longcat-scan.md](2026-08-19_phase-3-longcat-scan.md). No LongCat inference `.py` was imported.

## Evidence

- Unit tests: continuation planner, avatar gate, catalog pins, protocol, dispatcher, Video Lab chaining, TimelinePreviewer playlist.
- Python (no GPU): audio2video stub provenance, unofficial-repo reject, duration exception for avatar, pipeline registration.
- CI still uses the video stub executor. Live INT8 DiT on a 24 GB card is not proven here (DF-8).

## Gaps opened

- DF-8: LongCat inference tree not vendored; GPU talking-head is a stub until a scanned import lands.
- DF-9: Continuation seam quality is unmeasured on Wan 2.2 (chaining UX only).
