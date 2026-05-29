# Docs Archive

This directory holds documentation tied to prior **major** versions of the project.
Once a major-version line is no longer active, its `docs/v<MAJOR>.<MINOR>.<PATCH>/`
trees are moved here under `archive/versions/v<MAJOR>/v<SEMVER>/`.

Active major-version docs live under [`../versions/v<MAJOR>/v<SEMVER>/`](../versions/).

## Layout

```
docs/archive/versions/
  v0/                         pre-Nexus "Gemma Code" era (v0.1.0 - v0.9.0)
    v0.1.0/
    v0.2.0/
    ...
    v0.9.0/
```

The v0 line shipped as a single-purpose local agentic coding VS Code extension
("Gemma Code") between April 2026 and the v1.0.0 four-pillar pivot. Historical
context for that era -- architecture, plans, known-gaps, release notes,
benchmarks -- is preserved verbatim under `v0/`. References to these files from
the active codebase have been rewritten to point here; new work should not
acquire fresh dependencies on archived docs.
