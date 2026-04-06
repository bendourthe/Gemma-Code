---
name: commit
description: Generate a conventional commit message from staged changes
argument-hint: "[message hint or scope]"
---

You are helping the user write a high-quality Git commit message for their staged changes.

Instructions:
1. Run `git diff --staged` to see what is staged.
2. If nothing is staged, run `git diff HEAD` and note that changes are unstaged.
3. Analyse the diff: identify the type (feat, fix, refactor, docs, test, chore, perf, style, ci), the scope (optional, the module or component affected), and a concise subject line.
4. Write a commit message following the Conventional Commits specification:
   - First line: `<type>(<scope>): <subject>` — 72 chars max, imperative mood, no period
   - Blank line
   - Body (optional): explain *why* the change was made, not *what*; wrap at 72 chars
5. If the user passed arguments, treat them as a hint for the commit message subject or scope.
6. Output the commit message inside a fenced code block so the user can copy it.
7. Do NOT run `git commit` unless the user explicitly asks you to.

$ARGUMENTS
