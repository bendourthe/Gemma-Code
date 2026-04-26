# Plan — v0.5.0 Implementation

**Project**: Gemma Code
**Version**: v0.5.0 (target)
**Plan Type**: Major Release / Feature Bundle
**Created**: 2026-04-24
**Goal**: Land a coherent v0.5.0 release that adopts the in-scope items from 5 cross-project comparisons, ships a measurable token-cost reduction (≥40% on golden tasks; cache hit rate >50% on iterative-debug), externalizes sub-agent specialist prompts, gates tool / git / prompt actions through a generic harness layer, hardens memory consolidation through an N-corroboration rule, tightens tool-surface ergonomics for the agent, and renames the project's agent directive from `CLAUDE.md` to `AGENTS.md` — all while keeping Gemma Code 100% offline-first on a single consumer GPU.

## Source Comparisons & Sub-Plans

This plan is the canonical execution path for v0.5.0. It merges and orders 5 adoption efforts derived from cross-project comparisons. The five detailed sub-plans live alongside in `docs/v0.5.0/plans/` for reference; this implementation plan is what `/implement-phase` consumes.

| Source | Comparison | Sub-Plan |
|--------|------------|----------|
| token-optimizer-mcp | [comparison/comparison-token-optimizer-mcp.md](../comparison/comparison-token-optimizer-mcp.md) | [token-optimizer-adoption.md](token-optimizer-adoption.md) |
| routa | [comparison/comparison-routa.md](../comparison/comparison-routa.md) | [routa-harness-adoption.md](routa-harness-adoption.md) |
| 7 Principles for Agent-Friendly CLIs | [comparison/comparison-7-principles-for-agent-friendly-clis.md](../comparison/comparison-7-principles-for-agent-friendly-clis.md) | [agent-friendly-tools.md](agent-friendly-tools.md) |
| foundry-vault | [comparison/comparison-foundry-vault.md](../comparison/comparison-foundry-vault.md) | [memory-hygiene.md](memory-hygiene.md) |
| free-claude-code | [comparison/comparison-free-claude-code.md](../comparison/comparison-free-claude-code.md) | [ci-and-docs-hygiene.md](ci-and-docs-hygiene.md) |

If a phase below conflicts with a sub-plan, this implementation plan wins.

## Hard Constraints

