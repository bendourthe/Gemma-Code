# Session History -- v1.1.0 Phase 5

**Date**: 2026-05-19
**Phase**: Phase 5 -- Hybrid retrieval + local embedder
**Plan reference**: [docs/v1.1.0/plans/phase-05-hybrid-retrieval-and-local-embedder.md](../../plans/phase-05-hybrid-retrieval-and-local-embedder.md)
**Comparison source**: [docs/v1.1.0/comparison-agentmemory.md](../../comparison-agentmemory.md) Section 11.2 P1 (adoptions A1 + A2)
**Outcome**: Phase 5 landed in a single commit; all six sub-tasks closed; 90 new tests added; 3 new open items recorded.

---

## 1. Pre-implementation review

- Read the full Phase 5 plan plus the cycle-level v1.1.0 plan to understand how the phase fits into the agentmemory cluster (Phase 4 provides provenance + HookBus; Phase 5 builds the hybrid retrieval primitives; Phase 6 consumes them via the CLI + decay; Phase 7 consumes them via session replay).
- Inspected existing memory infrastructure: [core/memory/MemoryHub.ts](../../../../core/memory/MemoryHub.ts) (Phase 4 four-layer in-memory facade with substring retrieve), [core/lifecycle/HookBus.ts](../../../../core/lifecycle/HookBus.ts) (Phase 4 12-variant lifecycle bus), [src/storage/UnifiedMemoryRetriever.ts](../../../../src/storage/UnifiedMemoryRetriever.ts) (legacy 312-line SQLite-backed retriever with HNSW + FTS5 hybrid via `MemoryStore.retrieveHybrid`), [src/agents/IdleTimeScheduler.ts](../../../../src/agents/IdleTimeScheduler.ts) (Phase 6 idle-time scheduler the warm-build worker plugs into).
- Confirmed `@xenova/transformers` is not yet a dependency; the codebase already has a "deterministic heuristic fallback" pattern (`HeuristicEmbedder.ts` in `src/storage/`) that we mirror for the new `LocalEmbedder` so CI keeps working without the 80 MB ONNX payload.
- Surfaced a plan deviation early: the plan's "replace the substring path in `UnifiedMemoryRetriever`" instruction is wrong about where the substring path lives. The actual substring scan is in `core/memory/MemoryHub.ts::InMemoryMemoryHub.retrieve`; `UnifiedMemoryRetriever` already runs an HNSW + FTS5 + recency hybrid. Decision: wire the new hybrid path into `MemoryHub` (where it has consumers today) and defer the `UnifiedMemoryRetriever` migration to Phase 6/9 where `MemoryStore` itself gains the BM25/Dense indexes.

## 2. Sub-task execution chronology

| Order | Sub-task | Files created | Notes |
|---|---|---|---|
| 1 | 5.1 LocalEmbedder | [core/memory/LocalEmbedder.ts](../../../../core/memory/LocalEmbedder.ts) | Lazy-loads `@xenova/transformers` via guarded dynamic import; transparently falls back to a 384-dim hash sketch when the optional dep is unavailable. Exposes `defaultWeightsPath()` honouring `NEXUS_HOME`. |
| 2 | 5.2 BM25 index + stopwords | [core/memory/Bm25Index.ts](../../../../core/memory/Bm25Index.ts), [core/memory/stopwords.ts](../../../../core/memory/stopwords.ts) | Standard Okapi BM25 with smoothed IDF; tokenizer drops 120 stop-words + single-char tokens. |
| 3 | 5.3 Dense vector index | [core/memory/DenseIndex.ts](../../../../core/memory/DenseIndex.ts) | Linear cosine scan; tombstone + compact mechanics; custom "NXDI" binary format for `save`/`load` that does not require Float32Array alignment. |
| 4 | 5.4 RRF fuser | [core/memory/RrfFuser.ts](../../../../core/memory/RrfFuser.ts) | Free `fuse()` + `RrfFuser` instance class with mutable `k` for SettingsStore listeners. |
| 5 | 5.5 HybridRetriever + MemoryHub delegation | [core/memory/HybridRetriever.ts](../../../../core/memory/HybridRetriever.ts), edits to [core/memory/MemoryHub.ts](../../../../core/memory/MemoryHub.ts) | Hybrid façade runs BM25 + Dense + Graph in parallel, fuses via RRF, resolves ids via `entryProvider`, applies scope filter. MemoryHub takes optional `hybridRetriever` + `hybridMinCorpus` threshold (default 100); structural `HybridRetrieverLike` interface keeps the dep one-way. |
| 6 | 5.6 Warm-build worker | [core/memory/WarmRebuildWorker.ts](../../../../core/memory/WarmRebuildWorker.ts) | `warmRebuild(...)` reads rows, embeds in batches of 32, repopulates indexes, emits `lifecycle.notification` progress events. Fingerprint short-circuit skips when nothing changed. `createWarmRebuildTask(...)` returns an `IdleTimeScheduler.register`-compatible shape (default 5 s idle threshold, 24 h cadence). |
| 7 | 5.7 Gate + benchmark | [tests/benchmarks/hybrid-retrieval.bench.ts](../../../../tests/benchmarks/hybrid-retrieval.bench.ts), [package.json](../../../../package.json) edits | New benchmark covers the Phase 5 latency assertions (already exercised in unit tests too). Settings additions: `nexus.memory.bm25.k1`, `nexus.memory.bm25.b`, `nexus.memory.rrf.k`, `nexus.memory.hybridMinCorpus`. `@xenova/transformers ^2.17.2` added under `optionalDependencies`. |

