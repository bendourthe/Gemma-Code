# Quality Document -- Gemma-Code

**Origin**: v0.8.0 Phase 4 sub-task 4.7 (item C4) -- companion to `evaluator-rubric.md`. Adopted from the `projects/project-06/solution/quality-document.md` reference in the multi-source comparison report.

**Purpose**: A short A-F letter-grade summary that distils the 15-criterion rubric into a single decision-friendly figure. Use this for stand-up reporting, release-readiness, and DEVLOG entries.

## Translation from rubric averages

| Rubric overall average | Letter | Meaning |
|------------------------|--------|---------|
| >= 4.5 | A | Exceeds the bar across the board. Ship it; consider as exemplar. |
| 4.0 - 4.49 | B | Solid. Minor polish welcomed but not required for merge. |
| 3.5 - 3.99 | C | Acceptable. At least one follow-up logged in `known-gaps.md`. |
| 3.0 - 3.49 | D | Marginal. Multiple follow-ups; consider a clean-up phase before release. |
| < 3.0 | F | Reject. Block release or schedule a hard reset. |

## Required fields

For each session, fill in (and submit alongside the rubric file):

- **Session id**: <YYYY-MM-DD_phase-N or PR number>
- **Branch / tag**: <git ref>
- **Plan reference**: <docs/v0.X.0/plans/*.md#section>
- **Overall letter grade**: <A / B / C / D / F>
- **Top three strengths** (one line each):
  1.
  2.
  3.
- **Top three risks or follow-ups** (one line each; link `known-gaps.md` row id):
  1.
  2.
  3.
- **Reviewer**: <name / sub-agent id>
- **Date**: <YYYY-MM-DD>

## Companion artifacts

- `evaluator-rubric.md` -- 15-criterion 1-5 grades.
- `session-handoff.md` -- forward-looking carryover (what is open, what is decided, where to start next session).
- `session-progress.md` -- chronological log of what happened this session.

`/wrap-up-session` writes all four files under `docs/archive/versions/v0/v0.8.0/development/<session-id>/` when invoked.
