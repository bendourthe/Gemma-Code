# v1.2.0 -- Known Gaps, Deferrals, and Carryovers

**Status**: live. v1.2.0 opens with the 2026-05 ecosystem-adoption track. Phase 1 (2026-05-27) shipped the skill-native foundation; Phase 2 (2026-05-28) shipped the Coding-pillar command-output compressor (`core/observability/CommandCompressor.ts`) with filter / group / truncate / dedupe strategies, tee-on-failure, and a benchmark stability gate; Phase 3 (2026-05-28) shipped the code-graph MCP subsystem under `core/codegraph/` (SQLite + FTS5 store, regex-based scanner for TS / Python / Rust / Go, 8 internal MCP tools, Coding-pillar wiring, and a stability-gate benchmark hitting 25% of the grep-shaped tool-call count); Phase 4 (2026-05-28) shipped the memory enhancements (AST-aware chunker, LEANN-derived `PrunedDenseIndex`, `MemoryStorageTier` policy gating, and a storage-size benchmark hitting 18.7% of Standard with 100% recall on the 2k-chunk CI fixture); Phase 5 (2026-05-28) shipped the agent-loop policy items (read-only explore sub-agent enforcement at `core/coding/SubAgentPolicy.ts` and wired into `src/agents/SubAgentManager`; path-scoped skills via the new `SkillRecord.pathScope` field plus `matchPathScope` in `core/skills/SkillCatalog.ts`; shared `.nexusignore` parser at `core/storage/NexusIgnore.ts` plus a per-tool `.nexus/permissions.deny` parser at `core/storage/PermissionsDeny.ts`; and the 13th lifecycle hook position `lifecycle.session.reflection` with reference implementation at `core/lifecycle/SessionReflectionHook.ts`). The known-gaps file is appended phase-by-phase; items move to `## 2. Resolved` when closed in a later phase; the `## 3. Summary` at the bottom is recomputed each pass.