## 3. Tests added

| File | Tests | Coverage focus |
|---|---|---|
| [tests/unit/core/memory/LocalEmbedder.test.ts](../../../../tests/unit/core/memory/LocalEmbedder.test.ts) | 17 | Determinism, 384-dim, L2-norm == 1, empty input, batch latency, `fromInstallPath`, `NEXUS_HOME` override, `hashEmbed` properties, `cosineSimilarity` invariants. |
| [tests/unit/core/memory/Bm25Index.test.ts](../../../../tests/unit/core/memory/Bm25Index.test.ts) | 18 | Tokenizer behaviour, add/delete/replace, ranking on a canonical fixture, length-norm sensitivity (`b`), tie-breaking, 1,000-entry index + add + search latency. |
| [tests/unit/core/memory/DenseIndex.test.ts](../../../../tests/unit/core/memory/DenseIndex.test.ts) | 16 | Add/delete/replace, tombstone + compact, dim padding/truncation, 1,000-entry indexing + search latency, save/load round-trip, malformed-file rejection, default path with `NEXUS_HOME`. |
| [tests/unit/core/memory/RrfFuser.test.ts](../../../../tests/unit/core/memory/RrfFuser.test.ts) | 9 | DEFAULT_RRF_K, hand-computed paper example, single-ranking pass-through, empty list, lower-k boosts top-of-list, tie-breaking by entryId, mutable `k`. |
| [tests/unit/core/memory/HybridRetriever.test.ts](../../../../tests/unit/core/memory/HybridRetriever.test.ts) | 14 | Default k=60, runtime k mutation, isReady, graceful degradation when stages are empty, graph contribution, scope filtering, missing entryProvider drop, 1,000-entry p50<50ms + p99<150ms, regression that substring top hits stay in hybrid top-10, `substringFallback` helper. |
| [tests/unit/core/memory/MemoryHub.hybrid.test.ts](../../../../tests/unit/core/memory/MemoryHub.hybrid.test.ts) | 5 | No retriever => substring; with retriever + small corpus => substring; with retriever + large corpus => hybrid; runtime flip via `setHybridRetriever`; empty retriever degrades back. |
| [tests/unit/core/memory/WarmRebuildWorker.test.ts](../../../../tests/unit/core/memory/WarmRebuildWorker.test.ts) | 11 | Populates BM25 + Dense from source; clears stale indexes; fingerprint short-circuit; HookBus notifications on success; loadAll error path; embedder failure degrades to BM25-only with warning; zero-row safety; 10,000-row latency ceiling; task wrapper shape + fingerprint persistence + custom thresholds. |
| **Total** | **90** | -- |

## 4. Troubleshooting

Three rounds of test failure -> fix needed:

