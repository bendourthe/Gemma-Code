# Known Gaps - v2.3

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-28 (v2.3.0 Phase 4)

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v2.3.0-adoption-qwen-video2x-openworker.md](plans/v2.3.0-adoption-qwen-video2x-openworker.md)

## v2.3.0

**Last updated**: 2026-08-28 (Phase 4)

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 1 | 0 |
| Bugs / regressions (BG) | 0 | 0 |
| Warnings (WN) | 1 | 0 |
| Missing tests / coverage gaps (MT) | 1 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

Phases 1-4 landed at automated/internal-compatible evidence. Real Video2X, GPU, packaging, and perceptual review remain Phase 5/6 work rather than Phase 4 slips.

### Open this cycle

##### DF-1 - Hydrated Video Lab sessions do not restore Enhance eligibility

- **Source phase**: Phase 4 - Video Lab Enhance Experience
- **Plan reference**: `docs/v2/v2.3/plans/v2.3.0-adoption-qwen-video2x-openworker.md` (T011, T013)
- **Reason**: Enhance requires a durable output id and SHA-256 from the generation completion event. Studio session turns persist a media path, not those identities, so remounting a saved clip shows the original video and download but not Enhance. not_observed != absent for a later persistence design.
- **Suggested next step**: Persist source output id and hash on studio turns, or recover them from the generation index by path/hash during hydrate, then prove Enhance returns after remount.

##### WN-1 - jsdom canvas and React act notices in Video Lab tests

- **Source phase**: Phase 4 - Video Lab Enhance Experience
- **Plan reference**: `docs/v2/v2.3/plans/v2.3.0-adoption-qwen-video2x-openworker.md` (T013)
- **Reason**: Video Lab tests still emit `HTMLCanvasElement.getContext` and `act(...)` notices. They appeared in the passing Phase 2 desktop aggregate and in the Phase 4 focused run. They are not failed assertions.
- **Suggested next step**: Keep treating them as renderer-environment noise unless a test starts failing; Phase 6 can decide whether a canvas stub is worth the churn.

##### MT-1 - VideoLabPage function coverage is below 80% on the focused run

- **Source phase**: Phase 4 - Video Lab Enhance Experience
- **Plan reference**: `docs/v2/v2.3/plans/v2.3.0-adoption-qwen-video2x-openworker.md` (Phase 4 quality gate)
- **Reason**: Focused Phase 4 coverage measured `VideoLabPage.tsx` at 85.64% lines and 72.41% functions. The new Enhance paths are covered; remaining function gaps are pre-existing page helpers. Line coverage for every Phase 4 file is above 80%.
- **Suggested next step**: Phase 6 aggregate coverage is the release gate. Do not treat this function percentage as a missing Enhance test.
