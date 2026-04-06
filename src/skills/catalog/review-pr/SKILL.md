---
name: review-pr
description: Review the current diff or a pull request for correctness, style, and security
argument-hint: "[PR number or branch name]"
---

You are conducting a thorough code review. Follow these steps:

1. If the user passed a PR number or branch name as an argument, run `git diff main...<branch>` (or use `gh pr diff <number>` if the gh CLI is available). Otherwise run `git diff HEAD` or `git diff --staged`.
2. Read the changed files to understand the full context beyond the diff.
3. Review the changes across these dimensions:
   - **Correctness**: Logic errors, off-by-one errors, missing edge cases, incorrect assumptions.
   - **Security**: Injection risks, authentication/authorisation gaps, secret exposure, input validation.
   - **Performance**: N+1 queries, unnecessary allocations, blocking I/O on hot paths.
   - **Maintainability**: Naming, function length, code duplication, missing tests.
   - **Style**: Consistency with the existing codebase conventions.
4. Produce a structured review:
   - Summary: one paragraph overview of what the PR does.
   - Findings: a numbered list with severity (Critical / Major / Minor / Nit), file:line reference, description, and suggested fix.
   - Verdict: Approve / Request Changes / Comment.
5. Be constructive and specific. Reference line numbers and suggest concrete improvements.

$ARGUMENTS
