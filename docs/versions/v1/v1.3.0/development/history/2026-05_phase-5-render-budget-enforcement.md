# Session history: v1.3.0 Phase 5 -- Render-Budget Enforcement

**Date**: 2026-05-29
**Cycle**: v1.3.0
**Phase**: 5 (Render-Budget Enforcement, skill-cleaner adoption track)
**Plan reference**: [docs/versions/v1/v1.3.0/plans/adoption-skill-cleaner.md](../../plans/adoption-skill-cleaner.md)
**Source comparison**: [docs/versions/v1/v1.3.0/comparison-skill-cleaner.md](../../comparison-skill-cleaner.md)
**Acceptance scope**: add the render fallback ladder (full descriptions -> equal truncation -> omitted-minimum-lines) from insight I-06 to `SkillRenderLine.ts`, so when the loaded skill set exceeds the budget envelope the rendered block degrades gracefully instead of silently overflowing; have `SkillAuditor` report which rung the catalog would land on. The live agent-loop render path is intentionally NOT changed in v1.3.0.

---

## 1. Sub-tasks completed

| Sub-task | Output | Status |
|---|---|---|
| T015 | [core/skills/SkillRenderLine.ts](../../../../../core/skills/SkillRenderLine.ts) -- `renderSkillBlockWithinBudget(skills, budgetTokens)` returning `{ lines, omittedCount, rung }` with the three-rung ladder (full -> equal-truncate -> priority-ordered omit, devai-hub before user before builtin per I-09); first-sentence-preferring truncation; `name`/`path` never altered (I-15). [core/skills/SkillAuditor.ts](../../../../../core/skills/SkillAuditor.ts) -- budget report carries `renderRung` + `renderOmittedCount`; `formatAuditReport` surfaces a `Render rung:` line in `## Skill Budget`. Test: [tests/unit/core/skills/SkillRenderLine.fallback.test.ts](../../../../../tests/unit/core/skills/SkillRenderLine.fallback.test.ts) (6 cases) + 3 new auditor rung cases. | Closed |
| T016 | Build + full-suite + architecture gate; live `skills audit` rung verification at default / `--budget-percent 100` / `--budget-percent 0.1`. | Closed |

## 2. Deviations from the plan text

| # | Deviation | Resolution |
|---|---|---|
| D1 | The plan places the new test at `tests/skills/SkillRenderLine.fallback.test.ts`. | Test follows the repo's actual layout: `tests/unit/core/skills/SkillRenderLine.fallback.test.ts` (consistent with Phases 2-4). |
| D2 | The plan describes truncation as "compute the average tokens-per-description that would fit, truncate every description to that length". | Implemented as: subtract the line-overhead skeleton (`- id:  (file: path)` for every skill) from the budget, divide the remainder evenly across descriptions, convert the per-description token budget to a character budget (`tokens * 4`, matching `tokenize`'s `ceil(bytes/4)`), then re-render and re-check. Any overflow from multi-byte descriptions falls through to the omitted rung rather than overshooting -- the ladder is fit-guaranteed, not best-effort. |
| D3 | The plan anticipates the live catalog at default 2% would land on `truncated` or `omitted` (213 skills). | On this host the live catalog is the 16-skill builtin-only `src/skills/catalog` (the ~213 Nexus-Hub skills await the upstream-release sync tracked by carryforward `1.1.P3.B`), so 891 used tokens fit comfortably in the 2,560-token envelope -> rung `full`. The transition behaviour is verified instead via `--budget-percent 0.1` (-> `omitted`, drops 14) and the synthetic mixed-source unit test (devai-hub dropped before user before builtin). |

## 3. Test + gate results

- `npm run build` (tsc): clean.
- `npm run test`: 3,700 passed, 0 failed, 5 skipped (329 files). The new/modified files add 9 tests (6 fallback-ladder unit cases covering all three rungs + the priority-ordered drop + empty-catalog + first-sentence preservation; 3 auditor rung-diagnostic cases).
- `npm run lint` (`eslint src`): unaffected (`core/**` and `tests/**` are intentionally outside the `eslint src` scope; the new code is type-checked by `tsc`). Prettier is not a project dependency (no config, no `package.json` script); the new code matches the surrounding module conventions.
- `npm run check-architecture` (`depcruise src core modules`): 0 errors. `SkillRenderLine.ts` adds one intra-`core` import (`core/skills` -> `core/observability/TokenCost`), which is permitted; the `core/** -> modules/**` boundary holds. Remaining warnings are pre-existing orphan stubs unrelated to this track.
- Live rung verification (`node bin/nexus.mjs skills audit`): the `## Skill Budget` section now carries `- Render rung: full (would drop 0 skills if rendered now)`. `--budget-percent 100` -> `full`; `--budget-percent 0.1` -> `omitted` with `would drop 14 skills`. The 16-skill builtin-only catalog has no `user`/`devai-hub` roots on this host, so the source-priority drop ordering is verified by the unit test rather than the live run.

## 4. Known-gaps changes

In [docs/versions/v1/v1.3.0/known-gaps.md](../../known-gaps.md):

- **Added** two adoption-ledger rows (T015, T016), both `Resolved` for Phase 5.
- **No new open items**: Phase 5 produced no deviations that revealed defects, no skipped sub-tasks, no coverage shortfalls, no suppressed lints, and no bypassed quality gates. The open-items table (T002.P2.A, T012.P2.C, T013.P3.D) and the summary counts are unchanged.
- **Adoption ledger** recomputed: 16 of 23 (T001-T016); 7 pending across Phases 6-7.

## 5. Next steps

- Advance to Phase 6 (Upstream Hygiene + P3 Backlog, T017-T019): extend Nexus-Hub `validate_skills.py` with single-line `name`/`description` rules (T017, pairs with the open `T002.P2.A` allowlist drain), and add the `--deep-logs` and `--by-root` CLI flags (T018). Fold `T012.P2.C` (multi-root usage scan) into T018 since both touch root resolution.
- Phase 7 (T015 follow-up): wiring `renderSkillBlockWithinBudget` into the live agent-loop render path was explicitly deferred out of v1.3.0 to avoid a behavior change; it remains a candidate for a future cycle once the budget envelope is validated against a fully-synced catalog.
