# Nexus v1.2.0 -- 2026-05 Ecosystem-Adoption Track (DRAFT)

**Status**: draft -- updated as later v1.2.0 tracks land
**Cycle opened**: 2026-05-26 (post-v1.1.0 close)
**First-track close**: 2026-05-28
**Desktop product version**: 1.2.0 (bumped from 1.1.0)
**Engine version (package.json)**: still managed by semantic-release on the v0.x line
**Plan**: [docs/versions/v1/v1.2.0/plans/adoption-ecosystem-2026-05.md](plans/adoption-ecosystem-2026-05.md)
**Known gaps**: [docs/versions/v1/v1.2.0/known-gaps.md](known-gaps.md)

## Highlights

The first v1.2.0 cycle track adopts 18 items from a seven-source ecosystem comparison covering LEANN, CodeGraph, RTK, Hallmark, and two Anthropic engineering articles. All seven plan phases landed on 2026-05-28.

### Coding pillar (the dominant economy wins)

* **Command-output compression** ([core/observability/CommandCompressor.ts](../../../core/observability/CommandCompressor.ts)) -- filter / group / truncate / dedupe strategies for every Coding-pillar Bash tool call, with tee-on-failure preserving raw output under `~/.nexus/logs/commands/`. The Phase 7 end-to-end benchmark shows **-93.76% token bytes** on the reference 5-step Coding-pillar workload.
* **Code-graph MCP module** ([core/codegraph/](../../../core/codegraph)) -- SQLite + FTS5 symbol-and-call-edge graph + 8 internal MCP tools (`codegraph_search`, `codegraph_context`, `codegraph_trace`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, `codegraph_node`, `codegraph_explore`, `codegraph_files`). Coding pillar prefers these over `grep` for symbol queries. The benchmark shows **-45.45% tool calls** on the same workload.
* **LSP client** ([core/coding/lsp/LspClient.ts](../../../core/coding/lsp/LspClient.ts)) -- symbol-precise `lsp_definition` and `lsp_references` MCP tools for TypeScript, Python, and Rust. Launches the language server lazily on first request; missing-binary detection surfaces a structured error.

### Memory subsystem

* **AST-aware chunker** ([core/memory/chunkers/AstChunker.ts](../../../core/memory/chunkers/AstChunker.ts)) -- one chunk per top-level symbol for the four languages Nexus itself uses; size-based fallback otherwise.
* **LEANN-derived PrunedDenseIndex** ([core/memory/PrunedDenseIndex.ts](../../../core/memory/PrunedDenseIndex.ts)) -- kNN graph + chunk text only; embeddings recomputed on the search path with a 512-entry LRU cache. Phase 7.2 benchmark shows **-81.32% on-disk bytes** vs the Standard tier at the 2k-chunk CI scale.
* **MemoryStorageTier policy** ([core/config/MemoryStorageTier.ts](../../../core/config/MemoryStorageTier.ts)) -- `Standard | Pruned`; defaults to `Standard` until per-host benchmarks justify the switch. One-way migration script at [scripts/migrate-dense-index-to-pruned.mjs](../../../scripts/migrate-dense-index-to-pruned.mjs).

### Agent-loop policy

* **Read-only explore sub-agents** ([core/coding/SubAgentPolicy.ts](../../../core/coding/SubAgentPolicy.ts)) -- sub-agents dispatched with `intent: 'explore'` are restricted to Read, Glob, Grep, codegraph_*, and a configurable read-only Bash allowlist. Edit / Write / side-effecting Bash calls are rejected.
* **Path-scoped skills** -- new `SkillRecord.pathScope` field plus `matchPathScope` in [core/skills/SkillCatalog.ts](../../../core/skills/SkillCatalog.ts); skills can declare include / exclude glob patterns and auto-activate only in matching directories.
* **`.nexusignore` and `.nexus/permissions.deny`** ([core/storage/NexusIgnore.ts](../../../core/storage/NexusIgnore.ts), [core/storage/PermissionsDeny.ts](../../../core/storage/PermissionsDeny.ts)) -- shared exclusion + per-tool deny parsers, honored across memory ingest, codegraph scanning, file-watching, and sub-agent dispatch.
* **13th lifecycle hook position** -- `lifecycle.session.reflection` fires once at session end with the transcript + files-written list. Reference implementation at [core/lifecycle/SessionReflectionHook.ts](../../../core/lifecycle/SessionReflectionHook.ts) emits a "proposed AGENTS.md update" artifact under `~/.nexus/reflections/`.

### Skill-native foundations

