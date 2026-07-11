# v1.7.0 Phase 3 -- bounded-edit skill optimizer + optimizer-quality A/B (S2 + S6, SO003 + SO004)

**Date**: 2026-06-30
**Plan**: [../../plans/adoption-self-optimizing-skills.md](../../plans/adoption-self-optimizing-skills.md)
**Comparison**: [../../comparison-self-optimizing-skills.md](../../comparison-self-optimizing-skills.md) (S2, S6)
**Outcome**: COMPLETE. The headline capability: a reverse-engineered SkillOpt/GEPA loop that reflects on failing golden-task trajectories, proposes regression-safe bounded edits to a local skill `.md`, accepts an edit only on a held-out validation win, buffers rejects, and overwrites a skill file ONLY after explicit human approval -- plus the A/B that gates whether the optimizer may ever ship default-on.

---

## 1. What was asked

`/implement phase 3 of v1.7.0 adoption-self-optimizing-skills`. Phase 3 was the first incomplete phase (Phase 1 S1 live runner closed 2026-06-29; Phase 2 S4 split + gate + buffer closed 2026-06-30, committed at `0b8ad7e`). Phase 3 is S2 (the bounded-edit `SkillOptimizer`) + S6 (the optimizer-quality A/B, folded in).

## 2. Model-routing pre-flight

The plan recommended "Strong reasoning tier, high effort -- `claude-opus-4-8`, high" (S2/S3 touch autonomous self-modification, untrusted input, and the security gate -- the plan defaults to the stronger tier on any high-risk signal). The session ran on **Opus 4.8**, matching the recommendation exactly; no switch.

## 3. Pre-implementation review (key findings, from 4 parallel codebase explorations)

