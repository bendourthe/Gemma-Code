# Session History - v1.14.0 Phase 1: Catalog curation, release dates, gated remediation

**Date**: 2026-07-19
**Plan**: [../../plans/installer-catalog-curation-and-reliability.md](../../plans/installer-catalog-curation-and-reliability.md)
**Phase**: 1 of 5 - "Catalog curation: best-of-family data set + release dates + gated remediation"
**Outcome**: Complete. All quality gates passed (0 test failures, 0 lint errors, no new source so coverage N/A, build unaffected).

## Goal

Reduce catalog clutter safely, give every selectable model a first-class `releaseDate`, and remediate the gated opt-ins so the "every offered model installs" guarantee (Phase 2) has a clean data foundation.

## What was done

### 1.1 - Prune / verify (no deletions)

- Confirmed the picker loader (`load_catalog_models`) already excludes auxiliary `vae` / `controlnet` types (they have no `task` and their `type` is unmapped in `CATALOG_TYPE_TO_TAB`); added a regression test rather than a loader change.
- **Deviation**: the plan's default was to drop `sana-1.6b-int4`. A live grep showed it is referenced by the desktop Image Studio (`ImageStudioPage.tsx`), the diffusion runtime (`runtimes/diffusion/requirements.txt`, `tests/python/diffusion/test_pipelines_sana.py`), and installer tests - dropping it is out-of-scope cross-stack breakage. Retained + flagged for the Phase 2 guided flow instead (tracked ICR.P1.A). The best-of-family clutter reduction is a render-time concern (Phase 3), so the catalog stays a complete data source.
- Updated `_meta.phase` -> `v1.14.0 Phase 1` and appended a curation note to `_meta.comment`.

### 1.2 - releaseDate backfill

- Added `releaseDate` (ISO `YYYY-MM-DD`, public release dates) to the 18 selectable models that lacked one. All 34 selectable models now carry a valid `releaseDate`; auxiliary entries excluded from the requirement.

### 1.3 - Gated remediation (live-probe classified)

- `sd1.5`: re-pointed `runwayml/stable-diffusion-v1-5` (withdrawn, 307) -> public `stable-diffusion-v1-5/stable-diffusion-v1-5` (302); removed `gated`/`gatedReason`. Installs automatically, no token.
- `svd`, `stable-audio-open-1.0`, `sana-1.6b-int4`: genuinely license-gated (HF 401). Kept `gated: true`, added `requiresLicense: true` + `licenseUrl` (the model's HF license page), and reworded `gatedReason` to describe the guided-unlock path. These feed the Phase 2 guided HF-auth flow.

### 1.4 - recommended.json

- Verified every tier default still resolves to an existing, public id (no default is gated). No change needed (the retained/curated set did not touch any default id).

### 1.5 - Tests + lint

- New/updated tests: `test_sd15_repointed_to_public_mirror`, `test_gated_opt_ins_carry_license_metadata`, `test_every_selectable_model_has_release_date` (replaced the obsolete `test_known_gated_repos_are_flagged`), `test_load_catalog_models_excludes_auxiliary_types`.
- ruff check + format clean on the edited test files.

## Test results

- Full installer pytest: green (0 failures, a few pre-existing skips).
- Root registry vitest (`tests/unit/core/registry`): 129/129 green (incl. `catalog.test.ts`, `catalog-digests.test.ts`).
- Coverage: N/A this phase (data + tests only, no new source).

## Method notes

- Catalog edits applied via a verified string-replacement script (each edit asserts a unique anchor match) so formatting was preserved and no edit was silently mis-applied; result validated as JSON (38 models retained).
- Ground truth for the gated classification came from live HF `resolve` first-hop probes and the Ollama registry manifest HEAD for `gemma4:12b` (all captured during planning).

## Known gaps

`docs/v1/v1.14/known-gaps.md` ICR.P1.A-D: guided-auth flow (Phase 2), sha256 pin rotation (Phase 2.4), and best-effort Gemma 4 tier dates. None block the phase.

## Next

Phase 2 - Install-reliability closure: HF token discovery + guided license step, the live per-tier preflight gate, and real sha256 pin rotation.
