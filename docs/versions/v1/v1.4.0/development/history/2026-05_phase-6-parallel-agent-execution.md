# Session history: v1.4.0 Phase 6 -- Parallel Agent Execution

**Date**: 2026-05-31
**Cycle**: v1.4.0
**Phase**: 6 (Parallel agent execution, claude-code-harness adoption track)
**Plan reference**: [docs/versions/v1/v1.4.0/plans/adoption-claude-code-harness.md](../../plans/adoption-claude-code-harness.md)
**Source comparison**: [docs/versions/v1/v1.3.0/comparison-claude-code-harness.md](../../../v1.3.0/comparison-claude-code-harness.md)
**Acceptance scope**: adopt A10 (re-partial) -- optional git-worktree isolation for concurrently-dispatched, file-mutating sub-agents, so two parallel write-capable sub-agents cannot collide; defer the full Breezing-style Planner/Critic/Worker team orchestration. Stability gate: parallel sub-agents run in isolated worktrees without file conflicts; isolation is opt-in and defaults off; the worktree is cleaned up when unchanged.

---

## 1. Sub-tasks completed

| Sub-task | Output | Status |
|---|---|---|
| T018 (A10 -- worktree isolation) | New [src/agents/WorktreeManager.ts](../../../../../src/agents/WorktreeManager.ts): the worktree lifecycle, mirroring [GitSafetyNet](../../../../../src/guardrails/GitSafetyNet.ts)'s fault-tolerant `execFile` git pattern. `isAvailable()` (`git rev-parse --is-inside-work-tree`), `create(label)` (`git worktree add --detach <dir> HEAD` into a per-process/per-instance-unique dir under `os.tmpdir()/nexus-worktrees`), `cleanupIfUnchanged(handle)` (removes via `git worktree remove --force` only when `git status --porcelain` is empty; retains a modified worktree). Injectable git runner for unit-testing without a real repo. Opt-in `isolate?: boolean` on [src/agents/types.ts](../../../../../src/agents/types.ts) `SubAgentConfig` (default off); additive optional `root` param on [src/tools/handlers/pathGuard.ts](../../../../../src/tools/handlers/pathGuard.ts) `resolveInsideWorkspace`; `_rootOverride` on [src/tools/handlers/terminal.ts](../../../../../src/tools/handlers/terminal.ts) `RunTerminalTool`; wired through [src/agents/SubAgentManager.ts](../../../../../src/agents/SubAgentManager.ts) (`setWorktreeManager`, worktree created/cleaned in a try/finally around the run, `run_terminal` rooted at it). Graceful degradation to the shared workspace when isolation is requested but unavailable. | Closed |
| T019 (tests + stabilization) | New [tests/unit/agents/WorktreeManager.test.ts](../../../../../tests/unit/agents/WorktreeManager.test.ts) (8 assertions via an injected fake git runner) and new [tests/integration/agents/worktree-isolation.test.ts](../../../../../tests/integration/agents/worktree-isolation.test.ts) (5 real-git tests, incl. the acceptance proof that two parallel write-capable `run_terminal` executions in separate worktrees do not collide, and `SubAgentManager.run({isolate:true})` routing a sub-agent's write into a worktree). | Closed |

## 2. Design decision (confirmed with the user before coding)

Worktree isolation roots only `run_terminal` at the worktree, because per [ADR-0004](../../../../../docs/adr/0004-sub-agent-isolation-contract.md) `run_terminal` is the sole file-mutation surface across every sub-agent tool scope (verification / research / planning all exclude write_file / edit_file / create_file / delete_file). Rooting the mutation surface fully satisfies the no-collision acceptance without threading a root override through the safety-critical module-level path-guard helpers used by the read tools. The read tools continue reading the shared workspace (a HEAD checkout, so reads of unmodified tracked files are equivalent). The alternative (also rooting read_file / list_directory / grep_codebase) was offered and declined as out of proportion to the re-partial scope.

## 3. Deviations from the plan text

| # | Deviation | Resolution |
|---|---|---|
| D1 | The plan cites `src/agents/SubAgentManager.ts`. | That path is still live (the `src/`->`modules/coding/` move is the Phase 7 carryforward `1.4.P1.B`), so no path adjustment was needed -- implemented at the cited path. Informational; no new gap. |
| D2 | "Add optional git-worktree isolation ... so concurrently-dispatched sub-agents that mutate files run in their own worktree." | Implemented by rooting `run_terminal` (the only mutation surface) at the worktree; read tools keep reading the shared workspace. Recorded as `T018.P3.B` (P3/DF). |
| D3 | A10 ships attachable + opt-in but is not yet enabled in the production dispatch path. | `setWorktreeManager` is exposed and `isolate` is honored, but the runtime bootstrap does not yet call `setWorktreeManager` and the `DAGExecutor` does not set `isolate:true` -- exactly parallel to the A8-hook wiring gap `T016.P3.A`. Recorded as `T018.P3.A` (P3/DF) for Phase 8 (T027). |

## 4. Open items added to known-gaps

Two, both P3 / DF: `T018.P3.A` (runtime/bootstrap wiring of `setWorktreeManager` + enabling `isolate` for parallel DAG nodes; pairs with `T016.P3.A` in Phase 8) and `T018.P3.B` (rooting the read tools at the worktree for write-then-read parity, plus the deferred full Breezing-style team-orchestration layer). The v1.4.0 [known-gaps.md](../../known-gaps.md) was updated: the adoption ledger splits T018-T019 as Resolved (A10), a Phase 6 Open-Items section records both deferrals with all four required fields plus the scope-decision note, a Resolved row is added, and the summary advances to 12-of-12 adoption items landed.

## 5. Verification evidence

- `npx tsc --noEmit` -> clean (the four modified `src/` files and the new `WorktreeManager.ts` type-check).
- Targeted run (`vitest run` on the two new suites) -> 13 passed (8 unit + 5 integration), incl. the real-git parallel no-collision proof (1.1s) and the `SubAgentManager.run({isolate:true})` routing test (1.3s).
- `npm run lint` (`eslint src`) -> clean, exit 0.
- `npm run check-architecture` (depcruise over `src core modules`) -> 0 errors, 11 pre-existing warnings (none in the five files this phase touched; `WorktreeManager.ts` is not flagged -- its `src -> modules/coding/utils/logger` import follows the established `GitSafetyNet` pattern).
- Full suite (`npx vitest run --coverage`) -> 338 test files passed, 2 skipped (pre-existing), 0 failed; 3876 tests passed, 5 skipped; coverage above the 80/75/80 gates (no threshold error).
- A non-deterministic benchmark fixture (`tests/fixtures/memory-tier-benchmark-results/2026-05-26/results.json`) was overwritten by an unrelated memory-tier benchmark test during the full-suite run and restored with `git checkout --`, keeping the commit scoped to Phase 6.

## 6. Next steps

- Advance to Phase 7 (architectural carryforward): the `src/`->`modules/coding/` move (`1.4.P1.B`, T020), TypeScript project references (`1.1.P1.A`, T021), the Tree-sitter scanner swap (`3.3.P2.G`, T022), and multi-layer HNSW (`4.2.P3.K`, T023).
- Phase 8 (T027) should live-wire `setWorktreeManager(new WorktreeManager(workspaceRoot))` at bootstrap and enable `isolate` for concurrently-dispatched write-capable DAG nodes (closing `T018.P3.A`), alongside the parallel A8/reflection hook wiring (`T016.P3.A`, `5.4.P3.T`), and add a production-path integration test.
- If write-then-read parity inside a worktree is ever needed, thread the `pathGuard` `root` override through the read tools' module-level resolution helpers (`T018.P3.B`).