1. **Stop-word test wrong**: my own stop-word list contains "over", so `tokenize("The quick brown fox jumps over the lazy DOG")` returns 6 tokens not 7. Updated the test expectation (the regression confirmed the tokenizer is correctly applying the stop-word list).
2. **DenseIndex `save` Float32Array alignment**: writing the float view via `new Float32Array(buf.buffer, buf.byteOffset + offset, dim)` throws on Windows because the variable-length id string preceding the vector breaks 4-byte alignment. Switched to a per-element `buf.writeFloatLE(slot.vec[j], offset + j*4)` loop -- byte-aligned writes work regardless of preceding payload.
3. **Path tests assuming POSIX separators**: on Windows the `path.join` output uses `\` not `/`. Changed `expect(p).toContain("/tmp/nx-test")` to `expect(p).toContain("nx-test")` so the assertion is separator-agnostic.

One round of architecture-check failure -> fix needed:

4. **Circular dep `MemoryHub <-> HybridRetriever`**: importing the concrete `HybridRetriever` class from `MemoryHub.ts` (for the optional constructor option type) created a cycle (`HybridRetriever` imports `MemoryHit` / `isVisibleFromScope` from `MemoryHub`). Solved structurally: declared a minimal `HybridRetrieverLike` interface inline in `MemoryHub.ts` (with just `isReady` + `retrieve(...)`) and dropped the cross-module import. `npm run check-architecture` then shows zero new cycles.

One typo round caused by an over-aggressive `replace_all`: my Edit `replace_all` from `HybridRetriever` to `HybridRetrieverLike` also rewrote the method name `setHybridRetriever` to `setHybridRetrieverLike`. Reverted the method name with a targeted Edit and re-ran the suite -- everything green.

## 5. Deviations from the plan

- **Plan said "replace the substring path in `UnifiedMemoryRetriever`"**; actually the substring path lives in `core/memory/MemoryHub.ts::InMemoryMemoryHub.retrieve`, not in the SQLite-backed `UnifiedMemoryRetriever`. The new hybrid path was wired into `MemoryHub` (with the documented <100-entry fast-path fallback gated by `nexus.memory.hybridMinCorpus`) so the user-visible semantics match the plan. The deeper `UnifiedMemoryRetriever` migration is intentionally deferred to Phase 6/9 where `MemoryStore` itself grows BM25 + Dense indexes alongside the existing HNSW path. Recorded as open item 5.5.P1.N.
- **Plan said "the dense index uses bundled `all-MiniLM-L6-v2` (384-dim) and produces deterministic embeddings for fixture inputs"**; the real ONNX pipeline depends on the Phase 14 installer payload, which has not yet landed. The `LocalEmbedder` transparently falls back to a deterministic 384-dim hash sketch (`hashEmbed`) that satisfies the determinism + L2-norm + 384-dim invariants, so the surrounding pipeline (DenseIndex, HybridRetriever, WarmRebuildWorker) is fully covered in CI. The real semantic-embedding test is deferred until Phase 14. Recorded as open item 5.1.P1.M.
- **Plan said "Add an `IdleTimeScheduler` worker `memory.warm-rebuild`"**; the worker code (`warmRebuild` + `createWarmRebuildTask`) ships with full coverage, but the actual `scheduler.register(...)` call site in `desktop/sidecar/` needs the `MemoryStore`-backed `WarmRebuildSource` adapter that Phase 6 will land. Recorded as open item 5.6.P2.O.

## 6. Quality gate

| Gate | Result |
|---|---|
| All tests passing | ✓ (3,132 / 3,132, 5 skipped) |
| New code line coverage | ✓ (extensive unit tests per file; coverage threshold 80% lines / 75% branches enforced by [configs/vitest.config.ts](../../../../configs/vitest.config.ts)) |
| Lint errors | ✓ (eslint src clean; `core/memory/` is outside the eslint scope per project policy) |
| Build / compile | ✓ (`tsc --noEmit` clean) |
| Architecture | ✓ (`npm run check-architecture` clean; zero new cycles / orphans) |

## 7. Next steps

- Phase 6 (memory CLI + Ebbinghaus decay + slash commands): consume the new `HybridRetriever` from `/recall`; build the `MemoryStoreWarmRebuildSource` adapter that closes open items 5.5.P1.N and 5.6.P2.O.
- Phase 7 (session replay timeline): the `TimelineScrubber` reads from the trace store, which now sees `lifecycle.notification` events from the warm-build worker so the user can observe index rebuilds during replay.
- Phase 14 (cross-OS installer): pack the `all-MiniLM-L6-v2` ONNX weights under `~/.nexus/runtimes/embedder/all-MiniLM-L6-v2/` so production hosts switch from the hash fallback to the real pipeline. Closes 5.1.P1.M when the integration test asserts `embedder.backend === "transformers"` after first use.
