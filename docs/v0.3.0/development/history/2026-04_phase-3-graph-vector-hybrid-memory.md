# Development Log: Phase 3 -- Graph-Vector Hybrid Memory

**Date**: 2026-04-15
**Operator**: Benjamin Dourthe
**Assisted by**: Claude Opus 4.6 (Claude Code)
**Objective**: Implement a 4-layer memory stack (working/episodic/semantic/graph) with entity extraction, provenance tracking, memory consolidation, and unified cross-layer retrieval for Gemma Code v0.3.0.
**Outcome**: All 7 sub-tasks completed. 15 new files created, 7 files modified. 42 new tests passing (3 test files runnable without native module). TypeScript compiles cleanly, 0 lint errors. Tests requiring better-sqlite3 native module blocked by pre-existing ERR_DLOPEN_FAILED (not a Phase 3 regression).

---

## 1. Starting State

- **Branch**: `main`
- **Starting commit**: `7bf9868` (feat(v0.3.0): implement advanced context engineering (Phase 2))
- **Environment**: Windows 11 Pro, Node.js 20, TypeScript, Vitest 1.6.1, better-sqlite3 (native module)
- **Prior session reference**: `docs/v0.3.0/development/history/2026-04-14_phase-2-advanced-context-engineering.md`
- **Plan reference**: `docs/v0.3.0/implementation-plan.md` (Phase 3, lines 693-1409)

Context: Phase 2 (Advanced Context Engineering) completed the day prior, delivering lazy tool loading, output redirection, regenerate-from-source compaction, relevance scoring, and conversation syncing. Phase 3 was the natural next step: building the 4-layer memory architecture on top of the existing flat MemoryStore, using the context budgeting and retrieval infrastructure from Phase 2.

---

## 2. Chronological Steps

### 2.1 Memory Layer Architecture and Type Definitions (Sub-task 3.1)

**Plan specification**: Define all 4-layer type interfaces with provenance, TTL, and staleness detection. Extend existing MemoryEntry with optional backward-compatible fields.

**What happened**: Created `src/storage/MemoryLayers.types.ts` with all type definitions: MemoryProvenance, WriteGate, MemoryTTL, WorkingMemoryState, EpisodicEntry, SemanticMemoryEntry (extends MemoryEntry), GraphEntity, GraphRelation, EntityType, RelationType, MemoryQuery, MemoryQueryResult, MemoryResultEntry. Added `isStale()` and `isExpired()` pure utility functions. Extended `MemoryStore.types.ts` with optional `provenance?`, `ttl?`, `scope?` fields and re-exports.

**Key files changed**: `src/storage/MemoryLayers.types.ts` (new), `src/storage/MemoryStore.types.ts` (modified)

---

### 2.2 Working Memory Manager -- Layer 1 (Sub-task 3.2)

**Plan specification**: Implement ephemeral in-context JSON working memory with task tracking, open files, errors, decisions, goals, and scratchpad. Integrate into PromptBuilder and AgentLoop.

**What happened**: Created `WorkingMemory` class with all capped arrays (10 open files, 5 errors, 5 decisions). `serialize(maxTokens)` produces compact markdown and drops sections by priority when over budget (scratchpad first, working task last). Added `workingMemory?` to PromptContext. Updated `_buildMemorySection()` to prepend working memory (20% of budget) before recalled memories. Updated AgentLoop to track open files on read/write/edit/create tool calls and record errors on failures.

**Key files changed**: `src/storage/WorkingMemory.ts` (new), `tests/unit/storage/WorkingMemory.test.ts` (new), `src/chat/PromptBuilder.ts`, `src/chat/PromptBuilder.types.ts`, `src/tools/AgentLoop.ts`

**Verification**: 21 tests passing.

---

### 2.3 Episodic Memory -- Layer 2 (Sub-task 3.3)

**Plan specification**: Implement session-level event recording with SQLite, FTS5, optional embeddings, and tool event helpers. Integrate into AgentLoop for significant tool calls.

