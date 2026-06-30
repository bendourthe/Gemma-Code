# v1.7.0 Phase 1 -- TS-native golden-task live runner (S1, SO001)

**Date**: 2026-06-29
**Plan**: [../../plans/adoption-self-optimizing-skills.md](../../plans/adoption-self-optimizing-skills.md)
**Comparison**: [../../comparison-self-optimizing-skills.md](../../comparison-self-optimizing-skills.md) (S1)
**Outcome**: COMPLETE. The golden suite is no longer dry-mode-only; a vscode-free TS runner materializes a snapshot, runs the agent through an injected driver seam, evaluates the declarative `success_criteria`, and emits a scored `GoldenTaskResult`.

---

## 1. What was asked

`/implement phase 3 of v1.6.0 adoption-aisuite-harness`. On resolution, Phase 3 of the v1.6.0 plan was found already complete (A1 dehydration, delivered 2026-06-15; whole plan closed 2026-06-16) with all artifacts on disk. The only open plan was the brand-new v1.7.0 `adoption-self-optimizing-skills` (created today, unstarted). The user was asked to disambiguate and chose **"Start v1.7.0 Phase 1"** -- the S1 TS-native golden-task live runner (SO001), the first incomplete phase and the hard prerequisite for the rest of the cycle.

## 2. Model-routing pre-flight

The plan recommended "Strong reasoning tier, high effort -- `claude-sonnet-4-6`, high". The session ran on **Opus 4.8** (a stronger tier than the planning-time concrete id), so per the no-degradation guarantee the build stayed on the current/stronger model rather than downgrading. Phase 1 is Med-High complexity and security-sensitive (re-enables live execution), so high effort on a strong tier is the right posture.

## 3. Pre-implementation review (key findings)

- **The criteria contract** lives in `tests/golden/framework/` (Python): `models.py` (schema), `evaluator.py` (8 criterion types), `snapshot.py` (`prepare_worktree` + `init_git_repo`), `task_loader.py` (YAML). The live corpus (`tests/golden/tasks/*.yaml`, 28 tasks) uses 3 types in practice (`file_contains`, `output_contains`, `file_exists`) but the README documents all 8.
- **The broken live path**: `_run_live()` posts to the FastAPI backend deleted by ADR-0001 -> "backend call failed" for every task since v0.4.0.
- **VSCode coupling** (confirmed by a focused exploration): `AgentLoop` itself is vscode-free, but `ConversationManager` and the `logger` import `vscode` and cannot load in plain-Node Vitest/CLI. `OllamaClient`, `Tracer`, `WorktreeManager`, `GitSafetyNet`, `ConfirmationGate`, `PermissionTiers` are vscode-free.
- **Architecture rules** (`configs/dependency-cruiser.cjs`): `no-llm-outside-llm-folder` (evaluation/ must consume LLM via types, never a concrete client), `no-core-from-modules`, `no-cross-module-deps-coding`. `tests/` and `desktop/` are excluded from the cruise.
- **No YAML dependency** is present, and the project deliberately avoids one (the `generate-golden-tasks` generator regex-extracts only `id`).

## 4. Design decisions

1. **Injected `AgentDriver` seam.** Because the real loop is vscode-coupled and barred by `no-llm-outside-llm-folder`, the runner depends on an injected `AgentDriver` interface (the same injection pattern used by `WorktreeManager.GitRunner` and `TraceDbReader`). The runner stays vscode-free, CLI-ready, and architecture-compliant; the composition root supplies the real driver, the dry path needs none, tests inject a mock, and the live smoke uses the vscode-free `OllamaClient`.
2. **Snapshot isolation by copy + `git init`** (not `git worktree add HEAD`). Golden snapshots are standalone mini-projects, not committed nested repos, so the v1.5.0 `WorktreeManager` model does not apply; copy-into-temp + a fresh `git init` baseline is the faithful primitive (and gives `git diff` / `diff_matches` a clean reference).
3. **Dependency-free YAML-subset loader.** Consistent with the project's existing hand-rolled parsers (`generate-golden-tasks` regex, `parseSkillFrontmatter`), a targeted parser for the fixed golden schema -- including YAML double-quoted escape decoding for patterns like `"\\?|\\$1|:id"` and `"grep -c \"'\\\" + \" ..."` -- is validated against the full 28-task corpus and fails closed on unsupported constructs.

## 5. Files

New (`modules/coding/evaluation/`): `goldenCriteria.ts`, `goldenSnapshot.ts`, `goldenTaskLoader.ts`, `GoldenTaskRunner.ts`.
New tests: `tests/unit/evaluation/{goldenCriteria,goldenTaskLoader,goldenSnapshot,GoldenTaskRunner}.test.ts` (12+13+9+8) and `tests/integration/golden/{golden-runner-end-to-end,golden-runner.live}.test.ts` (3 + env-gated smoke).

## 6. Troubleshooting

None of note. `tsc -b` and ESLint passed clean on first run of the new modules; all 45 new tests passed first run; the full suite, architecture, tampering, and security gates were all green without rework. The one deliberate fix was dropping an unused accumulator (`text`) from the live smoke driver to keep it `noUnusedLocals`-safe.

## 7. Verification

- `npm run test`: 4354 passed / 6 skipped / 0 failed. `npm run lint`: 0 errors. `tsc -b`: clean.
- `npm run check-architecture`: 0 errors / 10 pre-existing warnings. `npm run check:tampering`: 0 findings. `npm run security:check`: in sync.
- New-module coverage: 97.11% lines / 83.25% branches / 100% functions (all above the 80/75/80 gate).

## 8. Next steps

- **Phase 2 (S4)**: train/validation/test split + held-out gate + `RejectedEditBuffer` (reuses `ArtifactStore` + the Phase 1 runner's scored results).
- **Carryovers** ([../../known-gaps.md](../../known-gaps.md)): `SO001.P1.A` (production full-`AgentLoop` driver behind the seam -- likely needed when Phase 3's `SkillOptimizer` wants real rollouts), `SO001.P1.B` (`nexus golden run` CLI), `SO001.P1.C` (Windows-native shell-command criteria).
