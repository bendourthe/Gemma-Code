# v1.7.0 Phase 2 -- train/validation/test split + held-out gate + rejected-edit buffer (S4, SO002)

**Date**: 2026-06-30
**Plan**: [../../plans/adoption-self-optimizing-skills.md](../../plans/adoption-self-optimizing-skills.md)
**Comparison**: [../../comparison-self-optimizing-skills.md](../../comparison-self-optimizing-skills.md) (S4)
**Outcome**: COMPLETE. The golden suite now carries a locked train/validation/test split whose `test` split is structurally unreachable from the optimizer loader, a pure held-out validation gate, and a content-addressed redaction-on-write rejected-edit buffer -- the regression-safety scaffolding the Phase 3 optimizer cannot be trusted without.

---

## 1. What was asked

`/implement phase 4 of v1.6.0 adoption-aisuite-harness`. On resolution, Phase 4 of the v1.6.0 plan (A2 hierarchical sub-run trace nesting, AS006) was found already complete (closed 2026-06-15; the whole v1.6.0 cycle closed 2026-06-16, all 6 phases). The active cycle is v1.7.0 (`adoption-self-optimizing-skills`), where Phase 1 (S1 live runner, SO001) landed 2026-06-29 and Phase 2 (S4) was the first incomplete phase. The user was asked to disambiguate and chose **"v1.7.0 Phase 2 (S4)"** -- split + held-out gate + rejected-edit buffer.

## 2. Model-routing pre-flight

The plan recommended "Mid reasoning tier, medium effort -- `claude-sonnet-4-6`, medium" (Phase 2 is Med complexity, Low risk). The session ran on **Opus 4.8** (a stronger tier), so per the no-degradation guarantee the build stayed on the current/stronger model rather than downgrading; the cost-saving downshift (`/model sonnet` + `/effort medium`) was offered as optional.

## 3. Pre-implementation review (key findings)

- **Two task schemas.** The in-process `GOLDEN_TASKS` smoke set ([GoldenTaskSuite.ts](../../../../modules/coding/evaluation/GoldenTaskSuite.ts), `GoldenTaskCategory` enum) is distinct from the YAML corpus schema ([goldenTaskLoader.ts](../../../../modules/coding/evaluation/goldenTaskLoader.ts), `GoldenTaskSpec`, `category: string`). The optimizer rolls out the YAML corpus via the Phase 1 runner, so the `split` belongs on `GoldenTaskSpec`.
- **`RegressionReport` already exists** as a TS interface in `GoldenTaskSuite.ts` (`taskId/field/previous/current/delta/regression`); the gate reuses it. The Python `tests/golden/framework/comparison.py` compares baselines (pass-rate + per-task improvement/regression + time deltas) -- the model for the gate, simplified to the pass/fail signal the plan specifies.
- **`ArtifactStore`** ([core/memory/ArtifactStore.ts](../../../../core/memory/ArtifactStore.ts)) already redacts-then-hashes on `put`, so the rejected-edit buffer gets redaction-on-write for free by storing content through it.
- **Boundary rules** ([configs/dependency-cruiser.cjs](../../../../configs/dependency-cruiser.cjs)): `no-core-from-modules` (the buffer in `core/memory` must take primitives, not pillar types -- it does), `no-llm-outside-llm-folder` (not triggered). The split module depends one-directionally on the loader (`GoldenSplit` type lives in the loader), so no new circular-dependency warning.
- **Corpus**: 28 tasks across 7 categories (`agent-friendly` 3, `bug-fix` 5, `code-review` 4, `memory-hygiene` 1, `multi-file-edit` 5, `refactor` 5, `test-gen` 5).

## 4. Design decisions

1. **`GoldenSplit` type lives in the loader, not the split module.** It is a field of `GoldenTaskSpec`, so defining it in `goldenTaskLoader.ts` keeps the dependency one-directional (`goldenSplit.ts -> goldenTaskLoader.ts`). A reciprocal type import would have created a `goldenSplit <-> goldenTaskLoader` cycle that `dep-cruiser` (which follows pre-compilation type deps) would flag as a new warning.
2. **Default-by-category, not by global hash.** The plan asks for splits that are "representative" per category. `assignDefaultSplits` groups by category, sorts by id, and round-robins train -> validation -> test, so each split spans families regardless of input order (deterministic). Explicit `split:` in a task YAML always wins.
3. **The guard is structural, not advisory.** `optimizerVisibleTasks` / `loadOptimizerVisibleTasks` are the only loaders the optimizer path uses; they filter to train + validation and then re-check with `assertNoTestSplit`, so a future change that lets a `test` task through fails loudly instead of silently contaminating the loop.
4. **The buffer is `core/`-only and primitive-typed.** It is keyed by `skillId + editHash` and takes `{ skillId, editHash, reason, validationDelta, content }` -- all primitives -- so it never imports a pillar's `GoldenTaskResult` (the Phase 3 optimizer, in `modules/`, computes the gate report and calls `buffer.record(...)`). Content goes through `ArtifactStore` (redacted); the reason is redacted in the index; `record` is idempotent.

## 5. Files

New (`modules/coding/evaluation/`): `goldenSplit.ts`, `validationGate.ts`. New (`core/memory/`): `RejectedEditBuffer.ts`. Modified: `goldenTaskLoader.ts` (additive `split` field + fail-closed parse), `tests/golden/README.md` (schema doc).
New tests: `tests/unit/evaluation/{goldenSplit,validationGate}.test.ts` (13 + 8) and `tests/unit/core/memory/RejectedEditBuffer.test.ts` (8).

## 6. Troubleshooting

Minimal. The initial `RejectedEditBuffer.test.ts` used `require("node:fs")` (the project is ESM/TS) and left an unused import after a cast was removed -- both fixed before the first run. New-module coverage came in at 96-98% on the first measured pass; two cheap robustness assertions (a non-array index JSON, a pruned-artifact get) lifted `RejectedEditBuffer` to 100% branches. No behavior changed during the gate run.

## 7. Verification

- `npm run test`: 4382 passed / 6 skipped / 0 failed. `npm run lint`: 0 errors. `tsc -b`: clean.
- `npm run check-architecture`: 0 errors / 10 pre-existing warnings (no new cycle). `npm run check:tampering`: 0 findings. `npm run security:check`: in sync.
- New-module coverage: `goldenSplit.ts` 100/100/100, `validationGate.ts` 100/100/100, `RejectedEditBuffer.ts` 100/100/100 (lines/branches/functions); the `goldenTaskLoader` split-parse is covered, residual uncovered loader lines are pre-existing parser branches.

## 8. Next steps

- **Phase 3 (S2 + S6)**: the `SkillOptimizer` bounded-edit loop (reflect -> bounded edit -> held-out `validationGate` -> `RejectedEditBuffer`), human-approval before overwrite, + the optimizer-quality A/B that gates default-on. It consumes everything built this phase.
- **Carryovers** ([../../known-gaps.md](../../known-gaps.md)): `SO002.P2.A` (latency/token regression gating, deferred to a Phase 3 consumer), `SO002.P2.B` (buffer orphan GC, mirrors `AS005.P3.A`), `SO002.P2.C` (difficulty-stratified splits).
