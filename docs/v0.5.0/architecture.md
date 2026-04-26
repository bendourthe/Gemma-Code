# Gemma Code v0.5.0 -- Architecture

This document captures the v0.5.0 architecture: the canonical directives, the harness layer, the persistent-cache stack, the memory-consolidation rule, and the new tool-surface parameters that landed across phases 1-12. It complements [ARCHITECTURE.md](../../ARCHITECTURE.md) (which stays version-neutral) and supersedes [docs/v0.3.0/architecture.md](../v0.3.0/architecture.md) for the v0.5.0 release.

---

## 1. Identity and canonical directives

- `AGENTS.md` is the sole canonical agent directive. There is no `CLAUDE.md` anywhere in the repository -- enforced by a meta-test (`tests/unit/meta/no-claude-md.test.ts`) and verified at release time by `git grep -i 'CLAUDE\.md'`.
- The Module Authorship Contract in `AGENTS.md` defines the rules for adding modules: layering, error contracts, public-vs-internal exports, and where Zod schemas belong.
- The five comparison-driven adoption plans live under [docs/v0.5.0/comparison/](./comparison/) and the executable plans under [docs/v0.5.0/plans/](./plans/). The canonical execution path is [docs/v0.5.0/plans/implementation-plan.md](./plans/implementation-plan.md); sub-plans are reference material.

## 2. Harness layer

The "harness" is the shell that an agent (Claude Code, Cursor, custom CLI, husky) wires into the repo. v0.5.0 ships a generic harness with three principles:

1. **No agent-specific files committed.** The repository must build and test cleanly without `.claude/`, `.cursor/`, or any other vendor directory.
2. **Hooks live under `scripts/hooks/`.** Three Node ESM scripts are intentionally portable:
   - `check-commit-msg.mjs` -- ASCII-only enforcement; rejects em-dashes, curly quotes, ellipsis, CJK
   - `check-prompt-policy.mjs` -- per-workspace policy override surface for sub-agent prompts
   - `check-tool-permission.mjs` -- maps tool calls onto the permission tier (auto / confirm / dangerous)
   - `check-git-control-plane.mjs` -- guards destructive `git` flags (`--force`, `reset --hard`, etc.)
3. **Specialist prompts externalized.** Sub-agent prompts ship as Markdown under `assets/specialists/` (`research.md`, `planning.md`, `verification.md`, `orchestration.md`) and are loaded via a priority chain by `SpecialistLoader`:

```
<workspace>/.gemma-code/specialists/<role>.md   (workspace override; not committed)
        |
        v
<repo>/assets/specialists/<role>.md             (committed default)
```

Characterization tests in `tests/unit/specialists/` lock the prompts behind a behavior-preservation barrier so future edits are visible diffs.

## 3. Tool catalogue and permission tiers

`src/tools/ToolCatalog.ts` enumerates every tool the agent can call along with its schema (parameters, defaults, examples, severity tier). The agent discovers schemas at runtime via the meta-tool `get_tool_schema(tool_name='<name>')` -- the in-extension analog of `--help` (Principle 5 of the agent-friendly-CLI rubric). See [docs/v0.5.0/tool-audit.md](./tool-audit.md) for the per-tool severity row.

Permission tiers, codified in [docs/adr/0005-tool-permission-tiers.md](../adr/0005-tool-permission-tiers.md):

| Tier | Examples | Default behavior |
|------|----------|-------------------|
| 0 -- auto | `read_file`, `list_directory`, `grep_codebase` | Run silently |
| 1 -- confirm | `write_file`, `apply_edit`, `web_search` | One-click confirmation |
| 2 -- dangerous | `run_terminal`, `delete_file` | Blocking confirmation; `editMode: plan` shows a diff |

Users override per-tool tiers via `gemma-code.permissionOverrides`.

### v0.5.0 tool-surface parameters

