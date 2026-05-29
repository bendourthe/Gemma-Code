# Phase 4.4 -- Memory-Tier Storage Benchmark Results (2026-05-26)

## Stability gate

The Phase 4 plan declares:

> On a 100k-chunk benchmark workload, `PrunedDenseIndex` consumes at most
> 20% of the on-disk bytes that `DenseIndex` consumes, with recall@10 within
> 5 percentage points.

This benchmark is the **scaled-down CI variant** of that gate. It runs in
the integration test suite (`tests/integration/memory-tier/storage-benchmark.test.ts`)
on a 2,000-chunk fixture using the deterministic `hash-fallback` embedder so
it completes in under 2 seconds. The full 100k-chunk run with the real
transformer embedder is documented as a manual sweep and tracked in
`docs/versions/v1/v1.2.0/known-gaps.md` (MT entry).

## Results

See `results.json` for the machine-readable artifact. Highlights:

| Metric                | Standard tier | Pruned tier | Ratio  |
|-----------------------|---------------|-------------|--------|
| On-disk bytes (~)     | ~3.0 MB       | ~0.6 MB     | 18.7%  |
| Ingest time           | ~25 ms        | ~0 ms       | --     |
| Compact (graph build) | n/a           | ~1.6 s      | --     |
| Recall vs Standard    | 100%          | 100%        | --     |

**Both stability gates satisfied** at the 2k-chunk scale:

* Storage ratio 18.68% (cap: 20%) -- the pruned index drops the per-node
  384-dim embedding bytes, saving 1,536 bytes per node before counting
  text overhead.
* Recall vs Standard: 100% (floor for CI: 80%; plan headline at 100k: 95%).

## Reproducing the full 100k benchmark

```bash
NEXUS_PHASE4_BENCH_SIZE=100000 npx vitest run \
  tests/integration/memory-tier/storage-benchmark.test.ts \
  --config configs/vitest.config.ts
```

This run takes several minutes and consumes a few hundred MB of disk in
`os.tmpdir()`. The benchmark loop is the same; only the corpus size scales.
The 100k variant is the canonical artifact for the Phase 7 documentation
refresh.

## Embedder choice

The CI variant runs `hash-fallback` because:

1. CI must not pull the 90 MB MiniLM weight binaries.
2. The hash sketch is deterministic, so recall comparisons across runs are
   apples-to-apples.

The 100k variant uses the real embedder so the recall comparison reflects
semantic similarity, not token-bucket collisions. Both tiers see the same
embedder; only the storage path differs.
