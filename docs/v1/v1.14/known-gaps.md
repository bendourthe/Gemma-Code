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

### Open Items (Phase 2)

| ID | Class | Source phase | Item | Reason | Suggested next step |
|----|-------|--------------|------|--------|---------------------|
| ICR.P2.A | DF | Phase 2 | The live pull+load preflight for the 12 GB / 16 GB tier defaults (`--preflight 16`) was not run this cycle | It downloads ~43 GB and writes into the user's Ollama / models root, so it is an operator action on a target box (same freeze / real-hardware deferral as IR.P2.A); the reachability leg WAS run live (0 dead refs, see `development/reachability-2026-07-19.md`) | Operator runs `nexus-installer --preflight 16` on a target box; also live-exercises the `sana-1.6b-int4` gated opt-in (token + nunchaku) for ICR.P1.A |
| ICR.P2.B | DF | Phase 2 | The guided-auth dialog + coordinator are unit-tested but not exercised end-to-end on a real display with a real gated download | The logic (discovery precedence, validate, deselect-on-decline, one-token-covers-rest) is fully unit-tested with mocks; the on-monitor dialog + a real HF token round-trip need a display and an account, continuing the on-device visual-QA pattern | Confirm the dialog on a real display during the next on-device installer QA pass |
| ICR.P2.C | MT | Phase 2 | HF-weight `sha256` pins remain placeholders (same as ICR.P1.C) | Real digests need the multi-GB download from ICR.P2.A, not run this cycle | Rotate via `scripts/installer/build/pin-hf-weights.py` after the operator preflight download |
| ICR.P2.D | WN | Phase 2 | The 3 SANA ControlNet repos (`sana-controlnet-{pose,depth,canny}`) probe GATED (HTTP 401) | Pre-existing; they are auxiliary (excluded from the picker by the loader) so there is no offered-set impact, but the diffusion runtime's ControlNet auto-pull would need a token | Re-point to a public ControlNet source or gate the runtime auto-pull behind the same HF-token flow if ControlNets ship |

### Phase 1 reconciliation

- **ICR.P1.B (guided-auth flow) -> RESOLVED** this cycle: `engine/hf_auth.py` (token discovery + validation), `engine/gated_auth.py` (queue coordinator), and `widgets/gated_auth_dialog.py` (the guided step), wired into the installing page and unit-tested.
- **ICR.P1.A (sana-1.6b-int4 retained + flagged)**: the guided flow now covers it; a LIVE opt-in install (token + nunchaku runtime) remains operator-only and folds into ICR.P2.A.
- **ICR.P1.C (pin rotation)**: still deferred; tracked as ICR.P2.C.

### Carried forward from v1.13.0 (still open)

| ID | Class | Item | Status this cycle |
|----|-------|------|-------------------|
| IR.P1.E | DF | The live pull+load preflight CI job | Still freeze-blocked (GitHub Actions budget $0 until ~2026-08-01); Phase 2.3 runs the preflight LIVE locally and records evidence, but the CI leg stays deferred |
| IR.P3.A | DF | On-device visual confirmation of the gradient wordmark | Unchanged; folds into the v1.14 on-device QA pass |
| IR.P4.A | DF | `BASE_INSTALL_GB` unmeasured estimate + picker QA | Unchanged; the Phase 3 collapse/sort work will want an on-device picker QA pass |
| IR.P5.A | NI | Section-header icon / spinner polish | Unchanged; cosmetic |

### Summary

- Open: Phase 1 = 3 (ICR.P1.A deviation follow-up, ICR.P1.C pin-rotation, ICR.P1.D date-accuracy; ICR.P1.B resolved this cycle); Phase 2 = 4 (ICR.P2.A live pull+load, ICR.P2.B on-device dialog QA, ICR.P2.C pin-rotation, ICR.P2.D auxiliary ControlNet gating).
- Resolved so far: Phase 1 -- `sd1.5` re-pointed + de-gated, gated opt-ins flagged, `releaseDate` on every selectable model, auxiliary exclusion regression-tested. Phase 2 -- HF token discovery (env + HF CLI cache), the guided license/token dialog + queue coordinator (the "make gated models work" guarantee), a LIVE reachability probe showing 0 dead references, and the installer README (closes IR.P2.B).
- No release-blockers: the remaining items are operator/live-run (multi-GB downloads under the Actions freeze), on-device QA, or auxiliary/polish.

_Last updated: 2026-07-19 (Phase 2)._
