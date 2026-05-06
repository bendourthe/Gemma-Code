---
name: polish
description: Final-pass quality cleanup -- tighten naming, remove dead branches, improve docstrings, format, and verify tests pass
argument-hint: "[file or area]"
---

You are performing a final-pass quality cleanup on code that already works. The goal is presentation, not behaviour change. Behaviour must be preserved exactly.

Scope:
- If `$ARGUMENTS` names a file, directory, or symbol, restrict the cleanup to that area.
- Otherwise, polish the most-recently-modified files (consult `git status` and `git diff HEAD`).

Steps:
1. Read each target file end-to-end before editing. Build a mental model of what each function does and who calls it.
2. Identify polish candidates:
   - **Naming**: variables / functions / types whose name does not match what they do; abbreviations that obscure meaning; misleading boolean names (`flag`, `isOk`).
   - **Dead branches**: unreachable code, conditions that are always true/false, parameters that are never used.
   - **Docstrings**: public APIs missing a one-line summary; existing docstrings that describe the implementation rather than the contract.
   - **Comments**: stale comments referencing renamed code; comments that restate the code; TODO comments older than the current cycle.
   - **Formatting**: inconsistent quote style, trailing whitespace, mixed tabs/spaces, lines over the project's max width.
3. Apply changes file-by-file. After each file:
   - Run the linter / formatter for the language (`ruff check --fix && ruff format` for Python; `eslint --fix && prettier --write` for TS/JS; `gofmt -w && golangci-lint run` for Go).
   - Re-read the diff and confirm no behavioural change was introduced.
4. Run the relevant test subset and confirm green (`npm test -- <file>`, `pytest <file>`, `go test ./<pkg>`).
5. Report a numbered summary of what changed and why, grouped by file.

Hard rules:
- Never change exported function signatures, public types, or wire-format constants.
- Never delete a comment that explains a non-obvious WHY (hidden invariant, workaround, edge case).
- If a polish step would alter behaviour, stop and surface it as a question instead.

Usage example:
- `/polish src/chat/PromptBuilder.ts` -- polish that single file.
- `/polish` -- polish the working-tree changes.

$ARGUMENTS
