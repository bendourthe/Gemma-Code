# Session history: v1.2.0 Phase 1 -- Skill-Native Foundation

**Date**: 2026-05-27
**Cycle**: v1.2.0
**Phase**: 1 (Skill-Native Foundation, ecosystem-adoption track)
**Plan reference**: [docs/v1.2.0/plans/adoption-ecosystem-2026-05.md](../../plans/adoption-ecosystem-2026-05.md)
**Source comparison**: [docs/v1.2.0/comparison-ecosystem-2026-05.md](../../comparison-ecosystem-2026-05.md)
**Acceptance scope**: this session landed all five Phase 1 sub-tasks plus two user-authorized scope expansions surfaced at the 1.5 quality gate (sidecar IPC stubs for the v1.1.0 Phase 11 surface, and a pre-existing desktop tsc strict-null fix). Phase 1 is skill-native + policy only -- no `core/` or `modules/` surfaces touched within the plan's stated scope.

---

## 1. Sub-tasks completed

| Sub-task | Output | Status |
|---|---|---|
| 1.1 | New Nexus-Hub skill `catalog/skills/developer-experience/hallmark-design/SKILL.md` (anti-slop gate catalog + 4 verbs + attribution to Hallmark / Together AI; 22-theme catalog explicitly excluded per comparison Section 9.4 N6) | Closed |
| 1.2 | New Nexus-Hub skill `catalog/skills/developer-experience/html-output-conventions/SKILL.md` + 4 self-contained reference templates under `references/` (grid-comparison.html, annotated-diff.html, interactive-tuning.html, tabbed-document.html); cross-references the Hallmark skill; cites README.md Design Principle 5 for the privacy note | Closed |
| 1.3 | New "hooks-over-prompts" Critical Rule in [AGENTS.md](../../../../AGENTS.md); new inventory at [.claude/agents/hooks-over-prompts-inventory.md](../../../../.claude/agents/hooks-over-prompts-inventory.md) ranking current prompt-based rules by enforcement-determinism gain; new "Claude Code addenda" row registering the inventory as a reference doc | Closed |
| 1.4 | New `## AGENTS.md review cadence` section in AGENTS.md; new "Recurring Obligations" section in [docs/todos.md](../../../todos.md); both cross-reference the 2026-11-26 next-review date | Closed |
| 1.5 | Build + lint + test verification (Nexus-AI core suite 3392/3397 pass, lint clean, tsc 0); Nexus-Hub skill validation PASS for both new skills; `buildManifest` proof confirms both skills appear in the sync manifest walk (213 total) | Closed |

## 2. User-authorized scope expansions (at the 1.5 quality gate)

Two pre-existing desktop failures surfaced while verifying Phase 1 deliverables. The user authorized fixing each:

| Expansion | Files | Status |
|---|---|---|
| Sidecar IPC stubs for v1.1.0 Phase 11 methods | [desktop/sidecar/src/handlers.ts](../../../../desktop/sidecar/src/handlers.ts) (5 `NotImplementedError` stubs added), [desktop/sidecar/src/protocol.ts](../../../../desktop/sidecar/src/protocol.ts) (5 `METHOD_SCHEMAS` entries downgraded to `NotImplementedAny` + `implemented: false`) | Closed; desktop test suite 411/411 pass |
| Desktop tsc strict-null fix | [desktop/tests/slashCommands.test.ts](../../../../desktop/tests/slashCommands.test.ts) (lines 104, 105, 113, 114 -- replaced `arr[i].namespace` with `arr[i]?.namespace`) | Closed; `tsc --noEmit` exits 0 |

## 3. Open items added to known-gaps

Four new entries appended to the new [docs/v1.2.0/known-gaps.md](../../known-gaps.md) `## 1. Open Items`:

