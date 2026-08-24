# Session History - v2.1.0 Phase 7: Architecture Refactor, Known-Gaps, CI/CD

**Date**: 2026-08-20
**Version**: v2.1.0
**Plan**: [../../plans/v2.1.0-adoption-open-local-ai-wave.md](../../plans/v2.1.0-adoption-open-local-ai-wave.md)
**Phase**: 7 of 7 - Architecture Refactor, Known-Gaps Reconciliation, and CI/CD
**Outcome**: Complete. Layout already canonical. v2.1 gaps reconciled (A13/A14 recorded, DiffusionGemma flip conditions kept). CI comments point at existing jobs; no silent workflow rewrite. Version bump, tag, and GitHub Release wait for `/update release`.

## Goal

Clean layout, reconciled v2.1 known-gaps, CI that covers the plan and stays optimized.

## Pre-flight

`is_final_phase` = **true** (numerically last, title matches the v3.11.0 gate, Phases 1-6 have session history). Model routing: plan recommended frontier / max. Cursor cannot script a switch; this session stayed on Cursor Grok 4.6 (same-or-stronger). Visible degrade: map refresh not re-run. The user pre-authorized commit and push after Phase 7, then a cross-version known-gaps sweep, then `/update release`. Version remains 2.0.0 until that release flow.

## 1. Starting State

- **Branch**: `develop`
- **Starting commit**: `33f32b3` (Phase 6 hardening)
- **Package version**: 2.0.0

## 2. Chronological Steps

### 2.1 Architecture refactor (7.1)

`npm run check:docs-layout` reports canonical two-level layout (no `docs/versions` wrappers). Empty dirs `modules/coding/skills/catalog/__none__` and `__nonexistent_user__` are SkillLoader test placeholders (same as v1.19 / v2.0); not pruned. No Cat 1 deletes, no archive moves, no core/module boundary moves. Dual catalog JSON stays.

### 2.2 Known-gaps reconciliation (7.2)

Hardware and host-boundary items stay deferred (DF-1, DF-2, DF-4 through DF-22). DiffusionGemma (DF-1) already lists both flip conditions. Recorded comparison backlog: DF-23 A13 minimal mask canvas, DF-24 A14 frame-anchored Video Lab comments. File status stays `in-progress` until `/update release` bumps the version.

### 2.3 CI/CD (7.3)

Existing jobs already cover new code: `test-ts` + coverage, desktop vitest on Node 22, `test-python-runtimes`. Optimizations kept: concurrency cancel-in-progress, npm/pip cache, Node 22-only desktop vitest, path-filtered installer/sandbox/shell-build, live Unsloth `workflow_dispatch` only. Applied: comments on `ci.yml` pointing at `docs/v2/v2.1/ci-hardware-gates.md` and Phase 6 surfaces. No new matrix OS, no GPU in CI.

### 2.4 Tests (7.4)

Added `tests/unit/docs/v2.1-phase-7-ci-gates.test.ts` so the hardware-gates doc keeps the live-train and streaming flags. Root layout check green.

## 3. Verification Gate

| Check | Result |
|---|---|
| `check:docs-layout` | PASS |
| Empty-dir audit | 2 SkillLoader placeholders retained |
| `ci.yml` comments | updated, no job rewrite |
| Package version | 2.0.0 (release flow owns the bump) |

## 4. Deviations

- No high-risk file moves (layout already matched the scheme).
- Known-gaps not finalized here; `/update release` owns the version bump.

## 5. Known gaps appended

DF-23, DF-24. Open DF count 23; DF-3 remains resolved.

## 6. Next

Commit and push this phase. Then address remaining open known-gaps across versions. Then `/update release` (tag and GitHub Release still confirm).
