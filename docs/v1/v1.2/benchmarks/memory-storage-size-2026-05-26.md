# Phase 7.2 -- Memory Storage-Size Benchmark, Extended Scope (2026-05-26)

**Plan reference**: [adoption-ecosystem-2026-05.md sub-task 7.2](../plans/adoption-ecosystem-2026-05.md)
**Status**: published
**Captured at**: 2026-05-28
**CI gate**: [tests/integration/memory-tier/phase-7-storage-size-extended.test.ts](../../../../tests/integration/memory-tier/phase-7-storage-size-extended.test.ts)
**Phase 4 sibling**: [tests/integration/memory-tier/storage-benchmark.test.ts](../../../../tests/integration/memory-tier/storage-benchmark.test.ts) (dense-only)
**Raw fixtures**: [tests/fixtures/memory-storage-extended-results/2026-05-26/](../../../../tests/fixtures/memory-storage-extended-results/2026-05-26)

## Scope extension vs Phase 4.4

Phase 4.4 measured `PrunedDenseIndex` vs `DenseIndex` in isolation and
published its results at [tests/fixtures/memory-tier-benchmark-results/2026-05-26/](../../../../tests/fixtures/memory-tier-benchmark-results/2026-05-26).
Phase 7.2 extends the scope per the plan to include:

* `~/.nexus/memory/dense/` (Standard and Pruned arms)
* `~/.nexus/memory/bm25/` (serialized footprint -- the in-memory index has no on-disk file today)
* `~/.nexus/codegraph/<repo-fingerprint>.db` (built by scanning [tests/fixtures/codegraph-benchmark-repo/](../../../../tests/fixtures/codegraph-benchmark-repo))

Both arms see the same BM25 + codegraph footprints; only the dense tier
differs.

## Results (2k-chunk CI smoke)

| Subsystem            | Standard arm | Pruned arm | Delta (Pruned vs Standard) |
|----------------------|--------------|------------|-----------------------------|
| Dense index          | 3,088,902 B  | 576,954 B  | -81.32%                     |
| BM25 (serialized)    | 51 B         | 51 B       | 0%                          |
| Codegraph (SQLite)   | 73,728 B     | 73,728 B   | 0%                          |
| **Total**            | **3,162,681 B** | **650,733 B** | **-79.42%**            |

### Headline ratios

| Comparison                                | Ratio  | Status (gate)                     |
|-------------------------------------------|--------|-----------------------------------|
| Dense-only Pruned/Standard                | 18.68% | passed (gate <=20% from Phase 4.4) |
| Combined Pruned/Standard (all subsystems) | 20.58% | informational                     |

The dense-only number matches Phase 4.4 byte-for-byte
([results.json](../../../../tests/fixtures/memory-tier-benchmark-results/2026-05-26/results.json))
-- this benchmark uses the same fixed-seed corpus and the same
`hash-fallback` deterministic embedder so the numbers are stable
across runs.

The combined ratio (20.58%) is slightly above the dense-only ratio
because the constant BM25 + codegraph overhead shows up in both
numerator and denominator. The plan's headline gate is the dense-only
number; the combined ratio is published for the cycle-end
documentation refresh so the cost question has a single artifact to
cite.

## Stability gates (passed)

| Gate                          | Threshold | Achieved | Status |
|-------------------------------|-----------|----------|--------|
| Dense-only storage ratio      | <=20%     | 18.68%   | passed |
| Recall@10 vs Standard (Phase 4.4) | >=80% (CI) / >=95% (100k) | 100% (CI 2k) | passed |

Recall is owned by the Phase 4.4 sibling test; this benchmark trusts
the upstream measurement and does not re-run it. The two tests run
back-to-back in CI; if either gate slips, both will fail.

## Reproducing

```bash
npx vitest run --config configs/vitest.config.ts \
  tests/integration/memory-tier/phase-7-storage-size-extended.test.ts
```

The CI variant (corpus size 2,000) completes in ~2 seconds. The
canonical 100k sweep is gated behind `NEXUS_PHASE7_BENCH_SIZE=100000`
(or `NEXUS_PHASE4_BENCH_SIZE=100000` for the Phase 4.4 variant) and
takes several minutes plus a few hundred MB of `tmpdir` disk. See
[tests/fixtures/memory-tier-benchmark-results/2026-05-26/README.md](../../../../tests/fixtures/memory-tier-benchmark-results/2026-05-26/README.md)
for the manual-replay protocol.

## What changed since Phase 4.4

* New artifact at [docs/versions/v1/v1.2.0/benchmarks/memory-storage-size-2026-05-26.md](memory-storage-size-2026-05-26.md) (this file)
* New CI test at [tests/integration/memory-tier/phase-7-storage-size-extended.test.ts](../../../../tests/integration/memory-tier/phase-7-storage-size-extended.test.ts)
* New raw fixture at [tests/fixtures/memory-storage-extended-results/2026-05-26/summary.json](../../../../tests/fixtures/memory-storage-extended-results/2026-05-26/summary.json)

The Phase 4.4 dense-only artifact remains the canonical reference for
the headline gate; this Phase 7.2 artifact is the cycle-end combined
view.

## Cross-reference

* Phase 4 dense-only gate: [memory-tier-benchmark-results/2026-05-26/](../../../../tests/fixtures/memory-tier-benchmark-results/2026-05-26)
* Phase 7 token-usage report: [coding-pillar-token-usage-2026-05-26.md](coding-pillar-token-usage-2026-05-26.md)
