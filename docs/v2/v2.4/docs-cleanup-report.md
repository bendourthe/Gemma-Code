# Docs cleanup report - v2.4.2 Phase 3

**Mode**: audit (no files moved)
**Date**: 2026-08-31
**Scope**: documents this phase created or updated

## This phase

| Path | Category | Disposition |
|---|---|---|
| `docs/v2/v2.4/plans/v2.4.2-field-ui-history-and-generation.md` | Cat 4 active | Keep in the version plan tree; T016-T019 and Phase 3 exit marked complete |
| `docs/v2/v2.4/development/history/2026-08-30_v2.4.2-phase-3-image-followup.md` | Cat 4 active | Session history for this phase (filename keeps the plan date) |
| `docs/v2/v2.4/known-gaps.md` | Cat 4 active | Appended MT-3; kept MT-1 and MT-2 |
| `docs/DEVLOG.md` | Cat 4 living | Phase 3 entry |
| `ARCHITECTURE.md` | Cat 4 living | Follow-up img2img and SAM2 recovery |

No Cat 1 deletes. No Cat 2 archive moves. Scratch docs were not created. Default: leave living files in place.

## CI impact (Phase 3)

New test path `desktop/tests/followUpSource.test.ts`. Existing `ImageStudioPage.test.tsx`, `imageIntent.test.ts`, `GenerationCanvas.test.tsx`, `tests/unit/core/image/replaceIntent.test.ts`, and `tests/python/diffusion/test_real_execute.py` already run under `npm run test:shell` / pytest. No new command, dependency, environment variable, or artifact. No workflow file changed.
