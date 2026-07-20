# Session History - v1.14.0 Phase 5 (FINAL): refactor + known-gaps + CI/CD + release readiness

**Date**: 2026-07-19
**Plan**: [../../plans/installer-catalog-curation-and-reliability.md](../../plans/installer-catalog-curation-and-reliability.md)
**Phase**: 5 of 5 (final) - "Architecture Refactor, Known-Gaps Reconciliation, and CI/CD"
**Outcome**: Complete. Release-gate GO (2 documented load-flakes matching the v1.13 baseline). Handed to `/update release`; nothing auto-tagged/pushed.

## Goal

Close the cycle: verify layout, reconcile known gaps, confirm CI/CD, run the full release-gate suites, and hand release-readiness to `/update release`.

## What was done (verification + reconciliation; no feature code changed)

### 5.1 - Architecture refactor

- No-op: the cycle's new modules + `scripts/installer/README.md` + tests are correctly placed; no empty dirs, duplicates, non-version orphans, or stray TODO/FIXME/DEVIATION markers; `docs/v1/v1.14/` canonical.

### 5.2 - Known-gaps reconciliation

- Reconciled v1.13 carry-forwards: `IR.P1.C` (gated re-point) and `IR.P2.B` (installer README) RESOLVED; `IR.P1.A` / `IR.P2.A` (live Gemma pull+load / preflight) PARTIAL (reachability run live, 0 dead refs; the multi-GB pull+load stays operator-only, ICR.P2.A); `IR.P1.B` deferred (ICR.P2.C); `IR.P1.D` / `IR.P2.C` / `IR.P1.E` low-priority / freeze-deferred; `IR.P3.A` / `IR.P4.A` / `IR.P5.A` carried forward.
- Added the v1.14 terminal reconciliation block.

### 5.3 - CI/CD

- The installer pytest job (`ci.yml`, `uv run pytest tests/`) auto-covers the new test files; the reachability job (`installer-smoke.yml`) is freeze-safe; concurrency cancel-in-progress + npm caching present. No new job. Per-workflow path filters are a freeze-deferred optimization.

### 5.4 - Release readiness

- Static gates green; installer pytest green; root vitest returned to the 4637-passed baseline after an environment repair (below). Handed to `/update release`; no auto tag/push.

## Test results

- Static gates: `npm run build` 0, `npm run lint` 0, `npm run check-architecture` 0 errors / 10 pre-existing warnings, `npm run check:tampering` 0 findings, `npm run security:check` in sync.
- Installer pytest: green.
- Root vitest: 4637 passed / 6 skipped / 2 failed. The 2 (`memory-auto-archive`, `memory-consolidator-large`) are load-induced integration flakes that PASS in isolation (17s, 6/6) - the same class as the v1.13 baseline flakes, not v1.14 regressions (v1.14 touched no memory/DB TS code).

## Environment repair (important)

- The first full-suite run showed 419 failures. Root cause: `better-sqlite3` `NODE_MODULE_VERSION` mismatch (compiled 135 vs required 137) left in local `node_modules` by the prior "Rebuild the installer" `npm ci` (which built native modules against a different Node ABI). Running on Node v24.13.0 (ABI 137). Fix: `npm rebuild better-sqlite3`; the re-run returned to the 4637-passed baseline. This is a local dev-env repair, not a code defect, and does not affect the shipped installer (which bundles its own Python + Ollama, not this repo's node_modules).

## Deviations

- None (Phase 1's ICR.P1.A retention decision stands, reconciled in known-gaps).

## v1.14.0 cycle summary

1. Catalog curation (release dates + gated remediation). 2. Install-reliability closure (HF auth flow + live reachability + README). 3. Models-page best-of-family collapse + sort + disable + release pill. 4. Installing-page polish (dependency bars, View Logs margin, footer Cancel). 5. This close-out.

## Next

Hand to `/update release` for the version bump / changelog / tag (its own confirmation gates; nothing auto-tagged). The tag-triggered binary build stays freeze-blocked until ~2026-08-01.