| Tool | Phase | New parameter | Behavior |
|------|-------|---------------|----------|
| (all) | 2 | `max_bytes` | Per-call override of the 64 KB cap; ceiling 1 MB |
| `read_file` | 2 | `range_start`, `range_end` | Byte-range pagination; 1 MB max window |
| `grep_codebase` | 2 | `max_results`, `next_offset` | Cursor-based pagination; default 50 / max 500 |
| `run_terminal` | 6 | `dry_run` | Returns tokens + allowlist verdict without spawning |
| `delete_file` | 6 | `dry_run` | Returns size + SHA-256 (first 1 MB) without unlinking |
| `list_directory`, `grep_codebase` | 6 | `format` | `'text' \| 'json'`; default `'text'`. Truncated JSON includes a `_truncation` field so output stays parseable |

Every error path in `src/tools/handlers/*.ts` carries the failing parameter name and a `Usage:` hint, locked in by a property test plus an AST meta-test (`tests/unit/tools/errors.test.ts`).

## 4. Cache stack

```
+-----------------------------------------------------------------------+
|  In-process LRU (50 entries / 1 MB)        ToolOutputLru              |
|  - decoupled eviction policy via Evictor   src/storage/eviction/      |
|  - default LRU; LFU / ARC / W-TinyLFU /                              |
|    Clock pluggable via gemma-code.cacheEvictionStrategy              |
+-----------------------------------------------------------------------+
                          |
                          v
+-----------------------------------------------------------------------+
|  Persistent SQLite cache       ToolOutputCache                        |
|  <workspace>/.gemma-code/tool-output-cache.sqlite (chmod 0o600)       |
|  - keyed by (absolute_path, mtime_ms, size_bytes)                    |
|  - content_brotli BLOB (Brotli-compressed payload)                   |
|  - excerpt TEXT (first 4 KB; FTS5-indexed for keyword fallback)      |
|  - embedding BLOB (Float32; nomic-embed-text or heuristic)           |
|  - embedding_provenance TEXT ('ollama' | 'heuristic')                |
|  - capacity 500 entries; LRU eviction on insert                      |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
|  WebResponseCache              src/tools/handlers/webCache.ts         |
|  <workspace>/.gemma-code/web-response-cache.sqlite (chmod 0o600)      |
|  - fronts web_search; TTL-based eviction                             |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
|  Predictive layer (opt-in)     src/storage/PredictiveCache.ts         |
|  - per-path access timestamps; ARIMA(1,0,1) gradient-descent fit     |
|  - predict(topK) ranks paths by inverse predicted-arrival-delta      |
|  - off by default; gemma-code.predictiveCacheEnabled = false         |
|  - LSTM is explicitly out of scope                                   |
+-----------------------------------------------------------------------+
```

### Eviction strategies

`src/storage/eviction/` ships five pure-JS strategies behind a common `Evictor` interface (`onAccess` / `onInsert` / `onRemove` / `pickVictim` / `clear`):

- **LRU** -- preserves v0.4.0 behavior; default
- **LFU** -- ties broken by insertion order (oldest wins)
- **ARC** -- adaptive recency/frequency split with B1/B2 ghost lists
- **W-TinyLFU** -- 1% recency window + count-min sketch admission to a frequency-aware main region
- **Clock** -- second-chance approximation

Selectable via `gemma-code.cacheEvictionStrategy`. Unknown values fall back to LRU so a typo'd setting never bricks the cache.

### Embedding fallback

When Ollama is unreachable, `EmbeddingClient.embedWithProvenance` falls back to `HeuristicEmbedder` -- a deterministic 128-D embedder (hash + stats + bigram/trigram features) and tags the result with `provenance: 'heuristic'`. The cache row's `embedding_provenance` column tracks this so the search path can apply a higher cosine threshold (0.95+) for noisier signals. When Ollama recovers, `/cache reembed` walks the heuristic-tagged rows and upgrades them.

**Recall caveat**: heuristic embeddings are noisier than `nomic-embed-text`. Treat the fallback as "search keeps working offline" rather than "indistinguishable from full embedding".

## 5. Memory consolidation discipline

`MemoryConsolidator` (`src/storage/MemoryConsolidator.ts`) enforces a corroboration threshold before promoting an observation from "candidate" to "fact":

