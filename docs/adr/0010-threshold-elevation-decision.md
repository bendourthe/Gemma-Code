# ADR-0010: Per-provenance semantic threshold elevation (heuristic vs. ollama)

- **Status**: Accepted (2026-05-03)
- **Deciders**: Benjamin Dourthe (project owner) — closes pen-test F-007 + known-gaps Section 4.2 as part of v0.6.0 Phase 5 sub-task 5.2

## Context

v0.5.0 Phase 12 introduced the heuristic embedder fallback ([src/storage/HeuristicEmbedder.ts](../../src/storage/HeuristicEmbedder.ts)) — a deterministic 128-D embedding from hash + statistical + n-gram features that runs when Ollama is unavailable. Rows produced by the heuristic embedder are tagged `embedding_provenance = 'heuristic'` in the `tool_output_cache` table; rows produced by Ollama are tagged `'ollama'` (or NULL on legacy data, treated conservatively as the higher-quality tier).

Phase 12 documentation claimed that retrieval applied an *elevated* cosine similarity bar to heuristic rows (the rationale being that the heuristic embedding has lower discriminative power, so its similarity scores should be trusted only when very high). The actual code in `searchByEmbedding` applied a single `DEFAULT_SEMANTIC_THRESHOLD = 0.85` to every row regardless of provenance. The doc/code drift was tracked as pen-test F-007 and known-gaps Section 4.2; an `it.todo` placeholder in [tests/integration/heuristic-fallback.test.ts](../../tests/integration/heuristic-fallback.test.ts) had been waiting since v0.6.0 Phase 2 sub-task 2.5.

The plan offered Option A (implement the elevation) or Option B (retract the documentation claim). The decision criterion was straightforward: if the heuristic embedder is shipping in v0.6.0 (it is — `EmbeddingClient.embedWithProvenance` falls back to it whenever Ollama is offline), the documented behavior must match the code. Either elevate the threshold or stop claiming we do.

## Decision

Implement Option A — per-provenance threshold elevation.

- Add `DEFAULT_HEURISTIC_SEMANTIC_THRESHOLD = 0.95` next to the existing `DEFAULT_SEMANTIC_THRESHOLD = 0.85` in [src/storage/ToolOutputCache.ts](../../src/storage/ToolOutputCache.ts).
- Extend `searchByEmbedding(queryVec, options)` so `options` accepts an optional `heuristicThreshold` field. The existing `threshold` field continues to mean the ollama-tier threshold.
- The SQL now reads `SELECT absolute_path, embedding, embedding_provenance, content_brotli ...`. The scoring loop checks `row.embedding_provenance === 'heuristic'` to pick the row's threshold; rows tagged `'ollama'` or NULL use the lower 0.85 bar (NULL is conservatively classified as the higher-quality tier, since heuristic rows are always tagged at write time).
- Plumb `heuristicThreshold` through [src/storage/UnifiedMemoryRetriever.ts](../../src/storage/UnifiedMemoryRetriever.ts) `ToolOutputSearchOptions`. `searchToolOutputs` forwards via spread (`...(heuristicThreshold !== undefined ? { heuristicThreshold } : {})`) to keep the call signature minimal.
- Expose two settings in [package.json](../../package.json) `contributes.configuration.properties`: `gemma-code.ollamaEmbeddingThreshold` (default 0.85) and `gemma-code.heuristicEmbeddingThreshold` (default 0.95), both clamped to `[0, 1]`. Register in [src/config/settings.ts](../../src/config/settings.ts) `GemmaCodeSettings`.
- Replace the three `it.todo` placeholders in [tests/integration/heuristic-fallback.test.ts](../../tests/integration/heuristic-fallback.test.ts) with three real tests: (a) heuristic-tagged rows below 0.95 are filtered out, (b) ollama-tagged rows survive at 0.92 because 0.92 >= 0.85, (c) when no rows clear the elevated threshold, retrieval falls back to FTS5 keyword search.

## Consequences

**Positive**

