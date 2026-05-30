# v1.3.0 -- Known Gaps, Deferrals, and Carryovers

**Status**: open. v1.3.0 opens with the skill-cleaner adoption track ([plans/adoption-skill-cleaner.md](plans/adoption-skill-cleaner.md), derived from [comparison-skill-cleaner.md](comparison-skill-cleaner.md)). Phase 1 (2026-05-28) ships the one skill-native item: the `skill-description-authoring` Nexus-Hub skill encoding the trigger-noun preservation rule (product / tool / action / object) plus single-line / ASCII-sanitized description discipline. No code surface in `core/` or `modules/` is touched in Phase 1; the deliverable lives entirely in the sibling Nexus-Hub repo. Phases 2-7 land the code-shaped items (foundational utilities, the `nexus skills audit` command, similarity + usage detection, render-budget enforcement, upstream hygiene, and stabilization). The known-gaps file is appended phase-by-phase; items move to `## 2. Resolved` when closed in a later phase; the `## 3. Summary` at the bottom is recomputed each pass.

**Audience**: v1.3.0 phase authors, code reviewer, future-cycle planners
**Last updated**: 2026-05-29 (Phase 3)
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
| T003 | Create model-agnostic `tokenize()` helper at `core/observability/TokenCost.ts` (insight I-04, P0) | Resolved | adoption-skill-cleaner Phase 2 (2026-05-29); `ceil(utf8_bytes / 4)`; 4 unit tests (ASCII / Latin-accent / emoji+CJK / empty) |
| T004 | Add `contextWindow` + `getActiveContextWindow()` to `core/registry/ModelRegistry.ts` (insight I-05, P0) | Resolved | adoption-skill-cleaner Phase 2 (2026-05-29); `DEFAULT_CONTEXT_WINDOW=272000`, gemma4:e4b seeded at 128000; 9 unit tests |
| T005 | Create canonical render formatter at `core/skills/SkillRenderLine.ts` (insight I-02, P0) | Resolved | adoption-skill-cleaner Phase 2 (2026-05-29); `renderSkillLine` / `renderSkillBlock`; newline-flattening + empty-description handling; 6 unit tests |
| T006 | Realpath dedup before insertion in `core/skills/SkillCatalog.ts` (insight I-07/I-09, P1) | Resolved | adoption-skill-cleaner Phase 2 (2026-05-29); `dedupeByRealpath` + `skills.dedup` TelemetryBus event; builtin>user>devai-hub keep-priority; 7 unit tests (junction fixture) |
| T007 | Phase 2 build + test + lint + architecture gate | Resolved | adoption-skill-cleaner Phase 2 (2026-05-29); `npm run build` clean, 3655 tests pass (0 fail), `eslint src` 0 errors, `check-architecture` 0 errors; see open item T007.P2.B |
| T008 | Create the auditor module at `core/skills/SkillAuditor.ts` (insights I-01/I-05/I-06/I-09, P0) | Resolved | adoption-skill-cleaner Phase 3 (2026-05-29); `auditSkills` + `formatAuditReport` compose TokenCost / ModelRegistry / SkillRenderLine / SkillCatalog into Budget + Descriptions + name-Duplicates + Roots; `bySimilarity` / `unused` stubbed for Phase 4; 8 unit tests |
| T009 | Add the `skills audit` subcommand to `bin/nexus.mjs` (insight I-11 minus P3 flags) | Resolved | adoption-skill-cleaner Phase 3 (2026-05-29); `--context-tokens` / `--budget-percent` / `--months` (no-op until Phase 4) / `--skills-root` / `--json`; read-only disk catalog builder; 3 integration tests |
| T010 | Phase 3 build + test + live-catalog smoke run | Resolved | adoption-skill-cleaner Phase 3 (2026-05-29); `npm run build` clean, 3666 tests pass (0 fail), `eslint src` 0 errors; live smoke run emits all five sections (budget 891/2560 tokens, 34.8% pressure on gemma4:e4b; 12 description candidates; 16 builtin skills) |

---

## 1. Open Items

### T002.P2.A -- Nexus-Hub validate_skills.py reports 7 pre-existing false-positive secret matches (WN, P2)

- **Source phase**: adoption-skill-cleaner Phase 1 (T002)
- **Plan reference**: [plans/adoption-skill-cleaner.md](plans/adoption-skill-cleaner.md) Phase 6 sub-task T017
- **Reason**: Running the full Nexus-Hub `python scripts/validate_skills.py` (no `--path` filter) exits 1 with 7 ERROR-level "potential Generic secret assignment" findings in unrelated, pre-existing skills (`ai-development/google-antigravity-sdk`, `documentation/user-documentation` x2, `infrastructure/cd-pipeline-generator` x2, `infrastructure/rollback-strategy-advisor` x2). These are example snippets (e.g. `password = "..."` in runbook / pipeline samples), not real secrets. They predate this track and are not introduced by the new `skill-description-authoring` skill, which passes both the targeted full validator and the quality pass with 0 errors / 0 warnings. The plan's Phase 6 explicitly says not to mass-edit pre-existing violations; an `--allow-existing` allowlist (`validate_skills.allowlist.json`) is the intended remedy.
- **Suggested next step**: When Phase 6 / T017 extends `validate_skills.py` with the single-line `name` / `description` checks, also introduce the `--allow-existing` allowlist and grandfather these 7 secret-scan false positives (or refine the `Generic secret assignment` regex to skip fenced code-block examples). Track the allowlist drain as a Nexus-Hub-side issue.

_(no open items beyond T002.P2.A above; T007.P2.B was resolved in Phase 3 -- see `## 2. Resolved`.)_

---

## 2. Resolved

### T007.P2.B -- core/observability/TokenCost.ts dependency-cruiser orphan (WN, P2)

- **Source phase**: adoption-skill-cleaner Phase 2 (T007)
- **Resolved in**: Phase 3 (T008, 2026-05-29)
- **Reason it is now closed**: `core/skills/SkillAuditor.ts` (T008) imports `tokenize` from `core/observability/TokenCost.ts` and `DEFAULT_CONTEXT_WINDOW` + `ModelRegistry` from `core/registry/ModelRegistry.ts`, removing both orphan edges. The Phase 3 `npm run check-architecture` run no longer lists either module as a `no-orphans` warning (the remaining warnings are pre-existing orphan stubs unrelated to this track), and `npm run deps:check` reports zero violations.

---

## 3. Summary

| Category | Open | Resolved |
|---|---|---|
| NI (not implemented) | 0 | 0 |
| DF (deferred) | 0 | 0 |
| BG (bug) | 0 | 0 |
| MT (missing tests) | 0 | 0 |
| WN (warning) | 1 | 1 |
| QG (quality gate) | 0 | 0 |
| **Total** | **1** | **1** |

**Adoption ledger**: 10 of 23 sub-tasks resolved (T001-T010); 13 pending across Phases 4-7.