- Default `gemma-code.memoryCorroborationThreshold = 2` -- two independent sightings before a row is treated as a fact.
- Single-source rows remain queryable but only surface when no fact-tier match is available.
- A migration backfilled `corroboration_count = 1` on every existing row so the upgrade is non-destructive.
- The missed-fact golden eval `memory-hygiene-missed-fact-01` proves the agent does not blindly trust candidate rows.
- `/memory lint` produces a parseable health report (counts, top corroborated, candidate rows).

`/memory prune --apply` and `/memory lint --apply` are intentionally deferred to v0.6.0; the v0.5.0 surface is read-only / report-only.

## 6. Compaction and budgeting

- `tiktoken` (added in Phase 5) replaces the v0.4.0 character-count heuristic. The system-prompt budget is `gemma-code.systemPromptBudgetPercent` (default 10%, range 5-30%).
- Sliding-window compaction keeps the most-recent N messages (`compactionKeepRecent`, default 10) and the most-recent K tool results (`compactionToolResultsKeep`, default 8); older tool results are replaced with one-line summaries.
- See [docs/adr/0003-compaction-strategy-ordering.md](../adr/0003-compaction-strategy-ordering.md) for why compaction runs before the byte-cap (the cap holds even if compaction is later disabled).

## 7. Operational hygiene

- husky `pre-commit` (`lint-staged`) + `commit-msg` (`scripts/hooks/check-commit-msg.mjs`) wired by `npm install`
- Conventional Commits via [commitlint.config.cjs](../../commitlint.config.cjs); enforced in CI by [.github/workflows/commitlint.yml](../../.github/workflows/commitlint.yml)
- semantic-release on push to `main` ([.releaserc.json](../../.releaserc.json), [.github/workflows/semantic-release.yml](../../.github/workflows/semantic-release.yml)); plugin chain `changelog -> git -> github`. No `@semantic-release/npm` -- Gemma ships as a VSIX
- All GitHub Actions pinned to commit SHAs (verified by a meta-test); `concurrency: cancel-in-progress` on long-running workflows
- CI matrix runs Node 18, 20, 22

## 8. Performance posture

- Hooks p99 < 50 ms (Phase 9 benchmark gate)
- `tool-execution` p99 within +5 ms vs. v0.4.0 baseline
- `context-compaction` and `cache-hit` p99 within +10% vs. baseline
- Nightly benchmark regression gate via `scripts/check-bench-regressions.mjs`

## 9. Offline and security guarantees

- All work landed without adding any runtime network egress
- All new SQLite files chmod 0o600 on POSIX (`secureDbPermissions`)
- Secret-path denylist applies to `tool_output_cache.store()`, `WebResponseCache.store()`, and operation-log entries
- `gemma-code.secretPathDenyExtra` extends the built-in denylist with workspace-specific glob patterns
- DOMPurify sanitizes every webview HTML sink; CSP locked down (Phase 4 of v0.4.0)

## 10. Module dependency contract

Hard rules codified by `configs/dependency-cruiser.cjs` (`npm run deps:check` in CI):

- `no-llm-outside-llm-folder`
- `no-panels-from-tools`
- `no-tools-from-storage`
- `no-storage-from-panels`

Pre-existing violations are grandfathered with a `BASELINE-2026-04-25; ratchet by v0.6.0` annotation. New violations always fail CI.

See [ARCHITECTURE.md](../../ARCHITECTURE.md) for the full Mermaid module-dependency diagram.

## 11. ADR roll-up

| ADR | Title | Phase |
|-----|-------|-------|
| 0001 | Python backend removed | v0.4.0 (legacy) |
| 0002 | Memory subsystem layering | v0.5.0 Phase 11 |
| 0003 | Compaction strategy ordering | v0.5.0 Phase 11 |
| 0004 | Sub-agent isolation contract | v0.5.0 Phase 11 |
| 0005 | Tool permission tiers | v0.5.0 Phase 11 |

See [docs/adr/](../adr/) for the canonical text.

## 12. Out of scope (recorded for v0.6.0+)

LSTM predictive caching (hard constraint), multi-provider LLM proxy, voice transcription, distributed cache, `/memory prune --apply`, `/memory lint --apply`, auto-merge for Dependabot PRs, `format=json` on `read_file` and `run_terminal`, severity-rubric CI gate that fails builds, streaming reads for files > 1 MB. The full table is in the implementation plan.
