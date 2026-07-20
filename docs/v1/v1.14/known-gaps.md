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

### Open Items (Phase 3)

| ID | Class | Source phase | Item | Reason | Suggested next step |
|----|-------|--------------|------|--------|---------------------|
| ICR.P3.A | DF | Phase 3 | On-device visual QA of the best-of-family collapse, recommended-first sort, grayed disabled cards, release-date pill, and the "Needs more VRAM" divider | The collapse/sort/pill logic is unit-tested (97% on `typed_catalog.py`) with offscreen renders, but the on-monitor appearance was not eyeballed; continues the IR.P3.A / IR.P4.A visual-QA pattern | Confirm the picker on a real display during the next on-device installer QA pass |
| ICR.P3.B | NI | Phase 3 | The collapse hides fitting variants that are not the family best-fit, with no in-installer "show all variants" escape hatch | Deliberate, per the user's "best fit + bigger disabled" choice: a user wanting a smaller/faster tier than the best-fit on their GPU cannot pick it in the installer | The desktop model manager can install any catalog model post-install; add a picker "show all variants" toggle only if requested |

### Open Items (Phase 4)

| ID | Class | Source phase | Item | Reason | Suggested next step |
|----|-------|--------------|------|--------|---------------------|
| ICR.P4.A | DF | Phase 4 | On-device visual QA of the installing-page polish (uniform dependency bars, View Logs button inset, footer Cancel appearing during install and gone on completion) | The layout invariants (bar column span, button-row margins, footer-cancel visibility across the install lifecycle) are unit-tested with offscreen renders, but the on-monitor appearance was not eyeballed; continues the IR.P3.A / ICR.P3.A visual-QA pattern | Confirm the installing page on a real display during the next on-device installer QA pass |

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

- Open: Phase 1 = 3 (ICR.P1.A, ICR.P1.C, ICR.P1.D; ICR.P1.B resolved); Phase 2 = 4 (ICR.P2.A live pull+load, ICR.P2.B on-device dialog QA, ICR.P2.C pin-rotation, ICR.P2.D auxiliary ControlNet gating); Phase 3 = 2 (ICR.P3.A on-device picker QA, ICR.P3.B no show-all-variants toggle); Phase 4 = 1 (ICR.P4.A on-device installing-page QA).
- Resolved so far: Phase 1 -- `sd1.5` re-pointed + de-gated, gated opt-ins flagged, `releaseDate` on every selectable model, auxiliary exclusion regression-tested. Phase 2 -- HF token discovery, the guided license/token dialog + coordinator, a LIVE reachability probe (0 dead refs), the installer README. Phase 3 -- the Models page collapses each family to one best-fitting pick (recommended first, larger tiers grayed under a divider), dims incompatible cards, and shows the release date as a pill. Phase 4 -- the installing page's Dependencies bars fill the row (no dead space), the View Logs button is inset off the outline, and Cancel lives on the footer row during install and is removed on completion.
- No release-blockers: the remaining items are operator/live-run (multi-GB downloads under the Actions freeze), on-device QA, or deliberate design choices.

### Phase 5 reconciliation (terminal gate)

- **Architecture**: no-op -- the cycle's new modules (`engine/hf_auth.py`, `engine/gated_auth.py`, `widgets/gated_auth_dialog.py`), `scripts/installer/README.md`, and tests sit in the correct trees; no empty dirs, duplicates, non-version orphans, or stray TODO/FIXME/DEVIATION markers introduced. `docs/v1/v1.14/` is canonical.
- **v1.13 carry-forward**: `IR.P1.C` (gated re-point) and `IR.P2.B` (installer README) RESOLVED. `IR.P1.A` / `IR.P2.A` (live Gemma pull+load / preflight) PARTIAL -- the reachability leg was run live (0 dead refs); the multi-GB pull+load stays operator-only (ICR.P2.A). `IR.P1.B` (pin rotation) deferred (ICR.P2.C). `IR.P1.D` (Ollama 400 hint), `IR.P2.C` (thin CLI test), and `IR.P1.E` (pull+load CI leg) remain low-priority / freeze-deferred. `IR.P3.A` / `IR.P4.A` / `IR.P5.A` carried forward (on-device QA / polish).
- **CI/CD**: the installer pytest job (`ci.yml`, `uv run pytest tests/`) auto-covers the cycle's new test files; the reachability job (`installer-smoke.yml`) is freeze-safe; concurrency cancel-in-progress + npm caching are in place. No new job required. Per-workflow path filters are a freeze-deferred optimization (CI is $0-frozen).
- **Tests**: static gates green (tsc build, eslint, check-architecture 0 errors / 10 pre-existing warnings, check:tampering 0, security:check in sync); full installer pytest green. Root vitest: 4637 passed / 6 skipped / 2 failed -- the 2 (`memory-auto-archive`, `memory-consolidator-large`) are load-induced integration flakes that PASS in isolation (matches the v1.13 baseline), not v1.14 regressions.
- **Environment note**: the first full-suite run showed 419 failures from a `better-sqlite3` NODE_MODULE_VERSION mismatch (135 vs 137) left in local `node_modules` by the prior installer-rebuild `npm ci`; `npm rebuild better-sqlite3` repaired it and the re-run returned to the 4637-passed baseline. A local dev-env repair, not a project defect.
- **Release**: handed to `/update release`; NOT auto-tagged/pushed. The tag-triggered binary build (`release.yml`) stays blocked by the GitHub Actions budget freeze until ~2026-08-01 (same as v2.2.0 / v2.3.0).

_Last updated: 2026-07-19 (Phase 5, terminal)._
