# Known Gaps - v1.14.0 (Installer Catalog Curation and Install Reliability)

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/installer-catalog-curation-and-reliability.md](plans/installer-catalog-curation-and-reliability.md)

## v1.14.0

### Open Items

| ID | Class | Source phase | Item | Reason | Suggested next step |
|----|-------|--------------|------|--------|---------------------|
| ICR.P1.A | DF | Phase 1 | `sana-1.6b-int4` was RETAINED and flagged `requiresLicense` rather than dropped (a deliberate deviation from the plan's "drop" default) | Live grep showed it is wired across the desktop Image Studio (`ImageStudioPage.tsx`), the diffusion runtime (`runtimes/diffusion/requirements.txt`, `tests/python/diffusion/test_pipelines_sana.py`), and installer tests; dropping it is out-of-scope cross-stack breakage, and the user's directive is to make gated models work, not drop them | Phase 2 builds the guided HF-auth flow that consumes `requiresLicense`/`licenseUrl`; live-exercise a `sana-1.6b-int4` opt-in install (token + nunchaku) once that flow exists |
| ICR.P1.B | DF | Phase 1 | The guided-auth UI + HF-token flow that the new `requiresLicense`/`licenseUrl` fields feed is not yet implemented | Phase 1 is a data-only catalog cycle; `svd`, `stable-audio-open-1.0`, and `sana-1.6b-int4` now carry the fields, but the installer step that reads them is Phase 2 (sub-tasks 2.1/2.2) | Implement token discovery (2.1) and the guided license/token step (2.2) in Phase 2 |
| ICR.P1.C | MT | Phase 1 | HF-weight `sha256` pins remain all-zero placeholders on the HF default models (carry-forward of v1.13 `IR.P1.B`) | Computing a real digest requires downloading multi-GB weights, out of scope for an offline data phase; the placeholder-warn path is unchanged | Rotate pins via `scripts/installer/build/pin-hf-weights.py` during / after the Phase 2.4 live preflight download |
| ICR.P1.D | DF | Phase 1 | `releaseDate` values are best-effort public release dates; the `gemma4` e2b/e4b/26b/31b tiers share the 12B's `2026-05-01` launch date | The Gemma 4 tiers launched together in the project timeline; exact per-tier dates were not separately sourced, and the field is display-only (a card pill) | Refine to precise per-tier dates if they surface; no functional impact |

### Carried forward from v1.13.0 (still open)

| ID | Class | Item | Status this cycle |
|----|-------|------|-------------------|
| IR.P1.E | DF | The live pull+load preflight CI job | Still freeze-blocked (GitHub Actions budget $0 until ~2026-08-01); Phase 2.3 runs the preflight LIVE locally and records evidence, but the CI leg stays deferred |
| IR.P3.A | DF | On-device visual confirmation of the gradient wordmark | Unchanged; folds into the v1.14 on-device QA pass |
| IR.P4.A | DF | `BASE_INSTALL_GB` unmeasured estimate + picker QA | Unchanged; the Phase 3 collapse/sort work will want an on-device picker QA pass |
| IR.P5.A | NI | Section-header icon / spinner polish | Unchanged; cosmetic |

### Summary

- Open (Phase 1): 4 (2 DF flow/deviation, 1 MT pin-rotation, 1 DF date-accuracy). All feed Phase 2 or are display-only; none block the phase.
- Resolved this phase: `sd1.5` re-pointed to the public `stable-diffusion-v1-5` mirror and de-gated (was v1.13 `IR.P1.C`, partial); genuinely-gated opt-ins (`svd`, `stable-audio-open-1.0`, `sana-1.6b-int4`) now carry `requiresLicense` + `licenseUrl` for the Phase 2 guided flow; every selectable model carries a `releaseDate`; auxiliary `vae`/`controlnet` picker exclusion confirmed + regression-tested.
- No release-blockers: the guided-flow and pin-rotation items are sequenced into Phase 2 by design.

_Last updated: 2026-07-19 (Phase 1)._
