# Phase 5 -- Hybrid retrieval + local embedder

**Goal**: Replace substring memory retrieval with BM25 + dense vector + graph fused via Reciprocal Rank Fusion (RRF); bundle the local embedder with installer-packed weights.
**Prerequisites**: Phase 4 (provenance schema required for scoped indexes); Phase 14's installer-packed weight payload is the production path (dev path can download to `~/.nexus/runtimes/embedder/` on first launch).
**Stability Gate**: A 1,000-entry test corpus returns top-K results in <50 ms median on the dev laptop; the BM25 index rebuilds on memory write in <5 ms median; the dense index uses bundled `all-MiniLM-L6-v2` (384-dim); RRF default `k=60` is exposed via `nexus.memory.rrf.k`; a regression test asserts old substring top hits remain in the hybrid top-10.

**Adopts**: agentmemory A1 + A2 (see [comparison-agentmemory.md](../comparison-agentmemory.md) Section 11.2 P1).

---

## Sub-tasks

### 5.1 -- `LocalEmbedder` over `@xenova/transformers`

**Objective**: Add a TypeScript embedder wrapping `@xenova/transformers` and the `all-MiniLM-L6-v2` ONNX weights.

**Prompt**:
> Add `@xenova/transformers` to [package.json](../../../package.json) dependencies. Add [core/memory/LocalEmbedder.ts](../../../core/memory/LocalEmbedder.ts) with `class LocalEmbedder { async embed(text: string): Promise<Float32Array> }` and `embedBatch(texts: string[]): Promise<Float32Array[]>`. The embedder loads `Xenova/all-MiniLM-L6-v2` from a local path (`~/.nexus/runtimes/embedder/all-MiniLM-L6-v2/`); if not found on dev hosts, fall back to the Hub fetch (`Xenova/all-MiniLM-L6-v2`). The installer (Phase 14) packs the weights so production hosts never hit the Hub. Add a `weightsPath` constructor arg + `LocalEmbedder.fromInstallPath()` factory. Acceptance: a unit test embeds "hello world" deterministically; vector length is 384; batch embedding is <50 ms for 10 short strings on a dev laptop.

---

### 5.2 -- BM25 index

**Objective**: Build an in-memory BM25 inverted index over `memory_entries`.

**Prompt**:
> Add [core/memory/Bm25Index.ts](../../../core/memory/Bm25Index.ts) with a standard BM25 implementation (k1=1.5, b=0.75; document the constants; expose via Settings `nexus.memory.bm25.k1` / `.b`). The index is keyed by `entryId`; tokens are case-folded + stop-word-stripped (use a small English stop-word list under [core/memory/stopwords.ts](../../../core/memory/stopwords.ts)). On `MemoryHub.write(entry)`, index the entry's `text` field; on `MemoryHub.delete(id)`, remove from the index. Persistence: rebuild on first launch from the SQLite rows (warm-build worker in `IdleTimeScheduler`). Acceptance: a unit test indexes 1,000 entries and asserts BM25 ranking matches a reference Python implementation on 10 sample queries.

---

### 5.3 -- Dense vector index

**Objective**: Add a simple cosine-similarity vector index over the embedded memory entries.

**Prompt**:
> Add [core/memory/DenseIndex.ts](../../../core/memory/DenseIndex.ts). Storage: a flat in-memory `Float32Array[]` keyed by `entryId`, persisted to `~/.nexus/memory/dense.bin` on shutdown and reloaded on startup. On `write(entry)`, compute `embedder.embed(entry.text)` and append; on `delete(id)`, mark the slot as tombstoned and prune on next compaction. Search: linear scan (1,000 entries x 384-dim cosine is <2 ms on a modern CPU; no need for HNSW yet -- document the upgrade path as a v1.2.0 follow-up if corpora grow beyond ~50,000 entries). Acceptance: a unit test indexes 1,000 entries, queries with a known-similar string, asserts the expected entries are in the top-10.

---

### 5.4 -- RRF fuser

**Objective**: Reciprocal Rank Fusion across BM25 + Dense + Graph rankings.

**Prompt**:
> Add [core/memory/RrfFuser.ts](../../../core/memory/RrfFuser.ts) with `fuse(rankings: Array<Map<string, number>>, k: number = 60): Map<string, number>`. The fuser computes `sum_over_rankings(1/(k + rank_i))` for every entryId that appears in any ranking. Output is sorted by the fused score, descending. Expose `nexus.memory.rrf.k` (default 60) via the SettingsStore. Acceptance: unit tests over a canonical RRF example (the original paper's test case) confirm the implementation; `k=60` is the default.

---

### 5.5 -- `HybridRetriever` and migration of `UnifiedMemoryRetriever`

**Objective**: A single façade that runs BM25 + Dense + Graph in parallel, fuses via RRF, and returns top-K.

**Prompt**:
> Add [core/memory/HybridRetriever.ts](../../../core/memory/HybridRetriever.ts) with `retrieve(query: string, opts: {scopeId?: string; limit: number}): Promise<MemoryHit[]>`. Internally: (a) `embedder.embed(query)` -> Dense top-50; (b) `bm25.search(query)` -> BM25 top-50; (c) `GraphMemory.entitySearch(query)` -> Graph top-50; (d) `RrfFuser.fuse([dense, bm25, graph], k=60)` -> top-K. Replace the substring path in `UnifiedMemoryRetriever` with a delegating call to `HybridRetriever`. Keep the substring path as a fast-path-fallback for very small corpora (<100 entries) where BM25 is overkill. Acceptance: an integration test against a 1,000-entry corpus measures p50 retrieve latency <50 ms, p99 <150 ms; a regression test asserts that for 10 canonical queries, the new hybrid top-10 contains every entry that the old substring search returned in its top-10 (no regressions on previously-working queries).

---

### 5.6 -- Warm-build worker on first launch

**Objective**: On a fresh start, rebuild the BM25 + Dense indexes from the SQLite rows in the background; while the rebuild runs, retrieval falls back to substring.

**Prompt**:
> Add an `IdleTimeScheduler` worker `memory.warm-rebuild` that on first launch (or when the indexes are detected as stale -- a hash-of-row-count mismatch) reads all `memory_entries` rows and embeds them in batches of 32. The worker reports progress via the Phase 4 HookBus (`lifecycle.notification` kind). The `HybridRetriever.retrieve` method detects when the index isn't ready and falls back to substring; once ready, it switches transparently. Acceptance: on a 10,000-row test corpus, the warm rebuild finishes in <60 s on a dev laptop; during rebuild, retrieval still returns results (slower but correct).

---

### 5.7 -- Phase 5 lint, build, test gate

**Objective**: Verify the hybrid retriever is CI-green and performance gates hold.

**Prompt**:
> Re-run the four-step gate. Run the new Phase 5 latency benchmark in `tests/benchmarks/hybrid-retrieval.bench.ts` and assert the p50 + p99 latency targets. Acceptance: 0 failures; the benchmark passes.
