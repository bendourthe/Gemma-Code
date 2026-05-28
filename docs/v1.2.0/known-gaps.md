# v1.2.0 -- Known Gaps, Deferrals, and Carryovers

**Status**: live. v1.2.0 opens with the 2026-05 ecosystem-adoption track (Phase 1, 2026-05-27). The cycle's first phase ships the skill-native foundation: two new Nexus-Hub skills (Hallmark anti-slop + HTML-output conventions), the hooks-over-prompts Critical Rule + inventory in [AGENTS.md](../../AGENTS.md), and the AGENTS.md review cadence in [docs/todos.md](../todos.md). The known-gaps file is appended phase-by-phase; items move to `## 2. Resolved` when closed in a later phase; the `## 3. Summary` at the bottom is recomputed each pass.

**Audience**: v1.2.0 phase authors, code reviewer, future-cycle planners
**Last updated**: 2026-05-27
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
| Open items (Phase 1 entries) | 4 |
| Carryforward from v1.1.0 | 2 (re-listed by code; full text in v1.1.0 file) |
| Resolved in Phase 1 | 2 |
| Release blockers (P0) | 0 |
| Severity breakdown (Open, Phase 1) | P1: 0  P2: 2  P3: 2 |
