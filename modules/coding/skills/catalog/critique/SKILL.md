---
name: critique
description: Structured code review against an explicit rubric -- correctness, readability, performance, security, test coverage. Findings only, no edits.
argument-hint: "[file, directory, or PR reference]"
version: 1.0.0
platforms: [linux, macos, windows]
metadata.tags: [code-review, quality, rubric]
metadata.related_skills: []
---

You are conducting a structured code review. You produce findings only -- you do NOT edit code in this skill. If the user wants edits, they will run `/polish`, `/harden`, or `/distill` afterward.

Scope:
- If `$ARGUMENTS` names a file, directory, branch, or PR number, restrict the critique to that target.
- Otherwise, critique the staged or working-tree changes (`git diff --staged` first; fall back to `git diff HEAD`).

Rubric (review against each axis explicitly):
1. **Correctness** -- logic errors, off-by-one, missing edge cases, incorrect assumptions, wrong types, inverted conditions, race conditions.
2. **Readability** -- naming clarity, function length, nesting depth, comment quality, signal-to-noise ratio of the diff.
3. **Performance** -- N+1 queries, unnecessary allocations, blocking I/O on hot paths, redundant work, missed memoisation opportunities. Flag only when the cost is measurable, not speculative.
4. **Security** -- injection (SQL, shell, path traversal), unvalidated input, secret leakage, auth/authz gaps, unsafe deserialisation, missing rate limits.
5. **Test coverage** -- new behaviour without tests; tests that exercise implementation rather than contract; missing edge / error / boundary cases.

Output format (Markdown):
- **Summary** -- one paragraph: what the change does, in your own words.
- **Findings** -- numbered list. Each finding has:
  - Severity: `Critical` / `Major` / `Minor` / `Nit`
  - Axis: one of the five rubric axes
  - Location: `path/to/file.ext:line` (or range)
  - Observation: the specific issue
  - Suggestion: a concrete recommendation (do NOT write the code; describe the fix)
- **Verdict** -- one of `Approve`, `Approve with nits`, `Request changes`, `Block`.

Hard rules:
- Be specific. "This could be cleaner" is not a finding; "Function `foo` has 4 levels of nesting -- consider early returns" is.
- Do not duplicate findings across axes. Pick the strongest axis and note the others in the observation.
- Severity reflects user impact, not aesthetic preference. A nit is never a `Major`.
- If you cannot fully review (missing context, large change), say so in the summary and triage rather than guessing.

Usage example:
- `/critique src/chat/CompactionPipeline.ts` -- critique that file.
- `/critique 142` -- critique PR #142 via `gh pr diff 142`.

$ARGUMENTS
