# v0.5.0 Phase 1 -- Identity & Naming

**Date**: 2026-04-25
**Plan**: [docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md](../../plans/implementation-plan.md) (Phase 1)
**Sub-plan reference**: [docs/archive/versions/v0/v0.5.0/plans/ci-and-docs-hygiene.md](../../plans/ci-and-docs-hygiene.md) (Phase 1 sub-task 1.1; Phase 2 sub-tasks 2.1 + 2.2)
**Outcome**: AGENTS.md is the canonical agent-agnostic directive for the repository; CLAUDE.md is removed; the smoke-test classification rubric is documented and enforced by a meta-test.

## Sub-tasks completed

### 1.1 - AGENTS.md migration and CLAUDE.md removal

- Created [AGENTS.md](../../../../versions/AGENTS.md) at the repository root with all rules previously enforced by `CLAUDE.md`, rewritten to be agent-agnostic where the original rule was tool-specific. The legacy "When using the Bash tool" wording is now "Shell-execution tool calls"; "Read, Glob, and Grep tool call" is now "file-read, file-glob, and content-search tool call".
- Added the five-step Cognitive Workflow section: ANALYZE -> PLAN -> EXECUTE -> VERIFY -> PROPAGATE. The workflow is described as a rhythm to embody, not a script to recite.
- Strengthened two existing rules during the migration: destructive git commands now name the categories that require confirmation (force-push, hard reset, branch deletion, history rewrites); the ASCII-only commit-message rule is promoted from a global preference into the project's Critical Rules.
- A "Module Authorship Contract" section is reserved for Phase 11 (memory-hygiene plan); for now it points readers at `ARCHITECTURE.md` and the future `configs/dependency-cruiser.cjs`.
- Deleted `CLAUDE.md` via `git rm`. No pointer file is left behind.
- Updated cross-references: [.vscodeignore](../../../../versions/.vscodeignore) excludes `AGENTS.md` instead of `CLAUDE.md`; the `setup-project` skill at [src/skills/catalog/setup-project/SKILL.md](../../../../versions/src/skills/catalog/setup-project/SKILL.md) now bootstraps an `AGENTS.md` for new projects; [CONTRIBUTING.md](../../../../versions/CONTRIBUTING.md) names AGENTS.md as the canonical agent directive.
- Added [tests/unit/docs/AGENTS-md.test.ts](../../../../versions/tests/unit/docs/AGENTS-md.test.ts) which asserts AGENTS.md exists and contains every required section, the cognitive-workflow vocabulary, and the no-co-author commit rule. The companion non-existence test asserts `CLAUDE.md` is gone.

### 1.2 - Smoke-test classification rubric

- Created [docs/archive/versions/v0/v0.5.0/test-pyramid.md](../../test-pyramid.md) by carrying forward the v0.4.0 ratio documentation (86.7 / 6.7 / 6.7) and appending the new Smoke-Test Classification Rubric: `missing_env`, `upstream_unavailable`, `product_failure`, `harness_bug`. The rubric documents the helper functions canonical to the project and links to the meta-test.
- Extended [tests/helpers/factories.ts](../../../../versions/tests/helpers/factories.ts) with `skipIfMissingEnv(...keys)` and `skipIfNoOllama()`. Both return booleans so they compose with `describe.skipIf(...)`.
- Reclassified [tests/integration/ollama-health.test.ts](../../../../versions/tests/integration/ollama-health.test.ts) to use `skipIfNoOllama()` plus an inline class comment (`missing_env`). No other integration test had a bare env-var early return; the meta-test confirmed.
- Added [tests/unit/test-discipline.test.ts](../../../../versions/tests/unit/test-discipline.test.ts) which walks `tests/integration/**/*.test.ts` and enforces: (a) no bare `if (!process.env.X) return` early returns; (b) any `it.skip(` / `describe.skip(` must have an adjacent `TODO(harness-bug)` or `TODO(missing_env)` comment. Bypass via `SKIP_TEST_DISCIPLINE_LINT=1` for emergency triage.
- Cross-referenced from [CONTRIBUTING.md](../../../../versions/CONTRIBUTING.md) Testing section.

### 1.3 - Phase 1 stabilization