* **Hallmark anti-AI-slop design skill** imported into Nexus-Hub at `catalog/skills/developer-experience/hallmark-design/` (anti-slop gates + four verbs; theme catalog deliberately excluded per the single-product-one-theme principle).
* **HTML-output convention skill** at `catalog/skills/developer-experience/html-output-conventions/` -- decision table for HTML vs Markdown; four self-contained interactive templates including the "copy as JSON" round-trip pattern Phase 6.3 consumes.
* **Hooks-over-prompts Critical Rule** in [AGENTS.md](../../../AGENTS.md) plus a ranked migration inventory at [`.claude/agents/hooks-over-prompts-inventory.md`](../../../.claude/agents/hooks-over-prompts-inventory.md).
* **6-month AGENTS.md review cadence** with the next review scheduled for 2026-11-26 in [docs/todos.md](../../todos.md).

### Re-partial integrations

* **OS-native file watcher** ([core/storage/FileWatcher.ts](../../../core/storage/FileWatcher.ts)) -- 2-second debounce, `.nexusignore` honoring, dedup-by-path with delete-supersedes-modify semantics. Drives incremental codegraph re-scans via [WatchedRepoScanner](../../../core/codegraph/scanner/WatchedRepoScanner.ts).
* **Interactive HTML artifact host** ([desktop/src/components/InteractiveArtifact.tsx](../../../desktop/src/components/InteractiveArtifact.tsx)) -- renders any HTML payload containing a `<form data-nexus-artifact="true">` and auto-attaches a "Copy as JSON" button that serialises form state to the clipboard.

## Benchmarks

| Benchmark | Result | Report |
|---|---|---|
| Coding-pillar token usage | -93.76% tokens, -45.45% tool calls | [benchmarks/coding-pillar-token-usage-2026-05-26.md](benchmarks/coding-pillar-token-usage-2026-05-26.md) |
| Memory storage size (dense-only) | -81.32% (Pruned vs Standard) | [benchmarks/memory-storage-size-2026-05-26.md](benchmarks/memory-storage-size-2026-05-26.md) |
| Memory storage size (combined) | -79.42% (all subsystems) | (same report) |
| Codegraph stability gate (Phase 3.6) | 2 / 7 = 28.57% tool calls vs grep path | [tests/fixtures/codegraph-benchmark-results/2026-05-26/](../../../tests/fixtures/codegraph-benchmark-results/2026-05-26) |
| Compressor stability gate (Phase 2.5) | 21,121 / 76,538 = 27.6% bytes | [tests/fixtures/coding-pillar-benchmark-results/2026-05-26/](../../../tests/fixtures/coding-pillar-benchmark-results/2026-05-26) |
| Memory-tier storage gate (Phase 4.4) | 18.68% / 100% recall on 2k corpus | [tests/fixtures/memory-tier-benchmark-results/2026-05-26/](../../../tests/fixtures/memory-tier-benchmark-results/2026-05-26) |

## Items deliberately NOT adopted

See [comparison-ecosystem-2026-05.md Section 9.4](comparison-ecosystem-2026-05.md) Appendix A in the plan. Highlights: Multica (cloud + Docker / Postgres dependency conflicts with single-machine product shape), LEANN multimodal + cloud LLM backends (out of scope, no outbound calls), RTK opt-in telemetry (no-telemetry by construction), CodeGraph auto-writes to other agents' config files (agent-boundary violation), Hallmark 22-theme catalog (single shell theme), Multica pgvector (would force Postgres into the installer).

## Carried forward

29 open items remain in [docs/versions/v1/v1.2.0/known-gaps.md](known-gaps.md): 12 P2 + 17 P3. None are release blockers (zero P0 / P1). The largest deferrals:

* Tree-sitter swap for the regex-based codegraph scanner (`3.3.P2.G`) -- when the budget for the four native packages becomes available
* True multi-layer HNSW for `PrunedDenseIndex` (`4.2.P3.K`) -- when scaling past ~50k nodes
* Live worktree-vs-HEAD replay for the Phase 7.1 benchmark (`7.1.P2.A`) -- when a stable local-model CI fixture lands
* Daemon-side auto-wiring of the session-reflection hook (`5.4.P3.T`) -- when the chat session-end path is consolidated

Plus 2 v1.1.0 carryforward items (`1.1.P1.A` TypeScript project-references, `1.4.P1.B` src/ -> modules/coding move).

## Cycle status

This is the **first track** of the v1.2.0 cycle. The v1.1.0 cycle closed with 15 phases (the stabilization-plus-expansion wave); v1.2.0 may absorb additional tracks before its final release. The desktop product version was bumped from 1.1.0 to 1.2.0 to reflect the adoption-track close; the engine package.json continues to flow through semantic-release on the v0.x line.

## Tag policy

The git tag scheme is owned by `.github/workflows/semantic-release.yml`, which tags off the engine package.json. The desktop product version is **internal** -- no separate `v1.2.0` git tag is created from this commit. The engine-side semantic-release tag will land via CI when the next feat commit reaches `main`.

---

Generated on 2026-05-28 (Phase 7.4 cycle close). This file is the canonical v1.2.0 release-notes draft; the v1.2.0 final notes (when the full cycle closes with additional tracks) will supersede.
