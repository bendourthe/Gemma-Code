# Docs Archive

Historical documentation tied to prior **major** versions, kept for traceability.
Everything under `archive/` is **read-only and reversible**: do not edit in place.

Once a major-version line is no longer active, its version trees move here under
the canonical scheme `archive/v<MAJOR>/v<MAJOR>.<MINOR>/` (patch releases share
their minor dir). Active major-version docs live under
[`../v<MAJOR>/v<MAJOR>.<MINOR>/`](../v1/).

> **v1.10.0 Phase 8 canonicalization (2026-07-11).** The archive was migrated
> from the legacy three-level `archive/versions/v<MAJOR>/v<SEMVER>/` wrapper to
> the canonical `archive/v<MAJOR>/v<MAJOR>.<MINOR>/` layout (dropping the
> `versions/` wrapper and collapsing the redundant patch segment, since every v0
> line shipped a single `.0` patch). See
> [`../v1/v1.10/docs-cleanup-report.md`](../v1/v1.10/docs-cleanup-report.md).

## Layout

```
docs/archive/
  v0/                         pre-Nexus "Gemma Code" era (v0.1 - v0.9)
    v0.1/
    v0.2/
    ...
    v0.9/
```

The v0 line shipped as a single-purpose local agentic coding VS Code extension
("Gemma Code") between April 2026 and the v1.0.0 four-pillar pivot. Historical
context for that era -- architecture, plans, known-gaps, release notes,
benchmarks -- is preserved verbatim under `v0/`. References to these files from
the active codebase have been rewritten to point here; new work should not
acquire fresh dependencies on archived docs.

## Resurfacing an archived file

1. Move it back to its source location (or its modern equivalent).
2. Re-run the docs-layout audit and confirm the new classification.
