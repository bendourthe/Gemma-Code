---
name: distill
description: Strip code to its essence -- remove indirection, simplify conditionals, collapse single-consumer abstractions. Behaviour-preserving.
argument-hint: "[file, function, or area]"
version: 1.0.0
platforms: [linux, macos, windows]
metadata.tags: [refactoring, simplification]
metadata.related_skills: [polish, harden]
---

You are simplifying code while preserving its observable behaviour. The goal is to make the same code do the same thing with less structural overhead.

Scope:
- If `$ARGUMENTS` names a file, function, or directory, restrict the distillation to that target.
- Otherwise, ask the user which area to distill -- this skill is too broad to apply blindly to a working tree.

What to remove:
1. **Indirection** -- helper functions / methods with exactly one caller, where the helper's body is clearer inlined than wrapped. Inline them.
2. **Dead conditionals** -- branches whose condition is always true or always false given the call sites. Replace with the live branch.
3. **Single-consumer abstractions** -- interfaces / base classes / generic wrappers with one implementer. Collapse the abstraction unless the seam is explicitly load-bearing for tests or future extension that already has a written-down requirement.
4. **Redundant defensive code** -- nil checks, empty-string guards, type assertions for values guaranteed by the type system or the immediately-prior function call.
5. **Accidental complexity** -- a 3-step state machine for a 1-step problem; a builder pattern for a struct with 2 fields; a generic with one instantiation.

What to KEEP (these are NOT candidates for distillation):
- Public API surfaces, even if currently only one consumer (the surface IS the contract).
- Seams that exist for testability (mocked interfaces, dependency injection seams).
- Comments documenting non-obvious WHYs.
- Validation at system boundaries (user input, external APIs, deserialisation).
- Performance-motivated indirection (caching layers, batching wrappers).

Process:
1. Read the target end-to-end. List every abstraction (interface, helper, branch) and rate it: `keep` / `inline` / `delete`.
2. Verify the test coverage on the target is sufficient to catch behaviour regressions. If not, stop and request tests first.
3. Apply changes one abstraction at a time. After each change:
   - Re-run the tests (`npm test`, `pytest`, `go test`) for the affected module.
   - Confirm the diff is smaller, not larger, than what it removed.
4. Run the linter / formatter to clean up the resulting code.
5. Report:
   - Lines removed vs. lines added.
   - Each abstraction inlined / deleted, with a one-line rationale.
   - Any abstraction you considered but kept, with why.

Hard rules:
- Behaviour-preserving. If a change alters error messages, return values, log lines, side effects, or timing, it is out of scope.
- Run the full test suite after each commit-sized chunk. Stop on the first failure.
- Do not distill code under active development by another contributor (check `git log --since='1 day ago'` for the file).

Usage example:
- `/distill src/chat/CompactionPipeline.ts` -- simplify that file.
- `/distill src/utils/MarkdownRenderer.ts:renderHeading` -- simplify one function.

$ARGUMENTS
