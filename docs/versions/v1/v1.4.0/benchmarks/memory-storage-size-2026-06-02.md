# Memory-tier storage benchmark, 100k chunks (v1.4.0 Phase 8, gap 4.4.P2.L)

**Date**: 2026-06-02
**Cycle**: v1.4.0 Phase 8 (T030)
**Gap closed**: `4.4.P2.L` (MT, P2) -- the headline 100k-chunk memory-tier sweep deferred from v1.2.0 Phase 4.4.
**Harness**: `tests/integration/memory-tier/storage-benchmark.test.ts` (the same `runBenchmark` logic, run once at `NEXUS_PHASE4_BENCH_SIZE=100000` outside the 60s CI gate; the per-run CI smoke stays at 2k).

## Why this run was unblocked

The v1.2.0 Phase 4.4 benchmark could only run at 2k chunks in CI because `PrunedDenseIndex.compact()` built its kNN graph with an all-pairs O(N^2) scan, which is impractical at 100k. v1.4.0 Phase 7 (T023, gap `4.2.P3.K`) replaced that with a true multi-layer HNSW build (`hnswlib-node`), so the 100k sweep is now feasible. This run confirms the HNSW path is the one exercised at scale.

## Results

| Metric | Standard (`DenseIndex`) | Pruned (`PrunedDenseIndex`) |
|---|---|---|
| Corpus size | 100,000 chunks | 100,000 chunks |
| On-disk size | 154,588,902 bytes (~147.4 MB) | 32,905,976 bytes (~31.4 MB) |
| Ingest time | 396 ms | 14 ms (text only) |
| Compact (graph build) | n/a | 60,803 ms (~60.8 s) |
| Graph build method | n/a | `hnsw` (`lastBuildMethod`) |

- **Storage ratio**: 0.2129 (the pruned index is 21.29% of the standard index on disk).
- **Recall@10 vs Standard**: 0.965 (96.5%).
- **Embedder**: `hash-fallback` (the deterministic 384-dim sketch). The real `@huggingface/transformers` MiniLM embedder requires the downloaded ONNX weights, which are not present in this run; the hash fallback is what CI exercises. Storage size and graph-build scaling are embedder-independent (both tiers store 384-dim rows), and recall is measured tier-vs-tier under the same embedder, so it is a fair relative comparison. With real embeddings the absolute recall and on-disk text size shift, but the HNSW-vs-all-pairs scaling result holds.

## Interpretation

- **Scaling (the gap's headline)**: `compact()` completed at 100k via the HNSW build in ~61 s (`lastBuildMethod: hnsw`). The pre-T023 all-pairs build is O(N^2) and would not complete in a practical window at this size; the ~61 s here is why the 100k run exceeds the benchmark test's 60 s CI gate (the CI smoke stays at 2k by design). The ~50k practical ceiling flagged in `4.2.P3.K` is cleared.
- **Recall**: 96.5% at 100k, comfortably above the 80% smoke gate and above the 95% tightened target the 100k corpus was expected to reach as the graph approximation converges.
- **Storage ratio**: 21.29% at 100k for this synthetic corpus. The pruned tier stores chunk text plus the HNSW topology rather than the dense float vectors; the ratio is dominated by the text-vs-vector size trade-off and the `outDegree: 32` graph. It is slightly above the 20% smoke-gate constant (the gate is asserted on the 2k corpus); the 100k value is recorded here as the at-scale reference, not a regression.

## Reproduce

```bash
NEXUS_PHASE4_BENCH_SIZE=100000 npx vitest run --config configs/vitest.config.ts \
  tests/integration/memory-tier/storage-benchmark.test.ts
```

The run writes a machine-readable summary to `tests/fixtures/memory-tier-benchmark-results/2026-05-26/results.json` and will report the 60 s timeout in CI (expected at 100k); the numbers above were captured from a long-timeout run of the same logic.

---

## Token-usage benchmark (gap `7.1.P2.A`, CLOSED deterministic-synthesis-canonical)

`7.1.P2.A` proposed optionally upgrading the token-usage benchmark to a live worktree-vs-HEAD replay. We close it by declaring the existing **deterministic synthesis canonical**: the token-usage benchmark builds a fixed-seed synthetic transcript and measures token deltas reproducibly, with no dependency on a live model, network, or working-tree state. A live worktree-vs-HEAD replay would introduce nondeterminism (model sampling, environment drift) into a gate whose value is precisely its reproducibility across machines and CI runs. The deterministic synthesis is the supported benchmark; the live-replay variant is intentionally not adopted. Reopen as a fresh cycle item if a live regression-detection harness is ever wanted alongside (not replacing) the deterministic gate.