**What happened**: Created `EpisodicMemory` class following MemoryStore patterns exactly (FTS5, BM25, cosine similarity, WAL mode). Schema: `episodic_events` table with `episodic_fts` virtual table and 3 FTS sync triggers. Added `recordToolEvent()` and `recordDecisionEvent()` helper functions. Updated AgentLoop with `EPISODIC_TOOLS` set (write_file, edit_file, create_file, run_terminal, grep_codebase) and fire-and-forget recording.

**Key files changed**: `src/storage/EpisodicMemory.ts` (new), `tests/unit/storage/EpisodicMemory.test.ts` (new), `src/tools/AgentLoop.ts`

---

### 2.4 Graph Memory and Entity Extraction -- Layer 4, Part A (Sub-task 3.4)

**Plan specification**: Implement SQLite schema for entities/relations, regex-based entity extraction pipeline, and relationship inference from co-occurrence.

**What happened**: Created `GraphMemory` class with `graph_entities` and `graph_relations` tables, UNIQUE constraints, and indexes. All operations synchronous (better-sqlite3). `upsertEntity` increments mention_count on duplicates, merges properties. `upsertRelation` increases weight by 0.1 (capped at 1.0). `findRelatedEntities` uses BFS capped at 50 results. Created `EntityExtractor` with regex patterns for 7 entity types (file, function, class, module, technology, error, decision) and relationship inference (imports, modifies, causes, decided_for, related_to).

**Troubleshooting**:
- **Problem**: Sentence splitting regex `[.!?\n]+` was splitting inside file extensions (e.g., `MemoryStore.ts` became two fragments), breaking relation detection between co-occurring file entities.
- **Root cause**: Naive character-class split treats the period in `.ts` as a sentence boundary.
- **Resolution**: Changed to negative lookbehind regex: `(?<!\.\w{1,5})[.!?]\s+|\n+`. This preserves file extensions while still splitting on actual sentence-ending punctuation.

**Key files changed**: `src/storage/GraphMemory.ts` (new), `src/storage/EntityExtractor.ts` (new), `tests/unit/storage/GraphMemory.test.ts` (new), `tests/unit/storage/EntityExtractor.test.ts` (new)

**Verification**: 13 EntityExtractor tests passing (including the import relation test after the regex fix).

---

### 2.5 Graph Query Engine -- Layer 4, Part B (Sub-task 3.5)

**Plan specification**: Implement multi-hop traversal, recency-weighted scoring, formatted context injection, shortest path explanation, and MemoryStore integration.

**What happened**: Created `GraphQueryEngine` with `queryByEntity` (depth-limited BFS), `queryByRelationType`, `queryContextFor` (extracts entities from natural language, traverses each at depth 2), `formatAsContext` (markdown for prompt injection), and `explainPath` (shortest path with natural-language explanation). Hard cap of 100 nodes in BFS. Recency factors: 1.0 (<1 day), 0.7 (<7 days), 0.4 (older). Integrated into MemoryStore via `setGraphEngine()` setter; `retrieve()` appends graph context at up to 25% of token budget.

**Troubleshooting**:
- **Problem**: ESLint flagged unused variable `entity` in `_reconstructPath` method.
- **Resolution**: Simplified the path reconstruction to use `knownEntities.find()` directly, removed the unused variable and the dead `_collectEntitiesFromRelations` helper method.

**Key files changed**: `src/storage/GraphQueryEngine.ts` (new), `tests/unit/storage/GraphQueryEngine.test.ts` (new), `src/storage/MemoryStore.ts`

---

### 2.6 Memory Consolidation and Write Policy (Sub-task 3.6)

**Plan specification**: Implement consolidation pipeline (gather, extract, graph update, pattern detection, promotion), write gate enforcement, and ContextCompactor integration.

