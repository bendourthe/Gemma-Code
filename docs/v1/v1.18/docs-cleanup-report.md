# Docs Cleanup Report - Nexus AI Studio - 2026-08-17

**Active version:** v1.18.0
**Mode:** audit
**Scope:** `docs/v1/v1.18/` plus Phase 5 edits under `ARCHITECTURE.md`, `README.md`, `docs/install.md`, `docs/todos.md`, and `docs/DEVLOG.md` (implement-phase 8.5; no files moved)

This phase created no scratch docs. No files were moved or deleted. The shared-layer contract lives in-module (`desktop/sidecar/src/controlSurface/contract.ts`), not as a separate docs file. Session history is a new Cat 4 file under the version directory.

## Summary

| Category | Count |
|---|---|
| Cat 1 (delete) | 0 |
| Cat 2 (archive) | 0 |
| Cat 3 (stale-flag) | 0 |
| Cat 4 (active) | 13 |
| **Total** | **13** |

## Dispositions

| Path | Category | Heuristics | Destination | Notes |
|---|---|---|---|---|
| docs/v1/v1.18/plans/v1.18.0-adoption-agent-harness-and-governance.md | Cat 4 | active version | (keep) | Cycle plan; Phase 5 exit checklist ticked; Phase 4 still open |
| docs/v1/v1.18/comparisons/v1.18.0-comparison-openworker.md | Cat 4 | active version | (keep) | Seed comparison |
| docs/v1/v1.18/comparisons/v1.18.1-comparison-openinterpreter.md | Cat 4 | active version | (keep) | Seed comparison |
| docs/v1/v1.18/comparisons/v1.18.2-comparison-laguna-s-2-1.md | Cat 4 | active version | (keep) | Seed comparison |
| docs/v1/v1.18/known-gaps.md | Cat 4 | active version | (keep) | Appended Phase 5 DF-9..10 |
| docs/v1/v1.18/docs-cleanup-report.md | Cat 4 | self | (keep) | This report (rewritten per phase) |
| docs/v1/v1.18/development/history/2026-08-16_phase-1-skill-native-and-llamacpp-recipe.md | Cat 4 | active version | (keep) | Phase 1 session history |
| docs/v1/v1.18/development/history/2026-08-17_phase-2-live-harness-activation.md | Cat 4 | active version | (keep) | Phase 2 session history |
| docs/v1/v1.18/development/history/2026-08-17_phase-3-catalog-registry-governance.md | Cat 4 | active version | (keep) | Phase 3 session history |
| docs/v1/v1.18/development/history/2026-08-17_phase-5-acp-agent-surface.md | Cat 4 | active version | (keep) | Phase 5 session history |
| docs/reference/skill-native-adoptions-v1.18.md | Cat 4 | version-agnostic recipe | (keep) | Phase 1 |
| docs/reference/llamacpp-loopback-adapter.md | Cat 4 | version-agnostic recipe | (keep) | Phase 1 |
| docs/reference/low-cost-model-optimization.md | Cat 4 | version-agnostic guidance | (keep) | Phase 2 named profiles; Phase 3 MoE note |

## Cat 3 refresh queue

None in `docs/v1/v1.18/`. Full-tree archive of prior minors is out of this cycle.

## Target tree preview

No moves proposed. Default is leave as-is. The control-surface reuse contract is documented in `desktop/sidecar/src/controlSurface/contract.ts` plus `ARCHITECTURE.md` (ACP agent surface). Do not add a parallel markdown copy.