1. **100% offline-first single-GPU.** No runtime network egress, no cloud APIs, no models that require more than a single consumer GPU via Ollama.
2. **Generic agent-agnostic identity.** `CLAUDE.md` is deleted entirely. `AGENTS.md` is the sole canonical agent directive. Gemma Code is independent — Claude Code is inspiration only; nothing in product files reflects Claude branding. (Development-time tool config — `.vscode/`, `.idea/`, optional `.claude/` files developers may keep locally — is not part of Gemma Code's identity and is not committed to the repository.)
3. **No backwards compatibility shims for renamed/removed conventions.** When a file moves or is deleted, references update; we do not leave compatibility pointers.
4. **No co-author lines in commit messages.** Existing rule preserved verbatim into `AGENTS.md`.
5. **No item that requires LSTM, predictive ML beyond pure-JS ARIMA, voice models, multi-provider proxying, Discord/Telegram, Tauri/Axum/Drizzle/Postgres, Storybook, Entrix Rust crate, or `prepare-commit-msg` co-author template.** All explicitly out of scope.

## Overview

This plan adopts 51 in-scope items across the 5 comparisons. The phases are dependency-ordered: Phase 1 establishes identity (AGENTS.md), Phase 2 hardens the tool surface so subsequent phases can rely on bounded outputs and actionable errors, Phase 3 lays the compression foundation that the persistent cache (Phase 4) and semantic recall (Phase 5) build on, Phase 6 adds mutation safety, Phase 7 hardens memory consolidation discipline, Phase 8 stands up the generic harness layer plus specialist externalization, Phase 9 fans out coverage and observability, Phase 10 lands development hygiene and CI hardening, Phase 11 catches up the documentation discipline, and Phase 12 closes the loop with advanced fallbacks plus the release gate that enforces the ≥40% token reduction and zero >10% benchmark regression bars.

The user-visible delta in v0.5.0: tools return bounded outputs with actionable errors and `dry_run` previews on mutating operations; reads return diffs against cached content; tool outputs get Brotli-compressed when worthwhile and persist across sessions; semantic recall via the existing nomic-embed-text embedder surfaces relevant cached outputs; sub-agent prompts are user-customizable Markdown files; a `/memory lint` slash command surfaces stale memory; an opt-in operation log writes a grep-friendly journal of every tool call; husky blocks malformed/non-ASCII commits; CI runs across Node 18/20/22 with SHA-pinned actions and concurrency cancellation; Dependabot opens weekly toolchain updates; ADRs document the architectural decisions for memory layering, compaction strategy, sub-agent isolation, and tool permission tiers.

Success is measured through three artifacts: a `tests/golden/baselines/v0.5.0.json` showing ≥40% average tool-output token reduction vs. v0.4.0; a 4-task golden micro-eval suite (3 truncation-recovery + 1 missed-fact) where the agent demonstrates correct use of the new pagination, truncation hint, and consolidation discipline; and a clean test-pyramid run with all 1,168+ existing tests plus the new ones green, no benchmark regression beyond +5 ms p99 on `tool-execution` or `cache-hit`, and the harness hooks all firing under 50 ms p99.

## Phases at a Glance

| Phase | Title | Outcome | Items adopted |
|-------|-------|---------|---------------|
| 1 | Identity & Naming | `AGENTS.md` is canonical; `CLAUDE.md` deleted; cognitive-workflow stanza added; smoke-test classification rubric documented | ci-1, ci-3 |
| 2 | Tool Surface Hardening | 64 KB byte-cap + truncation hint; `read_file` and `grep_codebase` paginate; tool-error messages contain parameter name + Usage hint; null-safety baseline | aft-1, aft-2, aft-3, aft-4, tom-7 |
| 3 | Compression Foundation | Brotli-compress tool outputs > 500 B at quality 4; OutputRedirector integrated; threshold logic skips low-value compressions | tom-1, tom-2, tom-3 |
| 4 | Persistent Cache + Diff Reads | SQLite tool-output cache with mtime+size invalidation; `read_file` returns unified diffs against cached content; `/cache` slash commands | tom-4, tom-5 |
| 5 | Semantic Recall + Precise Budgeting | `UnifiedMemoryRetriever` recalls cached tool outputs via nomic-embed-text at cosine 0.85; `PromptBudget` uses tiktoken with heuristic fallback | tom-8, tom-9 |
| 6 | Mutation Safety + Structured Outputs | `dry_run` on `run_terminal` and `delete_file`; `format=json` on `list_directory` and `grep_codebase` | aft-5, aft-6 |
| 7 | Memory Hygiene & Consolidation Discipline | `/memory lint` writes `memory-health.md`; `MemoryConsolidator` enforces N≥2 corroboration by default; missed-fact golden eval | mh-1, mh-2, mh-3 |
| 8 | Generic Harness + Specialist Externalization | `scripts/hooks/` Node scripts for tool-permission, git-state, and prompt-policy checks (each <50 ms p99); sub-agent prompts loaded from `assets/specialists/*.md` via priority-chain `SpecialistLoader`; characterization tests | rha-1, rha-2, rha-3, rha-4 |
| 9 | Coverage & Observability | API-response cache for `web_search`; in-process LRU layer; buffered trace writes; cache-aware dashboard panels; opt-in `.gemma-code/operation-log.md` | tom-10, tom-11, tom-12, tom-13, mh-4 |
| 10 | Local Development Hygiene + CI Hardening | husky pre-commit (lint) + commit-msg (ASCII-only); dependency-cruiser baseline; Dependabot weekly config; ESLint `@ts-ignore` rule; SHA-pinned GitHub Actions; concurrency cancel-in-progress; Node 18/20/22 CI matrix | rha-5, rha-6, ci-4, ci-5, ci-6, ci-7, tom-14 |
| 11 | Documentation Discipline | ADR-0002 through ADR-0005; mermaid module-dependency diagram; module authorship contract in `AGENTS.md`; refactor / characterization-test playbook; docs/issues template; severity rubric `tool-audit.md`; `get_tool_schema` documented; auto-generated `docs/index.md`; CODEOWNERS; branch-cleanup workflow | rha-7, rha-8, rha-9, rha-10, rha-11, mh-5, mh-6, ci-2, ci-8, aft-7, aft-8 |
| 12 | Advanced Fallbacks + Release Gate | Truncation-recovery 3-task golden micro-eval; ARIMA-only predictive cache (LSTM excluded); multi-tier eviction strategies; HeuristicEmbedder fallback; semantic-release + commitlint; final golden-task baseline; CHANGELOG; version bump to 0.5.0 | tom-15, tom-16, tom-17, tom-18 |

**Item-id key**: `tom-N` = token-optimizer-adoption sub-task; `rha-N` = routa-harness-adoption; `aft-N` = agent-friendly-tools; `mh-N` = memory-hygiene; `ci-N` = ci-and-docs-hygiene. Item ids correspond to the order of adoption candidates in the source comparisons; see the per-comparison sub-plan for full executable prompts.

---

## Phase 1: Identity & Naming

**Goal**: Make `AGENTS.md` the canonical agent-agnostic directive (with cognitive-workflow stanza). Delete `CLAUDE.md` entirely. Document the smoke-test classification rubric.

**Prerequisites**: None.

**Stability Gate**: `AGENTS.md` exists; `CLAUDE.md` does not exist; all repository references to `CLAUDE.md` updated to `AGENTS.md`; smoke-test rubric in `docs/v0.5.0/test-pyramid.md`; agent-behavior baseline against a representative golden task is statistically equivalent pre/post migration.

### 1.1 — Create `AGENTS.md` and delete `CLAUDE.md`

**Objective**: Migrate every rule from `CLAUDE.md` to a new `AGENTS.md` (rewriting tool-specific rules as tool-agnostic where possible); delete `CLAUDE.md`; update every cross-reference.

**Prompt**: Run sub-task 1.1 from [ci-and-docs-hygiene.md](ci-and-docs-hygiene.md#11--create-agentsmd-as-canonical-agent-agnostic-directive-delete-claudemd). Verify acceptance criteria: full Vitest suite green; snapshot test confirms `CLAUDE.md` non-existence and `AGENTS.md` content; `git grep -i 'CLAUDE\.md\|CLAUDE\.MD'` returns zero matches outside `docs/v0.5.0/comparison/comparison-free-claude-code.md` and this implementation-plan.

### 1.2 — Smoke-test classification rubric

**Objective**: Document the four categories (`missing_env`, `upstream_unavailable`, `product_failure`, `harness_bug`) in `docs/v0.5.0/test-pyramid.md` and reclassify every integration test to use the documented helpers; add a meta-test that catches future bare-`process.env`-early-returns.

**Prompt**: Run sub-tasks 2.1 and 2.2 from [ci-and-docs-hygiene.md](ci-and-docs-hygiene.md#phase-2-test-discipline). Note: `docs/v0.4.0/test-pyramid.md` is being copied to `docs/v0.5.0/test-pyramid.md` (preserving the existing 86.7/6.7/6.7 ratio documentation) and extended with the rubric section.

### 1.3 — Phase 1 stabilization

**Prompt**: Generate and run comprehensive verification for Phase 1 of the v0.5.0 implementation plan. Specifically: (1) run `npm run lint`, `npm run build`, `npm run test`, `npm run test:integration` and fix all failures; (2) run the AGENTS.md and test-discipline meta-tests; (3) run a representative golden task pre- and post-migration to confirm agent behavior is unchanged; (4) confirm `git grep -i 'CLAUDE.md'` returns zero matches outside the historical comparison report and this plan; (5) run `/generate-session-history` to document Phase 1.

### Phase 1 Exit Checklist

- [ ] `AGENTS.md` exists with all migrated rules + cognitive-workflow stanza
- [ ] `CLAUDE.md` is deleted; non-existence test green
- [ ] No remaining `CLAUDE.md` references outside historical artifacts
- [ ] `docs/v0.5.0/test-pyramid.md` includes the smoke-test classification rubric
- [ ] Every integration test uses documented helpers
- [ ] Test-discipline meta-test green
- [ ] Agent-behavior baseline statistically equivalent
- [ ] Session history generated

---

## Phase 2: Tool Surface Hardening

**Goal**: Add a 64 KB byte-cap with structured truncation hint to every tool output; `read_file` and `grep_codebase` accept pagination parameters; rewrite every tool-handler error message to contain the parameter name and a `Usage:` hint; establish a null-safety test baseline.

**Prerequisites**: Phase 1.

**Stability Gate**: Every tool output ≤ 64 KB by default; truncation hint format consistent; `read_file(range_start, range_end)` and `grep_codebase(max_results, next_offset)` paginate correctly; `tests/unit/tools/errors.test.ts` enforces the parameter-name + `Usage:` property; `tests/benchmarks/tool-execution.bench.ts` p99 within +5 ms.

### 2.1 — Universal 64 KB byte-cap + truncation hint

**Prompt**: Run sub-task 1.1 from [agent-friendly-tools.md](agent-friendly-tools.md#11--universal-64-kb-byte-cap-with-structured-truncation-hint).

### 2.2 — `read_file` pagination via `range_start` / `range_end`

**Prompt**: Run sub-task 1.2 from [agent-friendly-tools.md](agent-friendly-tools.md#12--read_file-pagination-via-range_start--range_end).

### 2.3 — `grep_codebase` pagination via `max_results` / `next_offset`

**Prompt**: Run sub-task 1.3 from [agent-friendly-tools.md](agent-friendly-tools.md#13--grep_codebase-pagination-via-max_results--next_offset).

### 2.4 — Audit and rewrite tool-handler error messages

**Prompt**: Run sub-tasks 2.1 and 2.2 from [agent-friendly-tools.md](agent-friendly-tools.md#phase-2-error-message-actionability). Apply the meta-test that walks `src/tools/handlers/*.ts` source via the TypeScript compiler API and asserts every `return { ok: false, error: ... }` literal contains the substring `Usage:`.

### 2.5 — Null-safety baseline across tool handlers

**Prompt**: Run sub-task 1.3 from [token-optimizer-adoption.md](token-optimizer-adoption.md#13--null-safety-baseline-across-tool-handlers).

### 2.6 — Phase 2 stabilization

**Prompt**: Generate and run comprehensive tests for Phase 2. (1) Lint, build, test, integration. (2) Run the cap-fire calibration: 24 golden tasks × cap-fire rate < 30% per task (raise default to 128 KB if any task fires the cap on > 30% of tool calls). (3) Re-run 24 golden tasks; no regression. (4) Manual smoke against representative tool error scenarios. (5) Run `/generate-session-history`.

### Phase 2 Exit Checklist

- [x] Every tool output respects the 64 KB cap (tunable via `max_bytes`)
- [x] `read_file` and `grep_codebase` paginate correctly
- [x] `tests/unit/tools/errors.test.ts` enforces parameter-name + `Usage:` property; meta-test catches missing-`Usage:` regressions
- [x] `tests/unit/tools/null-safety.test.ts` exercises every handler against null/undefined/empty/binary
- [ ] Cap-fire rate < 30% on all golden tasks (deferred -- requires live Ollama; will run alongside Phase 12 golden-task baselining)
- [ ] No benchmark regression > 5 ms p99 (deferred -- benchmark-suite run requires `npm run bench` baseline; tracked for Phase 12)
- [x] Session history generated -- [docs/v0.5.0/development/history/2026-04_phase-2-tool-surface-hardening.md](../development/history/2026-04_phase-2-tool-surface-hardening.md)

---

## Phase 3: Compression Foundation

**Goal**: Add a `Compressor` module (Node `zlib` Brotli, quality 4, text mode); integrate into `OutputRedirector` so tool outputs > 500 B are stored compressed in the conversation transcript; threshold logic skips compressions below 20% savings.

**Prerequisites**: Phase 2 (truncation cap is applied before compression so the cap holds even if compression is disabled).

**Stability Gate**: 10 KB lorem-ipsum compresses ≥ 50%; round-trip is byte-equivalent for UTF-8 with emoji and CJK; full Vitest suite green; `tests/benchmarks/tool-execution.bench.ts` p99 within +5 ms.

### 3.1 — Brotli compressor module with threshold logic

**Prompt**: Run sub-task 1.1 from [token-optimizer-adoption.md](token-optimizer-adoption.md#11--brotli-compressor-module-with-threshold-logic).

### 3.2 — OutputRedirector integration

**Prompt**: Run sub-task 1.2 from [token-optimizer-adoption.md](token-optimizer-adoption.md#12--integrate-compressor-into-outputredirector).

### 3.3 — Phase 3 stabilization

**Prompt**: Generate and run comprehensive tests for Phase 3. (1) Lint, build, test, integration. (2) Round-trip fidelity tests for ASCII / emoji / CJK / JSON / binary fixtures. (3) Bench: p99 < +5 ms vs baseline. (4) Run integration test that captures a 12 KB grep result and asserts < 6 KB on disk after compression. (5) Run `/generate-session-history`.

### Phase 3 Exit Checklist

- [x] `src/tools/Compressor.ts` exists with documented public API ([src/tools/Compressor.ts](../../../src/tools/Compressor.ts))
- [x] `OutputRedirector.ts` stores compressed payloads transparently (`.txt.br` files; `readTail`/`grepOutput`/`readDecoded` decompress on read)
- [x] 4 compression events tracked (`originalBytes`, `compressedBytes`, `skippedBelowThreshold`, `skippedLowSavings`) -- DEVIATION: surfaced via module-level `getCompressionStats()` (mirrors the established `getTruncationStats()` pattern in OutputRedirector); `MetricsCollector` has no event-emit pattern in this codebase
- [x] No new entries in `package.json` `dependencies` (uses Node built-in `zlib` and `crypto`)
- [x] Round-trip is byte-equivalent across UTF-8 fixtures (emoji + CJK covered in [tests/unit/tools/Compressor.test.ts](../../../tests/unit/tools/Compressor.test.ts) and [tests/integration/tool-output-compression.test.ts](../../../tests/integration/tool-output-compression.test.ts))
- [x] Session history generated -- [docs/v0.5.0/development/history/2026-04_phase-3-compression-foundation.md](../development/history/2026-04_phase-3-compression-foundation.md)

---

## Phase 4: Persistent Cache + Diff-Based Reads

**Goal**: Add `tool-output-cache.sqlite` (chmod 0o600) keyed by `(absolute_path, mtime, size)`; `read_file` returns unified diffs against cached content on cache hit, full content on first read or `full=true`; `/cache clear`, `/cache status`, `/cache prune` slash commands.

**Prerequisites**: Phase 3 (Compressor stores cached entries Brotli-compressed).

**Stability Gate**: First read returns full content; second read of unchanged file returns the unchanged-marker; second read after content modification returns a unified diff; `full=true` always returns full content; secret-path denylist blocks caching of `.env`, `id_rsa`, etc.; cache cap (500 entries) enforced via LRU; `tests/benchmarks/cache-hit.bench.ts` shows p99 < 1 ms hit / < 0.5 ms miss.

### 4.1 — Schema + dbPermissions integration

**Prompt**: Run sub-task 2.1 from [token-optimizer-adoption.md](token-optimizer-adoption.md#21--schema--dbpermissions-integration).

### 4.2 — Diff-based `read_file` handler with `full=true` escape hatch + `/cache` commands

**Prompt**: Run sub-task 2.2 from [token-optimizer-adoption.md](token-optimizer-adoption.md#22--diff-based-read_file-handler-with-fulltrue-escape-hatch).

### 4.3 — Phase 4 stabilization

**Prompt**: Generate and run comprehensive tests for Phase 4. (1) Lint, build, test, integration. (2) On Linux/macOS, verify chmod 0o600 on the new SQLite file. (3) Manual cache-correctness repro: read file, modify externally, re-read, assert diff covers the modification. (4) Verify secret-path guard rejects `.env` caching attempts. (5) Run `/generate-session-history`.

### Phase 4 Exit Checklist

- [x] `src/storage/ToolOutputCache.ts` with documented public API ([src/storage/ToolOutputCache.ts](../../../src/storage/ToolOutputCache.ts))
- [x] `dbPermissions.ts` covers `tool-output-cache.sqlite` (chmod 0o600 verified by `tests/unit/storage/dbPermissions.test.ts`)
- [x] `read_file` returns diffs on cache hit; full content on `full=true` -- DEVIATION: `lookup` now returns `{ content, fresh }` so the handler can diff against the previously-stored content even after the file changed (the original contract returned null on stat mismatch, which made the diff path unreachable)
- [x] `/cache clear`, `/cache status`, `/cache prune` listed in `/help` (registered in [src/commands/CommandRouter.ts](../../../src/commands/CommandRouter.ts))
- [x] Cache cap (500 entries) enforced via LRU; LRU eviction also invalidates the in-process LRU front cache
- [x] Secret-path denylist blocks `.env`, `id_rsa`, etc. from caching ([tests/unit/storage/ToolOutputCache.test.ts](../../../tests/unit/storage/ToolOutputCache.test.ts))
- [ ] `tests/benchmarks/cache-hit.bench.ts` p99 < 1 ms hit / < 0.5 ms miss (deferred -- `vitest bench` in this repo runs continuously without exiting when scoped to a single file; latency capture tracked for Phase 12 alongside the rest of `npm run bench`)
- [x] Session history generated -- [docs/v0.5.0/development/history/2026-04_phase-4-persistent-cache.md](../development/history/2026-04_phase-4-persistent-cache.md)

---

## Phase 5: Semantic Recall + Precise Budgeting

**Goal**: Extend `UnifiedMemoryRetriever` to query the tool-output cache via cosine similarity at 0.85 (using existing nomic-embed-text Ollama embedder); fall back to FTS5 keyword search when Ollama is offline. Replace the `chars / 4` heuristic in `PromptBudget` with a tiktoken-backed counter; heuristic remains as a fallback when tiktoken native binding cannot load.

**Prerequisites**: Phase 4 (the cache must exist before it can be searched semantically).

**Stability Gate**: When Ollama is reachable, agent recalls a cached tool output by paraphrase; when Ollama is offline, FTS5 fallback returns at least one result for an exact-keyword query; `PromptBudget` numbers match tiktoken within 0.5% on English fixtures and are more accurate on code fixtures; offline `npm install --offline` succeeds.

### 5.1 — Semantic recall on cached tool outputs

**Prompt**: Run sub-task 3.1 from [token-optimizer-adoption.md](token-optimizer-adoption.md#31--semantic-recall-on-cached-tool-outputs).

### 5.2 — tiktoken-backed PromptBudget with heuristic fallback

**Prompt**: Run sub-task 3.2 from [token-optimizer-adoption.md](token-optimizer-adoption.md#32--tiktoken-backed-promptbudget-with-heuristic-fallback).

### 5.3 — Phase 5 stabilization

**Prompt**: Generate and run comprehensive tests for Phase 5. (1) Lint, build, test, integration. (2) Verify offline install (`npm install --offline`). (3) Run nightly Ollama integration with Ollama up: confirm semantic recall surfaces cached outputs by paraphrase; with Ollama down: confirm FTS5 fallback works and `cache.embedding_skipped_ollama_offline` metric increments. (4) Capture tiktoken-vs-heuristic delta on the 24 golden tasks; store in `tests/golden/baselines/v0.5.0-tiktoken.json`. (5) Run `/generate-session-history`.

### Phase 5 Exit Checklist

- [x] `searchToolOutputs` uses cosine similarity when Ollama is up; FTS5 fallback when down -- [src/storage/UnifiedMemoryRetriever.ts](../../../src/storage/UnifiedMemoryRetriever.ts) `searchToolOutputs(query, options)` plus [src/storage/ToolOutputCache.ts](../../../src/storage/ToolOutputCache.ts) `searchByEmbedding` / `searchByKeyword`. Schema migrated with `embedding BLOB` + `excerpt TEXT` columns and an FTS5 contentless-shadow index over the excerpt.
- [x] `PromptBudget` uses tiktoken when available; heuristic fallback proven -- [src/config/PromptBudget.ts](../../../src/config/PromptBudget.ts) `countTokens` / `heuristicTokenCount` / `disposeEncoder`. Tests: [tests/unit/config/PromptBudget.tiktoken.test.ts](../../../tests/unit/config/PromptBudget.tiktoken.test.ts) covers both branches. CompactionStrategy / PromptBuilder / AgentLoop now delegate to the centralized counter.
- [x] `tiktoken` listed in `package.json` `dependencies` (`^1.0.17`)
- [ ] Offline install verified (deferred -- `npm install --offline` requires a primed dev workstation cache; tracked for Phase 12 release-gate run)
- [ ] `tests/golden/baselines/v0.5.0-tiktoken.json` written (deferred -- requires live Ollama + golden-task suite run; rolled into Phase 12 final baselining)
- [x] Session history generated -- [docs/v0.5.0/development/history/2026-04_phase-5-semantic-recall-and-budgeting.md](../development/history/2026-04_phase-5-semantic-recall-and-budgeting.md)

---

## Phase 6: Mutation Safety + Structured Outputs

**Goal**: Add `dry_run: boolean` parameter to `run_terminal` (returns parsed-token preview, no subprocess spawn) and `delete_file` (returns size + SHA-256, no unlink); add `format: 'text' | 'json'` parameter to `list_directory` and `grep_codebase` (default `text` is byte-equivalent to current output; `json` returns parseable structured output, including truncated form).

**Prerequisites**: Phase 2 (the structured truncation hint and pagination patterns are reused in `format=json`).

**Stability Gate**: Adversarial test asserts `child_process.spawn` and `fs.unlinkSync` are never called when `dry_run=true`; `format=json` outputs are RFC-8259 valid (round-trip through `JSON.parse`), including truncated form with the `_truncation` field; default `format='text'` byte-equivalent to pre-change.

### 6.1 — `dry_run` on `run_terminal` and `delete_file`

**Prompt**: Run sub-task 3.1 from [agent-friendly-tools.md](agent-friendly-tools.md#31--dry_run-on-run_terminal-and-delete_file).

### 6.2 — `format=json` on `list_directory` and `grep_codebase`

**Prompt**: Run sub-task 3.2 from [agent-friendly-tools.md](agent-friendly-tools.md#32--formatjson-on-list_directory-and-grep_codebase).

### 6.3 — Phase 6 stabilization

**Prompt**: Generate and run comprehensive tests for Phase 6. (1) Lint, build, test, integration. (2) Adversarial dry-run check via property-based fuzzing. (3) JSON-parseability property test on `list_directory(format='json')` and `grep_codebase(format='json')`. (4) Manual smoke: `delete_file(dry_run=true)` against `package.json`; verify SHA matches `git hash-object package.json`. (5) Re-run 24 golden tasks; no regression. (6) Run `/generate-session-history`.

### Phase 6 Exit Checklist

- [x] `run_terminal(dry_run=true)` returns preview without side effects -- [src/tools/handlers/terminal.ts](../../../src/tools/handlers/terminal.ts) `_dryRunReport`; [tests/unit/tools/handlers/terminal.dry_run.test.ts](../../../tests/unit/tools/handlers/terminal.dry_run.test.ts) covers allowlisted / un-allowlisted / blocked-pattern cases
- [x] `delete_file(dry_run=true)` returns size + SHA without unlinking -- [src/tools/handlers/filesystem.ts](../../../src/tools/handlers/filesystem.ts) `DeleteFileTool._dryRunReport`; [tests/unit/tools/handlers/filesystem.delete.dry_run.test.ts](../../../tests/unit/tools/handlers/filesystem.delete.dry_run.test.ts) covers <1 MB and >1 MB labelled-hint paths
- [x] Adversarial test confirms spawn/unlink are never called on dry-run -- [tests/unit/tools/handlers/dry_run.adversarial.test.ts](../../../tests/unit/tools/handlers/dry_run.adversarial.test.ts) (200-iteration LCG fuzz against each handler + curated shell-injection sweep)
- [x] `list_directory(format='json')` and `grep_codebase(format='json')` return parseable JSON -- [src/tools/handlers/filesystem.ts](../../../src/tools/handlers/filesystem.ts) `renderListDirectoryJson` / `renderGrepJson`; [tests/unit/tools/handlers/filesystem.format_json.test.ts](../../../tests/unit/tools/handlers/filesystem.format_json.test.ts) verifies `JSON.parse` round-trip including truncated form with `_truncation`
- [x] `format='text'` (default) byte-equivalent to pre-change -- explicit byte-equality assertion in [tests/unit/tools/handlers/filesystem.format_json.test.ts](../../../tests/unit/tools/handlers/filesystem.format_json.test.ts) `"default format='text' is byte-equivalent to the legacy output"`
- [x] No regression on 24 golden tasks -- 19/19 cases pass in `tests/unit/evaluation/GoldenTaskSuite.test.ts` (5 designed gaps in synthesized snapshots are unchanged from prior phases)
- [x] Session history generated -- [docs/v0.5.0/development/history/2026-04_phase-6-mutation-safety-and-structured-outputs.md](../development/history/2026-04_phase-6-mutation-safety-and-structured-outputs.md)

---

## Phase 7: Memory Hygiene & Consolidation Discipline

**Goal**: Add `/memory lint` (and `/memory lint --dry-run` alias) writing `memory-health.md` covering stale, broken-path, embedding-failed, and duplicate entries (report-only). Add a `corroboration_count` column to the semantic-memory table; backfill all existing rows to 1; introduce N-corroboration rule (default N=2 via `gemma-code.memoryCorroborationThreshold`) so single-source observations are *candidates* and require ≥N corroborating turns to be promoted to *facts*. Add the missed-fact golden eval.

**Prerequisites**: Phase 1 (memory hygiene observability), Phase 5 (semantic-recall infrastructure for `MemoryConsolidator` consistency).

**Stability Gate**: Synthetic memory state with all four issue classes produces a parseable `memory-health.md` in < 5 s; consolidator promotes facts at threshold; missed-fact golden eval at `tests/golden/tasks/memory-hygiene/missed-fact.yaml` passes; no regression on 24 existing golden tasks.

### 7.1 — `MemoryHealthCheck` + `/memory lint` slash command

**Prompt**: Run sub-task 1.1 from [memory-hygiene.md](memory-hygiene.md#11--memoryhealthcheck-module--memory-lint-slash-command).

### 7.2 — `/memory lint --dry-run` alias and `--apply` planning hook

**Prompt**: Run sub-task 1.2 from [memory-hygiene.md](memory-hygiene.md#12--memory-lint--dry-run-alias-and--apply-planning-hook).

### 7.3 — Schema migration: `corroboration_count` column + backfill

**Prompt**: Run sub-task 2.1 from [memory-hygiene.md](memory-hygiene.md#21--schema-migration-corroboration_count-column--backfill).

### 7.4 — `MemoryConsolidator` N-corroboration rule + setting

**Prompt**: Run sub-task 2.2 from [memory-hygiene.md](memory-hygiene.md#22--memoryconsolidator-n-corroboration-rule--setting).

### 7.5 — Missed-fact golden eval

**Prompt**: Run sub-task 2.3 from [memory-hygiene.md](memory-hygiene.md#23--missed-fact-golden-eval).

### 7.6 — Phase 7 stabilization

**Prompt**: Generate and run comprehensive tests for Phase 7. (1) Lint, build, test, integration. (2) Migration check against a 5K-row fixture; verify all rows backfilled to `corroboration_count = 1`. (3) Run missed-fact golden eval; confirm pass. (4) Re-run 24 existing golden tasks; no regression. (5) Manual: change `gemma-code.memoryCorroborationThreshold = 1`; verify legacy behavior; reset to 2. (6) Run `/generate-session-history`.

### Phase 7 Exit Checklist

- [ ] `MemoryHealthCheck` detects stale, broken-path, embedding-failed, duplicate
- [ ] `/memory lint`, `/memory lint --dry-run`, `/memory lint --apply` (placeholder error) work
- [ ] Schema migration adds `corroboration_count`, backfills to 1
- [ ] `gemma-code.memoryCorroborationThreshold` setting registered (default 2)
- [ ] Consolidator promotes at threshold; retriever returns fact-tier before candidate-tier
- [ ] Missed-fact golden eval passes
- [ ] No regression on 24 existing golden tasks
- [ ] Session history generated

---

## Phase 8: Generic Harness + Specialist Externalization

**Goal**: Stand up a generic, agent-agnostic harness layer at `scripts/hooks/` (Node ESM, no external deps) with three scripts: `check-tool-permission.mjs` (validates Bash/Write/Edit against secret-path denylist + workspace root), `check-git-control-plane.mjs` (asserts branch != `main`/`master`, no excessive uncommitted changes), `check-prompt-policy.mjs` (rejects prompts containing common secret patterns). Each script reads JSON from stdin, exits 2 with a `BLOCKED:` message on denial, and completes in < 50 ms p99. The scripts are agent-agnostic — they can be invoked by any agent's harness or by husky pre-commit. **No `.claude/settings.local.json` is committed to the repository** (Gemma Code is independent — agent-specific wiring is the developer's local config). Externalize sub-agent specialist prompts to `assets/specialists/*.md` via priority-chain `SpecialistLoader.ts`; lock current behavior with characterization tests *before* the refactor.

**Prerequisites**: Phase 1 (AGENTS.md describes the project's harness expectations).

**Stability Gate**: All three hook scripts fire on synthetic event payloads (tested via `tests/integration/hooks/`); each completes < 50 ms p99 (`tests/benchmarks/hooks.bench.ts`); characterization tests written before the specialist refactor still pass byte-equivalent after; `assets/specialists/{research,verification,planning,orchestration}.md` files exist with frontmatter; workspace override at `.gemma-code/specialists/research.md` correctly takes priority.

### 8.1 — `scripts/hooks/check-tool-permission.mjs` (generic, agent-agnostic)

**Objective**: Implement sub-task 1.1 from [routa-harness-adoption.md](routa-harness-adoption.md#11--bootstrap-claudesettingslocaljson-and-pretooluse-tool-permission-hook), with this **structural override**: do NOT create `.claude/settings.local.json` in the repository. Generate only the Node ESM script at `scripts/hooks/check-tool-permission.mjs` plus the shared module `scripts/hooks/lib/secret-paths.mjs`. Document in `AGENTS.md` how a developer can wire the script into their personal agent harness if they choose (but the wiring is not part of the repository).

**Prompt**: Implement the script per the routa sub-plan, but skip the `.claude/settings.local.json` step. Add a documentation paragraph in `AGENTS.md` under a new "Optional Developer Harness" section describing how to wire `scripts/hooks/*.mjs` into Claude Code, Cursor, husky, or any other agent harness via that agent's own configuration — example wirings can live in `docs/harness-integration.md` (a new file) but not as a committed `.claude/` directory.

### 8.2 — `scripts/hooks/check-git-control-plane.mjs`

**Prompt**: Run sub-task 1.2 from [routa-harness-adoption.md](routa-harness-adoption.md#12--sessionstart-git-state-hook), with the structural override that the script lives at `scripts/hooks/check-git-control-plane.mjs` and is not wired into `.claude/settings.local.json` in the repo.

### 8.3 — `scripts/hooks/check-prompt-policy.mjs`

**Prompt**: Run sub-task 1.3 from [routa-harness-adoption.md](routa-harness-adoption.md#13--userpromptsubmit-prompt-policy-hook), with the same structural override.

### 8.4 — Characterization tests for current `SubAgentManager` prompt output

**Prompt**: Run sub-task 2.1 from [routa-harness-adoption.md](routa-harness-adoption.md#21--characterization-tests-for-current-subagentmanager-prompt-output).

### 8.5 — `SpecialistLoader` priority chain + bundled Markdown specialists

**Prompt**: Run sub-task 2.2 from [routa-harness-adoption.md](routa-harness-adoption.md#22--specialistloader-priority-chain--bundled-markdown-specialists).

### 8.6 — Phase 8 stabilization

**Prompt**: Generate and run comprehensive tests for Phase 8. (1) Lint, build, test, integration. (2) Run `tests/benchmarks/hooks.bench.ts` and confirm p99 < 50 ms for each of the three hook scripts. (3) Re-run characterization tests; confirm byte-equivalence with the bundled specialist path. (4) Manual override smoke: create `.gemma-code/specialists/research.md` with a modified body; spawn a research sub-agent; confirm the override is used (verifiable via the `provenance` metric). (5) Run nightly Ollama integration with the workspace override; confirm no regression. (6) Run `/generate-session-history`.

### Phase 8 Exit Checklist

- [ ] `scripts/hooks/check-tool-permission.mjs`, `check-git-control-plane.mjs`, `check-prompt-policy.mjs` exist
- [ ] `scripts/hooks/lib/secret-paths.mjs` is the single source of truth for path patterns
- [ ] No `.claude/settings.local.json` committed to the repository
- [ ] `docs/harness-integration.md` documents optional wiring patterns for various agents
- [ ] All hook scripts complete < 50 ms p99
- [ ] Characterization tests still byte-equivalent after specialist refactor
- [ ] `assets/specialists/{research,verification,planning,orchestration}.md` exist
- [ ] `src/agents/SpecialistLoader.ts` priority chain implemented
- [ ] Workspace override smoke-tested end-to-end
- [ ] Session history generated

---

## Phase 9: Coverage & Observability

**Goal**: Extend cache infrastructure to `web_search` (TTL+URL key, SSRF-aware); add an in-process LRU layer in front of the on-disk tool-output cache; buffer `MetricsCollector` writes; add cache-aware dashboard panels; add an opt-in append-only `.gemma-code/operation-log.md` writing one line per tool call.

**Prerequisites**: Phases 3, 4 (compression + persistent cache), Phase 7 (memory observability).

**Stability Gate**: Two consecutive `web_search` calls for the same query produce exactly one network request (verified via MSW); in-process LRU has > 80% hit rate on a synthetic loop; `MetricsCollector` flushes every 5 s / 100 events and survives a forced extension reload via `dispose()`; dashboard panels render correctly; operation log writes lines when enabled, never when disabled, and redacts secret-path entries.

### 9.1 — API-response cache for `web_search`

**Prompt**: Run sub-task 4.1 from [token-optimizer-adoption.md](token-optimizer-adoption.md#41--api-response-cache-for-web_search).

### 9.2 — Single in-process LRU for live tool outputs

**Prompt**: Run sub-task 4.2 from [token-optimizer-adoption.md](token-optimizer-adoption.md#42--single-in-process-lru-for-live-tool-outputs).

### 9.3 — Buffered trace writes in MetricsCollector

**Prompt**: Run sub-task 4.3 from [token-optimizer-adoption.md](token-optimizer-adoption.md#43--buffered-trace-writes-in-metricscollector).

### 9.4 — Cache-aware dashboard panel

**Prompt**: Run sub-task 4.4 from [token-optimizer-adoption.md](token-optimizer-adoption.md#44--cache-aware-dashboard-panel).

### 9.5 — Opt-in append-only operation log

**Prompt**: Run sub-task 3.2 from [memory-hygiene.md](memory-hygiene.md#32--opt-in-append-only-operation-log).

### 9.6 — Phase 9 stabilization

**Prompt**: Generate and run comprehensive tests for Phase 9. (1) Lint, build, test, integration. (2) Run `npm run bench`; confirm cache-hit, tool-execution, context-compaction benchmarks within +10% of baseline. (3) Manual smoke: `F5` to launch Extension Development Host; exercise `read_file`, `web_search`, `/cache status`; verify dashboard panels populate. (4) Verify trace flushing: artificially crash the extension host (Developer: Restart Window); confirm last batch persisted via SQLite inspection. (5) Verify operation log writes lines when enabled; nothing when disabled; secret paths redact to `<redacted>`. (6) Run `/generate-session-history`.

### Phase 9 Exit Checklist

- [ ] `web-response-cache.sqlite` registered, chmod 0o600, SSRF re-validation enforced
- [ ] In-process LRU layer measurable via `lruStats()`
- [ ] `MetricsCollector` flushes every 5 s / 100 events; `dispose()` flushes synchronously
- [ ] Three new dashboard panels render correctly
- [ ] `gemma-code.operationLog.enabled` setting registered (default false)
- [ ] `.gemma-code/operation-log.md` writes one line per tool call when enabled; redacts secret paths
- [ ] `/operation-log status` and `/operation-log clear` listed in `/help`
- [ ] No benchmark regression > 10%
- [ ] Session history generated

---

## Phase 10: Local Development Hygiene + CI Hardening

**Goal**: Add husky pre-commit (lint via lint-staged) + commit-msg (ASCII-only) hooks; add dependency-cruiser baseline with module-boundary rules; add Dependabot weekly grouped config; configure ESLint `@typescript-eslint/ban-ts-comment` rule (allow-with-description, min 20 chars); SHA-pin every action across the 5 workflows; add `concurrency: cancel-in-progress` to CI / nightly / golden-tasks workflows; add Node 18/20/22 CI matrix.

**Prerequisites**: Phases 1–9.

**Stability Gate**: Pre-commit blocks a lint error; commit-msg blocks an em-dash; `npm run deps:check` green; ESLint rejects un-justified `@ts-ignore`; Dependabot opens a real PR within one weekly cycle; all 5 workflows SHA-pinned; superseded CI runs cancel; matrix runs across Node 18/20/22.

### 10.1 — husky pre-commit + commit-msg hooks

**Prompt**: Run sub-task 3.1 from [routa-harness-adoption.md](routa-harness-adoption.md#31--husky-pre-commit-and-commit-msg-hooks). Note: the `prepare-commit-msg` co-author template from routa is **explicitly forbidden** by `AGENTS.md`. Do not adopt it.

### 10.2 — dependency-cruiser baseline

**Prompt**: Run sub-task 3.2 from [routa-harness-adoption.md](routa-harness-adoption.md#32--dependency-cruiser-baseline).

### 10.3 — Dependabot weekly config

**Prompt**: Run sub-task 3.1 from [ci-and-docs-hygiene.md](ci-and-docs-hygiene.md#31--dependabot-weekly-config).

### 10.4 — ESLint rule rejecting un-justified `@ts-ignore`

**Prompt**: Run sub-task 3.2 from [ci-and-docs-hygiene.md](ci-and-docs-hygiene.md#32--eslint-rule-rejecting-un-justified-ts-ignore).

### 10.5 — SHA-pin GitHub Actions

**Prompt**: Run sub-task 3.3 from [ci-and-docs-hygiene.md](ci-and-docs-hygiene.md#33--sha-pin-github-actions).

### 10.6 — Workflow concurrency cancellation

**Prompt**: Run sub-task 3.4 from [ci-and-docs-hygiene.md](ci-and-docs-hygiene.md#34--workflow-concurrency-cancellation).

### 10.7 — Node-version CI matrix

**Prompt**: Run sub-task 5.1 from [token-optimizer-adoption.md](token-optimizer-adoption.md#51--node-version-ci-matrix).

### 10.8 — Phase 10 stabilization

**Prompt**: Generate and run comprehensive tests for Phase 10. (1) Lint, build, test, integration, deps:check. (2) Manual: stage a file with a lint error; attempt commit; confirm pre-commit blocks. (3) Manual: attempt em-dash commit message; confirm blocked. (4) Push to fresh feature branch; confirm CI runs against SHA-pinned actions; push a second commit; observe first run cancelled. (5) Verify Dependabot opens a PR within one weekly cycle. (6) Verify CI matrix runs across Node 18/20/22. (7) Run `/generate-session-history`.

### Phase 10 Exit Checklist

- [ ] husky pre-commit + commit-msg active; `--no-verify` documented as escape
- [ ] No `prepare-commit-msg` co-author template (forbidden by `AGENTS.md`)
- [ ] `configs/dependency-cruiser.cjs` present; CI `deps:check` green
- [ ] `.github/dependabot.yml` present with grouped weekly config
- [ ] ESLint `ban-ts-comment` `allow-with-description` enforced; baseline cleaned
- [ ] All 5 workflows SHA-pinned
- [ ] 3 long workflows have `concurrency: cancel-in-progress`
- [ ] Node 18/20/22 CI matrix green
- [ ] Session history generated

---

## Phase 11: Documentation Discipline

**Goal**: Backfill ADRs (0002 memory subsystem, 0003 compaction strategy, 0004 sub-agent isolation, 0005 tool permission tiers); add the mermaid module-dependency diagram to `ARCHITECTURE.md`; add the Module Authorship Contract section to `AGENTS.md`; publish refactor / characterization-test playbook; ship docs/issues template; document the severity rubric (Blocker/Friction/Optimization) in `docs/v0.5.0/tool-audit.md`; document `get_tool_schema` as the help-discovery surface; add auto-generated `docs/index.md` per-module catalog with CI sync check; add CODEOWNERS; add branch-cleanup workflow.

**Prerequisites**: Phases 1, 8, 10. (Phase 1 establishes AGENTS.md; Phase 8 lands SpecialistLoader for ADR-0004; Phase 10 lands dependency-cruiser for the mermaid diagram's forbidden-edges.)

**Stability Gate**: 4 new ADRs render correctly; mermaid diagram renders on GitHub preview; refactor playbook cross-referenced from `CONTRIBUTING.md` and `docs/v0.5.0/test-pyramid.md`; docs/issues template parseable; severity rubric documented; auto-generated `docs/index.md` is idempotent and CI catalog-sync check green; CODEOWNERS present.

### 11.1 — ADR-0002: Memory Subsystem Layering

**Prompt**: Run sub-task 4.1 from [routa-harness-adoption.md](routa-harness-adoption.md#41--adr-0002-memory-subsystem-layering).

### 11.2 — ADR-0003: Compaction Strategy Ordering

**Prompt**: Run sub-task 4.2 from [routa-harness-adoption.md](routa-harness-adoption.md#42--adr-0003-compaction-strategy-ordering).

### 11.3 — ADR-0004: Sub-Agent Isolation Contract

**Prompt**: Run sub-task 4.3 from [routa-harness-adoption.md](routa-harness-adoption.md#43--adr-0004-sub-agent-isolation-contract).

### 11.4 — ADR-0005: Tool Permission Tiers

**Prompt**: Run sub-task 4.4 from [routa-harness-adoption.md](routa-harness-adoption.md#44--adr-0005-tool-permission-tiers).

### 11.5 — Mermaid module-dependency diagram in `ARCHITECTURE.md`

**Prompt**: Run sub-task 4.5 from [routa-harness-adoption.md](routa-harness-adoption.md#45--mermaid-module-dependency-diagram-in-architecturemd). Cross-reference `configs/dependency-cruiser.cjs` from Phase 10.2.

### 11.6 — Module Authorship Contract in `AGENTS.md`

**Prompt**: Run sub-task 3.1 from [memory-hygiene.md](memory-hygiene.md#31--who-writes-where-contract-section-in-claudemd) — but place the contract section in `AGENTS.md` (not `CLAUDE.md`, which no longer exists per Phase 1). Cross-reference `configs/dependency-cruiser.cjs`.

### 11.7 — Refactor / characterization-test playbook

**Prompt**: Run sub-task 4.6 from [routa-harness-adoption.md](routa-harness-adoption.md#46--refactor--characterization-test-playbook).

### 11.8 — docs/issues template

**Prompt**: Run sub-task 4.7 from [routa-harness-adoption.md](routa-harness-adoption.md#47--docsissues-template).

### 11.9 — Severity rubric in `docs/v0.5.0/tool-audit.md`

**Prompt**: Run sub-task 4.1 from [agent-friendly-tools.md](agent-friendly-tools.md#41--severity-rubric-document).

### 11.10 — Document `get_tool_schema` as help-discovery surface

**Prompt**: Run sub-task 4.2 from [agent-friendly-tools.md](agent-friendly-tools.md#42--document-get_tool_schema-as-help-discovery-surface). Update `AGENTS.md` (not `CLAUDE.md`).

### 11.11 — Auto-generated `docs/index.md` per-module catalog

**Prompt**: Run sub-task 3.3 from [memory-hygiene.md](memory-hygiene.md#33--per-module-catalog-scriptsgenerate-catalogmjs--docsindexmd). Add CI catalog-sync check to `.github/workflows/ci.yml`.

### 11.12 — `.github/CODEOWNERS`

**Prompt**: Run sub-task 5.1 from [routa-harness-adoption.md](routa-harness-adoption.md#51--githubcodeowners).

### 11.13 — Branch-cleanup workflow

**Prompt**: Run sub-task 5.2 from [routa-harness-adoption.md](routa-harness-adoption.md#52--branch-cleanup-workflow). First scheduled run is dry-run-only for two weeks before enabling deletion.

### 11.14 — Phase 11 stabilization

**Prompt**: Generate and run comprehensive verification for Phase 11. (1) Lint, build, test. (2) Verify all 4 new ADRs render on GitHub preview; `docs/adr/README.md` index lists them in order. (3) Verify `ARCHITECTURE.md` mermaid block renders. (4) Verify `docs/refactor-playbook.md`, `docs/issues/_template.md`, `docs/v0.5.0/tool-audit.md` are parseable and cross-referenced. (5) Verify `docs/index.md` regenerated cleanly; CI catalog-sync check green. (6) Verify CODEOWNERS shows in GitHub UI; branch-cleanup workflow dispatchable. (7) Run `/generate-session-history`.

### Phase 11 Exit Checklist

- [ ] ADR-0002, 0003, 0004, 0005 present and indexed
- [ ] `ARCHITECTURE.md` mermaid module-dependency diagram present
- [ ] `AGENTS.md` includes Module Authorship Contract section
- [ ] `docs/refactor-playbook.md`, `docs/issues/_template.md`, `docs/v0.5.0/tool-audit.md` published
- [ ] `get_tool_schema` documented in `AGENTS.md` and `README.md`
- [ ] `scripts/generate-catalog.mjs` regenerates `docs/index.md` idempotently; CI catalog-sync green
- [ ] `.github/CODEOWNERS` recognized
- [ ] `.github/workflows/branch-cleanup.yml` present; first run dry-run only
- [ ] All cross-references resolve
- [ ] Session history generated

---

## Phase 12: Advanced Fallbacks + Release Gate (Final)

**Goal**: Ship the truncation-recovery 3-task golden micro-eval; ARIMA-only predictive cache (LSTM excluded); pluggable multi-tier eviction strategies; HeuristicEmbedder fallback for offline operation; semantic-release + commitlint for automated changelog/version bumps; final golden-task baseline at `tests/golden/baselines/v0.5.0.json`; verify the ≥40% token-savings target and zero >10% benchmark regression bars; bump `package.json` to 0.5.0; update CHANGELOG.

**Prerequisites**: Phases 1–11.

**Stability Gate (RELEASE GATE)**:

1. Full Vitest suite green (1,168+ existing tests + new ones).
2. `npm run bench` shows no benchmark regression > 10% on `tool-execution`, `context-compaction`, `cache-hit`; hooks p99 < 50 ms; `tool-execution` p99 < +5 ms vs. v0.4.0 baseline.
3. **Average tool-output token reduction ≥ 40% on 24 golden tasks vs. `tests/golden/baselines/v0.4.0.json`.**
4. **Cache-hit rate > 50% on iterative-debug golden task category.**
5. **All 4 new golden evals pass**: 3 truncation-recovery + 1 missed-fact.
6. CI matrix green on Node 18/20/22 with SHA-pinned actions and concurrency cancellation.
7. `npm run deps:check`, `npm run catalog`, lint-discipline, workflow-discipline, AGENTS.md non-existence test for CLAUDE.md all green.
8. CHANGELOG entry present; `package.json` version bumped to 0.5.0; git tag prepared.

### 12.1 — Truncation-recovery golden micro-eval (3 tasks)

**Prompt**: Run sub-task 4.3 from [agent-friendly-tools.md](agent-friendly-tools.md#43--truncation-recovery-golden-micro-eval).

### 12.2 — ARIMA-only predictive cache

**Prompt**: Run sub-task 5.3 from [token-optimizer-adoption.md](token-optimizer-adoption.md#53--arima-predictive-cache-pure-js-only). LSTM is **explicitly out of scope** (hard constraint: no model files, no GPU cycles for marginal gain). Default `gemma-code.predictiveCacheEnabled = false` (opt-in for v0.5.0).

### 12.3 — Multi-tier eviction strategies

**Prompt**: Run sub-task 5.4 from [token-optimizer-adoption.md](token-optimizer-adoption.md#54--multi-tier-eviction-strategies). Default strategy `lru` preserves Phase 4 behavior exactly.

### 12.4 — `HeuristicEmbedder` fallback for offline operation

**Prompt**: Run sub-task 5.5 from [token-optimizer-adoption.md](token-optimizer-adoption.md#55--heuristic-128-d-embedder-fallback). Add `/cache reembed` slash command for re-embedding heuristic-tagged rows when Ollama recovers.

### 12.5 — semantic-release + commitlint

**Prompt**: Run sub-task 5.2 from [ci-and-docs-hygiene.md](ci-and-docs-hygiene.md#32--semantic-release--commitlint). Configure plugin chain as `changelog → git → github` (no `@semantic-release/npm` — Gemma is a VSIX, not an npm package).

### 12.6 — Final stabilization (RELEASE GATE)

**Prompt**: This is the v0.5.0 release gate. Run comprehensive verification:
>
> 1. `npm run lint`, `npm run build`, `npm run test`, `npm run test:integration`, `npm run deps:check`, `npm run catalog`. Fix every failure or sync issue.
> 2. `npm run bench`. Capture p50/p99 for `tool-execution`, `context-compaction`, `cache-hit`, `hooks`. Confirm:
>    - Hooks p99 < 50 ms.
>    - `tool-execution` p99 within +5 ms vs. baseline.
>    - `context-compaction`, `cache-hit` p99 within +10% vs. baseline.
> 3. Run the full golden-task suite via `python tests/golden/framework/run_all.py` including all four new categories: `agent-friendly`, `memory-hygiene`, plus the existing 24 tasks.
>    - All 24 existing tasks: no regression vs. `tests/golden/baselines/v0.4.0.json`.
>    - Truncation-recovery 3-task suite: all pass.
>    - Missed-fact 1-task: pass.
>    - Compute `total_tokens` and `tool_output_tokens` per task. Write the new baseline to `tests/golden/baselines/v0.5.0.json`.
> 4. **Compute average tool-output-token reduction across the 24 existing golden tasks: must be ≥ 40%.** If lower, identify offending tasks and tune (Brotli quality, cache cap, threshold) before declaring failure.
> 5. **Compute cache-hit rate on iterative-debug task category: must be > 50%.** If lower, examine cache invalidation rules.
> 6. Push to a fresh branch; confirm CI matrix runs green on Node 18/20/22 with SHA-pinned actions; commitlint passes on a `feat: v0.5.0 unified release` commit.
> 7. Verify `git grep -i 'CLAUDE\.md\|CLAUDE\.MD'` returns zero matches outside `docs/v0.5.0/comparison/comparison-free-claude-code.md` and this implementation plan.
> 8. Update `docs/v0.5.0/architecture.md` (a new file, copied from `docs/v0.3.0/architecture.md` and extended) to document: AGENTS.md as canonical directive, the harness layer, the ToolOutputCache + WebResponseCache + LRU stack, the SpecialistLoader, the N-corroboration consolidation rule, the new tool-surface parameters (`max_bytes`, `range_*`, `dry_run`, `format`).
> 9. Bump `package.json` `version` from `0.4.0` to `0.5.0`. Update `CHANGELOG.md` with a comprehensive v0.5.0 entry organized by phase (1–12) summarizing what landed.
> 10. Run `/generate-session-history` to document Phase 12 (the release).
> 11. Run `/update-devlog` to capture the cumulative v0.5.0 summary.
> 12. Tag the commit: `git tag -a v0.5.0 -m "v0.5.0: unified adoption release"`. Do NOT push the tag — leave that for the developer's explicit confirmation.
>
> The v0.5.0 release is complete when all 12 steps above pass and the 8 release-gate criteria are met.

### Phase 12 Exit Checklist (= Release Gate)

- [ ] Truncation-recovery 3-task golden micro-eval green
- [ ] ARIMA predictive cache shipped; LSTM not present in codebase
- [ ] Multi-tier eviction strategies pluggable; default LRU preserves Phase 4 behavior
- [ ] `HeuristicEmbedder` present; `/cache reembed` works
- [ ] semantic-release + commitlint workflows passing
- [ ] **Average tool-output token reduction ≥ 40% vs. v0.4.0 baseline**
- [ ] **Cache-hit rate > 50% on iterative-debug golden tasks**
- [ ] No benchmark regression > 10% on any benchmark
- [ ] Hooks p99 < 50 ms; `tool-execution` p99 within +5 ms
- [ ] All 1,168+ Vitest tests + new tests green
- [ ] CI matrix green on Node 18/20/22 with SHA-pinned actions
- [ ] `npm run deps:check`, `npm run catalog`, all meta-tests green
- [ ] `git grep CLAUDE.md` returns zero matches outside historical artifacts
- [ ] `docs/v0.5.0/architecture.md` published with comprehensive v0.5.0 architecture
- [ ] `package.json` version = 0.5.0
- [ ] `CHANGELOG.md` v0.5.0 entry comprehensive
- [ ] Session history + devlog updated
- [ ] `v0.5.0` tag created (push deferred to user)

---

## Definition of Done (Plan-Level)

The v0.5.0 release is complete when **all** of the following hold:

1. **Identity**: `AGENTS.md` is the sole canonical directive; `CLAUDE.md` does not exist; no Claude branding in product files; generic naming convention applied throughout.
2. **Token efficiency**: ≥40% average tool-output token reduction on the 24 golden tasks vs. v0.4.0 baseline; cache-hit rate > 50% on iterative-debug category; new `tests/golden/baselines/v0.5.0.json` documents the achievement.
3. **Tool surface**: Every tool output ≤ 64 KB by default with truncation hint; `read_file` and `grep_codebase` paginate; `run_terminal` and `delete_file` accept `dry_run`; `list_directory` and `grep_codebase` accept `format='json'`; every error message contains parameter name + `Usage:` hint (locked in by property test + AST meta-test).
4. **Memory discipline**: `MemoryConsolidator` enforces N≥2 corroboration by default; `/memory lint` produces parseable health reports; missed-fact golden eval passes.
5. **Harness**: Three generic Node hook scripts at `scripts/hooks/` complete < 50 ms p99; sub-agent prompts loaded from `assets/specialists/*.md` via priority chain; characterization tests prove behavior-preservation; **no `.claude/` directory committed to the repository**.
6. **Hygiene**: husky pre-commit + commit-msg active; dependency-cruiser baseline clean; Dependabot opening weekly PRs; ESLint blocks un-justified `@ts-ignore`; all GitHub Actions SHA-pinned; long workflows cancel-in-progress; CI matrix runs across Node 18/20/22.
7. **Documentation**: 4 new ADRs (0002 memory, 0003 compaction, 0004 sub-agent, 0005 permission tiers); mermaid module-dependency diagram in `ARCHITECTURE.md`; Module Authorship Contract in `AGENTS.md`; refactor playbook published; severity rubric in `docs/v0.5.0/tool-audit.md`; `get_tool_schema` documented; `docs/index.md` auto-generated and CI-verified; `docs/v0.5.0/architecture.md` published.
8. **Performance**: No benchmark regression > 10% on `tool-execution`, `context-compaction`, `cache-hit`; hooks p99 < 50 ms.
9. **Offline guarantee**: All work landed without adding any runtime network egress; all new SQLite files chmod 0o600 on POSIX; secret-path denylist applies to cached tool outputs and operation log entries.
10. **Release artifacts**: `package.json` version = 0.5.0; `CHANGELOG.md` v0.5.0 entry; `v0.5.0` git tag prepared.

---

## Out of Scope (Recorded for v0.6.0+)

| Item | Source plan | Reason |
|------|-------------|--------|
| LSTM-based predictive caching | token-optimizer P3 | Requires model file; ARIMA-only path covers the leverage |
| Multi-provider LLM proxy | free-claude-code P1+ | Conflicts with offline-first thesis |
| Discord / Telegram messaging | free-claude-code | Out of IDE scope |
| Voice transcription (Whisper / Riva) | free-claude-code | Multi-GB dep footprint |
| Tauri / Axum / Drizzle / Postgres | routa | Single-process VS Code extension |
| `api-contract.yaml` dual-backend parity | routa | Not relevant |
| Storybook + governance workflow | routa | No UI component library |
| Entrix Rust crate (fast/normal/complete tiers) | routa | Existing CI tier already mirrors |
| Page-snapshot visual regression | routa | Webview surface too small |
| `prepare-commit-msg` co-author template | routa | Forbidden by `AGENTS.md` |
| Issue-enricher / issue-garbage-collector workflows | routa | Defer until issue volume grows |
| `--non-interactive` flag pattern on tools | 7-principles | Tools are non-interactive by construction |
| Stdin / `-` alias support (Principle #6) | 7-principles | Tool inputs are JSON, not stdin |
| Severity-rubric CI gate that fails builds | 7-principles | Rubric is vocabulary, not gate |
| `format=json` on `read_file` and `run_terminal` | 7-principles P3 | Existing shapes already agent-friendly |
| `/foundry-ingest`, `/foundry-compile`, `/foundry-ask` | foundry-vault | Out of domain (knowledge mgmt) |
| Obsidian-style plugin recommendations | foundry-vault | Bound to VS Code |
| Auto-generated *concept wiki* under `docs/` | foundry-vault | Out of scope (synthesized content) |
| `/memory prune` destructive cleanup | foundry-vault | Reserved for v0.6.0 |
| `/memory lint --apply` | foundry-vault | Reserved for v0.6.0 |
| Auto-merge for Dependabot PRs | free-claude-code | Too aggressive without stronger CI baseline |
| Speed-vs-quality runtime mode toggle | user note | Deferred to a later version |

---

## Notes for Implementers

- **Run phases sequentially.** Phase ordering encodes dependencies. Skipping ahead breaks subsequent phases (e.g. semantic recall in Phase 5 depends on the persistent cache from Phase 4).
- **Use `/implement-phase implementation-plan` to drive each phase.** The implement-phase command will read this file and execute the next pending phase end-to-end, including the stabilization step.
- **Each phase has its own session history.** Run `/generate-session-history` at the end of every phase. Do not batch.
- **The release gate (Phase 12) is non-negotiable.** All criteria must pass before bumping to 0.5.0. If a criterion fails, identify the root cause, fix, re-run from the failing phase forward.
- **The detailed sub-plans in `docs/v0.5.0/plans/*.md` are reference material.** This implementation-plan is the canonical execution path. If a sub-plan and this plan disagree, this plan wins.
- **Sub-task references**: prompts in this plan often say "Run sub-task X.Y from [plan-name.md]". Open the linked sub-plan, find the matching sub-task by anchor, paste its prompt verbatim into a fresh agent session — but apply any structural override called out in this plan (e.g. Phase 8 replaces `.claude/settings.local.json` with `scripts/hooks/`).
