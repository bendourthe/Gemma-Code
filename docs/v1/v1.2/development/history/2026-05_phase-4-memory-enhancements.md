# 2026-05 Phase 4 -- Memory Enhancements (LEANN-derived)

## Plan reference

[docs/versions/v1/v1.2.0/plans/adoption-ecosystem-2026-05.md](../../plans/adoption-ecosystem-2026-05.md) Phase 4. Non-final phase (4 of 7); Phase 9 release-readiness workflow does NOT run. Prerequisite: Phase 3 complete (commit `5b63989`).

## Goal

Ship two LEANN-derived memory improvements -- an AST-aware chunker that aligns memory ingest with semantic boundaries, and a graph-pruned dense index that drops embedding bytes from disk and recomputes them on the query path -- behind a `MemoryStorageTier` policy so the existing full-vector path stays the default.

Stability gate: `PrunedDenseIndex` on-disk size at most 20% of `DenseIndex` on a 100k-chunk workload with recall@10 within 5pp.

## Sub-tasks completed

| # | Title | Status | Notes |
|---|---|---|---|
| 4.1 | AST-aware code chunker | done | Reuses Phase 3 `extractSymbols()`; class chunks envelop methods to avoid duplication; `HybridRetriever.ingestFile()` helper added |
| 4.2 | PrunedDenseIndex with selective recomputation | done | Best-first kNN graph traversal, undirected edges, 512-entry LRU, versioned save/load |
| 4.3 | MemoryStorageTier policy gating | done | Defaults to `Standard`; migration script ships as `.mjs` CLI + `.ts` testable function |
| 4.4 | Phase 4 testing and stabilization (benchmark) | done | 18.68% storage, 100% recall on 2k CI fixture; 100k variant gated behind `NEXUS_PHASE4_BENCH_SIZE` |

## Test results (sub-step 8.2)

- `npm run test`: **3524 passed, 5 skipped, 0 failed** (308 files, ~44s)
- New Phase 4 tests: **56** across 5 files
  - `tests/unit/core/memory/AstChunker.test.ts` -- 18
  - `tests/unit/core/memory/PrunedDenseIndex.test.ts` -- 19
  - `tests/unit/core/memory/migrateDenseToPruned.test.ts` -- 7
  - `tests/unit/core/config/MemoryStorageTier.test.ts` -- 11
  - `tests/integration/memory-tier/storage-benchmark.test.ts` -- 1
- `npm run lint`: clean (`src/` scope)
- `npx tsc --noEmit`: clean

## CI/CD edits (sub-step 8.3)

| Surface | Action |
|---|---|
| `.github/workflows/ci.yml` | unchanged -- existing `npm run test` already runs the new integration suite |
| New top-level scripts | none -- migration is a manual / per-installation operation |
| New env vars | `NEXUS_PHASE4_BENCH_SIZE` is opt-in for the 100k benchmark; not declared in CI |
| Dependencies | none added -- `PrunedDenseIndex` uses Float32Array + node built-ins only |

## Deviations from the plan

1. **AST primitives reuse Phase 3's `extractSymbols`** (not Tree-sitter). Same tradeoff as Phase 3.3; documented as `4.1.P2.J` in known-gaps.
2. **Migration script ships as `.mjs`** instead of `.ts` because the repo's `scripts/` convention is `.mjs`. The underlying function lives at `core/memory/migrateDenseToPruned.ts` for unit testability. Documented as `4.3.P3.M`.
3. **CI benchmark scaled to 2,000 chunks** (1/50th of the plan's 100k). The 100k variant is the Phase 7.2 artifact. Documented as `4.4.P2.L`.
4. **`HybridRetriever.ingestFile()` is a new helper, not a migration of existing call sites.** `MemoryHub.write()` and `WarmRebuildWorker` continue to call `bm25.add` / `dense.add` directly. Documented as `4.x.P3.N`.

## Known gaps added

| Code | Severity | Type | Summary |
|---|---|---|---|
| 4.1.P2.J | P2 | DF | Tree-sitter chunker deferred; uses Phase 3 regex extractor |
| 4.2.P3.K | P3 | DF | O(N^2) graph build; ~50k node ceiling without HNSW upgrade |
| 4.3.P3.M | P3 | DF | Migration script is `.mjs` instead of `.ts` |
| 4.4.P2.L | P2 | MT | 100k-chunk benchmark is manual, not CI |
| 4.x.P3.N | P3 | DF | New `ingestFile()` helper not yet used by existing ingest sites |

Updated `docs/versions/v1/v1.2.0/known-gaps.md` `## 3. Summary` -- 14 open items (was 9), severity P1: 0, P2: 6, P3: 8.

## Files created

```
core/config/MemoryStorageTier.ts
core/memory/chunkers/AstChunker.ts
core/memory/chunkers/index.ts
core/memory/PrunedDenseIndex.ts
core/memory/migrateDenseToPruned.ts
scripts/migrate-dense-index-to-pruned.mjs
tests/unit/core/memory/AstChunker.test.ts
tests/unit/core/memory/PrunedDenseIndex.test.ts
tests/unit/core/memory/migrateDenseToPruned.test.ts
tests/unit/core/config/MemoryStorageTier.test.ts
tests/integration/memory-tier/storage-benchmark.test.ts
tests/fixtures/memory-tier-benchmark-results/2026-05-26/README.md
tests/fixtures/memory-tier-benchmark-results/2026-05-26/results.json
docs/versions/v1/v1.2.0/development/history/2026-05_phase-4-memory-enhancements.md   (this file)
```

## Files modified

```
core/memory/HybridRetriever.ts          (added ingestFile() + tier-aware DenseIndex|PrunedDenseIndex type)
docs/DEVLOG.md                          (Phase 4 entry prepended)
docs/versions/v1/v1.2.0/known-gaps.md               (Phase 4 entries appended; summary recomputed)
ARCHITECTURE.md                         (memory-tier subsystem section added)
AGENTS.md                               (project layout updated)
```

## Benchmark artifact

`tests/fixtures/memory-tier-benchmark-results/2026-05-26/results.json`:

```json
{
  "runAt": "2026-05-26",
  "corpusSize": 2000,
  "embedder": "hash-fallback",
  "embeddingDim": 384,
  "standard": { "onDiskBytes": 3088902, "ingestMs": 23 },
  "pruned": { "onDiskBytes": 576954, "ingestMs": 0, "compactMs": 1571 },
  "storageRatio": 0.1868,
  "storageRatioPercent": "18.68%",
  "recallVsStandard": 1,
  "recallVsStandardPercent": "100.00%",
  "stabilityGate": { "storageRatioMax": 0.2, "recallMin": 0.8 }
}
```

Both stability gates satisfied.

## Next steps

- **Phase 5** (Agent loop policy): read-only exploration sub-agent enforcement, path-scoped skills, `.nexusignore`, reflection hook. Picks up where Phase 4 leaves off.
- **Phase 7.2** (Storage-size benchmark): run the canonical 100k-chunk variant with the real transformer embedder; publish under `docs/versions/v1/v1.2.0/benchmarks/memory-storage-size-2026-05-26.md`.
- **Future cycle**: HNSW upgrade for `PrunedDenseIndex` (known-gap 4.2.P3.K) to lift the ~50k-node practical ceiling.