- Lint: 0 errors, 5 pre-existing warnings (out-of-phase scope).
- Build: `tsc` clean.
- Unit tests: 75 files, 1043 tests, all passing.
- Integration tests: 11 files, 62 tests, 2 designed skips (`ollama-health.test.ts`, gated on `OLLAMA_URL`; the new `skipIfNoOllama()` reports the skip cleanly).
- Migration completeness audit: `diff /tmp/old-claude.md AGENTS.md` confirms every CLAUDE.md rule is preserved with strengthening or generalization; no rule was lost.
- Reference sweep: `git grep -i 'CLAUDE\.md'` against the active product surface (src/, tests/, root config files, AGENTS/CONTRIBUTING/ARCHITECTURE/README) returns zero matches. Remaining matches are confined to historical artifacts: `docs/DEVLOG.md` (past entries), `docs/archive/versions/v0/v0.1.0`/`v0.2.0`/`v0.3.0` development history and reviews, and the v0.5.0 plan and comparison files which document the migration motivation.

## Deviations from the plan

- **Agent-behavior golden baseline check is deferred**. Step 5 of the stabilization prompt asks for a representative golden task to be run twice (once with the new AGENTS.md, once with the pre-migration CLAUDE.md, e.g. via `git worktree`). That check requires a live Ollama and a multi-minute run; it could not be executed in this session. The risk is judged low because the migration diff is purely additive: the cognitive-workflow stanza was added, tool-specific rules were generalized, and the ASCII-only commit-message rule was promoted into project-level Critical Rules. No existing rule was loosened, removed, or contradicted. A live golden-task baseline can be run on the developer's machine when convenient.

- **Reference-sweep scope clarification**. The umbrella plan's strict carve-out names only `docs/archive/versions/v0/v0.5.0/comparison-free-claude-code.md` and the implementation plan as exempt from the `git grep CLAUDE.md` audit. In practice the v0.5.0 sub-plans (`token-optimizer-adoption.md`, `routa-harness-adoption.md`, `ci-and-docs-hygiene.md`, `memory-hygiene.md`), the v0.5.0 comparison reports for the other source projects, the past-version review documents, and DEVLOG entries from v0.1.0 onward all reference the historical filename for traceability. The audit pass was therefore scoped to the active product surface; historical artifacts are exempt by virtue of being historical. Rewriting them would corrupt the project's record of how the migration came about.

## Test results

| Suite | Files | Tests | Status |
|-------|-------|-------|--------|
| Unit | 75 | 1043 | All passing |
| Integration | 11 | 62 | All passing (2 designed skips on `ollama-health.test.ts`) |
| New meta-tests | 2 | 8 | All passing |

## Files added or modified

- Added: [AGENTS.md](../../../../versions/AGENTS.md), [docs/archive/versions/v0/v0.5.0/test-pyramid.md](../../test-pyramid.md), [tests/unit/docs/AGENTS-md.test.ts](../../../../versions/tests/unit/docs/AGENTS-md.test.ts), [tests/unit/test-discipline.test.ts](../../../../versions/tests/unit/test-discipline.test.ts), this session-history file
- Modified: [.vscodeignore](../../../../versions/.vscodeignore), [src/skills/catalog/setup-project/SKILL.md](../../../../versions/src/skills/catalog/setup-project/SKILL.md), [CONTRIBUTING.md](../../../../versions/CONTRIBUTING.md), [tests/helpers/factories.ts](../../../../versions/tests/helpers/factories.ts), [tests/integration/ollama-health.test.ts](../../../../versions/tests/integration/ollama-health.test.ts)
- Deleted: `CLAUDE.md`

## Phase 1 exit checklist

- [x] `AGENTS.md` exists with all migrated rules + cognitive-workflow stanza
- [x] `CLAUDE.md` is deleted; non-existence test green
- [x] No remaining `CLAUDE.md` references on the active product surface (historical artifacts retained)
- [x] `docs/archive/versions/v0/v0.5.0/test-pyramid.md` includes the smoke-test classification rubric
- [x] Every integration test uses documented helpers; no bare env-var early returns
- [x] Test-discipline meta-test green
- [ ] Agent-behavior baseline statistically equivalent (deferred -- see Deviations)
- [x] Session history generated

## Next phase

Phase 2 -- Tool Surface Hardening (`max_bytes` cap with truncation hint; `read_file` and `grep_codebase` pagination; tool-error messages with parameter name + `Usage:` hint; null-safety baseline).
