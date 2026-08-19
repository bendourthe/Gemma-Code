# Docs Cleanup Report - Nexus AI Studio - 2026-08-18

**Active version:** v1.19.0
**Mode:** audit
**Scope:** `docs/v1/v1.19/` (implement-phase 8.5 + Phase 4 9.0; no files moved)

Propose-then-apply: nothing to move. Dual catalogs (`catalog.json` vs `models.json`) stay. LFM fixtures already live under `tests/unit/orchestration/fixtures/`. Empty dirs `modules/coding/skills/catalog/__none__` and `__nonexistent_user__` are test placeholders (keep).

## Summary

| Category | Count |
|---|---|
| Cat 1 (delete) | 0 |
| Cat 2 (archive) | 0 |
| Cat 3 (stale-flag) | 0 |
| Cat 4 (active) | 11 |
| **Total** | **11** |

## Dispositions

| Path | Category | Heuristics | Destination | Notes |
|---|---|---|---|---|
| docs/v1/v1.19/plans/v1.19.0-adoption-liquid-lfm-agentic.md | Cat 4 | active version | (keep) | Cycle plan; Phases 1-4 exit checklists ticked |
| docs/v1/v1.19/plans/v1.19.1-adoption-agent-loop-and-guardrail-hardening.md | Cat 4 | active version | (keep) | Sibling subplan |
| docs/v1/v1.19/plans/v1.19.2-adoption-catalog-and-model-expansion.md | Cat 4 | active version | (keep) | Sibling subplan |
| docs/v1/v1.19/comparisons/v1.19.0-comparison-liquid-lfm-agentic.md | Cat 4 | active version | (keep) | Seed comparison |
| docs/v1/v1.19/known-gaps.md | Cat 4 | active version | (keep) | 8 open DF after Phase 4; in-progress for sibling subplans |
| docs/v1/v1.19/docs-cleanup-report.md | Cat 4 | self | (keep) | This report |
| docs/v1/v1.19/development/history/2026-08-18_phase-1-catalog-entry-and-license-label.md | Cat 4 | active version | (keep) | Phase 1 session history |
| docs/v1/v1.19/development/history/2026-08-18_phase-2-lfm-harness-profile.md | Cat 4 | active version | (keep) | Phase 2 session history |
| docs/v1/v1.19/development/history/2026-08-18_phase-3-8b-a1b-bake-off.md | Cat 4 | active version | (keep) | Phase 3 session history |
| docs/v1/v1.19/development/history/2026-08-18_phase-4-refactor-known-gaps-cicd.md | Cat 4 | active version | (keep) | Phase 4 session history |
| docs/v1/v1.19/development/2026-08-18_lfm25-8b-a1b-bake-off.md | Cat 4 | active version | (keep) | Phase 3 bake-off record (DECLINE) |

## Cat 3 refresh queue

None in `docs/v1/v1.19/`.

## Target tree preview

No moves proposed. Canonical `docs/v1/v1.19/` already has `plans/`, `comparisons/`, `development/history/`, `known-gaps.md`.
