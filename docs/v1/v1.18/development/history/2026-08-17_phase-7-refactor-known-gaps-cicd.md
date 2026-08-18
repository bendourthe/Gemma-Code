# Session History - v1.18.0 Phase 7: Architecture Refactor, Known-Gaps, and CI/CD

**Date**: 2026-08-17
**Version**: v1.18.0
**Plan**: [../../plans/v1.18.0-adoption-agent-harness-and-governance.md](../../plans/v1.18.0-adoption-agent-harness-and-governance.md)
**Phase**: 7 of 7 - Architecture Refactor, Known-Gaps Reconciliation, and CI/CD
**Outcome**: Complete as a close-out of landed phases. Quality gates passed without bypass. `is_final_phase` is **false** because Phase 4 is unchecked. `/update release` is not handed off.

## Goal

Leave the layout clean, reconcile known gaps (including gated LG/OI items), and keep CI complete and optimized. Do not cut v1.18.0 while Phase 4 is open.

## Pre-flight

Five-signal `is_final_phase`: numerically last (yes); title is the terminal-phase heuristic (yes); prior phases complete (no: Phase 4 open); plan metadata wants a release handoff (yes); one plan under the version (yes). **Conflict -> false.** Operator asked `/implement phase 7` after committing Phase 6 (`8ac11ee`).

Model routing: plan Strong / high. Cursor is picker-only. This session stayed on Grok 4.6 (same-or-stronger). Visible degrade: none.

platform-contract-verification: not a distribution catalog (no `docs/policy/platform-read-contracts.md`), skipped.
model-prompting-research: no bundled profile freshness checker in this repo, skipped.
Cross-installer parity: one PyQt installer, silent no-op.

## 1. Starting State

- **Branch**: `develop` (ahead of origin; Phase 6 committed as `8ac11ee`)
- **Environment**: Windows 10, root Vitest + desktop shell tests
- **Plan reference**: [v1.18.0-adoption-agent-harness-and-governance.md](../../plans/v1.18.0-adoption-agent-harness-and-governance.md)
- **Prior session**: [2026-08-17_phase-6-os-process-sandbox.md](2026-08-17_phase-6-os-process-sandbox.md)

## 2. Chronological Steps

### 2.1 Architecture refactor (7.1)

**Plan specification**: Empty/duplicate/orphan/overcomplicated structure across Phases 1-6; propose-then-apply; confirm `docs/v1/v1.18/` is complete.

**What happened**: Detectors clean on v1.18-touched trees (`modules/coding/sandbox`, `desktop/sidecar/src/controlSurface`, `desktop/sidecar/src/acp`, harness/catalog paths). No empty directories. `ServingGateway` no longer owns `createServer` (Phase 5 extraction is the canonical listener). No duplicated loopback helper. Phase 4 scaffolding does not exist (ask inbox never landed). No file moves. `check:docs-layout` and `check:naming` clean. `check-architecture` 0 errors (10 pre-existing warnings).

**docs/v1/v1.18/**: plan, three comparisons, known-gaps, docs-cleanup-report, session histories for phases 1, 2, 3, 5, 6, 7. No Phase 4 history (phase not implemented).

### 2.2 Known-gaps reconciliation (7.2)

**Plan specification**: Ingest v1.17, record v1.12 EM status, gated LG/OI items, harness default, degraded OS modes, shared-transport contract. Finalize the file.

**What happened**: v1.17 and v1.16 items stay in their files (pointer + Phase 7 reconciliation block). Recorded DF-12 LG-A1, DF-13 LG-A4, DF-14 OI-A4-native, DF-15 `HARNESS_SELECTOR_SHIPPED_DEFAULT` still false. EM.P1.A / EM.P5.A already resolved; EM.P1.C is DF-5; EM.P3/EM.P4 stay closed. Shared transport recorded as resolved (OI-A3). Windows partial remains DF-11. `# DEVIATION:` file Status stays in-progress; not finalized because Phase 4 is open (same posture as v1.17 Phase 6 until `/update release`).

### 2.3 CI/CD (7.3)

**Plan specification**: Cover harness, catalog, ask inbox, ACP, three-OS sandbox; optimize path filters / concurrency / npm cache / gate expensive OS jobs.

**What happened**: Harness/catalog already on `ci.yml` `test-ts`. ACP already on `shell-build.yml` (`desktop/**`). Ask inbox not landed (no CI). Extracted the three-OS sandbox job from `ci.yml` into [`.github/workflows/sandbox.yml`](../../../../../.github/workflows/sandbox.yml) with path filters so unrelated pushes do not pay macOS/Windows `npm ci`. PRs still run those tests on ubuntu via `test-ts`. Concurrency cancel-in-progress + npm cache retained. Actions freeze ended 2026-08-01; does not apply.

### 2.4 Testing and stabilization (7.4)

**Plan specification**: `npm test` + lint + `test:shell` + `lint:shell`; update todos; session history.

**What happened**: See section 3.

## 3. Verification Gate

| Check | Result |
|---|---|
| `npx vitest run --coverage` | PASS - 454 files passed / 3 skipped; 4909 passed / 11 skipped / 0 failed |
| Line coverage | PASS - 87.73% lines / 84.17% branches / 91.39% functions (thresholds 80 / 75 / 80) |
| `npm run lint` | PASS |
| `npx tsc -b` | PASS |
| `npm run check-architecture` | PASS - 0 errors (10 pre-existing warnings) |
| `npm run check:docs-layout` | PASS |
| `npm run check:naming` | PASS |
| Desktop lint / typecheck / tests | PASS - lint + `tsc --noEmit`; 110 files / 956 passed / 0 failed |
| Quality gate bypass | None |

**Verdict: GO for close-out. HOLD on `/update release` (Phase 4).**

## 4. Known Issues

| Issue | Severity | Decision |
|---|---|---|
| Phase 4 ask inbox + scheduler not built | P1 | DF-9; `/implement phase 4` before release |
| Windows FS/network unenforced | P1 | DF-11 |
| Gated LG-A1 / LG-A4 / OI-A4-native | P2 | DF-12..14 |
| Harness default remains off | P2 | DF-15 / EM.P1.B |

## 5. Plan Discrepancies

| Marker | What | Why |
|---|---|---|
| is_final_phase false | No `/update release` | Phase 4 unchecked |
| known-gaps not finalized | Status stays in-progress | Same as v1.17 until version bump |
| Ready-to-release checklist | Left unchecked | DF-9 hold |

## 6. Assumptions Made

- Moving the sandbox matrix to a path-filtered workflow is equivalent coverage with fewer minutes on unrelated pushes.
- v1.17 motion DFs are not copied into v1.18; the next `/plan` still ingests both files.

## 7. Testing Summary

Root suite and desktop suite numbers are in section 3 after the post-phase re-run.

## 8. TODO Tracker

| Item | Status |
|---|---|
| 7.1 architecture refactor | Done (no moves) |
| 7.2 known-gaps | Done (not finalized) |
| 7.3 CI/CD | Done (`sandbox.yml`) |
| 7.4 tests + docs | Done |
| Phase 4 ask inbox | Still open |
| `/update release` | Not this phase |

## 9. Summary and Next Steps

Phase 7 closed the landed work (harness, catalog, ACP, sandbox) without cutting the version. Next: `/implement phase 4`, then `/update release` when Phase 4 is done (or operator explicitly skips Phase 4 and accepts DF-9 in the release).
