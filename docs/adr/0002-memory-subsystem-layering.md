# ADR-0002: Memory Subsystem Layering

- **Status**: Accepted (2026-04-26)
- **Deciders**: Benjamin Dourthe (project owner) — codifies the v0.3.0 (memory introduction) and v0.4.0 (consolidation) designs as they exist at the start of v0.5.0

## Context

A single SQLite store with FTS5 was sufficient for v0.2.0's modest "remember user-stated facts across sessions" feature. v0.3.0 expanded the scope: the agent loop now needs to recall recent tool outputs within a turn, structured per-session events for retrospection, dense semantic recall across the lifetime of the workspace, and entity/relation knowledge ("file X imports symbol Y", "module Z owns table W"). One backing store cannot serve all four access patterns without trade-offs that hurt at least one of them: an FTS5-only store does poorly on semantic recall once the user paraphrases; a vector-only store loses the precision of grep on identifiers; a graph store is unwieldy for unstructured recall.

## Decision

Adopt four memory layers, each backed by its own SQLite database file under `<workspace>/.gemma-code/memory/`, with a single retrieval orchestrator on top:

- **Working memory** — [src/storage/WorkingMemory.ts](../../src/storage/WorkingMemory.ts). Ephemeral in-context task state, scoped to the active session. No persistence beyond the session.
- **Episodic memory** — [src/storage/EpisodicMemory.ts](../../src/storage/EpisodicMemory.ts). Structured per-session event log (tool calls, user turns, sub-agent spawns) with provenance metadata for retrospection.
- **Semantic memory** — [src/storage/MemoryStore.ts](../../src/storage/MemoryStore.ts) with FTS5 keyword search and dense embeddings (Ollama `nomic-embed-text`, configurable via `gemma-code.embeddingModel`). The N-corroboration discipline added in v0.5.0 Phase 7 lives here (`corroboration_count` column; see [MemoryConsolidator.ts](../../src/storage/MemoryConsolidator.ts)).
- **Graph memory** — [src/storage/GraphMemory.ts](../../src/storage/GraphMemory.ts) with [src/storage/EntityExtractor.ts](../../src/storage/EntityExtractor.ts) and [src/storage/GraphQueryEngine.ts](../../src/storage/GraphQueryEngine.ts). Entity-relationship triples for multi-hop queries.

[src/storage/UnifiedMemoryRetriever.ts](../../src/storage/UnifiedMemoryRetriever.ts) is the public API: it queries each layer, merges results by relevance, and distributes the 3% memory share of the prompt budget (see [src/config/PromptBudget.ts](../../src/config/PromptBudget.ts)) across layers. Tool handlers, the agent loop, and the panels never reach into individual layers; they call the retriever.

[src/storage/MemorySubsystem.ts](../../src/storage/MemorySubsystem.ts) is the composition factory that wires the four layers, the retriever, and the consolidator. Everything else takes a `MemorySubsystem` instance. SQLite files are chmod 0o600 on POSIX via [src/storage/dbPermissions.ts](../../src/storage/dbPermissions.ts).

## Consequences

**Positive**

- Selective recall: each query type hits the layer best suited to it, with the retriever fusing results.
- Graceful degradation: if Ollama (and therefore the embedder) is down, semantic recall falls back to FTS5; the other three layers are unaffected.
- Clear ownership boundary: storage modules own writes. Tool handlers must consume `UnifiedMemoryRetriever` (formalised in the Module Authorship Contract added in Phase 11).
- v0.5.0's [MemoryHealthCheck.ts](../../src/storage/MemoryHealthCheck.ts) only had to walk four well-defined layers to surface stale, broken-path, embedding-failed, and duplicate entries.

**Negative**

- Four SQLite files instead of one. Schema migrations run per layer; each layer carries its own version row.
- Consolidation logic in [MemoryConsolidator.ts](../../src/storage/MemoryConsolidator.ts) bridges layers and is therefore the most complex memory module; the N-corroboration rule added in v0.5.0 Phase 7 added another condition before promotion.
- Cross-layer queries pay the cost of N round-trips. Acceptable because each layer's query is < 5 ms p99 against typical workspace sizes.

**Neutral**

- The retriever's budget distribution is heuristic (working > episodic > semantic-fact > graph > semantic-candidate) and not tuned per workspace. v0.6.0 may revisit.

## Alternatives considered

- **Single FTS5 store.** Rejected: paraphrased queries miss semantic matches; entity-relationship queries become awkward joins. v0.2.0 was this design and v0.3.0 outgrew it.
- **Vector-only store.** Rejected: loses identifier-precision recall ("find the row that mentions `EmbeddingClient`"); embeddings are not free and the embedder may be unavailable.
- **Graph-only store.** Rejected: forces every observation through entity extraction; unstructured prose ("the user prefers concise commit messages") is hard to model.
- **Two layers (semantic + graph).** Rejected: collapsing working into semantic created session-bleed bugs in early v0.3.0 prototypes; making episodic optional removed the retrospection signal needed by the consolidator.

## Links

- v0.3.0 implementation plan (memory layers): [docs/archive/versions/v0/v0.3.0/implementation-plan.md](../v0.3.0/implementation-plan.md)
- v0.5.0 Phase 7 (memory hygiene + corroboration): [docs/archive/versions/v0/v0.5.0/plans/memory-hygiene.md](../v0.5.0/plans/memory-hygiene.md)
- v0.5.0 architecture overview: [docs/archive/versions/v0/v0.5.0/architecture.md](../v0.5.0/architecture.md) (if present)
- Comparison source for the consolidation rule: [docs/archive/versions/v0/v0.5.0/comparison/comparison-foundry-vault.md](../v0.5.0/comparison/comparison-foundry-vault.md)
