# v0.7.0 Phase 1 -- Skill expansion (zero-code first)

**Cycle**: v0.7.0
**Phase**: 1 (skill expansion)
**Date**: 2026-05-05
**Plan reference**: [docs/v0.7.0/plans/v0.7.0-cycle.md](../../plans/v0.7.0-cycle.md) Phase 1
**Comparison reference**: [docs/v0.7.0/comparison-multi-source.md](../../comparison-multi-source.md) C28 (impeccable-style design skills) + C36 (LLM-KB system-prompt patterns adopted as a skill)
**Architecture reference**: [docs/v0.7.0/architecture.md](../../architecture.md) Section 1

---

## 1. Scope

Phase 1 ships six new skills as static MD files before any infrastructure work. The phase is intentionally zero-code-first: the catalog change is the entire deliverable, so the catalog delta is the first thing visible to the user on a v0.7.0 install. No TypeScript code paths changed.

Two sub-tasks. Both ran autonomously without blocking on operator action.

---

## 2. Sub-tasks executed

### 2.1 -- 1.1 Five general-purpose code-improvement skills

Added `polish`, `critique`, `distill`, `harden`, `animate` as `src/skills/catalog/<name>/SKILL.md` files with YAML frontmatter (`name`, `description`, `argument-hint`) and a structured prompt body. Each skill defines its prompt text from scratch rather than copying from impeccable's frontend-only schema (Apache 2.0 + frontend-specific). Each skill includes hard rules that constrain scope:

- `polish` -- behaviour-preserving final-pass cleanup. Hard rule: never change exported signatures, public types, or wire-format constants. Use case: tighten naming, remove dead branches, improve docstrings, format, run tests.
- `critique` -- structured five-axis review (correctness / readability / performance / security / test coverage). Findings only -- the skill does NOT edit code, leaving that to other skills. Output: numbered findings with severity (Critical / Major / Minor / Nit), axis, location, observation, suggestion; closes with a verdict.
- `distill` -- behaviour-preserving simplification. Targets indirection, dead conditionals, single-consumer abstractions, redundant defensive code, accidental complexity. Hard rule: keep public APIs, testability seams, validation at boundaries, performance-motivated indirection.
- `harden` -- targeted error handling, input validation, resource cleanup, retry/timeout (only at network boundaries), concurrency safety. Each addition must trace to a real failure mode. Hard rule: no defensive checks against scenarios that cannot occur given the type system.
- `animate` -- restricted to webview / extension UI surfaces. Hard rules: respect `prefers-reduced-motion`, no animation longer than 500 ms, no inline magic numbers (durations as named constants), no animation that moves user focus.

The skills compose: `/critique` produces findings; `/polish` / `/distill` / `/harden` apply edits without changing observable behaviour. None of them runs without explicit user invocation.

### 2.2 -- 1.2 `build-second-brain` skill

Added `src/skills/catalog/build-second-brain/SKILL.md`. The skill is a structured prompt that walks the agent through:

1. Pre-flight: detect whether `~/.gemma-code/memory/<workspace-id>/{Instructions,Memory,Context}.md` exist.
2. If they do not, refer the user to `/memory init` (Phase 2) and stop. The skill does NOT create the files itself -- that is `/memory init`'s job.
3. If a path argument is provided, treat it as input notes; otherwise switch to interview mode (one round of batched questions covering role, project, stack, preferences, patterns, anti-patterns).
4. Extract `Preferences` / `Corrections` / `Patterns` / `Decisions` and write into `Memory.md`; user-describing facts go to `Instructions.md`; project-describing facts go to `Context.md`.
5. Confirmation flow: show diff, wait for user approval, write.

The skill ships in Phase 1 (zero-code-first ordering rule) but is non-functional until Phase 2 lands the memory file architecture. Cross-references the schema in `architecture.md` rather than duplicating it.

---

## 3. Files added

- `src/skills/catalog/polish/SKILL.md`
- `src/skills/catalog/critique/SKILL.md`
- `src/skills/catalog/distill/SKILL.md`
- `src/skills/catalog/harden/SKILL.md`
- `src/skills/catalog/animate/SKILL.md`
- `src/skills/catalog/build-second-brain/SKILL.md`
- `docs/v0.7.0/architecture.md` (new file -- Section 1 filled in for Phase 1; Sections 2-5 are placeholders for later phases that the corresponding phase fills in)
- `docs/v0.7.0/development/history/2026-05_phase-1-skill-expansion.md` (this file)

## 4. Files modified

- `tests/unit/skills/SkillLoader.test.ts` -- new `describe("v0.7.0 skill expansion")` block. One test per new skill (asserts the skill loads from the real on-disk catalog with non-empty `description` and `prompt`) plus an `argument-hint` presence check. Reading the real catalog (vs. the existing tmp-dir helpers) means a malformed frontmatter ships as a test failure rather than a silent skip. 7 new tests.
- `tests/integration/commands/skill-execution.test.ts` -- updated the count assertion from "seven" to "thirteen" built-in skills with the new names appended.
- `README.md` -- six new rows in the slash-command table.
- `docs/DEVLOG.md` -- new Phase 1 entry above the Phase 0 entry.

## 5. Verification

| Gate | Result |
|---|---|
| `npm run lint` | green |
| `npm run build` | green |
| `npm test` | 153 test files, 0 FAIL markers. Trailing `SIGSEGV` on process exit is the documented Node 24 + better-sqlite3 native-cleanup issue ([known-gaps.md](../../known-gaps.md) Section 5.1), not a test failure. |
| `npm run deps:check` | 134 modules, 553 dependencies, 0 violations. |
| `npm run catalog:check` | 16 modules, no diff. |
| `npm run perm-tier:check` | green. |

## 6. Deviations from the plan

None. Phase 1 prompt called for "5 new skills" plus "build-second-brain"; both shipped. The plan's "argument-hint and a 1-2 sentence usage example in the body" landed for every skill. The plan's reference to `docs/v0.7.0/architecture.md` required creating that file (it did not pre-exist); the architecture doc ships as a phase-by-phase document with Phase 1's Section 1 filled in and later sections as placeholders.

## 7. Out of scope (deferred to later phases)

- Phase 2 -- `~/.gemma-code/memory/` file architecture. The `build-second-brain` skill is a no-op until Phase 2 lands and `/memory init` exists.
- Phase 6 -- `scripts/package-skills.mjs` exports the catalog for other harnesses (Claude Code, Cursor, OpenCode, Gemini CLI). The new skills will export automatically once that script ships.

## 8. Phase 1 Exit Checklist

- [x] 6 new SKILL.md files exist under `src/skills/catalog/`
- [x] All 6 parse via `SkillLoader` with non-empty `description` and `prompt`
- [x] `/help` lists all 13 skills (count gated by integration test)
- [x] `npm run lint && npm run test` green
- [x] `npm run deps:check` passes
- [x] Architecture doc (`docs/v0.7.0/architecture.md`) Section 1 filled in
- [x] DEVLOG entry written
- [x] Session history written (this file)
- [x] README updated with new commands

## 9. Next steps

Phase 2 -- Memory file architecture. The `MemoryFiles` storage module, `/memory init|archive|edit` commands, and PromptBuilder integration are the unblockers for `build-second-brain` (Phase 1 ships the skill; Phase 2 makes it functional) and for the manual memory page UI in Phase 5.
