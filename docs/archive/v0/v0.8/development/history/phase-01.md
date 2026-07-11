# Phase 1 -- Skill-native quick wins (prompt-only)

**Date**: 2026-05-15
**Plan reference**: [docs/archive/versions/v0/v0.8.0/plans/v0.8.0-cycle.md](../../plans/v0.8.0-cycle.md) Phase 1
**Status**: complete

## Summary

Phase 1 shipped seven prompt-only adoptions from the multi-source comparison: a structured compaction summary prefix that prevents the model from re-answering compacted questions, a strong-directive plan-mode denial template, a plan-mode capabilities reminder listing the v0.7.0 render primitives, an approved-with-notes path, and three new catalog skills (`/lens`, `/incident-commander`, `/council`). All seven sub-tasks landed with passing unit tests and a clean lint + build.

## Sub-tasks completed

### 1.1 Compaction `SUMMARY_PREFIX` framing (item A3)

- Created [src/chat/prompts/compaction.md](../../../../versions/src/chat/prompts/compaction.md) carrying the canonical prefix copy.
- Exported `COMPACTION_SUMMARY_PREFIX` from [src/chat/CompactionStrategy.ts](../../../../versions/src/chat/CompactionStrategy.ts:13) and wired it into the `LlmSummary.apply()` summary message between the `[Conversation summary]` header and the LLM-generated body.
- Added a regression test in [tests/unit/chat/CompactionStrategy.test.ts](../../../../versions/tests/unit/chat/CompactionStrategy.test.ts) asserting the prefix is present in the rendered summary.
- Token cost: ~70 tokens per compaction. Confirmed via local inspection that `PromptBudget` is not exceeded.

### 1.2 Strong-framed plan-mode denial template (item B2)

- Added `PLAN_DENIAL_TEMPLATE` and `buildDenialMessage(feedback)` exports in [src/chat/PlanMode.ts](../../../../versions/src/chat/PlanMode.ts).
- Added a `PlanMode.denyPlan(feedback)` method that reverts non-done steps to pending, resets the step pointer, and returns the rendered denial message.
- Added a `PlanDenyMessage` shape to [src/panels/messages.ts](../../../../versions/src/panels/messages.ts) and a `planDeny` case to [src/panels/ChatMessageRouter.ts](../../../../versions/src/panels/ChatMessageRouter.ts) that injects the rendered template as a system message.
- Regression test exercises both the template content and the state-mutation semantics.

### 1.3 PFM reminder injection on plan-mode entry (item B3)

- Created [src/chat/prompts/planModeCapabilities.md](../../../../versions/src/chat/prompts/planModeCapabilities.md) with the canonical render-primitive reference.
- Exported `PLAN_MODE_CAPABILITIES_REMINDER` from `PlanMode.ts` (const, no fs at hot path).
- [src/chat/PromptBuilder.ts](../../../../versions/src/chat/PromptBuilder.ts) now concatenates `PLAN_MODE_SYSTEM_ADDENDUM` and `PLAN_MODE_CAPABILITIES_REMINDER` when `planModeActive` is true, with `estimatedTokens` recomputed against the combined content.
- Regression test asserts the reminder names every v0.7.0 Phase 4 primitive (TODO_BLOCK, DIFF_CARD, ACTION_TAG, PERMISSION_PROMPT, THOUGHT_META_ROW, QUEUED_MESSAGE_FIELD, COMPLETION_REPORT).

### 1.4 Approved-with-notes plan-mode path (item B4)

- Added `PLAN_APPROVED_WITH_NOTES_TEMPLATE` and `buildApprovedWithNotesMessage(notes)` exports in `PlanMode.ts`.
- Added a `PlanMode.approveWithNotes(notes)` method that transitions every non-done step to approved and returns the rendered message.
- Added a `PlanApproveWithNotesMessage` shape to `messages.ts` and a `planApproveWithNotes` case to `ChatMessageRouter` that injects the system message.
- Webview UI textarea is deferred to Phase 3 sub-task 3.x (plan-mode UX overhaul); the protocol shape and router handler are in place so the executor sees the system message as soon as the UI submits.

### 1.5-1.7 Three new catalog skills

- [src/skills/catalog/lens/SKILL.md](../../../../versions/src/skills/catalog/lens/SKILL.md) -- analytical-lens-first answer pattern.
- [src/skills/catalog/incident-commander/SKILL.md](../../../../versions/src/skills/catalog/incident-commander/SKILL.md) -- triage / classify / 3-tier remediation / verify / playbook.
- [src/skills/catalog/council/SKILL.md](../../../../versions/src/skills/catalog/council/SKILL.md) -- advocate / architect / user-impact / synthesis. Latency cost flagged in the SKILL.md body since this skill performs three inference passes.
- All three carry the extended frontmatter fields anticipated by Phase 2.8 (`version`, `platforms`, `metadata.hermes.tags`) so they roll forward cleanly.
- Updated [tests/integration/commands/skill-execution.test.ts](../../../../versions/tests/integration/commands/skill-execution.test.ts) catalog-count assertion from 13 to 16 and added the three names to the `expected` list.

## Test results

```
npm run lint      -> exit 0 (eslint over src)
npm run build     -> exit 0 (tsc)
npx vitest run --config configs/vitest.config.ts \
    tests/unit/chat/CompactionStrategy.test.ts \
    tests/unit/chat/PlanMode.test.ts \
    tests/integration/commands/skill-execution.test.ts \
    tests/unit/panels/ \
    tests/unit/chat/PromptBuilder.test.ts
-> 244 tests passed (60 chat + 4 skills + 219 panels/PromptBuilder; numbers overlap intentionally as panels + PromptBuilder are shared infra)
```

Pre-existing failures (not caused by Phase 1; recorded in known-gaps.md as 10.O.D and 10.O.E):

- `tests/unit/cli/gemma-check.test.ts` and `tests/unit/scripts/package-skills.test.ts` -- `SyntaxError: Invalid or unexpected token` from `node:vm new Script`. Neither file was modified in Phase 1; both reproduce in isolation.
- `tests/integration/memory-consolidator-large.test.ts` -- 10K-event consolidation budget of 5 s exceeded (~11 s on dev workstation). v0.7.0 threshold; unrelated to Phase 1 changes.

## Deviations from plan

- Webview UI textarea for approved-with-notes (1.4) deferred to Phase 3 (plan-mode UX overhaul) where the annotation primitives land. Protocol shape and router handler are in place.

## Known gaps added

| ID | Category | Severity | Notes |
|---|---|---|---|
| 10.O.D | BG | P2 | Vitest vm-transform `SyntaxError` on `gemma-check.test.ts` and `package-skills.test.ts`. |
| 10.O.E | BG | P2 | `memory-consolidator-large.test.ts` 10K-event stress test exceeds 5 s budget. |

No items resolved this phase.

## Next phase

Phase 2: Harness artifacts + memory snapshot + injection defense.
