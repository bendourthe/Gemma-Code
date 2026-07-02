# v1.7.0 Phase 4 -- Pareto-frontier candidate management on git branches (S3, SO005)

**Date**: 2026-07-01
**Plan**: [../../plans/adoption-self-optimizing-skills.md](../../plans/adoption-self-optimizing-skills.md)
**Comparison**: [../../comparison-self-optimizing-skills.md](../../comparison-self-optimizing-skills.md) (S3)
**Outcome**: COMPLETE. The evolutionary (GEPA/EvoSkill) layer on top of the Phase 3 single-file loop: a `CandidateFrontier` that keeps >= 2 skill-edit candidates on separate git branches, scores each across the diverse task set, selects the non-dominated (Pareto) set, maintains a bounded population under a hard candidate cap (the EvoSkill replacement rule), and surfaces the winner for explicit human approval -- never auto-merging a winning branch.

---

## 1. What was asked

`/implement phase 4 of v1.7.0 adoption-self-optimizing-skills`. Phase 4 was the first incomplete phase (Phase 1 S1 live runner closed 2026-06-29 at `a60714f`; Phase 2 S4 split + gate + buffer closed 2026-06-30 at `0b8ad7e`; Phase 3 S2 + S6 optimizer + A/B closed 2026-06-30 at `35e91a1`). Phase 4 is S3 (the `CandidateFrontier`), which consumes the Phase 3 optimizer's candidates.

## 2. Model-routing pre-flight

The plan recommended "Strong reasoning tier, high effort -- `claude-opus-4-8`, high" (S3 touches autonomous self-modification, git-branch concurrency, and the security gate -- the plan defaults to the stronger tier on any high-risk signal). The session ran on **Opus 4.8**, matching the recommendation exactly; no switch.

## 3. Pre-implementation review (key findings)

- **Phase 3 spine.** The `modules/coding/skilloptimizer/` subtree already ships the seams this phase composes: `SkillEditApprovalGate` / `SkillEditApprovalRequest` (approval), `classifyAction` usage, `reassembleSkillFile` (frontmatter-preserving body write), the `Skill` model, and the `RejectedEditBufferPort` structural port pattern. Reused verbatim -- no changes to Phase 3 code.
- **Worktree-swarm infra.** `WorktreeManager` (`modules/coding/agents/`) is the v1.5.0 swarm infra, injectable via a `GitRunner` (`(args, cwd) => Promise<string|null>`), fault-tolerant (null, never throws). `GitSafetyNet` (`modules/coding/guardrails/`) checkpoints + commits. **Both import `../utils/logger`, which imports `vscode`** -- the exact coupling Phase 1/3 kept out of the optimizer subtree (`SO001.P1.A`). So a concrete `WorktreeManager` import would drag vscode into the (must-stay-plain-Node) skilloptimizer subtree.
- **Cap source.** `HardwareTier`'s `maxConcurrentSubAgents` (1/2/3 by VRAM tier) is the swarm worker cap the plan says to mirror -- the composition-root source for the frontier's `maxCandidates`.
- **A/B report shape.** `PanelAbHarness`'s `AbReport` (`panelWins`/`singleWins`/`aggregateQualityDelta`/`latencyMultiplier`/`taskCount`) is the model the Phase 3 A/B already reused; the frontier's Pareto core is a distinct, simpler pure module (per-task vectors, not two-arm aggregation).
- **Orphans.** `check-architecture` scans `src core modules` (not tests); depcruise's `orphan` = no incoming AND no outgoing edges, so a file with outgoing imports is never an orphan. The new files all import `types.ts`/`pareto.ts`, so no new orphan warning (baseline stays 10).

## 4. Design decisions

