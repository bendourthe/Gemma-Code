# ADR-0009: Delete PredictiveCache (wire-or-delete decision)

- **Status**: Accepted (2026-05-03)
- **Deciders**: Benjamin Dourthe (project owner) — closes pen-test F-008 + codebase-review #7 + known-gaps Section 4 as part of v0.6.0 Phase 5 sub-task 5.1

## Context

v0.5.0 Phase 12 introduced [src/storage/PredictiveCache.ts](../../src/storage/PredictiveCache.ts) — a pure-JS ARIMA(1,0,1) forecaster (~80 LOC core) that ranks recently-accessed paths by inverse predicted-arrival-delta and exposes a `predict(topK)` API. It was opt-in via `gemma-code.predictiveCacheEnabled`. The intent was a pre-warming layer for the tool-output cache.

The cycle review surfaced three converging facts that made the layer indefensible to keep:

1. **Hard constraint #1 of the v0.6.0 cycle is "no new product surface."** Wiring `PredictiveCache.predict()` into `ToolOutputCache.lookup()` would require either a 30-second debounced timer plus a pre-warm loop in `GemmaRuntime` or a dedicated `PredictiveCacheCoordinator` — new behavior, new opt-in surface, new telemetry to design.
2. **The setting is unwired today.** A workspace-wide `Grep` for `predictiveCacheEnabled` returned exactly zero hits outside the module's own docstring: no `getSettings()` consumer, no panel, no runtime, no agent loop touched it. The feature had no observable user impact because it had no consumer at all.
3. **The plan's wire-or-delete decision criterion was unverifiable.** The criterion was "wire if the bench shows >= 10% hit-rate uplift on the access-trace fixture." No hit-rate bench existed, and the access-trace fixture would itself have been new code. With (1) and (2) already closing the case, the additional measurement was unnecessary.

The plan offered Option A (wire it; build the consumer in `ToolOutputCache.lookup()` + a debounced pre-warm loop) and Option B (delete the layer outright). The codebase-review separately tracked the file as finding #7 (orphaned module that survived deletion review).

## Decision

Delete `PredictiveCache` and the `gemma-code.predictiveCacheEnabled` setting (Option B). Specifically:

- Remove [src/storage/PredictiveCache.ts](../../src/storage/PredictiveCache.ts), `tests/unit/storage/PredictiveCache.test.ts`, `tests/unit/storage/PredictiveCache.budget.test.ts`, and `tests/benchmarks/predictive-cache.bench.ts`.
- Remove the `gemma-code.predictiveCacheEnabled` block from [package.json](../../package.json) `contributes.configuration.properties`.
- Remove the `+--- Predictive layer ---+` ASCII block from [docs/archive/versions/v0/v0.5.0/architecture.md](../v0.5.0/architecture.md) Section 4 ("Cache stack"). The diagram now ends at `WebResponseCache`.
- Remove the four PredictiveCache benchmark entries plus the `"PredictiveCache throughput"` group header from [tests/benchmarks/baselines/v0.6.0.json](../../tests/benchmarks/baselines/v0.6.0.json) so `scripts/check-bench-regressions.mjs` no longer expects benches that do not exist.
- Record the removal in [CHANGELOG.md](../../CHANGELOG.md) `## [Unreleased]` `### Removed`.

If a future cycle decides predictive pre-warming is the right design, it starts from a fresh ADR rather than re-animating dead code.

## Consequences

**Positive**

- Closes pen-test F-008 (orphaned module surface), codebase-review #7 (dead code), and known-gaps Section 4 (documented-but-unwired layer) in one decision.
- Honors the "no new product surface" constraint: v0.6.0 ships with strictly fewer exported APIs and settings than v0.5.4.
- Removes a `no-orphans` warning from `dependency-cruiser` that had been carried as a baseline exception.
- Reduces the surface that future contributors have to reason about — one less "what does this layer do?" question on entry.

**Negative**

- The ARIMA prototype work is gone. Re-introducing predictive pre-warming in v0.7.0+ starts from scratch (or from this ADR's git history). The `Grep` for the deleted symbols + the file-level git history are the recovery path.
- A user who had `gemma-code.predictiveCacheEnabled = true` set in their workspace `settings.json` will see a one-time "unknown setting" warning on upgrade. Acceptable: the setting was opt-in and unwired, so the only effect is the warning.

**Neutral**

- The `Evictor` strategy surface (LRU/LFU/ARC/W-TinyLFU/Clock) introduced in v0.5.0 Phase 12 is **not** affected by this decision; that surface is wired and load-bearing. Only `PredictiveCache` is removed.

## Alternatives considered

- **Option A — wire it.** Rejected for the three reasons in the Context section: it would constitute new product surface, the consumer did not exist, and the decision criterion was unverifiable without additional new work.
- **Park the file with a `// TODO(v0.7.0)` marker.** Rejected: AGENTS.md rule forbids dormant TODOs in source. Either the layer is wired or it is gone.
- **Delete the wiring path but keep the module as a library.** Rejected: a library with no in-tree consumer is dead weight; the test files would have to stay green against an unused API.
- **Move PredictiveCache to a separate package.** Rejected: the project ships a single VSIX. A separate npm package is more infrastructure than the prototype value justifies.

## Links

- v0.5.0 Phase 12 introduction: [docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md](../v0.5.0/plans/implementation-plan.md) Phase 12, "Advanced Fallbacks"
- v0.6.0 Phase 5 plan entry: [docs/archive/versions/v0/v0.6.0/plans/v0.6.0-cycle.md](../v0.6.0/plans/v0.6.0-cycle.md) sub-task 5.1
- Phase 5 history: [docs/archive/versions/v0/v0.6.0/development/history/2026-05_phase-5-doc-code-drift.md](../v0.6.0/development/history/2026-05_phase-5-doc-code-drift.md) Section 2.1
- Pen-test finding: [docs/archive/versions/v0/v0.6.0/review/penetration-test.md](../v0.6.0/review/penetration-test.md) F-008
- Codebase-review finding: [docs/archive/versions/v0/v0.6.0/review/codebase-review.md](../v0.6.0/review/codebase-review.md) #7
- Known-gaps entry: [docs/archive/versions/v0/v0.6.0/review/known-gaps.md](../v0.6.0/review/known-gaps.md) Section 4
- Companion threshold-elevation decision: [ADR-0010](./0010-threshold-elevation-decision.md)