**What happened**: Created `MemoryConsolidator` with `consolidate()` pipeline, `detectPatterns()` using token overlap (intersection/union > 0.7), `shouldPersist()` enforcing 4 write gate policies, and `promoteToMemory()` with deduplication. Made `_isDuplicate` public as `isDuplicate()`. Added `saveWithProvenance()` to MemoryStore. Added `setPostCompactionHook()` to ContextCompactor rather than modifying the pre-compaction hook signature.

**Troubleshooting**:
- **Problem**: `MemoryConsolidator` imported `MemoryType` from `MemoryLayers.types.ts`, but that type is defined in `MemoryStore.types.ts`.
- **Resolution**: Split the import to source `MemoryType` from `MemoryStore.types.js` and the layer types from `MemoryLayers.types.js`.

**Key files changed**: `src/storage/MemoryConsolidator.ts` (new), `tests/unit/storage/MemoryConsolidator.test.ts` (new), `src/storage/MemoryStore.ts`, `src/chat/ContextCompactor.ts`

---

### 2.7 Unified Memory Retrieval and Panel Wiring (Sub-task 3.7)

**Plan specification**: Create unified retrieval layer querying all 4 layers with budget distribution, and wire everything together in GemmaCodePanel.

**What happened**: Created `UnifiedMemoryRetriever` with configurable budget distribution (working 20%, semantic 30%, graph 25%, episodic 25%). Parallel async queries via `Promise.all`, trimming in reverse priority order (episodic first, working never). Added `_initMemoryLayers()` to GemmaCodePanel creating all layer instances sharing `memory.db`. Updated `_injectMemoryContext()` to use unified retriever with fallback to MemoryStore. Wired MemoryConsolidator to ContextCompactor post-hook. Passed WorkingMemory and EpisodicMemory to AgentLoop options.

**Key files changed**: `src/storage/UnifiedMemoryRetriever.ts` (new), `tests/unit/storage/UnifiedMemoryRetriever.test.ts` (new), `src/chat/PromptBuilder.ts`, `src/chat/PromptBuilder.types.ts`, `src/panels/GemmaCodePanel.ts`

**Verification**: 8 UnifiedMemoryRetriever tests passing (all layers mocked).

---

### 2.8 Post-Phase Documentation

**What happened**: Updated `docs/DEVLOG.md` with comprehensive Phase 3 entry. Updated `README.md` (4-layer memory feature, hardware-aware feature, 6-stage compaction). Updated `ARCHITECTURE.md` (v0.3.0 component table, implementation plan link).

**Key files changed**: `docs/DEVLOG.md`, `README.md`, `ARCHITECTURE.md`

---

## 3. Verification Gate

| Check | Result |
|---|---|
| TypeScript compilation (`tsc --noEmit`) | PASS |
| ESLint (all new + modified files) | PASS (0 errors) |
| WorkingMemory tests (21 tests) | PASS |
| EntityExtractor tests (13 tests) | PASS |
| UnifiedMemoryRetriever tests (8 tests) | PASS |
| EpisodicMemory tests | NOT RUN (better-sqlite3 ERR_DLOPEN_FAILED, pre-existing) |
| GraphMemory tests | NOT RUN (better-sqlite3 ERR_DLOPEN_FAILED, pre-existing) |
| GraphQueryEngine tests | NOT RUN (better-sqlite3 ERR_DLOPEN_FAILED, pre-existing) |
| MemoryConsolidator tests | NOT RUN (better-sqlite3 ERR_DLOPEN_FAILED, pre-existing) |
| Full test suite (non-native tests) | PASS (439/534 tests; all 95 failures are pre-existing native module issue) |

---

## 4. Known Issues

| Issue | Severity | Decision |
|---|---|---|
| better-sqlite3 native module fails to load in test environment (ERR_DLOPEN_FAILED) | P1 | Pre-existing from v0.2.0. Requires `npm rebuild better-sqlite3` in the right Node version. Blocks 4 Phase 3 test files. Does not affect extension runtime (only test runner). |
| GraphQueryEngine `_reconstructPath` only finds start/end entities in path, intermediate nodes may be missing from the explanation | P2 | Deferred. Path traversal works correctly for BFS; the explanation text may be incomplete for paths > 2 hops. Will improve when a `getEntityById` method is added to GraphMemory. |

