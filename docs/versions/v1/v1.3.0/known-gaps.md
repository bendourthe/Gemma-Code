# v1.3.0 -- Known Gaps, Deferrals, and Carryovers

**Status**: open. v1.3.0 opens with the skill-cleaner adoption track ([plans/adoption-skill-cleaner.md](plans/adoption-skill-cleaner.md), derived from [comparison-skill-cleaner.md](comparison-skill-cleaner.md)). Phase 1 (2026-05-28) ships the one skill-native item: the `skill-description-authoring` Nexus-Hub skill encoding the trigger-noun preservation rule (product / tool / action / object) plus single-line / ASCII-sanitized description discipline. No code surface in `core/` or `modules/` is touched in Phase 1; the deliverable lives entirely in the sibling Nexus-Hub repo. Phases 2-7 land the code-shaped items (foundational utilities, the `nexus skills audit` command, similarity + usage detection, render-budget enforcement, upstream hygiene, and stabilization). The known-gaps file is appended phase-by-phase; items move to `## 2. Resolved` when closed in a later phase; the `## 3. Summary` at the bottom is recomputed each pass.

**Audience**: v1.3.0 phase authors, code reviewer, future-cycle planners
**Last updated**: 2026-05-28 (Phase 1)
**Sibling reviews**: [docs/versions/v1/v1.2.0/known-gaps.md](../v1.2.0/known-gaps.md) (the upstream cycle gap log; carryforward open items remain in force during v1.3.0); [docs/versions/v1/v1.3.0/plans/adoption-skill-cleaner.md](plans/adoption-skill-cleaner.md) (the active adoption plan); [docs/versions/v1/v1.3.0/comparison-skill-cleaner.md](comparison-skill-cleaner.md) (the single-source comparison this track adopts).

**Cycle context**: This file is created in Phase 1 (rather than deferred to T022 / Phase 7 as the plan text anticipated) because the implement-phase post-phase sequence appends gaps every phase. T022 in Phase 7 will append the full per-sub-task adoption ledger to this same file; the seeded sections below are forward-compatible with that pass.

Each entry has a severity tag:

- **P0** -- release-blocker for v1.3.0 (must close)
- **P1** -- should-fix in v1.3.0
- **P2** -- nice-to-have; documented for completeness
- **P3** -- out-of-scope for v1.3.0; explicitly recorded for future planning

Each entry has a category tag:

- **NI** (not implemented) -- a plan sub-task that was skipped
- **DF** (deferred) -- a plan sub-task explicitly deferred to a later phase / cycle
- **BG** (bug) -- a deviation that revealed a real defect
- **MT** (missing tests) -- a coverage shortfall
- **WN** (warning) -- a suppressed lint or runtime warning
- **QG** (quality gate) -- a Phase 7 gate the cycle author bypassed with "Proceed anyway"

---

## 0. Adoption Ledger

This is the per-sub-task closure ledger for the skill-cleaner adoption plan. T022 (Phase 7) appends the full ledger; the Phase 1 rows are recorded here as they land.

### Skill-cleaner adoption (adoption-skill-cleaner)

| Plan sub-task | Item | Status | Closing reference |
|---|---|---|---|
| T001 | Author `skill-description-authoring` Nexus-Hub skill (insight I-15, P1) | Resolved | adoption-skill-cleaner Phase 1 (2026-05-28); committed in Nexus-Hub; upstream release flow pending per carryforward `1.1.P3.B` |
| T002 | Validate the new Hub skill + manifest walk (Phase 1 stabilization) | Resolved | adoption-skill-cleaner Phase 1 (2026-05-28); `validate_skills.py` PASS (0 errors, 0 quality warnings); `buildManifest` walk reports 219 skills with the new skill present |

---

## 1. Open Items

### T002.P2.A -- Nexus-Hub validate_skills.py reports 7 pre-existing false-positive secret matches (WN, P2)

- **Source phase**: adoption-skill-cleaner Phase 1 (T002)
- **Plan reference**: [plans/adoption-skill-cleaner.md](plans/adoption-skill-cleaner.md) Phase 6 sub-task T017
- **Reason**: Running the full Nexus-Hub `python scripts/validate_skills.py` (no `--path` filter) exits 1 with 7 ERROR-level "potential Generic secret assignment" findings in unrelated, pre-existing skills (`ai-development/google-antigravity-sdk`, `documentation/user-documentation` x2, `infrastructure/cd-pipeline-generator` x2, `infrastructure/rollback-strategy-advisor` x2). These are example snippets (e.g. `password = "..."` in runbook / pipeline samples), not real secrets. They predate this track and are not introduced by the new `skill-description-authoring` skill, which passes both the targeted full validator and the quality pass with 0 errors / 0 warnings. The plan's Phase 6 explicitly says not to mass-edit pre-existing violations; an `--allow-existing` allowlist (`validate_skills.allowlist.json`) is the intended remedy.
- **Suggested next step**: When Phase 6 / T017 extends `validate_skills.py` with the single-line `name` / `description` checks, also introduce the `--allow-existing` allowlist and grandfather these 7 secret-scan false positives (or refine the `Generic secret assignment` regex to skip fenced code-block examples). Track the allowlist drain as a Nexus-Hub-side issue.

---

## 2. Resolved

_(none yet -- Phase 1 opened the cycle; resolved items will move here as later phases close earlier open items.)_

---

## 3. Summary

| Category | Open | Resolved |
|---|---|---|
| NI (not implemented) | 0 | 0 |
| DF (deferred) | 0 | 0 |
| BG (bug) | 0 | 0 |
| MT (missing tests) | 0 | 0 |
| WN (warning) | 1 | 0 |
| QG (quality gate) | 0 | 0 |
| **Total** | **1** | **0** |

**Adoption ledger**: 2 of 23 sub-tasks resolved (T001, T002); 21 pending across Phases 2-7.
