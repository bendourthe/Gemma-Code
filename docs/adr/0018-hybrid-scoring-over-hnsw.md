# ADR-0018: Hybrid memory scoring layered on top of HNSW

- **Status**: Accepted
- **Date**: 2026-05-16
- **Deciders**: v0.8.0 Phase 4 sub-task 4.6 -- aligned with the multi-source comparison report Section 5a items A5 and A6 (Mnemosyne / yantrikdb references).

## Context

v0.7.0 Phase 7 shipped an optional HNSW vector index (`hnswlib-node`) inside `MemoryStore`. The index activates when the entry count crosses a configurable threshold (default 1000) and `hnswlib-node` is loadable; otherwise the store falls back to the FTS5-pre-filtered linear cosine scan. Both paths produce a single ranked list using vector similarity alone.

The multi-source comparison surfaced two related improvements: (A5) hybrid scoring that combines vector + lexical + recency, and (A6) per-result "why retrieved" explanations the user can inspect. Mnemosyne and yantrikdb both use reciprocal-rank fusion (RRF) as the default fusion method.

The constraint is to keep HNSW: it is the right tool for the vector-retrieval engine. RRF is a complementary layer, not a replacement, so the design must surface both clearly.

## Decision

Introduce `src/storage/HybridRanker.ts` as a pure fusion module. The ranker accepts pre-fetched `VectorCandidate[]` and `LexicalCandidate[]` lists and produces a unified `RankedEntry[]` with one or more `reason` strings explaining provenance.

Two fusion methods are supported:

- `rrf` (default): Reciprocal Rank Fusion with k = 60. Robust to score-scale differences between sub-rankers. Used by Mnemosyne, yantrikdb, and most open-source RAG stacks.
- `weighted`: linear 50% vector + 30% lexical + 20% recency. Useful when the operator wants a deterministic blend or when one sub-ranker consistently dominates.

`MemoryStore.searchHybrid(query, limit, method)` wires the two sub-rankers (FTS5 keyword + HNSW or linear-scan semantic) into the fusion. `MemorySearchResult` gains an optional `reason: readonly string[]` field. The `matchSource` union expands from `"keyword" | "semantic" | "both"` to also include `"hybrid"`.

The MemoryPanel webview message shape (`MemorySnapshotMessage.sqlMemories`) gains optional `reason` and `matchSource` fields so the panel can show a collapsible "why retrieved" affordance.

## Consequences

- **Positive**: Better recall on queries where the vector engine misses a literal term (FTS5 lexical signal compensates). Recent edits surface ahead of stale entries (recency component). Users get an explanation per hit so they can audit memory recall.
- **Negative**: Two extra reads per query (keyword + semantic) when callers opt into hybrid. The existing `retrieve(query, budget, threshold)` path is unchanged, so callers can keep the cheaper single-ranker behaviour when they want it.
- **Neutral**: HNSW is not replaced. It remains the vector retrieval engine that feeds `VectorCandidate[]`; `HybridRanker` runs on top of its output.

## Alternatives considered

- **Replace HNSW with FTS5 + recency**. Rejected: vector similarity is the only sub-ranker that captures semantic similarity (paraphrases, synonyms). FTS5 alone regresses recall on real-world queries.
- **Weighted-sum only**. Rejected: the weights are hard to tune across query distributions. RRF is rank-based and side-steps the issue.
- **Build a new ANN store**. Rejected: HNSW is already in place, performant, and battle-tested. Adding a second store would be cost without benefit.

## Links

- Comparison report: `docs/archive/versions/v0/v0.7.0/comparison-multi-source-v2.md` Section 5a items A5 + A6.
- Predecessor: `docs/adr/0002-memory-subsystem-layering.md` (the layered memory architecture HNSW fits into).
- Plan reference: `docs/archive/versions/v0/v0.8.0/plans/v0.8.0-cycle.md` sub-task 4.6.
- Reciprocal Rank Fusion paper: Cormack, Clarke, Buettcher (2009).
