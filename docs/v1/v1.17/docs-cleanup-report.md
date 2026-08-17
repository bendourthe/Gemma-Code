# Docs Cleanup Report - Nexus AI Studio - 2026-08-16

**Active version:** v1.17.0 (in-flight; package.json still 1.16.0 until `/update release`)
**Mode:** audit
**Scope:** `docs/v1/v1.17/` (Phase 4 of implement-phase; `--keep-current-version` ON)

This phase created no scratch docs. No files were moved or deleted.

## Summary

| Category | Count |
|---|---|
| Cat 1 (delete) | 0 |
| Cat 2 (archive) | 0 |
| Cat 3 (stale-flag) | 0 |
| Cat 4 (active) | 8 |
| **Total** | **8** |

## Dispositions

| Path | Category | Heuristics | Destination | Notes |
|---|---|---|---|---|
| docs/v1/v1.17/plans/v1.17.0-adoption-ui-motion-identity.md | Cat 4 | active version | (keep) | Phase 4 exit checked |
| docs/v1/v1.17/comparisons/v1.17.0-comparison-ui-motion-identity-and-tokenizer.md | Cat 4 | active version | (keep) | Seed comparison |
| docs/v1/v1.17/known-gaps.md | Cat 4 | active version | (keep) | DF-1..DF-7 |
| docs/v1/v1.17/design-tokens.md | Cat 4 | active version | (keep) | Added Phase 4 metal section |
| docs/v1/v1.17/development/history/2026-08_phase-1-motion-foundation.md | Cat 4 | active version | (keep) | |
| docs/v1/v1.17/development/history/2026-08_phase-2-agent-state-orbs.md | Cat 4 | active version | (keep) | |
| docs/v1/v1.17/development/history/2026-08_phase-3-surface-liveness-beam.md | Cat 4 | active version | (keep) | |
| docs/v1/v1.17/development/history/2026-08_phase-4-hero-action-metal.md | Cat 4 | active version | (keep) | Created this phase |
| docs/v1/v1.17/docs-cleanup-report.md | Cat 4 | self | (keep) | This report |

## Cat 3 refresh queue

None in `docs/v1/v1.17/`. A full-tree audit is deferred to Phase 6 (Architecture Refactor).

## Target tree preview

```
docs/v1/v1.17/
├── comparisons/
│   └── v1.17.0-comparison-ui-motion-identity-and-tokenizer.md
├── design-tokens.md
├── development/history/
│   ├── 2026-08_phase-1-motion-foundation.md
│   ├── 2026-08_phase-2-agent-state-orbs.md
│   ├── 2026-08_phase-3-surface-liveness-beam.md
│   └── 2026-08_phase-4-hero-action-metal.md
├── docs-cleanup-report.md
├── known-gaps.md
└── plans/
    └── v1.17.0-adoption-ui-motion-identity.md
```

## Self-classification

This report classifies itself as Cat 4 (transient/active). A future run will promote it to Cat 2 once v1.17 is no longer active.
