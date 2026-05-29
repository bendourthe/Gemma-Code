# Phase 11 -- Documentation Discipline

**Date**: 2026-04-26
**Plan**: [docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md](../../plans/implementation-plan.md) (Phase 11)
**Source plans**: [routa-harness-adoption.md](../../plans/routa-harness-adoption.md) (4.1-4.7, 5.1-5.2), [memory-hygiene.md](../../plans/memory-hygiene.md) (3.1, 3.3), [agent-friendly-tools.md](../../plans/agent-friendly-tools.md) (4.1, 4.2)
**Prior phase**: Phase 10 -- Local Development Hygiene + CI Hardening (commit `c3cf113`)

## Goal

Backfill the architectural intent of v0.2.0-v0.5.0 in four ADRs; visualize the module-dependency graph (mirroring the rules in `configs/dependency-cruiser.cjs`); operationalise a who-writes-where contract in `AGENTS.md`; publish a refactor playbook tied to the Phase 8 specialist externalization; ship a docs/issues template and a per-tool severity rubric; document `get_tool_schema` as the help-discovery surface; auto-generate `docs/index.md` as a per-module catalog with CI sync; and land repository governance (`CODEOWNERS`, branch-cleanup workflow). Documentation-only phase: no `src/` changes.

## Sub-tasks completed

| # | Sub-task | Output |
|---|----------|--------|
| 11.1 | ADR-0002 memory subsystem layering | [docs/adr/0002-memory-subsystem-layering.md](../../../adr/0002-memory-subsystem-layering.md) |
| 11.2 | ADR-0003 compaction strategy ordering | [docs/adr/0003-compaction-strategy-ordering.md](../../../adr/0003-compaction-strategy-ordering.md) |
| 11.3 | ADR-0004 sub-agent isolation contract | [docs/adr/0004-sub-agent-isolation-contract.md](../../../adr/0004-sub-agent-isolation-contract.md) |
| 11.4 | ADR-0005 tool permission tiers | [docs/adr/0005-tool-permission-tiers.md](../../../adr/0005-tool-permission-tiers.md) |
| 11.5 | Mermaid module-dependency diagram | New `## Module Dependency Graph` section in [ARCHITECTURE.md](../../../../ARCHITECTURE.md) |
| 11.6 | Module Authorship Contract in AGENTS.md | [AGENTS.md](../../../../AGENTS.md) `## Module Authorship Contract` (replaces placeholder) |
| 11.7 | Refactor / characterization-test playbook | [docs/refactor-playbook.md](../../../refactor-playbook.md), cross-referenced from [CONTRIBUTING.md](../../../../CONTRIBUTING.md) and [test-pyramid.md](../../test-pyramid.md) |
| 11.8 | docs/issues template | [docs/issues/_template.md](../../../issues/_template.md) + new "Issue records" section in CONTRIBUTING.md |
| 11.9 | Severity rubric in tool-audit.md | [docs/archive/versions/v0/v0.5.0/tool-audit.md](../../tool-audit.md) with per-tool severity table |
| 11.10 | Document `get_tool_schema` | New `## Tool Catalogue and Help Discovery` section in [ARCHITECTURE.md](../../../../ARCHITECTURE.md), short paragraphs in [AGENTS.md](../../../../AGENTS.md) and [README.md](../../../../README.md), "Adding a new tool" reminder in [CONTRIBUTING.md](../../../../CONTRIBUTING.md) |
| 11.11 | Auto-generated `docs/index.md` catalog | [scripts/generate-catalog.mjs](../../../../scripts/generate-catalog.mjs), [docs/index.md](../../../index.md), CI catalog-sync job in [.github/workflows/ci.yml](../../../../.github/workflows/ci.yml), `npm run catalog` / `npm run catalog:check` scripts |
| 11.12 | `.github/CODEOWNERS` | [.github/CODEOWNERS](../../../../.github/CODEOWNERS) with default + security-path owners; documented in CONTRIBUTING.md |
| 11.13 | Branch-cleanup workflow | [.github/workflows/branch-cleanup.yml](../../../../.github/workflows/branch-cleanup.yml) (workflow_dispatch + weekly Sunday cron, dry-run during rollout) |
| 11.14 | Stabilization (lint, build, test, session history) | This document plus the DEVLOG entry |

## Subtask 11.1-11.4 detail (the four ADRs)

The four ADRs codify decisions that were made and shipped in v0.2.0-v0.5.0 but had no durable record outside the implementation plans. Each follows [docs/adr/template.md](../../../adr/template.md): Status / Deciders / Context / Decision / Consequences / Alternatives / Links.