- **1.1.P2.A** -- Nexus-Hub catalog index (`data/skills.json` + `data/SKILL_INDEX.md`) rebuild deferred (WN, P2). A full rebuild produced a 2528-line diff sweeping in ~5 skills of pre-existing drift; reverted to keep the Phase 1 commit scoped to the two new skill directories. A Nexus-Hub maintainer should land `make build-catalog` as a standalone hygiene commit.
- **1.1.P3.B** -- New Nexus-Hub skills require an upstream release tag to flow through `nexus skills sync` (DF, P3). The local `buildManifest` proof stands; production sync currently exits with `upstream did not return tag_name` for `bendourthe/DevAI-Hub` in this environment.
- **1.3.P2.C** -- Hooks-over-prompts migrations deferred to Phase 5 (DF, P2). The Phase 1.3 inventory ranks migration order; the actual hook implementations land in Phase 5 per the adoption plan.
- **1.x.P3.D** -- Phase 7.4 adoption ledger lands the per-item closure for all 18 adoption items (DF, P3); not a Phase 1 deliverable.

## 4. Closures added to known-gaps

Two closures appended to `## 2. Resolved`:

- **1.5.R1** -- Sidecar IPC handlers wired for the v1.1.0 Phase 11 surface (5 `NotImplementedError` stubs aligning with the existing `models.install` / `image.generate` convention). Resolves the two pre-existing `desktop/tests/sidecar-handlers.test.ts` failures.
- **1.5.R2** -- Desktop tsc strict-null errors in `slashCommands.test.ts` fixed via optional chaining (4 lines). Resolves the four pre-existing `TS2532` errors.

## 5. Quality gate (Phase 7) verdict

| Gate | Threshold | Result |
|---|---|---|
| Phase 1 tests passing | 0 failures | PASS (3392 + 411 = 3803 tests pass; 0 failures) |
| Coverage >= 80% | new code | N/A (markdown / skills only in the plan's scope; the user-authorized expansions are tested by the pre-existing desktop suite) |
| Lint errors | 0 | PASS (`lint` and `lint:shell` both exit 0) |
| Build / compile | succeeds | PASS (tsc 0; desktop typecheck 0; sidecar esbuild 0) |
| Skill validation | pass | PASS (`scripts/validate_skills.py` 0/0 for both new skills) |

## 6. Files written this session

**Nexus-AI (this repo):**

- `AGENTS.md` (M) -- new Critical Rule + new `## AGENTS.md review cadence` section + new Claude Code addenda row
- `docs/todos.md` (M) -- new "Recurring Obligations" section with the 2026-11-26 reminder
- `.claude/agents/hooks-over-prompts-inventory.md` (A) -- new reference doc
- `desktop/sidecar/src/handlers.ts` (M) -- 5 `NotImplementedError` stub handlers for the v1.1.0 Phase 11 surface
- `desktop/sidecar/src/protocol.ts` (M) -- 5 `METHOD_SCHEMAS` entries downgraded to `NotImplementedAny` + `implemented: false`
- `desktop/tests/slashCommands.test.ts` (M) -- 4 lines updated with optional chaining
- `docs/v1.2.0/known-gaps.md` (A) -- new v1.2.0 known-gaps file (4 open items, 2 resolved, summary, carryforward map)
- `docs/DEVLOG.md` (M) -- new Phase 1 entry prepended above the v1.1.0 Phase 15 block
- `docs/v1.2.0/development/history/2026-05_phase-1-skill-native-foundation.md` (A) -- this file

**Nexus-Hub (sibling repo):**

- `catalog/skills/developer-experience/hallmark-design/SKILL.md` (A) -- new skill
- `catalog/skills/developer-experience/html-output-conventions/SKILL.md` (A) -- new skill
- `catalog/skills/developer-experience/html-output-conventions/references/grid-comparison.html` (A)
- `catalog/skills/developer-experience/html-output-conventions/references/annotated-diff.html` (A)
- `catalog/skills/developer-experience/html-output-conventions/references/interactive-tuning.html` (A)
- `catalog/skills/developer-experience/html-output-conventions/references/tabbed-document.html` (A)

## 7. Next steps

- Phase 2 (Command-output compression): the adoption plan's next phase ships `core/observability/CommandCompressor.ts` with four strategies (filter / group / truncate / dedupe), tee-on-failure to `<nexus-home>/logs/commands/`, and routes every Coding-pillar Bash tool call through the compressor. Stability gate: >=50% token reduction on a fixed-seed benchmark transcript.
- Nexus-Hub maintenance: land `make build-catalog` as a standalone hygiene commit on Nexus-Hub `main` (closes 1.1.P2.A); cut a Nexus-Hub release tag containing the two new skills (closes 1.1.P3.B); then run `nexus skills sync --apply` here to verify end-to-end.
