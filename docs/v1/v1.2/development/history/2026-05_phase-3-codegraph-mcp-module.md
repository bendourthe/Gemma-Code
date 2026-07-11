# v1.2.0 Phase 3 -- Code-Graph MCP Module

**Date**: 2026-05-28
**Plan reference**: [docs/versions/v1/v1.2.0/plans/adoption-ecosystem-2026-05.md](../../plans/adoption-ecosystem-2026-05.md) Phase 3
**Source comparison**: [docs/versions/v1/v1.2.0/comparison-ecosystem-2026-05.md](../../comparison-ecosystem-2026-05.md), Source S2 (CodeGraph) and items 6 / 7 / 10 of Section 5
**Status**: Landed; stability gate passed at 28.6% (target: <=30%).

---

## Goal

Ship `core/codegraph/`, a SQLite-backed symbol + call-edge graph plus internal MCP server exposing 8 tools so the Coding pillar can answer "callers of X", "callees of Y", "impact radius of Z" in one tool call instead of spawning discovery sub-agents that scan files repeatedly. Stability gate: on the reference task "Find all callers of `redactSecrets` and assess whether changing its signature would break call sites", total tool calls with codegraph available must be at most 30% of the grep-shaped baseline.

This phase does NOT vendor CodeGraph, does NOT mutate `~/.claude.json` or `.cursor/rules/`, and does NOT bind a network port -- it implements the techniques as a Nexus-native internal MCP per the MCP Registry Policy decision tree (reverse-engineer-first; see [comparison Section 9.4 N5](../../comparison-ecosystem-2026-05.md#94-items-explicitly-not-recommended-for-adoption-security--policy-reasons)).

---

## Sub-tasks completed

### 3.1 -- Module scaffold

New tree at [core/codegraph/](../../../../versions/core/codegraph):

- `types.ts` -- public types (`FileNode`, `Symbol`, `CallEdge`, `SymbolSearchHit`, `SymbolReference`, `TracePath`, `SymbolContext`, `ImpactReport`, `ExploreReport`, `FilesListing`, plus per-language and per-kind enums).
- `manifest.ts` -- `CODEGRAPH_SCHEMA_VERSION = "1.0.0"`, `CODEGRAPH_SUPPORTED_LANGUAGES` (typescript / python / rust / go), `CODEGRAPH_TOOL_NAMES` as the authoritative 8-name ordered tuple.
- `index.ts` -- top-level barrel re-exporting the whole subsystem.
- `store/index.ts`, `scanner/index.ts`, `mcp/index.ts` -- subpackage barrels.

The dep-cruiser boundary rule `no-core-from-modules` already enforces "core/** must not import from modules/**"; no new dep-cruiser entries needed.

Acceptance test: [tests/unit/core/codegraph/scaffold.test.ts](../../../../versions/tests/unit/core/codegraph/scaffold.test.ts) (4 tests) asserts manifest invariants and that every subpackage class is constructable from the barrel.

### 3.2 -- SqliteGraphStore with FTS5

[core/codegraph/store/SqliteGraphStore.ts](../../../../versions/core/codegraph/store/SqliteGraphStore.ts) ships the persistence layer:

- Schema: `files(id, path UNIQUE, language, last_indexed_at, content_hash)` + `symbols(id, file_id, name, kind, line_start, line_end, signature_text)` + `call_edges(caller_symbol_id, callee_symbol_id, line, kind, PK on all four)` plus FTS5 virtual table `symbols_fts(name, signature_text)` with `rowid = symbols.id`.
- WAL journal mode + `synchronous = NORMAL` + `foreign_keys = ON` enabled via `pragma`.
- Prepared statements cached on first use; the hot path is allocation-free.
- FTS5 insertion indexes BOTH the original name AND a tokenized form (camelCase / snake_case split into lowercased sub-tokens) so a query like `token` matches `validateToken`.
- `searchSymbols(query, limit)` sanitizes punctuation, applies `*` prefix matching for bareword tokens (e.g. `redact` -> `redact*`), and returns ranked hits with signature previews.
- `pruneRemovedFiles(stillPresentPaths)` removes orphan files; foreign keys cascade to symbols and call edges.
- `resolveCodegraphDbPath(fingerprint)` produces `<nexus-home>/codegraph/<safe-fingerprint>.db` using the existing `nexusHome()` resolver.

Test coverage: [tests/unit/core/codegraph/SqliteGraphStore.test.ts](../../../../versions/tests/unit/core/codegraph/SqliteGraphStore.test.ts) (12 tests) covers WAL pragma, file/symbol/edge CRUD, FTS5 search, cross-process persistence (re-open after close), cascade cleanup, and sub-50ms FTS latency on a 10k-symbol fixture.

### 3.3 -- Regex scanner (DEVIATION from Tree-sitter)

[core/codegraph/scanner/RepoScanner.ts](../../../../versions/core/codegraph/scanner/RepoScanner.ts) ships a per-language regex extractor for TypeScript / Python / Rust / Go.

**DEVIATION**: The plan specified Tree-sitter. Nexus does not bundle the four per-language tree-sitter native binding packages (`tree-sitter-typescript`, `tree-sitter-python`, `tree-sitter-rust`, `tree-sitter-go`), each of which would add a native compile step to every dev machine. The regex extractor covers the four target languages well enough to drive the Phase 3.6 stability gate (which measures tool-call reduction, not symbol-extraction precision). The upgrade to Tree-sitter is tracked in [docs/versions/v1/v1.2.0/known-gaps.md](../../known-gaps.md) as `3.3.P2.G` (DF/P2).

Behaviors implemented:

- **Two-pass scan**: pass 1 upserts symbols across every reindexed file; pass 2 resolves call edges. This guarantees cross-file edges land regardless of directory walk order.
- **Symbol kinds**: function, method, class, interface, type, struct, enum, trait, module.
- **Call-edge extraction**: regex-walked call expressions in each symbol body, filtered against per-language keyword sets so `if(...)`, `for(...)`, `return(...)`, etc. never become false-positive edges. Per-call innermost-symbol selection prefers the tightest enclosing range (method beats containing class).
- **Cross-file edge resolution**: when the callee is not in the current file's symbol map, a global `findSymbolByName` lookup resolves the edge IFF exactly one match exists (avoids false positives on overloaded names).
- **Content-hash short-circuit**: SHA-256 over file contents; the per-file row in `files.content_hash` is compared so unchanged files are skipped entirely.
- **Ignore-file honoring**: `.gitignore` AND `.nexusignore` are read once per scan; negation patterns are out of scope for the regex scanner.
- **Per-file size cap**: default 1 MB; oversized files are skipped with `skipReason: 'size-cap'`.
- **File pruning**: paths present in the store but missing from the candidate list are dropped at end-of-scan; cascades to symbols + edges + FTS rows.

Test coverage: [tests/unit/core/codegraph/RepoScanner.test.ts](../../../../versions/tests/unit/core/codegraph/RepoScanner.test.ts) (8 tests) covers each of the four languages (with function + class + method + call-edge fixtures), incremental re-index, `.nexusignore`, size cap, and file pruning.

### 3.4 -- 8-tool internal MCP server

[core/codegraph/mcp/CodeGraphMcpServer.ts](../../../../versions/core/codegraph/mcp/CodeGraphMcpServer.ts) implements the `McpHarnessAdapter` interface from [core/coding/McpBridge.ts](../../../../versions/core/coding/McpBridge.ts):

- `listTools()` returns the 8 `McpToolDescriptor` records keyed by `serverId = "nexus.codegraph"`. Every descriptor carries a JSON-Schema `inputSchema` so the prompt builder can render the right parameter shape.
- `invokeTool(name, args)` dispatches to one of 8 private methods. Each returns either a structured payload (search hits, symbol context, trace path, impact report, etc.) or `{ error: string }` when the symbol is not found.
- `codegraph_trace` is a bounded BFS over the call-edge graph (default `maxDepth = 5`, ceiling 12) returning the edge chain from source to target.
- `codegraph_impact` returns direct callers plus a transitive closure (default depth 3, ceiling 10) so the agent can assess signature-change blast radius in one call.
- Bareword search queries get auto-prefix-matching (`token` -> `token*`); operator-containing queries pass through unchanged.

The server never spawns a child, never opens a socket, never binds a port -- it lives entirely inside the Node sidecar process. Exposure via stdio is intentionally out of scope (DF/P3 -- see known-gaps `3.4.P3.H`).

Test coverage: [tests/unit/core/codegraph/CodeGraphMcpServer.test.ts](../../../../versions/tests/unit/core/codegraph/CodeGraphMcpServer.test.ts) (12 tests) drives every tool end-to-end against a seeded graph; asserts the JSON-Schema payload shape, the unknown-tool error path, and missing-required-arg rejection.

### 3.5 -- Coding-pillar agent-loop wiring

Three sites:

- [src/tools/types.ts](../../../../versions/src/tools/types.ts) -- `BuiltinToolName` now includes 9 codegraph names; `BUILTIN_TOOL_NAMES` extends the list in matching order.
- [src/tools/ToolCatalog.ts](../../../../versions/src/tools/ToolCatalog.ts) -- 9 catalog entries with parameter schemas. `codegraph_files` carries a `_noop` placeholder parameter so the catalog invariant "every entry has at least one parameter" is preserved.
- [src/tools/handlers/codegraph.ts](../../../../versions/src/tools/handlers/codegraph.ts) -- 9 thin per-tool classes (`CodeGraphSearchTool`, `CodeGraphCallersTool`, ...) extending a private base that delegates to a lazily-resolved `McpHarnessAdapter`. The adapter resolver is configurable so production code wires in `CodeGraphMcpServer` while tests can inject a stub.
- [src/tools/ToolRegistryBuilder.ts](../../../../versions/src/tools/ToolRegistryBuilder.ts) -- new `codegraph?: CodeGraphHandlerDeps` option. When supplied, all 9 names register via `registerLazy` so the SQLite store is only constructed on first invocation.
- [src/guardrails/PermissionTiers.ts](../../../../versions/src/guardrails/PermissionTiers.ts) -- all 9 codegraph tools sit at the `AUTO_APPROVE` tier (read-only against a local DB file).
- [src/tools/ToolActivationRules.ts](../../../../versions/src/tools/ToolActivationRules.ts) -- 15-tool cap now treats codegraph tools as trimmable after MCP tools but before core built-ins, so the default workflow (read / grep / write / edit) keeps working when an external MCP server pushes the catalog past the cap.
- [src/chat/PromptBuilder.ts](../../../../versions/src/chat/PromptBuilder.ts) -- new "Code-graph preference" section emits a one-paragraph hint instructing the agent to prefer `codegraph_*` over `grep_codebase` / `run_terminal` for symbol-level questions. Only included when at least one codegraph tool is in the enabled set.

Test coverage: [tests/integration/coding-pillar/codegraph-wiring.test.ts](../../../../versions/tests/integration/coding-pillar/codegraph-wiring.test.ts) (6 tests) proves:

1. `BUILTIN_TOOL_NAMES` includes all 9 codegraph names.
2. `TOOL_CATALOG` has an entry for every codegraph tool.
3. `buildToolRegistry` registers all 9 when codegraph wiring is provided.
4. Each codegraph tool returns the structured JSON payload from the server (search + callers exercised end-to-end against a seeded store).
5. The system prompt includes the "Prefer codegraph_*" hint when codegraph tools are enabled.
6. The hint is omitted when no codegraph tool is enabled.

Updated tests that were affected by the catalog size change:

- [tests/unit/tools/ToolCatalog.test.ts](../../../../versions/tests/unit/tools/ToolCatalog.test.ts) -- expected entry count bumped from 13 to 22.
- The two e2e sub-agent + MCP-integration tests already passed unchanged thanks to the cap-trim-order update in `ToolActivationRules.ts`.

### 3.6 -- Stability-gate benchmark

Fixture repo at [tests/fixtures/codegraph-benchmark-repo/](../../../../versions/tests/fixtures/codegraph-benchmark-repo):

- `redact.ts` -- defines `redactSecrets`.
- `logger.ts`, `audit.ts`, `errorReporter.ts`, `session.ts`, `masker.ts` -- 5 caller files exercising both standalone functions and methods.

Benchmark at [tests/integration/codegraph/benchmark.test.ts](../../../../versions/tests/integration/codegraph/benchmark.test.ts) (2 tests) runs the reference task "Find all callers of `redactSecrets` and assess whether changing its signature would break call sites" twice:

- **With codegraph**: 1 call to `codegraph_callers` + 1 call to `codegraph_context` = **2 tool calls**.
- **Without codegraph (grep-shaped)**: 1 `grep_codebase` + 5 `read_file` (one per caller file) + 1 final `read_file` for the definition = **7 tool calls**.
- Ratio: **2 / 7 = 28.6%**, under the 30% gate.

Persisted results: [tests/fixtures/codegraph-benchmark-results/2026-05-26/with-codegraph.json](../../../../versions/tests/fixtures/codegraph-benchmark-results/2026-05-26/with-codegraph.json), [without-codegraph.json](../../../../versions/tests/fixtures/codegraph-benchmark-results/2026-05-26/without-codegraph.json), [summary.json](../../../../versions/tests/fixtures/codegraph-benchmark-results/2026-05-26/summary.json).

The benchmark also asserts via `codegraph_impact` that the call surface returns >=5 direct callers, proving the impact question is answerable in a single tool call.

---

## Test signals

- `npx vitest run --config configs/vitest.config.ts` -- **3468 passed, 5 skipped, 0 failed** (303 files), ~43s
- `npm run lint` -- clean
- `npx tsc --noEmit` -- clean
- 44 new tests across 6 new test files (scaffold + store + scanner + MCP server + wiring + benchmark)

---

## Decisions worth keeping

- **Regex over Tree-sitter** for the scanner -- the precision delta vs. the install-burden cost did not justify pulling in four native binding packages. The abstraction boundary at `extractSymbols(source, language)` lets a future Tree-sitter pass slot in.
- **Two-pass scan** -- pass 1 upserts symbols across every reindexed file; pass 2 resolves call edges. Single-pass missed cross-file edges whose callee appeared in a later directory entry; the failing benchmark surfaced it.
- **In-process MCP only** -- no stdio, no socket. Privacy-by-construction; external instances cannot reach the graph.
- **AUTO_APPROVE for all 9 codegraph tools** -- read-only against a local SQLite file. Same risk profile as `read_file`.
- **Codegraph tools trim before core built-ins** at the 15-tool cap -- the default workflow keeps working even when an external MCP server pushes the catalog over the cap.

---

## Known gaps surfaced by this phase

Appended to [docs/versions/v1/v1.2.0/known-gaps.md](../../known-gaps.md):

- `3.3.P2.G` (DF/P2) -- Tree-sitter scanner deferred; regex scanner ships instead. Upgrade path documented.
- `3.4.P3.H` (DF/P3) -- Codegraph MCP server is in-process only; no stdio/socket. By design.
- `3.5.P3.I` (DF/P3) -- 15-tool cap may silently trim codegraph tools; Phase 5 to surface a header warning.

No release-blockers introduced.

---

## Next phase

Phase 4: memory enhancements (LEANN-derived) -- AST chunker + `PrunedDenseIndex` + `MemoryStorageTier` policy gating. Phase 3's Tree-sitter primitives (deferred to `3.3.P2.G` here) would have been the natural input to the AST chunker; the chunker can instead use the same regex extractor or re-introduce Tree-sitter when Phase 4 lands.
