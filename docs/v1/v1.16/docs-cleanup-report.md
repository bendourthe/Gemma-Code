# Docs Cleanup Report -- Nexus-AI -- 2026-08-16

**Active version:** v1.16.0
**Mode:** audit
**Scope:** `docs/v1/v1.16/` (this phase's version directory; no files moved)

Inventory via `docs-layout-refactor` `audit-docs.py inventory --root docs/v1/v1.16`. Nine Markdown files, all younger than 6 days, all in the in-flight minor. No Cat 1 or Cat 2 actions. Scratch docs this phase created (the MLX how-to and the macOS smoke checklist) stay in place.

## Summary

| Category | Count |
|---|---|
| Cat 1 (delete) | 0 |
| Cat 2 (archive) | 0 |
| Cat 3 (stale-flag) | 0 |
| Cat 4 (active) | 9 |
| **Total** | **9** |

## Dispositions

| Path | Category | Heuristics | Destination | Notes |
|---|---|---|---|---|
| docs/v1/v1.16/plans/v1.16.0-adoption-local-serving-and-ocr.md | Cat 4 | 3, 4 | (keep) | In-flight plan; Phase 5 of 6 |
| docs/v1/v1.16/comparisons/v1.16.0-comparison-local-serving-and-ocr.md | Cat 4 | 3, 4 | (keep) | Source comparison for the plan |
| docs/v1/v1.16/known-gaps.md | Cat 4 | 3, 4 | (keep) | Append-only tracker; Status in-progress |
| docs/v1/v1.16/guides/mlx-via-local-adapters.md | Cat 4 | 2, 4 | (keep) | New in Phase 5.1; inbound refs from README, install.md, ADR-0019 |
| docs/v1/v1.16/testing/macos-mlx-smoke.md | Cat 4 | 4 | (keep) | New in Phase 5.1; blank checklist until hardware run (LSO.P5.A) |
| docs/v1/v1.16/development/history/2026-08-12_phase-1-local-serving-gateway.md | Cat 4 | 4 | (keep) | Phase 1 session history |
| docs/v1/v1.16/development/history/2026-08-12_phase-2-per-model-analytics.md | Cat 4 | 4 | (keep) | Phase 2 session history |
| docs/v1/v1.16/development/history/2026-08-13_phase-3-document-ocr.md | Cat 4 | 4 | (keep) | Phase 3 session history |
| docs/v1/v1.16/development/history/2026-08-14_phase-4-document-parse-tool.md | Cat 4 | 4 | (keep) | Phase 4 session history |

The Phase 5 session history (`development/history/2026-08-16_phase-5-mlx-docs-and-model-library-ux.md`) and the Phase 6 session history (`development/history/2026-08-16_phase-6-refactor-known-gaps-cicd.md`) are Cat 4 for the same reasons.

## Cat 3 refresh queue

None in this version directory. `docs/DEVLOG.md` remains at the docs root (cross-cutting, never archived) and received a Phase 5 prepend; a by-version split is still a later hygiene follow-up, not this phase.

## Target tree preview

No moves. The active tree after this phase:

```
docs/v1/v1.16/
├── known-gaps.md
├── docs-cleanup-report.md
├── comparisons/
│   └── v1.16.0-comparison-local-serving-and-ocr.md
├── development/history/
│   ├── 2026-08-12_phase-1-local-serving-gateway.md
│   ├── 2026-08-12_phase-2-per-model-analytics.md
│   ├── 2026-08-13_phase-3-document-ocr.md
│   ├── 2026-08-14_phase-4-document-parse-tool.md
│   ├── 2026-08-16_phase-5-mlx-docs-and-model-library-ux.md
│   └── 2026-08-16_phase-6-refactor-known-gaps-cicd.md
├── guides/
│   └── mlx-via-local-adapters.md
├── plans/
│   └── v1.16.0-adoption-local-serving-and-ocr.md
└── testing/
    └── macos-mlx-smoke.md
```

## Self-classification

This report classifies itself as Cat 4 (transient/active). A future run will promote it to Cat 2 once v1.16 is no longer the active minor.
