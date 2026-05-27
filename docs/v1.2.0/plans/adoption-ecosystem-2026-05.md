# Plan -- 2026-05 Ecosystem Adoption (LEANN + CodeGraph + RTK + Hallmark + 2 Anthropic articles)

**Project**: Nexus
**Version**: v1.2.0 (opens the v1.2.0 cycle's first adoption track; derived from a comparison snapshot taken at v1.1.0 close on 2026-05-26)
**Slug**: adoption-ecosystem-2026-05
**Plan Type**: Feature / Enhancement (adoption of external techniques)
**Source comparison**: [../comparison-ecosystem-2026-05.md](../comparison-ecosystem-2026-05.md)
**Scope filter**: all (P0 + P1 + P2; no P3 items exist)
**Reverse-engineer-first**: true
**Created**: 2026-05-26
**Goal**: Adopt the 18 items from the 2026-05 ecosystem comparison into Nexus -- shipping skill-native wins first, then internal RE builds for code-graph + command compression + memory enhancements, then re-partial integrations, then a stabilization phase with measurable benchmarks for Coding-pillar token usage and vector-index storage size.

## Overview

This plan operationalizes the adoption set surfaced in [comparison-ecosystem-2026-05.md](../comparison-ecosystem-2026-05.md). Seven external sources were scanned -- LEANN (S1), CodeGraph (S2), the Anthropic "best practices in large codebases" article (S3), RTK (S4), Hallmark (S5), Multica (S6), and the Anthropic "unreasonable effectiveness of HTML" article (S7). Eighteen adoption items were retained across five skill-native, ten re-full, and three re-partial buckets. One source (Multica) plus six narrower sub-items were rejected and are recorded in the out-of-scope appendix.

Phase sequencing follows the MCP Registry Policy decision tree (reverse-engineer-first). See [Section 6.4 of the source comparison](../comparison-ecosystem-2026-05.md#64-recommendation-ordering) for the ordering rationale. **Phase 1 ships skill-native items first** because they unlock the framing for the code-shaped work that follows; **Phases 2-5 are re-full internal builds** sized one concern per phase; **Phase 6 is the smaller re-partial bucket**; **Phase 7 is stabilization plus benchmarks** that quantify whether the Coding-pillar token-diet and the vector-index storage-cut actually delivered.

**Carryforward note**: This adoption plan opens the v1.2.0 cycle, forward from the v1.1.0 closure on 2026-05-26 (Phase 15.9, see [docs/v1.1.0/known-gaps.md](../../v1.1.0/known-gaps.md)). Prior-version known-gaps from v1.0.0 are not re-ingested here -- they were already triaged in [docs/v1.1.0/known-gaps.md `## 4. Carryforward map`](../../v1.1.0/known-gaps.md) at v1.1.0 cycle close. The phases below are the v1.2.0 cycle's first adoption track; the Phase 7 known-gaps closure (sub-task 7.4) lands the adoption ledger under `docs/v1.2.0/known-gaps.md`.

**Success looks like**: (1) Hallmark anti-slop gates plus HTML-output conventions are active in Nexus-Hub and used by Coding-pillar render paths; (2) every Coding-pillar Bash tool call routes through `CommandCompressor` before reaching the model, with tee-on-failure preserving raw output on disk; (3) the Coding pillar can ask `codegraph_callers` / `codegraph_trace` / etc. via an internal MCP without spawning discovery sub-agents that scan files repeatedly; (4) the on-disk size of `~/.nexus/memory/dense/` shrinks by at least 80% on a 100k-chunk benchmark workload via pruned-graph storage with selective recomputation; (5) every changed surface is documented in [AGENTS.md](../../../AGENTS.md), [README.md](../../../README.md), and [ARCHITECTURE.md](../../../ARCHITECTURE.md); (6) end-to-end benchmarks demonstrate measurable token and tool-call reductions on the Coding pillar against a fixed baseline.

## Phases at a Glance

| Phase | Title | Outcome |
|-------|-------|---------|
| 1 | Skill-native foundation | Hallmark + HTML-output skills live in Nexus-Hub; hooks-over-prompts policy committed; AGENTS.md review cadence on the calendar |
| 2 | Command-output compression | `core/observability/CommandCompressor.ts` wraps every Coding-pillar Bash tool call; tee-on-failure preserves raw output under `~/.nexus/logs/commands/` |
| 3 | Code-graph MCP module | `core/codegraph/` ships with SQLite store, Tree-sitter scanner (TS/Python/Rust/Go), and 8 internal MCP tools wired into the Coding pillar |
| 4 | Memory enhancements | AST-aware chunker live; `PrunedDenseIndex` ships behind `MemoryStorageTier` policy with selective embedding recomputation |
| 5 | Agent loop policy | Read-only exploration sub-agent enforced; path-scoped skills; `.nexusignore`; reflection hook in 12-hook lifecycle |
| 6 | Re-partial integrations | OS-native file watcher abstraction lifted out of code-graph; LSP client for TS/Python/Rust; interactive HTML scaffolding for "copy as JSON" round-trip artifacts |
| 7 | Stabilization & benchmarks | Token-usage benchmark, storage-size benchmark, docs refresh, known-gaps closure for the adoption set |

---

## Phase 1: Skill-Native Foundation

**Goal**: Ship the four zero-code skill / policy items first to frame the conventions that the subsequent code-shaped phases will follow.
**Prerequisites**: None.
**Stability Gate**: All four skills / policy entries are committed; `nexus skills sync` pulls Hallmark and the HTML-output convention skill into a fresh repo; the new entry in [AGENTS.md](../../../AGENTS.md) "Critical Rules" is reviewed.

### Sub-tasks

#### 1.1 -- Import Hallmark as a Nexus-Hub skill

**Objective**: Bring the Hallmark anti-AI-slop design skill into the Nexus-Hub skill catalog so Coding-pillar UI generation and desktop-shell tasks can opt into the 65+ anti-pattern gates and the four verbs (default build / `audit` / `redesign` / `study`).

**Prompt**:
> Adopt the Hallmark design skill into Nexus-Hub. Source: https://github.com/Nutlope/hallmark (MIT, by Together AI). Read its `SKILL.md` and `references/` directory. Create a new skill at `catalog/skills/developer-experience/hallmark-design/SKILL.md` in the [Nexus-Hub repo](https://github.com/bendourthe/Nexus-Hub) (sibling of Nexus). Preserve Hallmark's anti-slop gate list and the four verbs (default / `audit` / `redesign` / `study`); **do not import the 22-theme catalog** -- Nexus is a single product with one shell theme, per [comparison-ecosystem-2026-05.md Section 9.4 N6](../comparison-ecosystem-2026-05.md#94-items-explicitly-not-recommended-for-adoption-security--policy-reasons). Include attribution to Hallmark + Together AI in the skill front matter. After importing, run `nexus skills sync` from the Nexus repo to verify the skill loads under the Nexus skill catalog. Acceptance criteria: skill appears in `nexus skills list`; `audit` verb invokable from the Coding pillar; theme catalog explicitly *excluded* and noted in the SKILL.md "scope excluded" section. Do not modify any code under `core/` or `modules/`.

---

#### 1.2 -- HTML-output convention skill

**Objective**: Codify the "prefer HTML over Markdown for human-facing artifacts" convention from S7 as a portable Nexus-Hub skill so Coding-pillar review tooling, the session replay timeline, and the operator-actions dashboard share one output discipline.

**Prompt**:
> Create a new skill at `catalog/skills/developer-experience/html-output-conventions/SKILL.md` in the [Nexus-Hub repo](https://github.com/bendourthe/Nexus-Hub). The skill codifies the actionable insights from https://claude.com/blog/using-claude-code-the-unreasonable-effectiveness-of-html. Required content: (a) the *when to use HTML vs Markdown* decision table -- HTML for specs with N-way comparisons, code-review diffs, design prototypes, incident reports, and any artifact over ~100 lines; Markdown for short notes, README front matter, and commit messages; (b) four reference templates -- grid comparison layout, annotated diff display with color-coded severity margins, interactive tuning interface with "copy as JSON" controls, tabbed organization for long documents; (c) the anti-patterns -- no ASCII diagrams (use SVG), no defaulting to Markdown when an HTML artifact would actually be read. **Do not include** any reference to dollar-cost token savings -- Nexus runs on local models. Cite [README.md L88 "Privacy by construction"](../../../README.md) when discussing where these artifacts may persist. Acceptance criteria: skill appears in `nexus skills list`; the four templates are runnable inline (i.e. self-contained HTML); skill front matter cross-references the Hallmark skill so they compose. Do not modify any code under `core/` or `modules/`.

---

#### 1.3 -- Hooks-over-prompts policy in AGENTS.md

**Objective**: Add a Critical Rule to [AGENTS.md](../../../AGENTS.md) that codifies S3's "hooks for deterministic automation rather than prompt-based reminders" guidance, plus an inventory in `.claude/agents/` of any prompt-based reminders that should be converted to hooks during subsequent phases.

**Prompt**:
> Edit [AGENTS.md](../../../AGENTS.md) "Critical Rules" section to add one rule: **"Use hooks for deterministic automation (lint, format, pre-commit, file-write guards). Use prompts only for non-deterministic guidance (cognitive workflow, code style, communication tone). If a rule can be enforced by a script that runs without the model in the loop, ship it as a hook, not as a prompt."** Add an accompanying inventory at `.claude/agents/hooks-over-prompts-inventory.md` listing every current prompt-based rule in [AGENTS.md](../../../AGENTS.md) that could plausibly move to a hook; rank by enforcement-determinism gain. Source: https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start, item 21 in the [comparison report's Section 5](../comparison-ecosystem-2026-05.md#5-relevance-analysis-41-insights-mapped-against-nexus). Acceptance criteria: edit lints clean under any existing AGENTS.md style checks; inventory is referenced from the new Critical Rule. Do not modify any code yet -- the actual hook migrations happen during Phase 5.

---

#### 1.4 -- Scheduled AGENTS.md review cadence

**Objective**: Codify the S3 recommendation to review [AGENTS.md](../../../AGENTS.md) every 3-6 months for model-version drift, since older prompt workarounds may now block beneficial new behaviors.

**Prompt**:
> Add a recurring task to [docs/todos.md](../../../docs/todos.md) at the bottom (or under an existing "Recurring obligations" section if one exists): **"Review AGENTS.md against current model behavior every 6 months -- next review due 2026-11-26."** Add the same item as a new section in [AGENTS.md](../../../AGENTS.md) "Cognitive Workflow" titled `## AGENTS.md review cadence` with one sentence: "AGENTS.md is reviewed every 6 months against current model behavior; the next scheduled review is 2026-11-26. See [docs/todos.md](docs/todos.md) for the canonical date." Source: comparison item 20 ([Section 5](../comparison-ecosystem-2026-05.md#5-relevance-analysis-41-insights-mapped-against-nexus)). Acceptance criteria: both files reference each other; the next-review date is consistent in both. No code changes.

---

#### 1.5 -- Phase 1 Testing and Stabilization

**Objective**: Verify the four skill / policy items integrate cleanly and that no existing test in the Nexus repo regresses.

**Prompt**:
> Run the full Nexus test suite (`npm run test`, `npm run lint:shell`, `npm run test:shell`). Verify: (a) `nexus skills sync` succeeds and lists `hallmark-design` and `html-output-conventions` from Nexus-Hub; (b) any AGENTS.md-style lint passes with the new Critical Rule; (c) [docs/todos.md](../../../docs/todos.md) parses cleanly under the project's todo lint (if one exists); (d) no test under `tests/` regresses. Fix any failures. After all checks pass, run `/generate-session-history` to document Phase 1.

---

### Phase 1 Exit Checklist

- [ ] Hallmark skill imported into Nexus-Hub `catalog/skills/developer-experience/hallmark-design/` (theme catalog excluded)
- [ ] HTML-output convention skill in Nexus-Hub `catalog/skills/developer-experience/html-output-conventions/`
- [ ] [AGENTS.md](../../../AGENTS.md) Critical Rules updated; inventory committed at `.claude/agents/hooks-over-prompts-inventory.md`
- [ ] [docs/todos.md](../../../docs/todos.md) carries 2026-11-26 review reminder
- [ ] All tests passing; lint clean
- [ ] Session history generated
- [ ] Ready to advance to Phase 2

---

## Phase 2: Command-Output Compression

**Goal**: Wrap every Coding-pillar Bash tool call in a compression layer (filter / group / truncate / dedupe) that reduces context bloat before output reaches the local model, with tee-on-failure preserving raw output so the model can still inspect on retry.
**Prerequisites**: Phase 1 complete (the HTML-output skill informs how compressed output is rendered; the hooks-over-prompts policy frames where the compressor lives).
**Stability Gate**: A reference Coding-pillar session running `cargo test --workspace`, `npm run test`, and `git status` end-to-end consumes at least 50% fewer context tokens than the same session without the compressor active, measured against a fixed-seed agent-loop transcript.

### Sub-tasks

#### 2.1 -- Scaffold CommandCompressor module

**Objective**: Create the module layout, manifest, and integration seam for the compressor under [core/observability/](../../../core/observability/), without yet implementing the four strategies.

**Prompt**:
> Create a new module `core/observability/CommandCompressor.ts` (alongside the existing [`redactSecrets.ts`](../../../core/observability/redactSecrets.ts)) with the following surface: `class CommandCompressor` with `compress(command: string, rawOutput: string, exitCode: number): CompressedOutput` and `tee(command: string, rawOutput: string): string` (returns the on-disk tee path). Define the `CompressedOutput` type as `{ rendered: string; originalBytes: number; compressedBytes: number; strategyApplied: 'filter' | 'group' | 'truncate' | 'dedupe' | 'passthrough'; teePath: string | null }`. Add a `CommandStrategyRegistry` map from command name (e.g. `git`, `npm`, `cargo`, `pytest`, `eslint`, `grep`, `ls`, `cat`) to a strategy descriptor. **Stub** each strategy implementation -- the actual logic ships in 2.2. Add `core/observability/__tests__/CommandCompressor.test.ts` with placeholder describe blocks for each strategy. Source: https://github.com/rtk-ai/rtk; comparison items 25-27 ([Section 5](../comparison-ecosystem-2026-05.md#5-relevance-analysis-41-insights-mapped-against-nexus)). **Do not** copy any binary from RTK; **do not** match RTK's PATH-binary install pattern; **do not** add an opt-in telemetry path (Nexus is no-telemetry per [comparison Section 9.4 N4](../comparison-ecosystem-2026-05.md#94-items-explicitly-not-recommended-for-adoption-security--policy-reasons)). Acceptance criteria: module compiles; placeholder tests pass; module appears in `tsconfig.json` paths if needed.

---

#### 2.2 -- Implement four compression strategies

**Objective**: Implement the four strategies (filter, group, truncate, dedupe) per RTK's documented heuristics, ported to TypeScript.

**Prompt**:
> Implement the four compression strategies stubbed in 2.1. (a) **Filter**: for `git status` / `git diff` / `git log`, retain modified-file lines and drop progress / ANSI / hint lines; for `grep -r`, retain match lines and drop "Binary file ... matches" without a path component; for `ls`, retain entries and drop totals / blank lines. (b) **Group**: for `npm install` and `cargo build`, collapse "X compiling", "X compiled", and "X warnings emitted" into one line per crate / package with a count. (c) **Truncate**: for any output exceeding 10 KB, keep the first 200 and last 50 lines plus a `[... N lines elided; see tee at <path> ...]` separator. (d) **Dedupe**: for `pytest`, `vitest`, `jest`, collapse repeated identical lines (e.g. "PASSED tests/x.test.ts") into one line with `(xN)` suffix. Each strategy must be a pure function: `(rawOutput: string, command: string) => string`. Reference RTK's README for the per-command heuristics: https://github.com/rtk-ai/rtk. Add full test coverage in `core/observability/__tests__/CommandCompressor.test.ts` with at least one positive and one negative case per strategy. Acceptance criteria: all tests pass; each strategy reduces a fixture output by at least 40% on its representative command.

---

#### 2.3 -- Tee-on-failure to disk

**Objective**: Preserve raw output on disk whenever a command fails, so the agent can inspect the full output on retry without re-running the command.

**Prompt**:
> Implement `CommandCompressor.tee(command, rawOutput)`. The function writes raw output to `<nexus-home>/logs/commands/<ISO-timestamp>-<command-slug>-<short-hash>.log`, returns the absolute path, and registers the path with the trace dashboard if it is running. The tee path is *always* emitted by `compress(...)` when `exitCode !== 0`, regardless of strategy applied; on success, tee is *only* emitted when the truncate strategy elided more than 100 lines. Use the existing nexus-home resolution from [core/storage/](../../../core/storage/) (do not hard-code `~/.nexus`). Add a retention policy: prune tee files older than 14 days at sidecar startup. Add tests for: (a) success path, no truncation -> no tee; (b) success path with truncation -> tee written and path emitted; (c) failure path, no truncation -> tee written and path emitted; (d) sidecar-startup retention prune. Source: RTK README, "tee mode" section. Acceptance criteria: tee files never exceed 14 days; tee path is part of `CompressedOutput`; trace dashboard surface in [desktop/](../../../desktop/) is informed but not required to render in this sub-task.

---

#### 2.4 -- Wire CommandCompressor into the Coding pillar Bash tool

**Objective**: Route every Coding-pillar Bash tool invocation through `CommandCompressor` before the model sees output, with the compressed `rendered` string going to the model and the tee path being injected into the system prompt as a fallback inspection target.

**Prompt**:
> Modify the Coding-pillar Bash-tool handler (locate it under [modules/coding/](../../../modules/coding/) -- the engine is in `src/` during the one-cycle compat window per [AGENTS.md "Project Layout"](../../../AGENTS.md)) to invoke `CommandCompressor.compress(command, rawOutput, exitCode)` between the subprocess return and the tool-call response. The response that reaches the model is `CompressedOutput.rendered`; the system prompt for the next agent turn includes a one-line footer: `[Last command compressed; raw output available at <teePath> if needed.]` when `teePath` is set. The compressor is a no-op for any command not in the `CommandStrategyRegistry`. Add an integration test under `tests/integration/coding-pillar/` that runs a synthetic Bash tool sequence (`git status` -> `npm test` -> `grep -r foo .`) and asserts that the compressed bytes are less than 60% of the raw bytes total. Acceptance criteria: integration test passes; no regression in existing Coding-pillar tests; sidecar-side IPC schema for the tool response includes the `teePath` and `strategyApplied` fields.

---

#### 2.5 -- Phase 2 Testing and Stabilization

**Objective**: Run the full benchmark fixture and verify the 50% token-reduction stability gate is met.

**Prompt**:
> Generate a fixed-seed agent-loop transcript by running a reference Coding-pillar session against a checked-in fixture repo (`tests/fixtures/coding-pillar-benchmark-repo/`) with the prompt "Run the full test suite, then summarize failures." Record total tokens consumed by tool-call outputs both **with** `CommandCompressor` active and **without** (by toggling the registry to empty). Assert: total tool-call output tokens with the compressor active are at most 50% of without. Persist both transcripts under `tests/fixtures/coding-pillar-benchmark-results/2026-05-26/`. Run the full Nexus test suite and the Coding-pillar integration tests; fix any regressions. After all tests pass, run `/generate-session-history` to document Phase 2.

---

### Phase 2 Exit Checklist

- [ ] `core/observability/CommandCompressor.ts` shipped with 4 strategies
- [ ] Tee-on-failure writes under `<nexus-home>/logs/commands/` with 14-day retention
- [ ] Coding-pillar Bash tool routes through the compressor
- [ ] Integration test asserts >=50% token reduction on the benchmark
- [ ] No telemetry path added (verify by grep)
- [ ] All tests passing; lint clean
- [ ] Session history generated
- [ ] Ready to advance to Phase 3

---

## Phase 3: Code-Graph MCP Module

**Goal**: Ship `core/codegraph/` -- a SQLite-backed symbol-and-call-edge graph plus internal MCP server exposing 8 tools for the Coding pillar to call before it spawns discovery sub-agents that scan files. This is the largest single item in the adoption set and the biggest projected win for Coding-pillar context economy.
**Prerequisites**: Phase 2 complete (the compressor reduces noise from Tree-sitter / FTS scans during indexing).
**Stability Gate**: On a Nexus self-index benchmark, a reference task ("Find all callers of `redactSecrets` and assess whether changing its signature would break call sites") completes with **at most 30% of the tool calls** that the same task takes on the current main branch without `codegraph_*` tools available.

### Sub-tasks

#### 3.1 -- Scaffold core/codegraph module layout

**Objective**: Create the package layout, manifest, and integration seam under `core/codegraph/` without implementing the scanner or store yet.

**Prompt**:
> Create a new module `core/codegraph/` with the following files: `index.ts` (public surface), `types.ts` (interfaces for `Symbol`, `CallEdge`, `FileNode`, `GraphQuery`, `GraphResult`), `manifest.ts` (semver + supported-language list), `scanner/index.ts` (placeholder), `store/index.ts` (placeholder), `mcp/index.ts` (placeholder), and `__tests__/scaffold.test.ts` (smoke test asserting all four placeholders import cleanly). Update [configs/dependency-cruiser.cjs](../../../configs/dependency-cruiser.cjs) to allow `core/codegraph/` and to enforce that `modules/coding/` may import `core/codegraph/` but `core/codegraph/` must NOT import `modules/coding/` -- this matches the existing boundary rule from [AGENTS.md "Project Layout"](../../../AGENTS.md). Add `core/codegraph/` to the `tsconfig.json` paths if needed. **Do not** mutate `~/.claude.json`, `.cursor/rules/`, or any other agent's config files -- this is explicitly prohibited per [comparison Section 9.4 N5](../comparison-ecosystem-2026-05.md#94-items-explicitly-not-recommended-for-adoption-security--policy-reasons). Acceptance criteria: scaffold test passes; module appears in dep-cruiser output without violations.

---

#### 3.2 -- SQLite-backed graph store with FTS5

**Objective**: Implement the persistence layer -- SQLite schema for symbols + call edges + files, FTS5 index for full-text symbol-name search, WAL mode for concurrent reads.

**Prompt**:
> Implement `core/codegraph/store/SqliteGraphStore.ts` using `better-sqlite3` (already a Nexus dep per [Phase 5 hybrid retrieval](../../v1.1.0/plans/phase-05-hybrid-retrieval-and-local-embedder.md)). Schema: `symbols(id, file_id, name, kind, line_start, line_end, signature_text)`, `files(id, path, last_indexed_at, content_hash)`, `call_edges(caller_symbol_id, callee_symbol_id, line, kind)`, plus FTS5 virtual table over `symbols.name` and `symbols.signature_text`. Open the DB in WAL mode. Persist at `<nexus-home>/codegraph/<repo-fingerprint>.db` (use the existing nexus-home resolution from [core/storage/](../../../core/storage/)). API: `class SqliteGraphStore` with `upsertFile`, `upsertSymbol`, `upsertCallEdge`, `findSymbolByName`, `findCallersOf`, `findCalleesOf`, `searchSymbols(ftsQuery)`, `pruneRemovedFiles`. Add full unit-test coverage at `core/codegraph/__tests__/SqliteGraphStore.test.ts`. Source: comparison items 6, 7, 10 ([Section 5](../comparison-ecosystem-2026-05.md#5-relevance-analysis-41-insights-mapped-against-nexus)). Acceptance criteria: all CRUD operations covered; FTS5 query returns results in sub-50ms on a 10k-symbol fixture; the store's on-disk file persists across process restarts.

---

#### 3.3 -- Tree-sitter scanner for TypeScript / Python / Rust / Go

**Objective**: Implement the scanner that walks a repo, parses each source file with Tree-sitter, extracts symbol declarations + call edges, and writes them into the graph store.

**Prompt**:
> Implement `core/codegraph/scanner/TreeSitterScanner.ts` supporting TypeScript, Python, Rust, and Go (the four languages Nexus itself uses; other languages added on demand). For each file: (a) read content, compute SHA-256, skip if hash matches the store's `files.content_hash`; (b) parse with the appropriate Tree-sitter grammar; (c) extract symbols (functions, classes, methods, types) into `symbols`; (d) extract call edges by walking call-expression nodes and resolving identifiers via in-scope declarations -- best-effort, no cross-file dataflow analysis; (e) `upsertFile` + `upsertSymbol` + `upsertCallEdge` per parsed node. The scanner respects `.gitignore` AND the new `.nexusignore` (placeholder for Phase 5) AND a size cap (default 1 MB per file, configurable). Add tests at `core/codegraph/__tests__/TreeSitterScanner.test.ts` covering each of the four languages with a small fixture file. Source: comparison item 6 ([Section 5](../comparison-ecosystem-2026-05.md#5-relevance-analysis-41-insights-mapped-against-nexus)). Acceptance criteria: scanner can index the Nexus repo end-to-end in under 30 seconds; the store contains at least 1000 symbols after indexing; subsequent re-indexes are incremental (only re-parse files whose hash changed).

---

#### 3.4 -- Internal MCP tools: 8-tool surface

**Objective**: Expose the eight `codegraph_*` tools as an internal MCP server registered with the existing Nexus MCP harness.

**Prompt**:
> Implement `core/codegraph/mcp/CodeGraphMcpServer.ts` exposing exactly these eight tools (signatures per [comparison Section 3.2](../comparison-ecosystem-2026-05.md#32-s2--codegraph)): `codegraph_search(query: string)`, `codegraph_context(symbolName: string, depth: number)`, `codegraph_trace(fromSymbol: string, toSymbol: string)`, `codegraph_callers(symbolName: string)`, `codegraph_callees(symbolName: string)`, `codegraph_impact(symbolName: string)`, `codegraph_node(symbolName: string)`, `codegraph_explore(symbolNames: string[])`, `codegraph_files()`. Wire each to the corresponding `SqliteGraphStore` query method. Register the MCP server with the existing Nexus MCP harness (locate the registration entry point in [core/](../../../core/) -- it shipped in v1.0.0 per [README.md L56](../../../README.md)). The server runs **in-process** with the Node sidecar; it must not bind a network port. Add integration tests at `tests/integration/codegraph/` for each of the eight tools. Acceptance criteria: each tool callable from the Coding pillar; integration tests pass; no listening socket appears when the sidecar starts (verify via netstat in test).

---

#### 3.5 -- Wire codegraph tools into the Coding pillar agent loop

**Objective**: Make the Coding-pillar agent loop aware of the `codegraph_*` tools so it prefers them over Bash + grep for symbol-level questions.

**Prompt**:
> Modify the Coding-pillar agent loop's tool-selection prompt (under [modules/coding/](../../../modules/coding/) -- engine still in `src/` during the compat window) to include the eight `codegraph_*` tools in the available-tools list, with a one-line description per tool. Add a system-prompt hint at the start of each Coding-pillar session: "Prefer `codegraph_*` over `grep` / `Bash` when the question is about symbol definitions, callers, callees, or impact radius." Add a regression test at `tests/integration/coding-pillar/codegraph-preference.test.ts` that feeds the agent the prompt "Find all callers of `redactSecrets`" and asserts the first tool call is `codegraph_callers`, not `grep` or `Bash`. Acceptance criteria: regression test passes; existing Coding-pillar tests do not regress.

---

#### 3.6 -- Phase 3 Testing and Stabilization

**Objective**: Run the reference benchmark and verify the 30%-of-tool-calls stability gate.

**Prompt**:
> Run the reference task "Find all callers of `redactSecrets` and assess whether changing its signature would break call sites" on the Nexus repo, both with `codegraph_*` tools available and disabled. Record total tool-call count for both runs under `tests/fixtures/codegraph-benchmark-results/2026-05-26/`. Assert: with codegraph available, total tool calls are at most 30% of the disabled run. Run the full Nexus test suite + the new integration suite. Fix any regressions. After all tests pass, run `/generate-session-history` to document Phase 3.

---

### Phase 3 Exit Checklist

- [ ] `core/codegraph/` shipped with store, scanner, MCP server, types
- [ ] 8-tool MCP surface registered with Nexus MCP harness
- [ ] Coding-pillar agent loop prefers `codegraph_*` over grep / Bash for symbol queries
- [ ] Indexes Nexus repo end-to-end in <30s; incremental re-index works
- [ ] No outbound network call; no listening socket
- [ ] No mutation of other agents' config files (verify by grep for `.claude.json`, `.cursor/rules/`)
- [ ] Benchmark asserts <=30% tool-call count on the reference task
- [ ] Session history generated
- [ ] Ready to advance to Phase 4

---

## Phase 4: Memory Enhancements (LEANN-derived)

**Goal**: Ship two memory-subsystem improvements derived from LEANN's algorithmic ideas -- AST-aware chunking and a graph-pruned dense index with selective embedding recomputation -- gated behind a `MemoryStorageTier` policy so the existing full-vector path remains the default until the new path is benchmarked.
**Prerequisites**: Phase 3 complete (the Tree-sitter primitives from the code-graph scanner are reused by the AST chunker).
**Stability Gate**: On a 100k-chunk benchmark workload, `PrunedDenseIndex` consumes at most 20% of the on-disk bytes that `DenseIndex` consumes, with recall@10 within 5 percentage points.

### Sub-tasks

#### 4.1 -- AST-aware code chunker

**Objective**: Replace the current size-based chunker for code inputs with an AST-aware chunker that respects function and class boundaries, using Tree-sitter primitives already in the codegraph scanner.

**Prompt**:
> Implement `core/memory/chunkers/AstChunker.ts` that takes a file path + content and returns an array of `Chunk` records, each aligned to a Tree-sitter top-level node (function, class, method) for TypeScript / Python / Rust / Go. Fall back to the existing size-based chunker for any other language or for non-code files. Wire `AstChunker` into [core/memory/HybridRetriever.ts](../../../core/memory/HybridRetriever.ts) ingest path -- the hybrid retriever should call the AST chunker first, with the size chunker as fallback. Add tests at `core/memory/__tests__/AstChunker.test.ts` with a fixture file per language. Source: comparison item 2 ([Section 5](../comparison-ecosystem-2026-05.md#5-relevance-analysis-41-insights-mapped-against-nexus)). Acceptance criteria: chunker emits one chunk per top-level node; no chunk crosses a function boundary; fallback engages cleanly for unsupported languages.

---

#### 4.2 -- PrunedDenseIndex with selective recomputation

**Objective**: Implement a graph-pruned dense index inspired by LEANN's algorithm -- store only the HNSW graph + chunk text, recompute embeddings on the search path rather than storing them.

**Prompt**:
> Implement `core/memory/PrunedDenseIndex.ts` adjacent to the existing [DenseIndex.ts](../../../core/memory/DenseIndex.ts). API: same as `DenseIndex` (`addChunks`, `search`, `delete`, `compactify`), but storage representation is: (a) HNSW graph in CSR format with high-degree-preserving pruning (target out-degree 32); (b) chunk text only -- no embedding bytes persisted; (c) on `search(query, k)`, embed the query, then traverse the HNSW graph, computing embeddings on-demand for visited nodes via `LocalEmbedder` ([core/memory/LocalEmbedder.ts](../../../core/memory/LocalEmbedder.ts)); cache the last N=512 recomputed embeddings in-memory for the duration of the session. Source: comparison item 1 + Section 3.1 ([comparison report](../comparison-ecosystem-2026-05.md#31-s1--leann)). **Do not** vendor the LEANN package; this is a reverse-engineered internal implementation per [Section 6.3](../comparison-ecosystem-2026-05.md#63-reverse-engineering-viability) `re-full`. Add tests at `core/memory/__tests__/PrunedDenseIndex.test.ts` covering: index build, search, delete, recall@10 on a 1000-chunk fixture vs `DenseIndex`. Acceptance criteria: on-disk bytes <=20% of `DenseIndex` on the fixture; recall@10 within 5 percentage points.

---

#### 4.3 -- MemoryStorageTier policy gating

**Objective**: Add a `MemoryStorageTier` policy (similar to the existing `DiffusionTier` from Phase 3) so the new pruned path is opt-in at first, with a migration script for users who want to switch.

**Prompt**:
> Add a `MemoryStorageTier` enum (`Standard | Pruned`) to [core/config/](../../../core/config/) or wherever Nexus's per-pillar policies live. Wire the [HybridRetriever](../../../core/memory/HybridRetriever.ts) to construct either `DenseIndex` (when `Standard`) or `PrunedDenseIndex` (when `Pruned`) based on the tier setting. Default the tier to `Standard` until benchmarks complete. Write a one-way migration script at `scripts/migrate-dense-index-to-pruned.ts` that takes an existing `~/.nexus/memory/dense/` directory, walks every chunk, re-builds the pruned index from chunk text alone (since the original embeddings are no longer needed), and atomically swaps the directories. Add tests for the migration. Source: comparison Section 9.1 risk discussion. Acceptance criteria: switching tiers via config setting works without service restart for the next session; migration script idempotent (re-running on already-migrated dir is a no-op); migration backs up the original under `~/.nexus/memory/dense.backup-<timestamp>/`.

---

#### 4.4 -- Phase 4 Testing and Stabilization

**Objective**: Run the 100k-chunk benchmark and verify the storage + recall stability gate.

**Prompt**:
> Generate a 100k-chunk benchmark fixture by indexing a large public repo (e.g. the Nexus repo plus a checked-in copy of the Vue + React monorepos) under both `Standard` and `Pruned` tiers. Record on-disk bytes and recall@10 on a 100-query test set for both. Persist results under `tests/fixtures/memory-tier-benchmark-results/2026-05-26/`. Assert: `Pruned` on-disk bytes <=20% of `Standard`; recall@10 delta <=5 percentage points. Run the full Nexus test suite. Fix any regressions. After all tests pass, run `/generate-session-history` to document Phase 4.

---

### Phase 4 Exit Checklist

- [ ] `core/memory/chunkers/AstChunker.ts` shipped; wired into HybridRetriever
- [ ] `core/memory/PrunedDenseIndex.ts` shipped; no embedding bytes persisted
- [ ] `MemoryStorageTier` policy gating; default `Standard`
- [ ] One-way migration script idempotent and backed up
- [ ] Benchmark asserts <=20% storage + <=5pp recall delta
- [ ] No LEANN package dependency added (verify by grep `package.json`)
- [ ] Session history generated
- [ ] Ready to advance to Phase 5

---

## Phase 5: Agent Loop Policy Enforcement

**Goal**: Codify and enforce four S3 policies that improve agent behavior without adding new dependencies: read-only exploration sub-agent enforcement, path-scoped skills, `.nexusignore`, and a session-reflection hook position in the existing 12-hook lifecycle.
**Prerequisites**: Phase 1 complete (the hooks-over-prompts policy + inventory frame this phase). Phases 2-4 may run in parallel.
**Stability Gate**: A reference Coding-pillar session: (a) cannot edit files during the exploration sub-agent phase (enforced by tool-call rejection); (b) loads the `payments-service` skill only when CWD is inside `modules/coding/payments/` (or equivalent path predicate); (c) honors `.nexusignore` exclusion at memory ingest; (d) emits a `reflection` hook event at session end.

### Sub-tasks

#### 5.1 -- Read-only exploration sub-agent enforcement

**Objective**: Enforce that sub-agents dispatched with intent=`explore` cannot call write tools (Edit, Write, Bash with side-effects).

**Prompt**:
> Modify the sub-agent dispatch layer (locate it via the [`.claude/agents/`](../../../.claude/agents/) sub-agent definitions and the v1.0.0 sub-agent dispatch entry point) so that sub-agents invoked with `intent: 'explore'` have a tool allowlist restricted to: Read, Glob, Grep, `codegraph_*` tools, and `Bash` only for commands matching a configurable allowlist of read-only commands (default: `git status`, `git log`, `ls`, `cat`, `find`, `tree`). Reject any other tool call with a structured error. Add a linter rule in [configs/](../../../configs/) or `nexus-check` that flags any sub-agent prompt that requests `Edit` / `Write` while declaring `intent: 'explore'`. Source: comparison item 16 ([Section 5](../comparison-ecosystem-2026-05.md#5-relevance-analysis-41-insights-mapped-against-nexus)). Acceptance criteria: tool-call rejection enforced; regression test in `tests/integration/sub-agent-enforcement/` proves an `explore` sub-agent cannot Edit; linter rule fires on a bad sub-agent definition fixture.

---

#### 5.2 -- Path-scoped skills

**Objective**: Add a path predicate to the skill manifest so skills only auto-load when CWD or current edit path matches.

**Prompt**:
> Extend the `SkillManifest` type in [core/skills/SkillCatalog.ts](../../../core/skills/SkillCatalog.ts) to add an optional `pathScope: { include?: string[]; exclude?: string[] }` field (glob patterns relative to repo root). When loading skills at session start, filter to those whose `pathScope` matches the current CWD or the file the agent is editing; skills with no `pathScope` continue to load globally. Add a method `reevaluatePathScope(currentPath: string)` that the agent loop calls when the editing focus changes, so a skill can become active mid-session as the agent moves into a relevant subtree. Add tests at `core/skills/__tests__/PathScope.test.ts`. Source: comparison item 13 ([Section 5](../comparison-ecosystem-2026-05.md#5-relevance-analysis-41-insights-mapped-against-nexus)). Acceptance criteria: a fixture skill with `pathScope.include: ["modules/coding/**"]` loads only when CWD is under that subtree; existing globally-scoped skills continue to load unchanged.

---

#### 5.3 -- .nexusignore + agent permission policy

**Objective**: Honor a `.nexusignore` file at repo root that excludes paths from memory ingest and from skill / sub-agent reach, plus a `.nexus/permissions.deny` for explicit per-tool denials.

**Prompt**:
> Add `.nexusignore` parsing under [core/storage/](../../../core/storage/) -- syntax matches `.gitignore`. The parsed exclusion list is honored by: (a) memory ingest in [HybridRetriever.ts](../../../core/memory/HybridRetriever.ts); (b) the code-graph scanner from Phase 3; (c) the file-watcher abstraction in Phase 6 (forward-referenced); (d) any sub-agent's Read / Glob tool. Add a default `.nexusignore` at the repo root listing `*.coverage`, `.nyc_output/`, `coverage/`, `node_modules/`, `dist/`, `out/`, `*.tsbuildinfo` (the same set the existing test infra already filters). Add `.nexus/permissions.deny` parsing for per-tool denials -- e.g. `Bash: rm -rf /*` denies Bash matching that pattern. Source: comparison item 18 ([Section 5](../comparison-ecosystem-2026-05.md#5-relevance-analysis-41-insights-mapped-against-nexus)). Acceptance criteria: a fixture `.nexusignore` excludes a path from memory ingest; a fixture `permissions.deny` denies a specific Bash command; both tested.

---

#### 5.4 -- Reflection hook position in 12-hook lifecycle

**Objective**: Add a `session-reflection` hook position to the existing 12-hook lifecycle from Phase 4, fired at session end with the session transcript, so a stop-hook can propose AGENTS.md / skill updates while context is fresh.

**Prompt**:
> Extend the 12-hook lifecycle (see [docs/v1.1.0/plans/phase-04-memory-provenance-and-hooks.md](../../v1.1.0/plans/phase-04-memory-provenance-and-hooks.md) for the existing positions) with a 13th position `session-reflection` fired exactly once at session end. The hook receives the full session transcript plus the list of files written. Provide one reference hook implementation under [`.claude/agents/`](../../../.claude/agents/) that scans the transcript for "user said X, I did Y wrong" patterns and emits a `proposed-agents-md-update` artifact at `<nexus-home>/reflections/<session-id>.md` for human review. Source: comparison item 12 ([Section 5](../comparison-ecosystem-2026-05.md#5-relevance-analysis-41-insights-mapped-against-nexus)). Acceptance criteria: the 13th hook fires on session end; the reference hook writes a reflection artifact; integration test covers the firing.

---

#### 5.5 -- Phase 5 Testing and Stabilization

**Objective**: Verify all four policy items integrate cleanly.

**Prompt**:
> Run the full Nexus test suite + the four new integration test suites (sub-agent enforcement, path-scoped skills, .nexusignore, reflection hook). Fix any regressions. Verify the stability gate end-to-end by running a reference Coding-pillar session that exercises all four policies in one transcript. After all tests pass, run `/generate-session-history` to document Phase 5.

---

### Phase 5 Exit Checklist

- [ ] Read-only sub-agent enforcement live + linter rule firing
- [ ] Path-scoped skills + `reevaluatePathScope` API live
- [ ] `.nexusignore` + `.nexus/permissions.deny` honored across memory, code-graph, sub-agents
- [ ] 13th hook position (`session-reflection`) live with reference implementation
- [ ] All four policies covered by integration tests
- [ ] Session history generated
- [ ] Ready to advance to Phase 6

---

## Phase 6: Re-Partial Integrations

**Goal**: Ship the three bounded-scope re-partial items -- a file-watcher abstraction lifted out of the Phase 3 code-graph scanner; an LSP client for TypeScript / Python / Rust; an interactive HTML scaffolding pattern for "copy as JSON" round-trip artifacts.
**Prerequisites**: Phases 3 (code-graph), 5 (`.nexusignore`).
**Stability Gate**: (a) Code-graph re-uses the watcher abstraction without a behavior change; (b) the Coding-pillar agent loop calls an LSP-backed "find all references" tool on a TypeScript fixture and returns only symbol-matched references, not text matches; (c) the Tauri shell can render an interactive HTML artifact with a working "copy as JSON" button.

### Sub-tasks

#### 6.1 -- OS-native file watcher abstraction

**Objective**: Lift the file-watching logic out of the Phase 3 code-graph scanner into a reusable `core/storage/FileWatcher.ts` that wraps `chokidar` (or equivalent) with a 2-second debounce, OS-native event source (FSEvents / inotify / RDCW), and `.nexusignore` honoring.

**Prompt**:
> Implement `core/storage/FileWatcher.ts` wrapping `chokidar` with a 2-second debounce and `.nexusignore` honoring (from Phase 5.3). API: `class FileWatcher` with `watch(rootPath, callback)`, `stop()`, and `pendingChanges()` (snapshot of debounced not-yet-fired changes). Refactor `core/codegraph/scanner/TreeSitterScanner.ts` (Phase 3.3) to use this abstraction. Add the same abstraction to memory ingest from Phase 5.3. Source: comparison item 8 ([Section 5](../comparison-ecosystem-2026-05.md#5-relevance-analysis-41-insights-mapped-against-nexus)). Acceptance criteria: Phase 3 code-graph tests still pass after refactor; debounce verified on a fixture that writes 100 files in 1 second and asserts one callback invocation.

---

#### 6.2 -- LSP client for TypeScript / Python / Rust

**Objective**: Wire a Language Server Protocol client into the Coding-pillar agent loop, exposing two new tools (`lsp_definition`, `lsp_references`) that return symbol-precise results instead of text matches.

**Prompt**:
> Implement `core/coding/lsp/LspClient.ts` that speaks LSP over stdio to a per-language server: `typescript-language-server` for TypeScript, `pylsp` for Python, `rust-analyzer` for Rust. The client launches the server lazily on first request, caches the process, and reuses it across tool calls in the same session. Expose two MCP tools wired into the Coding-pillar agent loop: `lsp_definition(file, line, column)` and `lsp_references(file, line, column)`. The installer warns when an LSP binary is missing rather than silently falling back to grep (per [comparison Section 9.1](../comparison-ecosystem-2026-05.md#91-risks-of-the-adoption-set)). Source: comparison item 17 ([Section 5](../comparison-ecosystem-2026-05.md#5-relevance-analysis-41-insights-mapped-against-nexus)). Acceptance criteria: integration test on a TypeScript fixture asserts `lsp_references` returns symbol-precise matches, not text matches; missing-LSP warning surfaces in installer-smoke logs.

---

#### 6.3 -- Interactive HTML scaffolding for "copy as JSON" round-trips

**Objective**: Add a render-side template under [desktop/src/](../../../desktop/src/) for HTML artifacts that include interactive controls (sliders, form inputs) plus a "copy as JSON" button that round-trips state back into the Coding-pillar agent loop.

**Prompt**:
> Create `desktop/src/components/InteractiveArtifact.tsx` that renders any HTML payload containing a `<form data-nexus-artifact="true">` element with input controls; on click of the "Copy as JSON" button (rendered automatically by the wrapper), the form state is serialized to JSON and copied to the system clipboard with a confirmation toast. Add a reference template at `catalog/skills/developer-experience/html-output-conventions/references/interactive-tuning.html` (in Nexus-Hub) demonstrating sliders + checkboxes + a "copy as JSON" button. Source: comparison item 40 ([Section 5](../comparison-ecosystem-2026-05.md#5-relevance-analysis-41-insights-mapped-against-nexus)). **Bound the scope** explicitly: this is "copy as JSON" round-trip only -- no general in-app HTML editor, no script execution beyond the controlled form-state collector. Acceptance criteria: component renders in the Tauri shell; reference template loads end-to-end; UI scope-creep guard noted in the component's docstring.

---

#### 6.4 -- Phase 6 Testing and Stabilization

**Objective**: Verify the three re-partial items.

**Prompt**:
> Run the full Nexus test suite + the three new integration tests (file-watcher debounce, LSP references, interactive HTML round-trip). Fix any regressions. Confirm the Phase 3 code-graph scanner still passes after the file-watcher refactor. After all tests pass, run `/generate-session-history` to document Phase 6.

---

### Phase 6 Exit Checklist

- [ ] `core/storage/FileWatcher.ts` shipped; code-graph + memory ingest refactored to use it
- [ ] `core/coding/lsp/LspClient.ts` shipped for TS / Python / Rust
- [ ] Two new MCP tools (`lsp_definition`, `lsp_references`) wired into Coding pillar
- [ ] `desktop/src/components/InteractiveArtifact.tsx` shipped with scope-creep guard documented
- [ ] All three items covered by integration tests
- [ ] Session history generated
- [ ] Ready to advance to Phase 7

---

## Phase 7: Stabilization, Benchmarks, and Documentation Refresh

**Goal**: Quantify the adoption's actual impact (token usage, tool-call count, storage size), refresh top-level documentation to reflect the new surfaces, and close out known-gaps for the adoption set.
**Prerequisites**: Phases 1-6 complete.
**Stability Gate**: All three end-to-end benchmarks published; [README.md](../../../README.md), [AGENTS.md](../../../AGENTS.md), [ARCHITECTURE.md](../../../ARCHITECTURE.md) updated; a known-gaps entry exists for any deferred sub-item; no P0 / P1 regressions outstanding.

### Sub-tasks

#### 7.1 -- End-to-end token-usage benchmark

**Objective**: Run a representative Coding-pillar workload on the same fixture before / after the full adoption (Phases 2-6 active) and publish the delta.

**Prompt**:
> Define a Coding-pillar workload script at `tests/benchmarks/coding-pillar-token-usage.ts` that runs a fixed sequence: "1) Find all callers of `redactSecrets`. 2) Run the test suite. 3) Inspect one failing test. 4) Propose a fix and edit the file. 5) Re-run the test suite." Run this workload (a) against a checkout of `main` *before* this adoption plan landed (use `git worktree` from the most recent tag prior to Phase 1), and (b) against the current HEAD with all Phases 1-6 active. Record total tokens consumed and total tool calls for both runs. Publish results under `docs/v1.1.0/benchmarks/coding-pillar-token-usage-2026-05-26.md` with raw transcripts attached. Acceptance criteria: published report includes pre / post numbers + percentage deltas; deltas are non-trivial (>=30% on both tokens and tool calls per [comparison Section 4 cross-source themes](../comparison-ecosystem-2026-05.md#4-cross-source-themes)).

---

#### 7.2 -- End-to-end storage-size benchmark

**Objective**: Run the 100k-chunk fixture from Phase 4 and publish on-disk size + recall metrics for `Standard` vs `Pruned` tier.

**Prompt**:
> Re-run the Phase 4 100k-chunk benchmark with extended scope: include `~/.nexus/memory/dense/`, `~/.nexus/memory/bm25/`, and `~/.nexus/codegraph/<repo-fingerprint>.db` in the on-disk total. Publish results at `docs/v1.1.0/benchmarks/memory-storage-size-2026-05-26.md` with: total bytes per subsystem, deltas vs `Standard`, recall@10 per subsystem, query latency distribution per subsystem. Acceptance criteria: Pruned dense index storage <=20% of Standard (already verified in Phase 4.4); combined storage delta meaningful enough that switching to Pruned is worth recommending for memory-constrained tiers.

---

#### 7.3 -- Documentation refresh

**Objective**: Update top-level docs to reflect the new surfaces shipped in Phases 1-6.

**Prompt**:
> Edit the following files: (a) [README.md](../../../README.md) -- add a new bullet under "Design Principles" if the adoption introduced a new principle; document `core/codegraph/` and `core/observability/CommandCompressor.ts` in the project layout overview; add the two new benchmarks (7.1, 7.2) to "Project Status" with links. (b) [AGENTS.md](../../../AGENTS.md) -- add a "Code-graph MCP" subsection under "Tech Stack" or "Non-Obvious Tooling"; document the new `MemoryStorageTier` policy alongside the existing `DiffusionTier`; document the new sub-agent intent restrictions (Phase 5.1). (c) [ARCHITECTURE.md](../../../ARCHITECTURE.md) -- add an architecture diagram (Mermaid) for the code-graph module showing scanner -> store -> MCP -> Coding-pillar flow; add the pruned dense index decision rationale; document the file-watcher abstraction's role. Acceptance criteria: all three docs link consistently; markdown lints pass; no broken cross-references.

---

#### 7.4 -- Known-gaps closure for the adoption set

**Objective**: Close known-gaps entries for items completed by this plan and open new entries for anything deferred.

**Prompt**:
> Open `docs/v1.2.0/known-gaps.md` (creating the file if it does not exist, following the format of [docs/v1.1.0/known-gaps.md](../../v1.1.0/known-gaps.md)). For each of the 18 adoption items from [comparison-ecosystem-2026-05.md Section 7](../comparison-ecosystem-2026-05.md#7-adoption-plan): if completed, list it under `## Resolved` with the implementing phase / sub-task reference; if deferred or partially complete, list it under `## Open Items` with the four standard fields (`Source phase`, `Plan reference`, `Reason`, `Suggested next step`). Cross-reference the comparison file at the top. Acceptance criteria: every adoption item is accounted for; the file's `Status:` is `live`.

---

#### 7.5 -- Phase 7 Final Stabilization

**Objective**: Run the entire test suite end-to-end one final time, confirm no regressions, generate a final session history covering the whole adoption arc.

**Prompt**:
> Run the full Nexus test suite (`npm run test`, `npm run lint:shell`, `npm run test:shell`, `npm run test:shell:coverage`) plus every integration suite added in Phases 2-6. Fix any final regressions. Run a quick smoke of the desktop shell (`npm run dev:shell`) to confirm the interactive HTML scaffolding loads. Run `/generate-session-history` covering the full adoption arc (all seven phases). Tag the milestone in git as appropriate for the cycle this plan ultimately ships under (likely v1.2.x).

---

### Phase 7 Exit Checklist

- [ ] Token-usage benchmark published with >=30% improvement
- [ ] Storage-size benchmark published
- [ ] [README.md](../../../README.md), [AGENTS.md](../../../AGENTS.md), [ARCHITECTURE.md](../../../ARCHITECTURE.md) updated
- [ ] `docs/v1.2.0/known-gaps.md` carries the adoption ledger
- [ ] All tests passing across all phases; no P0 / P1 regressions
- [ ] Final session history covers all seven phases
- [ ] Adoption arc closed

---

## Appendix A -- Items Explicitly NOT Adopted (Security / Policy Reasons)

Reproduced from [comparison-ecosystem-2026-05.md Section 9.4](../comparison-ecosystem-2026-05.md#94-items-explicitly-not-recommended-for-adoption-security--policy-reasons). These items are out-of-scope for every phase above and must not be reintroduced via scope creep during implementation.

| ID | Item | Source | Rejection grounds (MCP Registry Policy) |
|---|---|---|---|
| N1 | Multica platform (managed agents, autopilots, squads) | S6 | Conflicts with single-user single-machine product shape; cloud mode requires outbound calls to multica.ai; self-hosted requires Docker + Postgres 17 + Go. Classification: `drop-outright` per policy decision tree step 5. |
| N2 | LEANN multimodal (PDF/DOCX/image) retrieval via ColPali / ColQwen2 | S1 | Out of scope -- Nexus's Chat pillar retrieves text + code only; visual-encoder retrieval inflates installer model-pull list without addressing a known need. |
| N3 | LEANN's cloud-LLM provider options (OpenAI / Anthropic backends) | S1 | Violates "no outbound calls without explicit user opt-in." Phase 4's `PrunedDenseIndex` must not expose any cloud-LLM configuration surface. |
| N4 | RTK's optional anonymized telemetry (opt-in) | S4 | Nexus is no-telemetry by construction per [README.md L88](../../../README.md). Phase 2's `CommandCompressor` must not include a telemetry path even as opt-in. |
| N5 | CodeGraph's auto-write into `~/.claude.json` and `.cursor/rules/` | S2 | Mutating other agents' config files from Nexus is out of bounds. Phase 3's internal MCP registers only into Nexus's own runtime. |
| N6 | Hallmark's 22-theme catalog | S5 | Nexus is a single product with one theme; theme variation is irrelevant inside the app. Phase 1.1 adopts the anti-slop gates and the four verbs only. |
| N7 | Multica's pgvector dependency for skills indexing | S6 | Nexus-Hub already indexes skills sufficiently for a single-machine workload; adding pgvector would force a Postgres dep into the installer. |

## Appendix B -- Plan Origin

This plan was generated from [comparison-ecosystem-2026-05.md](../comparison-ecosystem-2026-05.md) via `/generate-plan` in from-comparison mode with `scope=all` and `reverse-engineer-first=true`. The scope filter retained all 18 adoption items (4 skill-native + 11 re-full + 3 re-partial); the RE-first flag overlaid the dependency-ordered phase grouping with the MCP Registry Policy ordering from Section 6.4 of the comparison. No vendor-intrinsic items were retained; one `drop-outright` cluster (Multica) plus six narrower N-items appear in Appendix A above.