**Audience**: v1.2.0 phase authors, code reviewer, future-cycle planners
**Last updated**: 2026-05-28 (Phase 5)
**Sibling reviews**: [docs/v1.1.0/known-gaps.md](../v1.1.0/known-gaps.md) (the upstream cycle gap log; carryforward open items remain in force during v1.2.0); [docs/v1.2.0/plans/adoption-ecosystem-2026-05.md](plans/adoption-ecosystem-2026-05.md) (the active adoption plan); [docs/v1.2.0/comparison-ecosystem-2026-05.md](comparison-ecosystem-2026-05.md) (the seven-source comparison this cycle's first track adopts).

**Cycle context**: v1.2.0 opens the post-v1.1.0 cycle with the 2026-05 ecosystem-adoption track. Phase 1 (this commit) is skill-native + policy only: two new Nexus-Hub skills (hallmark-design, html-output-conventions, with 4 self-contained HTML reference templates), a new "hooks-over-prompts" Critical Rule and inventory in AGENTS.md, and a 6-month AGENTS.md review cadence. No code surface in `core/` or `modules/` is touched in Phase 1 itself; the two scope expansions this run (sidecar IPC stubs and a desktop strict-null test guard) are recorded under `## 2. Resolved` below. Phases 2-7 of the adoption plan land the code-shaped items (command compression, code-graph MCP, memory enhancements, agent-loop policy, re-partials, stabilization).

Each entry has a severity tag:

- **P0** -- release-blocker for v1.2.0 (must close)
- **P1** -- should-fix in v1.2.0
- **P2** -- nice-to-have; documented for completeness
- **P3** -- out-of-scope for v1.2.0; explicitly recorded for future planning

Each entry has a category tag:

- **NI** (not implemented) -- a plan sub-task that was skipped
- **DF** (deferred) -- a plan sub-task explicitly deferred to a later phase / cycle
- **BG** (bug) -- a deviation that revealed a real defect
- **MT** (missing tests) -- a coverage shortfall
- **WN** (warning) -- a suppressed lint or runtime warning
- **QG** (quality gate) -- a Phase 7 gate the cycle author bypassed with "Proceed anyway"

---

## 1. Open Items

### 1.1.P2.A -- Nexus-Hub catalog index (data/skills.json + SKILL_INDEX.md) rebuild deferred (WN, P2)

- **Source phase**: Phase 1 (sub-tasks 1.1, 1.2)
- **Plan reference**: [adoption-ecosystem-2026-05.md](plans/adoption-ecosystem-2026-05.md) sub-tasks 1.1 ("Import Hallmark as a Nexus-Hub skill") and 1.2 ("HTML-output convention skill").
- **Reason**: This phase added `catalog/skills/developer-experience/hallmark-design/` and `catalog/skills/developer-experience/html-output-conventions/` (with 4 reference templates) to the sibling Nexus-Hub repo. Running `python infrastructure/tools/build_skills_catalog.py` (or `make build-catalog`) registers both new skills into `data/skills.json` (211 -> 213) and regenerates `data/SKILL_INDEX.md`. A full rebuild was attempted and produced a 2528-line diff because the committed catalog index had pre-existing drift (5 skills had been added and many descriptions edited in their `SKILL.md` files without a corresponding catalog rebuild; the committed `SKILL_INDEX.md` reported `Total: 206` while 211 actual SKILL.md files existed). To respect the "every changed line must trace to the user's request" scope rule and avoid bundling ~2500 lines of unrelated churn into a Phase 1 commit, the wholesale catalog regeneration was reverted; both new skills are committed as the two new directories only. The new skills pass `python scripts/validate_skills.py` cleanly and are picked up by the syncer's `buildManifest` walk (verified locally against `../Nexus-Hub/catalog/skills`).
- **Suggested next step**: A Nexus-Hub maintainer should run `make build-catalog` as a standalone hygiene commit on Nexus-Hub `main`, accepting the 7-skill index update (5 pre-existing + 2 new) plus the description reorderings. Once committed there, cut a Nexus-Hub release tag so the new skills can flow through `nexus skills sync` (see 1.1.P3.B below).

### 1.1.P3.B -- New Nexus-Hub skills require an upstream release to flow through `nexus skills sync` (DF, P3)

- **Source phase**: Phase 1 (sub-task 1.5 acceptance)
- **Plan reference**: [adoption-ecosystem-2026-05.md](plans/adoption-ecosystem-2026-05.md) sub-task 1.5 ("Verify: nexus skills sync succeeds and lists hallmark-design and html-output-conventions").
- **Reason**: The production `nexus skills sync` CLI in [bin/nexus.mjs](../../bin/nexus.mjs) constructs `DevAIHubSyncer` with default options, which resolves the latest GitHub release of `bendourthe/DevAI-Hub` and sparse-clones that tag (see [core/skills/DevAIHubSyncer.ts](../../core/skills/DevAIHubSyncer.ts) `defaultResolveLatestTag` -> `api.github.com/repos/.../releases/latest`). Newly-created local skills in `../Nexus-Hub` cannot appear via `sync` / `list` until they are pushed AND a release tag containing them is cut. In this environment the live sync exits with `upstream did not return tag_name` (no resolvable release for the configured upstream). The faithful local verification used in 1.5 is the syncer's own `buildManifest` over the local Nexus-Hub catalog, which enumerates 213 skills including both new entries -- that is the exact function `nexus skills list` renders from once an active tag is present.
- **Suggested next step**: After 1.1.P2.A above is committed in Nexus-Hub, push and cut a Nexus-Hub release tag (e.g. `v0.X.0`); then in this repo run `node bin/nexus.mjs skills sync --apply` followed by `node bin/nexus.mjs skills list` and confirm `hallmark-design` + `html-output-conventions` appear. No code change is required in this repo.

### 1.3.P2.C -- Hooks-over-prompts migrations deferred to Phase 5 (DF, P2)

- **Source phase**: Phase 1 (sub-task 1.3)
- **Plan reference**: [adoption-ecosystem-2026-05.md](plans/adoption-ecosystem-2026-05.md) sub-task 1.3 ("Do not modify any code yet -- the actual hook migrations happen during Phase 5").
- **Reason**: Phase 1.3 added the "hooks for deterministic automation" Critical Rule to AGENTS.md and authored an inventory at [.claude/agents/hooks-over-prompts-inventory.md](../../.claude/agents/hooks-over-prompts-inventory.md) ranking current prompt-based rules by enforcement-determinism gain. The inventory deliberately stops at "rank + recommend"; the actual hook implementations (commit-msg ASCII / no-attribution guards, per-invocation destructive-git guard, shell-description presence guard, pre-commit `deps:check` wiring) are explicitly deferred to Phase 5 of the adoption plan to keep Phase 1 scope to skill-native + policy items only.
- **Suggested next step**: Land the prioritized migrations in Phase 5 sub-tasks (5.1-5.5 of the adoption plan), starting with the HIGH-gain commit-msg hooks. The inventory file itself is the authoritative source for migration order.

### 1.x.P3.D -- Phase 7.4 (adoption ledger) populates the rest of this file (DF, P3)

- **Source phase**: meta (Phase 7 forward reference)
- **Plan reference**: [adoption-ecosystem-2026-05.md](plans/adoption-ecosystem-2026-05.md) sub-task 7.4 ("known-gaps closure for the adoption set ... For each of the 18 adoption items ... if completed, list it under Resolved").
- **Reason**: The plan's Phase 7.4 explicitly lands the per-item adoption ledger here (every one of the 18 adoption items recorded as Resolved or Open with the four standard fields). Phase 1 of this file establishes the structure; later phases (2-6) append their own items, and Phase 7.4 consolidates into the final adoption ledger.
- **Suggested next step**: No action in Phase 1. The adoption ledger lands in Phase 7.

### 2.4.P2.E -- Legacy `preToolHook` compressor is dead code in production (DF, P2)

- **Source phase**: Phase 2 (sub-task 2.4)
- **Plan reference**: [adoption-ecosystem-2026-05.md](plans/adoption-ecosystem-2026-05.md) sub-task 2.4 ("Modify the Coding-pillar Bash-tool handler ... to invoke `CommandCompressor.compress` ... between the subprocess return and the tool-call response").
- **Reason**: `src/tools/handlers/terminal.ts` no longer imports `compressToolOutput` from `src/tools/handlers/preToolHook.ts`; the new `core/observability/CommandCompressor` is the only production compression path. `preToolHook.ts` plus its 6-test unit suite (`tests/unit/tools/handlers/preToolHook.test.ts`) remain in the tree but are not exercised by any non-test caller. Per AGENTS.md "no adjacent-scope cleanup", the module was not removed in this phase to keep the diff traced to the user's request.
- **Suggested next step**: In a follow-up hygiene commit (or as part of the v1.2.0 Phase 7 stabilization sweep), delete `src/tools/handlers/preToolHook.ts` and its unit test, then re-run `npm run test`, `npm run lint`, and `npm run check-architecture`.

### 3.3.P2.G -- Tree-sitter scanner replaced with regex-based extractor (DF, P2)

- **Source phase**: Phase 3 (sub-task 3.3)
- **Plan reference**: [adoption-ecosystem-2026-05.md](plans/adoption-ecosystem-2026-05.md) sub-task 3.3 ("Implement `core/codegraph/scanner/TreeSitterScanner.ts` supporting TypeScript, Python, Rust, and Go ... parse with the appropriate Tree-sitter grammar").
- **Reason**: A Tree-sitter scanner requires four per-language native binding packages (`tree-sitter-typescript`, `tree-sitter-python`, `tree-sitter-rust`, `tree-sitter-go`) plus a node-gyp toolchain on every developer machine; none of those packages were already installed in this repo, so adopting them would have added a non-trivial native build burden. The shipped scanner (`core/codegraph/scanner/RepoScanner.ts`) is regex-based with per-language matchers (functions, classes, methods, structs, traits, enums, type-interfaces, plus best-effort call-edge extraction). Acceptance criteria for Phase 3 (4 language fixtures pass, 30s-of-tool-calls stability gate met) are all satisfied with the regex implementation -- the benchmark records the actual codegraph path as 2 tool calls vs. 8 for the grep-shaped baseline (25% of the count, well under the 30% gate). The regex extractor misses some edge cases that a Tree-sitter parse would catch (e.g. multi-line function declarations whose `(` is on the next line; methods declared via assignment to a property; computed method names); these are documented in the scanner's source comments. Two-pass extraction (symbols first, edges second) is implemented so cross-file edges resolve correctly regardless of directory walk order.
- **Suggested next step**: When a future cycle has the budget for the additional native deps, swap `RepoScanner` for a true Tree-sitter scanner behind the same `core/codegraph/scanner/index.ts` re-export so consumers do not need to change. The existing `extractSymbols(source, language)` surface is the abstraction boundary.

### 3.4.P3.H -- Codegraph MCP server is in-process only; no stdio/socket transport (DF, P3)

- **Source phase**: Phase 3 (sub-task 3.4)
- **Plan reference**: [adoption-ecosystem-2026-05.md](plans/adoption-ecosystem-2026-05.md) sub-task 3.4 ("The server runs in-process with the Node sidecar; it must not bind a network port").
- **Reason**: `CodeGraphMcpServer` implements the `McpHarnessAdapter` interface from `core/coding/McpBridge.ts` and is registered via the existing in-process harness path; it is intentionally NOT exposed via stdio or any socket, per the plan's acceptance criteria. An external MCP client (e.g. a separate IDE session) cannot reach it. This is by design and matches the privacy-by-construction stance. The DF entry exists for future cycles that may want to expose the codegraph tools to a sibling Nexus instance.
- **Suggested next step**: If a future cycle needs cross-instance access (e.g. a desktop shell and a CLI both querying the same graph), expose `CodeGraphMcpServer` via `src/mcp/McpServer.ts` style stdio with a read-only-by-default allowlist mirroring `DEFAULT_MCP_EXPOSED_TOOLS`. Do not add a network listener.

### 3.5.P3.I -- 15-tool cap may trim codegraph tools first when the catalog is large (DF, P3)

- **Source phase**: Phase 3 (sub-task 3.5)
- **Plan reference**: Internal -- introduced by Phase 3.5's wiring decision.
- **Reason**: `src/tools/ToolActivationRules.ts` now treats the 9 `codegraph_*` tools as trimmable when the total enabled-tool count exceeds 15 (sub-agent or large-MCP scenarios). MCP tools are trimmed first, then codegraph tools, then core tools are preserved untouched. This is a sensible default but means an agent loop with a busy external MCP server may lose access to codegraph tools without an obvious diagnostic. Users will see the catalog drop, but the activation `reasons` map includes a per-tool entry explaining the trim.
- **Suggested next step**: When Phase 5 (agent-loop policy) lands, add a one-line warning to the system prompt header when any codegraph tool was trimmed under the 15-tool cap so the user can react.

### 4.1.P2.J -- AST chunker reuses Phase 3's regex extractor (DF, P2)

- **Source phase**: Phase 4 (sub-task 4.1)
- **Plan reference**: [adoption-ecosystem-2026-05.md](plans/adoption-ecosystem-2026-05.md) sub-task 4.1 ("Implement `core/memory/chunkers/AstChunker.ts` that takes a file path + content and returns an array of `Chunk` records, each aligned to a Tree-sitter top-level node").
- **Reason**: Phase 4.1 ships `core/memory/chunkers/AstChunker.ts` per the plan's surface (one chunk per top-level symbol for TS / Python / Rust / Go; size-based fallback for other languages). The "AST-awareness" reuses `extractSymbols()` from `core/codegraph/scanner/RepoScanner.ts` -- the Phase 3 regex-based extractor -- rather than Tree-sitter, because no Tree-sitter native bindings are available in this repo. This inherits Phase 3.3's exact tradeoff: symbol boundaries are correct in the common cases the regex extractor handles, and the same edge cases (multi-line declarations, property-method assignments, computed names) cause occasional under-chunking. Class chunks envelop their methods (instead of producing per-method nested chunks) to avoid line-range duplication.
- **Suggested next step**: When 3.3.P2.G (the Tree-sitter scanner swap) lands in a future cycle, `AstChunker` automatically inherits the upgrade because it consumes `extractSymbols` -- no change required at the chunker layer.

### 4.2.P3.K -- PrunedDenseIndex graph build is O(N^2); ~50k node practical ceiling (DF, P3)

- **Source phase**: Phase 4 (sub-task 4.2)
- **Plan reference**: [adoption-ecosystem-2026-05.md](plans/adoption-ecosystem-2026-05.md) sub-task 4.2 ("API: same as `DenseIndex` ... storage representation is HNSW graph in CSR format with high-degree-preserving pruning ... on `search(query, k)`, embed the query, then traverse the HNSW graph, computing embeddings on-demand for visited nodes").
- **Reason**: `core/memory/PrunedDenseIndex.ts` ships a single-layer kNN graph (with reverse-edge symmetrization for connectivity), not multi-layer HNSW. The graph build at `compact()` is an all-pairs `O(N^2)` scan; on the 100k-chunk benchmark this would take minutes. The Phase 4.4 stability gate uses a 2k-chunk CI fixture (1/50th scale) so the integration test completes in ~2s; the 100k sweep is documented as a manual run (see MT entry 4.4.P2.L below). Search is best-first graph traversal with seed-sampling, frontier-by-score, and an LRU embedding cache (default 512 entries) -- close to HNSW's query routine but without the hierarchical fanout. Storage savings hit the headline gate (18.68% of `DenseIndex` on the 2k benchmark).
- **Suggested next step**: When a future cycle has the budget, port the graph build to a true multi-layer HNSW (e.g. via `hnswlib-node` already mentioned in the v1.1.0 DenseIndex header) so the index scales past ~50k nodes without quadratic compact time. The save/load file format already includes a `version` field for forward-compat.

### 4.3.P3.M -- Migration script ships as `.mjs` instead of `.ts` (DF, P3)

- **Source phase**: Phase 4 (sub-task 4.3)
- **Plan reference**: [adoption-ecosystem-2026-05.md](plans/adoption-ecosystem-2026-05.md) sub-task 4.3 ("Write a one-way migration script at `scripts/migrate-dense-index-to-pruned.ts`").
- **Reason**: The Nexus repo's `scripts/` convention is `.mjs` files that import from compiled `out/` -- `tsconfig.json` explicitly excludes `scripts/` from the `tsc` include set. A `.ts` script under `scripts/` would not be runnable without a separate compilation step. To keep the migration logic unit-testable while honoring the script convention, the migration function lives at `core/memory/migrateDenseToPruned.ts` (where the unit tests can import it) and `scripts/migrate-dense-index-to-pruned.mjs` is a thin CLI wrapper that imports the compiled JS.
- **Suggested next step**: If a future cycle migrates `scripts/` to TypeScript (e.g. via a dedicated `tsconfig.scripts.json`), rename the wrapper to `.ts` to match the plan's literal filename. The underlying function module stays unchanged.

### 4.4.P2.L -- 100k-chunk memory-tier benchmark is manual, not CI (MT, P2)

- **Source phase**: Phase 4 (sub-task 4.4)
- **Plan reference**: [adoption-ecosystem-2026-05.md](plans/adoption-ecosystem-2026-05.md) sub-task 4.4 ("Generate a 100k-chunk benchmark fixture by indexing a large public repo ... record on-disk bytes and recall@10 on a 100-query test set").
- **Reason**: The 100k-chunk fixture takes minutes to build and consumes hundreds of MB of tmpdir disk. Running it on every CI invocation would balloon the integration suite well past its current budget. The Phase 4 stability gate ships as a CI-friendly 2k-chunk smoke (`tests/integration/memory-tier/storage-benchmark.test.ts`) that exercises the same code paths and asserts the documented gate (storage <=20% of Standard, recall >=80%). The 100k variant is gated behind the `NEXUS_PHASE4_BENCH_SIZE=100000` environment variable and is documented in `tests/fixtures/memory-tier-benchmark-results/2026-05-26/README.md`. The Phase 7.2 storage-size benchmark sub-task is responsible for the canonical 100k run.
- **Suggested next step**: Phase 7.2 runs the full 100k sweep with the real transformer embedder and publishes the resulting recall + ratio numbers under `docs/v1.2.0/benchmarks/memory-storage-size-2026-05-26.md`.

### 4.x.P3.N -- HybridRetriever owns ingest only via the new `ingestFile()` helper (DF, P3)

- **Source phase**: Phase 4 (sub-task 4.1 wiring decision)
- **Plan reference**: [adoption-ecosystem-2026-05.md](plans/adoption-ecosystem-2026-05.md) sub-task 4.1 ("Wire `AstChunker` into `core/memory/HybridRetriever.ts` ingest path -- the hybrid retriever should call the AST chunker first, with the size chunker as fallback").
- **Reason**: The HybridRetriever existed pre-Phase-4 as a query-only façade; the actual memory ingest happened upstream in `MemoryHub.write()` (which calls `bm25.add(id, text)` + `dense.add(id, vec)` directly). Phase 4.1 adds a new `HybridRetriever.ingestFile(input)` helper that chunks via `AstChunker`, embeds (Standard tier) or stores text (Pruned tier), and adds chunks to both indexes. Existing pre-Phase-4 ingest call sites in `MemoryHub` and `WarmRebuildWorker` were NOT migrated to use the helper; migration would expand Phase 4's scope into the memory-hub call graph. The new helper is the seam Phase 5+ ingest call sites should pick up.
- **Suggested next step**: When the memory hub gains a code-aware ingest pathway (e.g. a "ingest workspace" command or a code-graph-driven background indexer), route through `HybridRetriever.ingestFile()` instead of calling `bm25.add` / `dense.add` directly. The helper handles both tiers cleanly.

### 2.4.P3.F -- Tee footer is embedded in the tool-result JSON instead of the next-turn system prompt (DF, P3)

- **Source phase**: Phase 2 (sub-task 2.4)
- **Plan reference**: [adoption-ecosystem-2026-05.md](plans/adoption-ecosystem-2026-05.md) sub-task 2.4 ("the system prompt for the next agent turn includes a one-line footer: `[Last command compressed; raw output available at <teePath> if needed.]` when `teePath` is set").
- **Reason**: The plan asks for the footer to be injected into the next-turn system prompt via `PromptBuilder`. The shipped wiring embeds the footer as a `footer` field inside the `run_terminal` tool-result JSON payload alongside `teePath` and `strategyApplied`. Functionally the model sees the path on the very next reasoning step (the JSON is part of the conversation history that feeds the next system prompt), so the tee path is reachable without an additional PromptBuilder edit. A literal PromptBuilder hook would have crossed the Coding-pillar agent-loop boundary, which is closer to Phase 5's "agent loop policy" surface.
- **Suggested next step**: When Phase 5 lands the read-only-exploration sub-agent enforcement and the 13th `session-reflection` hook position, also add a PromptBuilder section that surfaces the most recent tee footer in the next-turn system prompt header, and switch the tool-result JSON to omit `footer` once the PromptBuilder section is wired.

### 5.1.P2.O -- Explore-intent enforcement wired only at `src/agents/SubAgentManager`, not at the (future) modules/coding dispatch path (DF, P2)

- **Source phase**: Phase 5 (sub-task 5.1)
- **Plan reference**: [adoption-ecosystem-2026-05.md](plans/adoption-ecosystem-2026-05.md) sub-task 5.1 ("Modify the sub-agent dispatch layer ... so that sub-agents invoked with `intent: 'explore'` have a tool allowlist restricted to: Read, Glob, Grep, codegraph_* tools, and Bash only for commands matching a configurable allowlist of read-only commands").
- **Reason**: The policy module ships at `core/coding/SubAgentPolicy.ts` (pure, no I/O) and is wired through the v1.0.0 sub-agent dispatch entry point at [src/agents/SubAgentManager.ts](../../src/agents/SubAgentManager.ts) -- the only sub-agent dispatcher actually running in production today. The plan's reference to `modules/coding/` is forward-looking; the Coding-module engine still lives in `src/` during the one-cycle compat window per [AGENTS.md "Project Layout"](../../AGENTS.md). When the dispatch path moves to `modules/coding/` (tracked separately under v1.1.0 carryforward `1.4.P1.B`), the new dispatcher must call `evaluateExploreToolCall` and `lintExploreSpecialist` at the same wiring points -- those public surfaces are stable.
- **Suggested next step**: When `1.4.P1.B` lands the src -> modules/coding move, port the explore intent + policy wiring in `SubAgentManager.run` / `SubAgentManager._buildScopedRegistry` to the new dispatcher. The policy module is the abstraction boundary.

### 5.1.P2.P -- Explore policy is not yet enforced for MCP tools loaded at runtime (DF, P2)

- **Source phase**: Phase 5 (sub-task 5.1)
- **Plan reference**: [adoption-ecosystem-2026-05.md](plans/adoption-ecosystem-2026-05.md) sub-task 5.1 (tool allowlist: "Read, Glob, Grep, codegraph_* tools, and Bash only for commands matching ...").
- **Reason**: `EXPLORE_READONLY_TOOLS` in [core/coding/SubAgentPolicy.ts](../../core/coding/SubAgentPolicy.ts) explicitly enumerates the built-in tool surface (read_file / list_directory / grep_codebase / codegraph_* / web_search / fetch_page). Dynamic MCP tools loaded at runtime via the [core/coding/McpBridge.ts](../../core/coding/McpBridge.ts) harness are NOT auto-classified -- under the current policy, every MCP tool is rejected from an explore sub-agent. This is the safer-by-default behavior, but it means a user who legitimately wants `mcp:github/search_issues` to be available during exploration must extend the allowlist manually.
- **Suggested next step**: When Phase 6 (re-partial integrations) lands the LSP client, also extend the policy with a "read-only MCP tool" annotation derived from the MCP tool descriptor's input schema -- tools whose JSON schema has no write-capable verbs in their name (e.g. `create`, `update`, `delete`, `post`, `write`) should automatically join the explore allowlist. Until then, MCP tools are blocked under explore intent.

### 5.2.P3.Q -- PathScope filtering does not auto-reload skills mid-session in the live daemon (DF, P3)

- **Source phase**: Phase 5 (sub-task 5.2)
- **Plan reference**: [adoption-ecosystem-2026-05.md](plans/adoption-ecosystem-2026-05.md) sub-task 5.2 ("Add a method `reevaluatePathScope(currentPath: string)` that the agent loop calls when the editing focus changes, so a skill can become active mid-session as the agent moves into a relevant subtree").
- **Reason**: `InMemorySkillCatalog.reevaluatePathScope` ships and is tested -- it returns the visible set for a given path. The actual live wiring (have the Coding-pillar agent loop call `reevaluatePathScope(currentEditPath)` when the focus changes) is NOT included in Phase 5: the agent loop's "current edit path" is not currently surfaced as a hook, and exposing it would cross from `core/skills/` into the agent-loop boundary (`src/tools/AgentLoop.ts`) -- closer to a Phase 6+ concern. Skills authored with `pathScope` are still loaded correctly when the daemon starts in a CWD that matches; they just do not auto-activate mid-session yet.
- **Suggested next step**: When the Coding-pillar agent loop gains a per-turn "active edit path" projection (likely as part of the eventual sub-agent + sessions surface from the v1.1.0 Phase 11 plan), have it call `catalog.reevaluatePathScope(activeEditPath)` and diff the result against the previously-loaded set; activate / deactivate skills accordingly. The catalog surface is already in place.

### 5.3.P2.R -- `permissions.deny` parser ships but is not yet wired into any tool (WN, P2)

- **Source phase**: Phase 5 (sub-task 5.3)
- **Plan reference**: [adoption-ecosystem-2026-05.md](plans/adoption-ecosystem-2026-05.md) sub-task 5.3 ("Add `.nexus/permissions.deny` parsing for per-tool denials -- e.g. `Bash: rm -rf /*` denies Bash matching that pattern").
- **Reason**: The parser at [core/storage/PermissionsDeny.ts](../../core/storage/PermissionsDeny.ts) is fully implemented and unit-tested (parse + evaluate with literal, wildcard, and ** path patterns; tool-name wildcards; first-match-wins). It is currently a stand-alone module with no caller -- which `dependency-cruiser` correctly flags as `no-orphans`. The next-cycle wiring point is the `run_terminal` permission-gate path (and any other write-capable tool's pre-tool hook). The plan only required the parser surface plus tests; wiring it everywhere would have crossed into a separate per-tool guard concern.
- **Suggested next step**: When v1.2.0 Phase 7 stabilization (or a follow-up cycle) lands a unified pre-tool permission-gate hook, route every tool invocation through `evaluateDeny(toolName, subject, parsedDeny)` after the existing path-guard and ALLOWED_COMMANDS checks. The shared parser is ready.

### 5.3.P3.S -- Codegraph scanner still uses its own inline ignore parser instead of the shared module (DF, P3)

- **Source phase**: Phase 5 (sub-task 5.3)
- **Plan reference**: [adoption-ecosystem-2026-05.md](plans/adoption-ecosystem-2026-05.md) sub-task 5.3 ("The parsed exclusion list is honored by: ... (b) the code-graph scanner from Phase 3").
- **Reason**: Phase 5.3 ships the shared `.nexusignore` parser at [core/storage/NexusIgnore.ts](../../core/storage/NexusIgnore.ts) and wires it into `HybridRetriever.ingestFile` (memory ingest). The pre-existing inline ignore parser inside [core/codegraph/scanner/RepoScanner.ts](../../core/codegraph/scanner/RepoScanner.ts) (which was added during Phase 3.3) was NOT refactored to use the shared module -- both parsers produce equivalent behavior on the same `.nexusignore` content, but they live in two places. Per AGENTS.md "every changed line must trace directly to the user's request", a wholesale refactor of the codegraph scanner was deferred so the Phase 5.3 diff stayed tight to the plan's surface.
- **Suggested next step**: In a follow-up hygiene commit, replace the inline `loadIgnorePatterns` / `isIgnored` functions in `RepoScanner.ts` with `mergeIgnorePatterns(defaultIgnorePatterns(), parseIgnoreFile(content))` and `matchesIgnore` from `core/storage/NexusIgnore.ts`. Re-run the Phase 3 codegraph integration tests to confirm parity.

### 5.4.P3.T -- session-reflection hook is registered manually; no auto-wiring in the daemon yet (DF, P3)

- **Source phase**: Phase 5 (sub-task 5.4)
- **Plan reference**: [adoption-ecosystem-2026-05.md](plans/adoption-ecosystem-2026-05.md) sub-task 5.4 ("Provide one reference hook implementation under `.claude/agents/` that scans the transcript for 'user said X, I did Y wrong' patterns and emits a `proposed-agents-md-update` artifact at `<nexus-home>/reflections/<session-id>.md`").
- **Reason**: The 13th lifecycle event `lifecycle.session.reflection` is added to the `HookBus` union; the reference implementation at [core/lifecycle/SessionReflectionHook.ts](../../core/lifecycle/SessionReflectionHook.ts) exports `attachSessionReflectionHook(bus, opts)` and is fully unit-tested. The daemon-side automatic wiring (have the chat session emit the event when the user closes the session, then have the bootstrap call `attachSessionReflectionHook` once at daemon startup) is NOT included in Phase 5: the chat session's `end()` path lives in `src/chat/` and crosses into the v1.1.0 Phase 11 surface that the v1.2.0 cycle's compat window has not yet stabilized. The hook composes cleanly when a caller wires it; the integration test exercises that contract.
- **Suggested next step**: When the daemon bootstrap path is consolidated (likely during Phase 7 stabilization or in the v1.1.0 carryforward 1.4.P1.B src -> modules/coding move), call `attachSessionReflectionHook(hookBus)` once at session-construction time and emit `lifecycle.session.reflection` from the session-end handler in `core/coding/` (or wherever the session-end lifecycle is consolidated). Until then, the hook only fires when a test or operator wires it explicitly.

### Carryforward map (v1.1.0 -> v1.2.0)

Per the v1.1.0 closure note in [docs/v1.1.0/known-gaps.md](../v1.1.0/known-gaps.md) section header, every "Open" item in that file carries forward into the v1.2.0 cycle by code reference. Architectural items rolling into v1.2.0 are re-listed below by their original v1.1.0 code, with cross-references back; the per-item triage in v1.1.0 stands. No re-ingestion of the entries' bodies is required here -- consult [docs/v1.1.0/known-gaps.md](../v1.1.0/known-gaps.md) for the full text.

Open carryforward items (by v1.1.0 code, all currently P1 / P2 / DF unless noted):

- `1.1.P1.A` -- TypeScript project-references wiring deferred (DF/P1)
- `1.4.P1.B` -- src/ -> modules/coding/ wholesale move: 12 sub-trees remain open (DF/P1)
- (and any other Open entries in [docs/v1.1.0/known-gaps.md `## 1. Open Items`](../v1.1.0/known-gaps.md) at v1.1.0 close)

These do not block Phase 1 of the v1.2.0 adoption track but remain visible to phase planners.

---

## 2. Resolved

### 1.5.R1 -- Sidecar IPC handlers wired for the v1.1.0 Phase 11 surface (resolved in Phase 1)

- **Source phase**: Phase 1 (user-authorized scope expansion at the 1.5 quality gate)
- **Reason**: The desktop test suite had two pre-existing failures in [desktop/tests/sidecar-handlers.test.ts](../../desktop/tests/sidecar-handlers.test.ts) ("declared-but-unimplemented methods throw NotImplementedError" and "handlers covers every declared method"). Root cause: [desktop/sidecar/src/protocol.ts](../../desktop/sidecar/src/protocol.ts) `IPC_METHODS` declared five v1.1.0 Phase 11 methods (`coding.chat.autocomplete`, `mcp.list`, `mcp.invoke`, `settings.get`, `settings.set`) with `implemented: true` schemas, but [desktop/sidecar/src/handlers.ts](../../desktop/sidecar/src/handlers.ts) never wired them; vitest transpiles without typechecking, so the missing `Record<Method, HandlerFn>` keys surfaced at runtime.
- **Resolution**: Added NotImplementedError stub handlers for the five methods, matching the existing convention used by `models.install` / `image.generate` / etc. Downgraded the five `METHOD_SCHEMAS` entries to `{ request: NotImplementedAny, response: NotImplementedAny, implemented: false }` so `dispatch({})` reaches the stub instead of failing the strict request schema. The real request / response schemas (`CodingChatAutocompleteRequest`, `McpListRequest`, `McpInvokeRequest`, `SettingsGet/SetRequest`, plus their responses) remain exported for Phase 11 to adopt when it wires the autocomplete / MCP / settings backends.
- **Closed in**: Phase 1 (v1.2.0); 411 / 411 desktop tests pass, typecheck clean.

### 1.5.R2 -- Desktop tsc --noEmit strict-null errors in slashCommands.test.ts (resolved in Phase 1)

- **Source phase**: Phase 1 (user-authorized scope expansion at the 1.5 quality gate)
- **Reason**: `npm run typecheck` in `desktop/` failed with 4 pre-existing `TS2532: Object is possibly 'undefined'` errors in [desktop/tests/slashCommands.test.ts](../../desktop/tests/slashCommands.test.ts) (lines 104, 105, 113, 114) under `noUncheckedIndexedAccess`. Unrelated to the sidecar IPC fix; surfaced while verifying that the sidecar edits were themselves type-clean.
- **Resolution**: Replaced `codeQualityEntries[0].namespace` / `codeQualityEntries[1].namespace` with optional-chained access (`codeQualityEntries[0]?.namespace` etc.), matching the repo's "prefer optional chaining over manual null checks" TypeScript convention. The prior `expect(codeQualityEntries).toHaveLength(2)` precondition keeps the assertion meaningful.
- **Closed in**: Phase 1 (v1.2.0); desktop typecheck exits 0.

---

## 3. Summary

| Section | Count |
|---|---|
| Open items (Phases 1-5 entries) | 19 |
| Carryforward from v1.1.0 | 2 (re-listed by code; full text in v1.1.0 file) |
| Resolved in Phase 1 | 2 |
| Resolved in Phase 2 | 0 |
| Resolved in Phase 3 | 0 |
| Resolved in Phase 4 | 0 |
| Resolved in Phase 5 | 0 |
| Release blockers (P0) | 0 |
| Severity breakdown (Open, Phases 1-5) | P1: 0  P2: 9  P3: 10 |
