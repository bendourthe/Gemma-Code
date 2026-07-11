# Session history: v1.5.0 Phase 4 -- Swarm / DAG Orchestration

**Date**: 2026-06-12
**Cycle**: v1.5.0 (Local Agent Maturity)
**Phase**: 4 (Swarm / DAG orchestration -- Bucket 3 `re-full`: item 36; closes v1.4.0 `T018.P3.A`, `T018.P3.B`, `T016.P3.A`)
**Plan reference**: [docs/versions/v1/v1.5.0/plans/adoption-ecosystem-2026-06.md](../../plans/adoption-ecosystem-2026-06.md)
**Source comparison**: [docs/versions/v1/v1.5.0/comparison-ecosystem-2026-06.md](../../comparison-ecosystem-2026-06.md)
**Branch (Nexus-AI)**: `feat/v1.5.0-phase-3-inbound-security` (continued; v1.5.0 not yet merged to `main`)
**Acceptance scope**: adopt report item 36 -- a planner/critic/worker orchestration layer over the worktree-isolated sub-agents, GPU-concurrency bounded, opt-in (default off) -- and close the three v1.4.0 deferrals this work subsumes. Stability gate: `npm run test`, `npm run lint`, `npm run check-architecture` clean; a production-path integration test proves real dispatched sub-agents are isolated and do not oversubscribe the GPU scheduler; `T018.P3.A`, `T018.P3.B`, `T016.P3.A` move to Resolved.

---

## 1. Sub-tasks completed

| Sub-task | Output | Status |
|---|---|---|
| T010 (closes `T018.P3.A`) | Live worktree wiring. [src/panels/ChatPanelBootstrap.ts](../../../../src/panels/ChatPanelBootstrap.ts) calls `subAgentManager.setWorktreeManager(new WorktreeManager(workspacePath))` at session construction (when a workspace is open). [modules/coding/orchestration/DAGExecutor.ts](../../../../modules/coding/orchestration/DAGExecutor.ts) gained a `DAGExecutorOptions` bag; with `isolateWrites` on it sets `isolate: true` for write-capable nodes only (`WRITE_CAPABLE_AGENT_TYPES` = `verification`, the sole `run_terminal`-bearing agent type per ADR-0004). | Closed |
| T011 (closes `T018.P3.B` team half) | Critic layer. New [modules/coding/orchestration/CriticAgent.ts](../../../../modules/coding/orchestration/CriticAgent.ts) (`CriticReviewer` port + fail-open `parseCriticVerdict`). `DAGExecutor` runs the critic after a worker succeeds; a rejection routes the node back through the existing reflexion + retry path (critic feedback = retry context). Opt-in via the `Orchestrator` `swarmEnabled` flag (default off), wired from `nexus.coding.swarmOrchestration.enabled` through `ChatController.buildOrchestrator`. Concurrency bounded by the existing GPU-tier semaphore. Source: Kimi "Agent Swarm" (S8) + Viktor multi-agent (S1). | Closed |
| T012 (closes `T018.P3.B` read half) | Read-tool worktree rooting. [src/tools/handlers/filesystem.ts](../../../../src/tools/handlers/filesystem.ts) helpers take an optional `root`; `ReadFileTool` / `ListDirectoryTool` / `GrepCodebaseTool` take an optional trailing `rootOverride`. `SubAgentManager._buildScopedRegistry` passes the worktree path to the read tools, so a worker reads back its own in-worktree `run_terminal` write. The `pathGuard` boundary check is unchanged. | Closed |
| T013 (closes `T016.P3.A`) | Live PreCompact WIP hook. Bootstrap attaches `attachPreCompactWipHook(hookBus)` (git probe rooted at the workspace) alongside the reflection hook; [modules/coding/chat/ContextCompactor.ts](../../../../modules/coding/chat/ContextCompactor.ts) gained `setHookBus` and emits `lifecycle.context.preCompact` at the real compaction boundary (before the pipeline; `afterTokens` = the conversation budget target). Fire-and-forget: the emit cannot block or delay compaction. | Closed |
| T014 | Tests + stabilization. +32 tests (4 unit suites + 3 integration suites), all green. Full suite 4020 passed / 5 skipped / 0 failed; `tsc -b` exit 0; `lint` 0; `check-architecture` 0 errors; `security:check` in sync; `check:tampering` 0 findings. No outbound call introduced. | Closed |

## 2. Design decisions & deviations from the plan text

