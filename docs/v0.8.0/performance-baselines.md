# v0.8.0 -- Performance Baselines

This document captures benchmark deltas for v0.8.0 sub-tasks that touch hot paths. Numbers are captured by the operator on a **quiescent dev workstation** (no concurrent CPU pressure, no thermal throttling) per the v0.7.0 / v0.6.0 procedure. The baseline JSON itself lives under [tests/benchmarks/baselines/](../../tests/benchmarks/baselines/).

## Phase 0.9 -- `marked` v12 renderer perf regression resolution

**Source**: Plan sub-task 0.9, closing v0.7.0 known-gap 10.O.19.

**Fix**: [src/utils/MarkdownRenderer.ts](../../src/utils/MarkdownRenderer.ts) was changed to cache a single configured `Marked` instance instead of using the `marked.parse()` shorthand. The shorthand allocates an internal Marked + configures it per call; the cached path avoids the per-call setup.

**Baseline reference (post-bump regression, captured in v0.7.0 hotfix)** -- from `docs/v0.7.0/known-gaps.md` Section 10.O.19:

| Bench | v0.4.0 baseline (hz) | v0.7.0 post-bump (hz) | Delta |
|---|---|---|---|
| render ~100-token message | 1284.85 | 504.17 | -60.8% |
| render ~500-token message | 463.72 | 238.39 | -48.6% |
| render ~2000-token message | 128.47 | 70.17 | -45.4% |

**Post-fix capture (v0.8.0 Phase 0.9)**: pending operator capture on a quiescent dev workstation. Run:

```bash
npm run bench -- --outputJson=tests/benchmarks/baselines/v0.8.0.json
```

The bench gate excludes that previously suppressed these three rows in [.github/workflows/nightly.yml](../../.github/workflows/nightly.yml) is removed. The next nightly run will report any residual regression against the v0.6.0 baseline at the 20% threshold; if the post-fix hz lands within 20% of v0.6.0, the gate passes unconditionally.

| Bench | Target band | Notes |
|---|---|---|
| render ~100-token message | >= 80% of v0.6.0 baseline | Caching restores hot-path setup cost |
| render ~500-token message | >= 80% of v0.6.0 baseline | Same |
| render ~2000-token message | >= 80% of v0.6.0 baseline | Same |

**Acceptance**: nightly bench gate runs green for two consecutive nights with the renderer benches included. If a residual gap remains, file a follow-up to evaluate the marked v15 ESM migration (separately deferred per ADR-0014 / known-gap 2.1).

## Phase 0.A -- HNSW persist/reload (no perf delta expected)

**Source**: Plan sub-task 0.8, closing v0.7.0 known-gap 10.O.18.

**Fix**: [src/storage/MemoryHnswIndex.ts](../../src/storage/MemoryHnswIndex.ts) `tryCreate` was changed to call `readIndexSync(path)` without the spurious `maxElements` second arg (the hnswlib-node v3 signature is `(filename, allowReplaceDeleted?: boolean)`). After read, `getMaxElements()` is queried to sync internal capacity tracking.

**Bench impact**: none expected. The HNSW path is exercised only when `hnswlib-node` loads (optional dependency); the loaded-vs-fallback branch is invariant under this fix. The pre-existing recall-delta and search-throughput benches (where they exist) should be unchanged.

## Cycle-level baseline carry-forward

Baseline files (committed):

- `tests/benchmarks/baselines/v0.4.0.json` -- long-arc floor
- `tests/benchmarks/baselines/v0.5.0.json`
- `tests/benchmarks/baselines/v0.6.0.json` -- nightly gate baseline
- `tests/benchmarks/baselines/v0.7.0.json` -- mid-cycle quiescent recapture pending (see v0.8.0 known-gaps 10.O.A)
- `tests/benchmarks/baselines/v0.8.0.json` -- cycle-close capture; created at Phase 7 release-gate run
