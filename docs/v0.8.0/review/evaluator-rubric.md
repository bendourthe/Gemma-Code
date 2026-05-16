# Evaluator Rubric -- Gemma-Code

**Origin**: v0.8.0 Phase 4 sub-task 4.7 (item C4) -- adopted from the `projects/project-06/solution/evaluator-rubric.md` reference in the multi-source comparison report.

**Purpose**: A structured 1-to-5 rubric that grades the work delivered in a single session, phase, or pull request across 15 criteria in 5 categories. Designed to feed `/wrap-up-session` and `/run-deep-review` so reviewers (human or sub-agent) produce comparable judgments instead of free-form prose.

**Usage**:

1. Copy this file into `docs/<version>/review/evaluator-rubric-<session-id>.md` (or accept the auto-generated copy emitted by `/wrap-up-session`).
2. For each criterion, write the **Score** (1-5) and a 1-2-sentence **Evidence** pointer (file path + line range, test name, or commit SHA).
3. Compute the per-category average. Average < 3 in any category triggers a follow-up phase or PR.
4. Submit alongside `quality-document.md` for the overall A-F grade.

## Anchored 1-5 scale

| Score | Meaning |
|-------|---------|
| 5 | Exceeds the bar. Reusable as an exemplar for future work. |
| 4 | Meets the bar with minor polish needed. |
| 3 | Meets the bar barely. One outstanding follow-up captured in `known-gaps.md`. |
| 2 | Below the bar. Multiple follow-ups required before release. |
| 1 | Unacceptable. Blocks merge / release. |

---

## Category 1: Correctness

| # | Criterion | Score | Evidence |
|---|-----------|-------|----------|
| 1.1 | Implementation matches the plan's acceptance criteria | _N/A_ | |
| 1.2 | Deviations are flagged in code (`# DEVIATION:`) and recorded in `known-gaps.md` | _N/A_ | |
| 1.3 | Edge cases identified in the plan are covered (empty input, large input, error path) | _N/A_ | |

**Category average**: _N/A_ / 5

## Category 2: Architecture

| # | Criterion | Score | Evidence |
|---|-----------|-------|----------|
| 2.1 | Module boundaries respected (no new circular imports, dependency-cruiser clean) | _N/A_ | |
| 2.2 | Public API surface is minimal and documented | _N/A_ | |
| 2.3 | Any non-trivial decision has an ADR or a `Why:` comment | _N/A_ | |

**Category average**: _N/A_ / 5

## Category 3: Verification

| # | Criterion | Score | Evidence |
|---|-----------|-------|----------|
| 3.1 | New code has unit tests; coverage >= 80% on new lines | _N/A_ | |
| 3.2 | Integration test covers the critical path end-to-end | _N/A_ | |
| 3.3 | Tests run deterministically (no `sleep`, no network) | _N/A_ | |

**Category average**: _N/A_ / 5

## Category 4: Documentation

| # | Criterion | Score | Evidence |
|---|-----------|-------|----------|
| 4.1 | DEVLOG entry summarises what changed and why | _N/A_ | |
| 4.2 | README / user-facing docs updated to match new behaviour | _N/A_ | |
| 4.3 | Inline comments explain non-obvious "why" only | _N/A_ | |

**Category average**: _N/A_ / 5

## Category 5: Operability

| # | Criterion | Score | Evidence |
|---|-----------|-------|----------|
| 5.1 | New settings have safe defaults; no behavioural surprises | _N/A_ | |
| 5.2 | Feature is observable (trace event, log line, metric) where appropriate | _N/A_ | |
| 5.3 | Failure modes are recoverable (no silent corruption, no stuck state) | _N/A_ | |

**Category average**: _N/A_ / 5

---

## Overall

| Category | Average | Status |
|----------|---------|--------|
| Correctness | _N/A_ | |
| Architecture | _N/A_ | |
| Verification | _N/A_ | |
| Documentation | _N/A_ | |
| Operability | _N/A_ | |
| **Overall** | _N/A_ | |

Translate to letter grade via `quality-document.md`. Sum < 3.5 across all categories is a fail.