- **ADR-0002** captures the four-layer memory design (Working / Episodic / Semantic / Graph), the unified retriever as the public API, the `chmod 0o600` discipline on the SQLite files, and the v0.5.0 Phase 7 N-corroboration addition. Alternatives recorded: single FTS5 store (v0.2.0 design that v0.3.0 outgrew), vector-only, graph-only, two-layer (semantic + graph).
- **ADR-0003** captures the six-stage compaction pipeline ordering (`ToolResultClearing -> SlidingWindow -> CodeBlockTruncation -> RegenerateFromSource -> LlmSummary -> EmergencyTrim`), the per-stage trigger / cost / loss profile in a table, and the cheapest-first short-circuit invariant. Alternatives recorded: single sliding-window, LLM-summary-only, truncation-only, LLM-first ordering.
- **ADR-0004** captures the per-role tool scopes (verification / research / planning), the v0.5.0 Phase 8 specialist-externalization priority chain (workspace override -> bundled -> hardcoded fallback), the Zod validation of overrides, the `MetricsCollector` provenance event, and the iteration cap from `gemma-code.subAgentMaxIterations`. Cross-references ADR-0005.
- **ADR-0005** captures the three permission tiers (`AUTO_APPROVE`, `CONFIRM`, `DANGEROUS`), the static `TOOL_PERMISSION_MAP` and `permissionOverrides` setting, the `editMode` and `toolConfirmationMode` interactions, and the belt-and-suspenders relationship with the optional Phase 1 PreToolUse hook. Cross-references ADR-0004.

The [docs/adr/README.md](../../../adr/README.md) index gained four rows in numeric order with the 2026-04-26 date.

## Subtask 11.5 detail (mermaid diagram)

Added a `flowchart TD` block under a new `## Module Dependency Graph` heading in `ARCHITECTURE.md`, between the Token Budget Allocation section and Further Reading. Subgraphs match the directory layout (`Panels`, `Chat`, `Agents`, `Orchestration`, `Tools`, `Storage`, `LLM`, `Guardrails`, `Observability`, `Mcp`). Allowed edges are solid arrows; the four forbidden edges from `configs/dependency-cruiser.cjs` are dashed-red and annotated with the rule name (`no-panels-from-tools`, `no-tools-from-storage`, `no-storage-from-panels`, `no-llm-outside-llm-folder`). Renders on GitHub preview; `linkStyle` directives apply the red-dashed styling. The diagram is a long-term shape; pre-existing baseline exceptions are not drawn (they live inline in `dependency-cruiser.cjs`).

## Subtask 11.6 detail (Module Authorship Contract)

Replaced the placeholder section in `AGENTS.md` with eight rules:

1. `src/llm/` is the only module that may import or call Ollama directly (with documented baseline exceptions).
2. `src/storage/` is the only module that opens SQLite databases.
3. `src/tools/handlers/` are the only modules that perform side-effecting operations (filesystem, terminal, network).
4. `src/panels/` never imports `src/storage/` directly; communication through `src/panels/messages.ts`.
5. Memory writes are owned by `MemoryStore` and `MemoryConsolidator`.
6. Confirmation prompts are owned by `ConfirmationGate.ts`.
7. Trace events are emitted via `MetricsCollector.ts` / `Tracer.ts`.
8. Settings are read through `src/config/settings.ts`; never via direct `vscode.workspace.getConfiguration`.

The forward reference makes `configs/dependency-cruiser.cjs` authoritative when text and config disagree.

## Subtask 11.7 detail (refactor playbook)

`docs/refactor-playbook.md` is the named contract for behavior-preserving refactors. Five sections plus anti-patterns:

- When to write characterization tests (modules > 200 LOC, externalization, multi-caller extractions, unwritten contracts).
- How to capture behavior (`toMatchFileSnapshot`, JSON snapshots, sub-string assertions, property-based tests).
- What to exclude from snapshots (timestamps, IDs, counters, normalized paths).
- Re-running snapshots: `--update` is deliberate, never reflexive.
- Worked example: Phase 8 specialist externalization with citations to `tests/snapshots/specialists/` and `SubAgentManager.characterization.test.ts`.

Cross-referenced from `CONTRIBUTING.md` "Testing" section and from the `test-pyramid.md` carry-over context list.

## Subtask 11.8 detail (issues template)

`docs/issues/_template.md` is YAML-frontmatter Markdown with seven keys (`id`, `title`, `state`, `github_issue`, `opened`, `closed`, `severity`) and four body sections (What / Why / Resolution / References). Severity uses the same Blocker / Friction / Optimization rubric as `docs/archive/versions/v0/v0.5.0/tool-audit.md`. Documented as opt-in in `CONTRIBUTING.md` "Issue records" section; small issues do not need an entry, multi-week investigations should. Filename convention: `<id>-<short-slug>.md`.

## Subtask 11.9 detail (severity rubric)

`docs/archive/versions/v0/v0.5.0/tool-audit.md` formalises the Blocker / Friction / Optimization labels. The audit table walks every tool registered in `src/tools/ToolCatalog.ts` plus `tail_output` / `grep_output` from `OutputRedirector.ts` and the MCP-tools wildcard. Twelve tools are classified `Optimization` (the v0.5.0 Phase 2/4/6 work landed pagination, byte caps, dry-run, JSON format); two tools are `Friction` (`web_search` and `fetch_page`, pending the session-scoped cache from token-optimizer-adoption Phase 4.1); MCP tools are `Variable` per-server. The rubric is vocabulary, not a CI gate.

## Subtask 11.10 detail (`get_tool_schema` documentation)