1. **A pure Pareto core, separately testable.** [pareto.ts](../../../../../modules/coding/skilloptimizer/pareto.ts) holds `dominates` / `paretoFrontier` / `lowestByHeldOut` / `highestByHeldOut` -- pure functions over per-task score vectors + held-out aggregates, no I/O. The acceptance criterion "non-dominated selection over a fixture score matrix" is a direct unit test of these. Domination compares only shared task keys and requires strictly-better-somewhere (identical vectors are mutually non-dominated); extremes break ties deterministically by the smallest candidate id (no clock/randomness).
2. **Everything side-effecting is an injected seam (the Phase 1/3 discipline).** The orchestrator ([CandidateFrontier.ts](../../../../../modules/coding/skilloptimizer/CandidateFrontier.ts)) depends on a `CandidateProducer` (over the Phase 3 optimizer), a `CandidateWorkspaceManager` (branch materialization), a `CandidateScorer` (over the Phase 1 runner), the reused `SkillEditApprovalGate`, and a `CandidatePromoter` (the merge). This keeps the orchestrator vscode-free and fully fake-testable, and defers the live wiring behind the same substrate as `SO001.P1.A`/`SO003.P3.B`.
3. **The real branch materializer stays vscode-free by reusing the *contract*, not the *class*.** [frontierWorktree.ts](../../../../../modules/coding/skilloptimizer/frontierWorktree.ts) (`WorktreeCandidateManager`) imports `GitRunner` **as a type only** (elided at runtime, so no `logger`->`vscode` pull) and reimplements the minimal branch-worktree lifecycle (`git worktree add -b <branch> <dir> HEAD`, commit, `worktree remove`) over the injected runner -- the same fault-tolerant null discipline as `WorktreeManager`. It "reuses the worktree-swarm infra" via the shared contract while staying plain-Node loadable and unit-testable with a fake git. A vscode-hosted composition root may instead inject a manager backed by the concrete `WorktreeManager` + `GitSafetyNet` behind the seam.
4. **Hard cap + EvoSkill replacement rule.** The population never exceeds `maxCandidates`. Under the cap: admit. At the cap: replace the lowest-held-out incumbent **only** when the challenger strictly beats it (by a configurable margin) on the held-out split, else reject. This is the EvoSkill "replace the lowest-performing variant when a new candidate beats it on the held-out split" rule, made deterministic.
5. **Auto-clean per candidate; the branch survives.** The worktree is removed immediately after scoring (in a `finally`), so at most one worktree is live at a time -- the single-GPU discipline the A/B harness uses. `git worktree remove` keeps the branch ref, so the winner is still promotable after cleanup.
6. **No auto-merge (carried from Phase 3).** The winner is surfaced through the reused `SkillEditApprovalGate` with a DESTRUCTIVE `write_file` classification; the `CandidatePromoter` (the only merge path) is called **only** when approval returns true. A denying gate promotes nothing (a dedicated test). The frontier degrades gracefully when isolation is unavailable (null workspace -> baseline-catalog score), still ranking and surfacing a winner.

## 5. Files

New (`modules/coding/skilloptimizer/`): `pareto.ts`, `CandidateFrontier.ts`, `frontierWorktree.ts`. Modified: `types.ts` (a "Phase 4 Frontier" section of seams + types). No `package.json` change -- the frontier is gated by the Phase 3 optimizer's existing opt-in flag, and `maxCandidates` is a constructor config sourced from the hardware tier at a composition root (not a new user setting this phase).
New tests (`tests/unit/skilloptimizer/`): `pareto.test.ts` (13), `CandidateFrontier.test.ts` (9), `frontierWorktree.test.ts` (8).

## 6. Troubleshooting

Minimal. The design landed on the first typecheck (`tsc -b` clean) and the 30 new tests passed on the first run; no rework. The main deliberation was the vscode-coupling of `WorktreeManager`/`GitSafetyNet` (resolved by the type-only `GitRunner` import in decision 3), not a defect.

## 7. Verification

- `npm run test`: **4461 passed / 6 skipped / 0 failed** (+30 from Phase 3's 4431). `npm run lint`: **0 errors**. `tsc -b`: clean.
- `npm run check-architecture`: **0 errors**, 10 pre-existing warnings (no new orphan/circular; 320 -> 323 modules). `npm run check:tampering`: **0 findings**. `npm run security:check`: in sync.
- New-module coverage: pareto 100/100/100, CandidateFrontier 100/94.11/100, frontierWorktree 96.61/90/100 (the `modules/coding/skilloptimizer/` subtree at 99.47% lines / 91.51% branches / 100% functions, above the 80/75/80 gate).
- Local-first / MCP Registry Policy clean: no new dependency, no new outbound call or credential.

## 8. Next steps

- **Phase 5 (O-A)**: tree-sitter shell-command introspection for the terminal permission gate (independent of the optimization track; fails closed).
- **Phase 6 (FINAL)**: whole-plan acceptance gate + README/ARCHITECTURE/CHANGELOG + Hub touchpoint + demand-gated backlog (S5, opencode O-B/O-D/O-E).
- **Carryovers** ([../../known-gaps.md](../../known-gaps.md)): `SO005.P4.A` (production candidate producer + scorer over the real agent, deferred behind `SO001.P1.A`/`SO003.P3.B`), `SO005.P4.B` (live branch->catalog promoter over `GitSafetyNet`), `SO005.P4.C` (no frontier CLI + auto tier-cap wiring).