| # | Decision / deviation | Resolution |
|---|---|---|
| D1 | The plan prompts reference `src/agents/`, but the agents tree moved to `modules/coding/agents/` in v1.4.0 Phase 7 (T020). | Implemented at the live paths (`modules/coding/agents`, `modules/coding/orchestration`). Same partial-move note recorded across prior v1.x phases; no behavior change. |
| D2 | "Write-capable DAG nodes" -- which node types? `NODE_TYPE_TO_AGENT_TYPE` maps research->research, code->planning, test/verify->verification, and only `verification` carries `run_terminal` (the sole mutation surface per ADR-0004). | Isolation is applied to write-capable agent types only (`WRITE_CAPABLE_AGENT_TYPES = {verification}`). Isolating read-only agents would add git overhead with no collision to prevent. The existing `code->planning` mapping (planning is read-only) was left unchanged -- out of scope for this phase. |
| D3 | Where to gate the swarm on/off and where to build the critic. | A single opt-in flag (`Orchestrator.swarmEnabled`, from `nexus.coding.swarmOrchestration.enabled`, default off) gates BOTH worktree isolation and the critic. The critic is constructed once in the `Orchestrator` constructor (an injected fake takes precedence in tests) and passed to each `DAGExecutor`. When off, the orchestrator runs the legacy single-workspace, critic-less Plan-and-Execute loop byte-equivalently. |
| D4 | Critic gating vs. the existing failure path. | A critic rejection is fed to `_handleNodeFailure` (not a separate path), so it reuses reflexion, retry-budget, and replan exactly as a worker failure does -- the critic feedback becomes the retry context. A critic that throws fails open (the worker already succeeded; the critic must not block legitimate work). |
| D5 | PreCompact `afterTokens` at a pre-pipeline emit. | The event fires before any compaction strategy runs (so WIP is flagged before it is buried), where the post-compaction count is not yet known. `afterTokens` is set to the conversation budget the pipeline targets -- a meaningful projected ceiling. The hook only uses the counts for the checkpoint; the warning text does not depend on them. |
| D6 | Wiring the hookBus into the compactor without reordering bootstrap. | Added a `setHookBus` setter (mirroring `setPostCompactionHook` / `setRebuildSnapshotProvider`) and called it after the existing `hookBus` is created at bootstrap; the compactor object already exists by then and is only exercised at runtime, so no construction reordering was needed. |

## 3. Open items added to known-gaps

Two forward-tier follow-ups recorded in [docs/versions/v1/v1.5.0/known-gaps.md](../../known-gaps.md) (not defects):

- `T011.P3.A` (P3/DF) -- the swarm mechanism, isolation, critic-gating, and concurrency bound are `supported` (unit + production-path integration tested), but no test drives a live multi-worker run against a running Ollama (repo norm). Live multi-model swarm behavior is `candidate`. Suggested next step: an opt-in live-model smoke test gated on `OLLAMA_URL`.
- `T012.P3.A` (P3/DF) -- read-tool rooting covers `read_file`, `list_directory`, and the primary ripgrep path of `grep_codebase`; the `vscode.workspace.findFiles` FALLBACK (ripgrep-absent) stays workspace-scoped (the VS Code API cannot re-root to an arbitrary directory). `future`-tier.

## 4. Verification evidence

- `npx vitest run --config configs/vitest.config.ts` on the 7 new suites -> **31 passed** (CriticAgent 10, DAGExecutor.swarm 7 at write time + 1 scheduler-bound = 8, Orchestrator.swarm 3, ContextCompactor.preCompact 3, swarm-orchestration 2, worktree-read-rooting 4, precompact-wiring 2; counted as +32 in the full-suite delta below).
- `npm run test` (full suite) -> **4020 passed / 5 skipped / 0 failed** (353 files); includes the `dep-cruiser-clean` integration baseline.
- `npx tsc -b` -> **exit 0**.
- `npm run lint` (`eslint src modules`) -> **0**.
- `npm run check-architecture` -> **0 errors** (10 pre-existing orphan/circular warnings, none involving the new files; `ContextCompactor` -> `core/lifecycle/HookBus` is a type-only `modules`->`core` import, allowed).
- `npm run security:check` -> **"All safety surfaces in sync"** (the new setting is a plain config toggle, not a safety surface).
- `npm run check:tampering` -> **0 findings** over `tests/` + `.github/workflows`.
- No outbound call introduced: the swarm path is local-only (LLM calls reuse the already-loaded local model) and opt-in (default off).

## 5. Carryforward closures

`T018.P3.A`, `T018.P3.B`, and `T016.P3.A` (v1.4.0 P3 deferrals) are raised candidate -> supported and moved to `## 2. Resolved` in the v1.5.0 known-gaps, each with a cited production-path test:

- `T018.P3.A` -- `swarm-orchestration.test.ts`: a dispatched write-capable node mutates an isolated worktree (never the shared workspace); a clean worktree is removed.
- `T018.P3.B` -- `DAGExecutor.swarm.test.ts` + `Orchestrator.swarm.test.ts` (critic gate + scheduler bound) and `worktree-read-rooting.test.ts` (write-then-read parity).
- `T016.P3.A` -- `precompact-wiring.test.ts`: a real (forced) compaction fires the hook, persists a checkpoint, and warns without blocking.

The remaining v1.4.0 carryforward (`T022.P3.A`, Tree-sitter `.wasm` packaging) is scheduled for Phase 6.

## 6. Next phase

Phase 5 -- model-layer & desktop re-partials (items 33, 24, 25, 26; item 38 demand-gated): multimodal input via Gemma 4, split preview panel, provider/credential management UI, cross-surface session resume.