Added a `## Tool Catalogue and Help Discovery` section to `ARCHITECTURE.md` explaining that the catalog metadata IS the help-discovery surface (projected into the system prompt by `PromptBuilder` on every turn) and `get_tool_schema` is the named recovery handle when the agent emits an unknown tool name. Short paragraphs added to `AGENTS.md` and `README.md` so contributors and new readers find the surface fast. `CONTRIBUTING.md` gained an "Adding a new tool" section listing the three steps that must accompany every new tool: catalogue update, audit-table row, `Usage:` hint convention.

## Subtask 11.11 detail (auto-generated catalog)

`scripts/generate-catalog.mjs` walks `src/` per top-level subdirectory, computes file count, total LOC, top exported names (via a regex sweep over `^export ...`), and an entry-point hint (PascalCase match, then largest LOC). Renders `docs/index.md` with a Modules table plus per-module purpose paragraphs from a hand-curated `MODULE_DESCRIPTIONS` constant inside the script. The footer points readers at `git log -- docs/index.md` for actual generation time so the file content is byte-deterministic. CI catalog-sync job regenerates and `git diff --exit-code`s; out-of-sync rows fail the build with a one-line "Run `npm run catalog` and commit" message. `npm run catalog` and `npm run catalog:check` scripts wired in `package.json`.

Idempotency verified: running the script twice produces zero diff.

## Subtask 11.12 detail (CODEOWNERS)

`.github/CODEOWNERS` declares `@bendourthe` as the default owner and pins the same handle as required reviewer for security-sensitive paths (`SECURITY.md`, `src/utils/ssrf.ts`, `src/utils/errors.ts`, `src/tools/handlers/`, `src/guardrails/`, `scripts/installer/`, `scripts/hooks/`, `.github/`, `.husky/`, `configs/dependency-cruiser.cjs`, `docs/adr/`). Single-author repository today; the file sets the contract for future contributors. Documented in `CONTRIBUTING.md`.

## Subtask 11.13 detail (branch-cleanup workflow)

`.github/workflows/branch-cleanup.yml` triggers on `workflow_dispatch` (with `dry_run` and `max_age_days` inputs) and on the weekly cron `0 6 * * 0`. The cron-triggered runs are forced to `dry_run: true` during the rollout window so the merged-into-main safety net can be reviewed in two consecutive workflow summaries before any branch is deleted. The candidate selection uses `git for-each-ref` with the regex `^(dependabot|copilot|feature)/.+$`, filters by `committerdate < cutoff`, intersects with `git merge-base --is-ancestor "$branch" origin/main`, and skips any branch whose tip commit message contains `WIP:`. Protected names (`main`, `master`, `develop`, `release/*`, `hotfix/*`) are never touched. The workflow writes a Step Summary table of candidates regardless of dry-run state for visibility.

## Verification

- `npm run lint`: 0 errors, 5 pre-existing warnings.
- `npm run build`: clean.
- `npm run deps:check`: 0 errors, 2 pre-existing warning-tier circular dependencies (grandfathered).
- `tests/unit/docs/AGENTS-md.test.ts`: 5/5 pass after the AGENTS.md rewrite (Module Authorship Contract section anchor strings present).
- `node scripts/generate-catalog.mjs && git diff --exit-code docs/index.md`: clean (idempotent).
- YAML lint on the new workflow and the issue template frontmatter: clean.

Twelve test failures observed in `tests/unit/chat/ContextCompactor.test.ts` and `tests/unit/errors/error-handling.test.ts` are pre-existing on `main` and unrelated to Phase 11 (verified by `git stash` + rerun on clean working tree). They should be tracked separately under `docs/issues/` once investigated.

## Files added or changed

```
.github/CODEOWNERS                             (added)
.github/workflows/branch-cleanup.yml           (added)
.github/workflows/ci.yml                       (added catalog-sync job)
ARCHITECTURE.md                                (added two sections: Tool Catalogue + Module Dependency Graph)
AGENTS.md                                      (rewrote Module Authorship Contract; added Tool Catalogue paragraph)
CONTRIBUTING.md                                (added Adding-a-new-tool / Tool quality / Issue records / Code ownership / Branch hygiene; cross-ref to refactor playbook)
README.md                                      (added Help discovery for the agent paragraph)
docs/adr/0002-memory-subsystem-layering.md     (added)
docs/adr/0003-compaction-strategy-ordering.md  (added)
docs/adr/0004-sub-agent-isolation-contract.md  (added)
docs/adr/0005-tool-permission-tiers.md         (added)
docs/adr/README.md                             (index extended with four rows)
docs/index.md                                  (auto-generated)
docs/issues/_template.md                       (added)
docs/refactor-playbook.md                      (added)
docs/archive/versions/v0/v0.5.0/test-pyramid.md                    (cross-ref to refactor playbook)
docs/archive/versions/v0/v0.5.0/tool-audit.md                      (added)
package.json                                   (catalog + catalog:check scripts)
scripts/generate-catalog.mjs                   (added)
```

## Next phase

Phase 12 -- Advanced Fallbacks + Release Gate (Final). See [docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md](../../plans/implementation-plan.md).