- **Reflection seam.** `ReflexionEngine` (`reflect(failedTask: TaskNode, error, context) -> Reflection{analysis, constraints[]}`) and `CriticAgent` (`review(node, output) -> {approved, feedback}`, fail-open) both take the injected `OllamaClient` port and live in `modules/coding/orchestration/` -- vscode-free.
- **Module placement is forced.** `core/**` cannot import `modules/**` (`no-core-from-modules`), and the loop reuses `ReflexionEngine`/`CriticAgent`/the Phase 1 runner (all in `modules/coding/`), so the optimizer must live in `modules/coding/skilloptimizer/` (the plan's preferred location), not `core/skills/`.
- **Skill model.** `SkillCatalog.load(id) -> Skill{ id, path (abs SKILL.md), frontmatter, body, provenance.contentHash }`; built-in skills at `modules/coding/skills/catalog/<slug>/SKILL.md`. No existing in-place SKILL.md edit path exists -- the optimizer is the first.
- **Guardrail split.** `ActionClassifier.classifyAction` and `ConfirmationGate.request` are vscode-free, but `pathGuard.resolveInsideWorkspace` is **vscode-coupled** (its `workspaceRoot()` default imports vscode). So the loop uses `classifyAction` directly and injects path-resolution + approval as seams (the composition root adapts `pathGuard`/`ConfirmationGate`), exactly the discipline the Phase 1 runner used for its `AgentDriver`.
- **Runaway budget.** `BudgetMiddleware` (`src/tools/`, vscode-free): `checkPreTurn()` denies once `iterationsUsed >= maxIterations`; `recordIteration()` increments. Used to cap optimizer rounds.
- **A/B harness.** The v1.6.0 Fusion F4 `PanelAbHarness` is pure functions (`runAbHarness`, `buildAbReport`, `compareArm`, `decidePanelRoutingDefault`) over an injected `AbRunners{runSingle, runPanel}`; the `nexus.llm.panelRouting` opt-in-default-off flag lives in `package.json` `contributes.configuration`. Both reused directly for S6.

## 4. Design decisions

1. **Everything vscode-coupled is an injected seam.** The optimizer depends on an `OptimizerRollout` (over the Phase 1 runner + the deferred real `AgentDriver`), a `FailureDiagnoser`/`SkillEditProposer`/`EditCritic`, a `SkillEditApprovalGate`/`SkillPathResolver`/`SkillFileIO`, and the Phase 2 `RejectedEditBuffer` (via a structural `RejectedEditBufferPort`). This keeps the loop vscode-free, pure-testable with fakes (the validationGate-test purity bar), and faithful to the Phase 1 precedent. Default implementations (`ReflexionDiagnoser`, `LlmSkillEditProposer`, `CriticEditReviewer`, `RootSkillPathResolver`, `fsSkillFileIO`) are provided and separately tested.
2. **Two budgets, two jobs.** The runaway `BudgetMiddleware` caps the *number of rounds* (the loop-level safety the plan names); a separate per-round *textual learning-rate budget* (`withinLearningRate`: max ops + max changed chars) caps *edit volume* (the SkillOpt "small step"). An over-budget edit is rejected + buffered, never truncated (fail-closed).
3. **The write is the only side effect, and it is unreachable without approval.** The loop measures and decides in memory; `_applyAcceptedEdit` is the sole writer, and it classifies -> path-resolves (throws on escape) -> `requestApproval` -> writes only on `true`. A denying gate yields zero writes (a dedicated test). A path escape is a hard stop.
4. **No-progress halt prevents spinning.** A proposed edit whose hash is already attempted this run or already in the buffer halts the loop ("no-progress"), so even without input variation the loop terminates well before the runaway cap.
5. **Untrusted-input boundary.** Trajectory failure/description text is `redactSecrets`-scanned before it reaches the diagnoser's model -- including the synthesized `TaskNode.description` that `ReflexionEngine` embeds in its prompt (the bug the redaction test caught), not only the separate error/context strings.
6. **S6 maps onto F4 cleanly.** baseline skill = single arm, optimized skill = panel arm; quality = held-out validation pass signal (1/0), latency = rollout wall-clock. `decideSkillOptimizerDefault` mirrors `decidePanelRoutingDefault`'s three-condition gate with skill-domain wording. The flag ships default-off (no live A/B here).

## 5. Files

New (`modules/coding/skilloptimizer/`): `types.ts`, `skillEdit.ts`, `io.ts`, `ReflexionDiagnoser.ts`, `SkillEditProposer.ts`, `EditCritic.ts`, `SkillOptimizer.ts`, `SkillOptimizerAb.ts`. Modified: `package.json` (the `nexus.coding.skillOptimizer.enabled` opt-in setting).
New tests (`tests/unit/skilloptimizer/`): `skillEdit.test.ts` (14), `SkillEditProposer.test.ts` (6), `ReflexionDiagnoser.test.ts` (4), `EditCritic.test.ts` (2), `SkillOptimizer.test.ts` (11), `io.test.ts` (5), `SkillOptimizerAb.test.ts` (6).

## 6. Troubleshooting

Minimal. (1) The redaction test failed first: `ReflexionEngine.reflect` embeds `failedTask.description` in its prompt, and the diagnoser passed the raw `taskDescription` into the synthesized `TaskNode`; fixed by redacting the node's title + description in `toTaskNode` (not only the separately-built error/context). (2) Initial new-module coverage left `io.ts` at 0% (no test) and a defensive `BLOCKED`-classification branch unreachable for `write_file`; added an `io.test.ts` (containment + atomic I/O) and removed the dead `BLOCKED` branch (the classification is still computed and surfaced in the approval prompt). Final subtree coverage 99.62 / 89.61 / 100. (3) A benchmark test wrote timing numbers into a fixture during the full-suite run; restored it so the commit traces only to Phase 3.

## 7. Verification

- `npm run test`: **4431 passed / 6 skipped / 0 failed**. `npm run lint`: **0 errors**. `tsc -b`: clean.
- `npm run check-architecture`: **0 errors**, 10 pre-existing warnings (no new orphan/circular -- the skilloptimizer modules import production modules so they are not orphans). `npm run check:tampering`: **0 findings**. `npm run security:check`: in sync.
- New-module coverage: `modules/coding/skilloptimizer/` subtree **99.62% lines / 89.61% branches / 100% functions** (above the 80/75/80 gate); global 88.05 / 83.85 / 91.25.
- Local-first / MCP Registry Policy clean: no new dependency, no new outbound call or credential.

## 8. Next steps

- **Phase 4 (S3)**: the `CandidateFrontier` -- run the optimizer to produce >= 2 candidates on separate worktree branches, select the non-dominated (Pareto) set, never auto-merge. It consumes this phase's `SkillOptimizer`.
- **Carryovers** ([../../known-gaps.md](../../known-gaps.md)): `SO003.P3.A` (opt-in default-off pending a live A/B), `SO003.P3.B` (production `OptimizerRollout` over the real `AgentLoop`, deferred behind `SO001.P1.A`), `SO003.P3.C` (live `ConfirmationGate`/`pathGuard` adapters), `SO003.P3.D` (no `nexus skills optimize` CLI). The Phase 2 `SO002.P2.A` (latency/token regression gating) remains open -- Phase 3 uses pass/fail as the load-bearing signal and did not extend the gate.
