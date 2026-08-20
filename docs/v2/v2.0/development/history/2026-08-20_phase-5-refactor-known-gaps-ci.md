# Session history -- v2.0.0 Phase 5 (refactor, known-gaps, CI)

**Date**: 2026-08-20
**Plan**: `docs/v2/v2.0/plans/v2.0.0-adoption-governed-autonomy-multimodal.md`
**Phase**: 5 -- Architecture refactor, known-gaps, CI/CD
**is_final_phase**: false

## Model-routing pre-flight

Plan recommended strong tier, high effort. Cursor cannot script a model switch. Continued on the current session model (visible degrade, no downshift).

## 5.1 Refactor

Propose-then-apply audit:

- `docs/v2/v2.0/` already has `plans/` and `comparisons/` plus Phase 1-4 histories and the browser security design. No Cat 1 deletes, no archive moves.
- Empty dirs `modules/coding/skills/catalog/__none__` and `__nonexistent_user__` are SkillLoader test placeholders (same as v1.19.0 Phase 4). Not pruned.
- Dual catalog JSON stays. No core/project move. No `runtimes/ocr` rename (v1.20 DF-6).

Applied: none of the high-risk moves. Layout is already the canonical two-level version tree.

## 5.2 Known-gaps

- v1.15-v1.18 remain canonical finalized files; indexed, not duplicated.
- v1.19 and v1.20 stay in-progress in their files; indexed.
- Named transfers: DF-13 Inkling GGUF multimodal, DF-14 Kimi K3 catalog wait.
- OpenWorker A2 scheduler recorded resolved (v1.18 `AgentRunScheduler`).
- Phase 4 DF-10-12 already present.

## 5.3 CI

- Documented hardware gates in `docs/v2/v2.0/ci-hardware-gates.md`.
- `ci.yml` comments plus `NEXUS_AUDIO_STUB=1` on pytest.
- Existing optimizations kept: concurrency cancel-in-progress, npm/pip cache, Node 22-only desktop vitest, path-filtered installer and sandbox workflows.

## Next

Phase 6 convergence evidence, then commit, push, and `/update release` (tag and GitHub Release still confirm).
