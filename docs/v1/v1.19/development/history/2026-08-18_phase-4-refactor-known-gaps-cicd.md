# Session History - v1.19.0 Phase 4: Architecture Refactor, Known-Gaps, CI/CD

**Date**: 2026-08-18
**Version**: v1.19.0
**Plan**: [../../plans/v1.19.0-adoption-liquid-lfm-agentic.md](../../plans/v1.19.0-adoption-liquid-lfm-agentic.md)
**Phase**: 4 of 4 - Architecture Refactor, Known-Gaps Reconciliation, and CI/CD
**Outcome**: Complete. `is_final_phase` is true for this plan. Release work hands off to `/update release`.

## Goal

Clean layout, reconcile known gaps (A2 decline + P3 watchlist + v1.18 stay-in-file), cover catalog / installer / harness / desktop picker in CI, optimize minutes.

## Pre-flight

`is_final_phase` = **true** (numerically last; title matches the v3.11.0 gate; Phases 1-3 committed as `58e2293`, `6a8e3f0`, `9f89f6d`). Adjacent v1.19.1 / v1.19.2 plans exist; they do not make this plan's Phase 4 non-final. Plan recommended Strong / high. Cursor picker-only; stayed on current model. No silent downshift. N1: no hosted inference.

## 4.1 Architecture refactor

Propose-then-apply: **no moves**.

- Dual catalogs (`core/registry/catalog.json` vs `models.json`) stay (installer typed catalog vs coding ModelCatalog).
- LFM characterization fixtures already live at `tests/unit/orchestration/fixtures/lfmToolCallFixtures.ts`.
- Bake-off note stays under `development/` (record, not session history).
- Empty dirs `modules/coding/skills/catalog/__none__` and `__nonexistent_user__` are test placeholders; not pruned.
- `docs/v1/v1.19/` already has `plans/`, `comparisons/`, `development/history/`, `known-gaps.md`.

## 4.2 Known-gaps reconciliation

File stays **in-progress** (sibling subplans). v1.18 items stay in that file.

Open DF: 2, 3, 6, 7, 8, 9, 10, 11. Resolved this cycle: DF-1, DF-4, DF-5, DF-12. No NI / MT / QG / WN.

## 4.3 CI/CD

- Moved `test-installer` from `ci.yml` to `.github/workflows/installer-tests.yml` with path filters (`scripts/installer/**` + catalog/registry) and `setup-uv` cache. Concurrency cancel-in-progress.
- `ci.yml` `test-ts` Node 22 runs `npm run test:shell` so develop pushes cover desktop picker tests (`shell-build.yml` remains main-only for the full Tauri matrix).
- Actions budget freeze ended 2026-08-01. No new macOS/Windows job.
- Installer parity checker: no-op (no `scripts/check_installer_parity.py`; three OS installers share one Python package).
- `platform-contract-verification` / `model-prompting-research`: no-op (not a Nexus-Hub catalog repo).

## 8.1 gitignore

0 patterns added (`.pytest_cache/`, `.ruff_cache/`, `__pycache__/` already ignored).

## Gates

- Root **4947 passed / 11 skipped / 0 failed** (459 files). Desktop **971 passed**. Installer pytest green. Lint + `tsc -b` + `check:tampering` + `check:docs-layout` clean.
- ENV: `SqliteGraphStore` FTS `< 50ms` failed once at exactly 50ms under parallel desktop+root load; passed on isolated retry and on the solo full suite. Not a product change.

## Deviations

None beyond the documented CI split (installer tests leave `ci.yml` rather than staying unfiltered).

## Next

Commit and push this phase, then `/update release`.