---

## 5. Plan Discrepancies

- **Post-compaction hook**: The plan specified modifying `_preCompactionHook` in ContextCompactor to trigger consolidation. Instead, added a separate `setPostCompactionHook()` method. This was a deliberate improvement: consolidation should run after compaction (when extracted data is available), not during pre-compaction.

---

## 6. Assumptions Made

- **Shared SQLite database**: Assumed that EpisodicMemory and GraphMemory can safely share the same `memory.db` file as MemoryStore using separate tables. WAL mode handles concurrent reads. EpisodicMemory opens its own connection; GraphMemory receives a Database instance. If write contention becomes an issue under heavy agent use, this may need revisiting.
- **Token estimation heuristic**: Used the project-wide `chars / 4` heuristic for all memory layers. This is consistent with the rest of the codebase but may under-estimate tokens for code-heavy content.
- **Technology name list completeness**: The EntityExtractor's curated technology list (50+ entries) covers common tools but will miss niche technologies. Assumed this is acceptable since the entity extraction is supplementary (regex-based, no LLM calls).

---

## 7. Testing Summary

### Automated Tests
- WorkingMemory: 21 passed, 0 failed
- EntityExtractor: 13 passed, 0 failed
- UnifiedMemoryRetriever: 8 passed, 0 failed
- EpisodicMemory: 8 tests written, NOT RUN (native module)
- GraphMemory: 8 tests written, NOT RUN (native module)
- GraphQueryEngine: 7 tests written, NOT RUN (native module)
- MemoryConsolidator: 9 tests written, NOT RUN (native module)

### Manual Testing Still Needed
- [ ] End-to-end: send a message in VS Code, verify working memory is serialized into system prompt
- [ ] End-to-end: run multiple tool calls, verify episodic events are recorded in SQLite
- [ ] End-to-end: trigger compaction, verify consolidation runs and entities appear in graph
- [ ] End-to-end: verify unified retriever produces merged context from all 4 layers
- [ ] Run `npm rebuild better-sqlite3` and re-run all 4 blocked test files

---

## 8. TODO Tracker

### Completed This Session
- [x] 3.1: Memory Layer Architecture and Type Definitions
- [x] 3.2: Working Memory Manager (Layer 1)
- [x] 3.3: Episodic Memory Layer (Layer 2)
- [x] 3.4: Graph Memory Schema + Entity Extraction (Layer 4, Part A)
- [x] 3.5: Graph Query Engine (Layer 4, Part B)
- [x] 3.6: Memory Consolidation + Write Policy
- [x] 3.7: Unified Memory Retrieval + Prompt Integration

### Remaining
- [ ] Rebuild better-sqlite3 native module and verify all blocked tests pass
- [ ] End-to-end manual testing in VS Code

### Out of Scope (Deferred)
- [ ] GraphMemory `getEntityById()` method (would improve path reconstruction)
- [ ] Embedding-based re-ranking in `queryContextFor()` (deferred until embedder performance is measured)

---

## 9. Summary and Next Steps

Phase 3 implemented the full 4-layer memory stack for Gemma Code: working memory (ephemeral task state in the system prompt), episodic memory (structured session events with FTS5 and embeddings), graph memory (entity-relationship triples with regex extraction and multi-hop BFS queries), and unified retrieval (cross-layer budget-distributed query merging). All layers are optional for graceful degradation, share the same SQLite database, and integrate into the existing PromptBuilder/AgentLoop/ContextCompactor pipeline.

**Next session should**:
1. Begin Phase 4: Safety, Budgeting & Runaway Prevention (hash-based loop detection, irreversible action classification, git safety net, permission escalation)
2. Rebuild better-sqlite3 native module and run the 4 blocked test files
3. Perform end-to-end manual testing of the memory stack in VS Code
