---
name: distill
description: Strip code to its essence -- remove indirection, simplify conditionals, collapse single-consumer abstractions. Behaviour-preserving.
argument-hint: "[file, function, or area]"
version: 1.0.0
platforms: [linux, macos, windows]
metadata.tags: [refactoring, simplification]
metadata.related_skills: [polish, harden]
---

Simplify code while preserving observable behaviour. Same code, same outcome, less structural overhead.

Scope:
- If `$ARGUMENTS` names a file, function, or directory, restrict to that target.
- Otherwise, ask the user which area -- this skill is too broad to apply blindly.

What to remove:
1. **Indirection** -- helpers with exactly one caller where the body is clearer inlined. Inline them.
2. **Dead conditionals** -- branches whose condition is always true / always false at the call sites. Replace with the live branch.
3. **Single-consumer abstractions** -- interfaces / base classes / wrappers with one implementer. Collapse unless the seam is explicitly load-bearing for tests or a written-down requirement.
4. **Redundant defensive code** -- nil / empty-string guards, type assertions for values guaranteed by the type system or the prior call.
5. **Accidental complexity** -- 3-step state machine for a 1-step problem; builder for a 2-field struct; generic with one instantiation.

What to KEEP:
- Public API surfaces (the surface IS the contract).
- Seams for testability (mocked interfaces, DI seams).
- Comments documenting non-obvious WHYs.
- Validation at system boundaries (user input, external APIs, deserialisation).
- Performance-motivated indirection (caches, batchers).

Process:
1. Read the target end-to-end. Rate every abstraction: `keep` / `inline` / `delete`.
2. Verify test coverage is sufficient. If not, stop and request tests first.
3. Apply changes one abstraction at a time. After each: re-run the affected tests; confirm the diff shrinks.
4. Run the linter / formatter.
5. Report: lines removed vs added; each inlined / deleted item with a one-line rationale; abstractions kept and why.

Hard rules:
- Behaviour-preserving. Changes to error messages, return values, log lines, side effects, or timing are out of scope.
- Run the test suite after each commit-sized chunk; stop on first failure.
- Skip files under active concurrent development (check `git log --since='1 day ago'`).

Usage: `/distill <file or function>` -- e.g. `/distill src/chat/CompactionPipeline.ts`.

$ARGUMENTS