- Closes pen-test F-007 and known-gaps Section 4.2 with the documented behavior matching the code.
- Heuristic recall is now safer-by-default: a near-miss similarity score from the lower-power embedder no longer surfaces as if it were an Ollama-quality match.
- The graceful-degradation contract from v0.5.0 Phase 12 holds end-to-end: when Ollama is offline, heuristic rows are written, scored at 0.95, and only return when very confident; if nothing clears the bar, FTS5 keyword search runs.
- The two new settings expose the dial without forcing a rebuild — operators with unusual workloads (e.g. very short tool outputs where heuristic features have low signal) can raise or lower either bar.

**Negative**

- This adds two user-facing settings under the v0.6.0 cycle's "no new product surface" constraint. Acceptable here because: (a) the *semantic threshold* dial already existed implicitly via `DEFAULT_SEMANTIC_THRESHOLD`, (b) the elevation is a *correctness fix* for documented behavior, not a new product capability, (c) defaults match the documented values so most users see no observable change.
- Heuristic rows are evicted from the recall set more aggressively. Workspaces that operate with Ollama frequently offline will see fewer semantic hits and proportionally more FTS5 hits. Acceptable because the alternative is returning low-quality semantic matches that the cost-of-error favors avoiding.
- Two thresholds means two dials to keep coherent in user reasoning. The package.json descriptions explicitly call out the relationship.

**Neutral**

- A `/cache reembed` slash command (introduced in v0.5.0 Phase 12) walks heuristic-tagged rows and re-embeds them via Ollama once it's back online. The threshold elevation makes that command more valuable: re-embedded rows graduate from the 0.95 tier to the 0.85 tier on the next access.

## Alternatives considered

- **Option B — retract the documentation claim.** Rejected. The heuristic embedder ships; documenting that we apply *no* discriminating filter to its output would be honest but misses the actual safety property. The cycle's constraint is "no new product surface" but explicitly carves out finding closures, and this finding is closed correctly only by the implementation.
- **Apply a single elevated threshold (0.95) to both ollama and heuristic rows.** Rejected: would silently degrade ollama recall quality. The 0.85 default has v0.5.0 baseline data behind it.
- **Drop heuristic rows from semantic recall entirely; force FTS5 fallback for them.** Rejected: equivalent to a 1.0 threshold; the heuristic embedder produces useful signal at 0.95+, just not at 0.85+.
- **Make the threshold dial per-row at write time instead of per-row at read time.** Rejected: the threshold is a retrieval-quality decision, not a write-time property. Operators need to be able to tune it without re-encoding the cache.

## Links

- Implementation: [src/storage/ToolOutputCache.ts](../../src/storage/ToolOutputCache.ts) (`DEFAULT_HEURISTIC_SEMANTIC_THRESHOLD`, `searchByEmbedding`), [src/storage/UnifiedMemoryRetriever.ts](../../src/storage/UnifiedMemoryRetriever.ts) (`ToolOutputSearchOptions`, `searchToolOutputs`)
- Settings: [src/config/settings.ts](../../src/config/settings.ts), [package.json](../../package.json) (`gemma-code.ollamaEmbeddingThreshold`, `gemma-code.heuristicEmbeddingThreshold`)
- Tests: [tests/integration/heuristic-fallback.test.ts](../../tests/integration/heuristic-fallback.test.ts)
- v0.6.0 Phase 5 plan entry: [docs/archive/versions/v0/v0.6.0/plans/v0.6.0-cycle.md](../v0.6.0/plans/v0.6.0-cycle.md) sub-task 5.2
- Phase 5 history: [docs/archive/versions/v0/v0.6.0/development/history/2026-05_phase-5-doc-code-drift.md](../v0.6.0/development/history/2026-05_phase-5-doc-code-drift.md) Section 2.6
- Pen-test finding: [docs/archive/versions/v0/v0.6.0/review/penetration-test.md](../v0.6.0/review/penetration-test.md) F-007
- Known-gaps entry: [docs/archive/versions/v0/v0.6.0/review/known-gaps.md](../v0.6.0/review/known-gaps.md) Section 4.2
- Heuristic embedder origin: [src/storage/HeuristicEmbedder.ts](../../src/storage/HeuristicEmbedder.ts), v0.5.0 Phase 12
- Companion ADR (predictive-cache decision): [ADR-0009](./0009-predictive-cache-decision.md)
