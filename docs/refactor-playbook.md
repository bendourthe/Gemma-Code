# Refactor / Characterization-Test Playbook

This playbook is the contract for behavior-preserving refactors in Gemma Code. It captures the discipline used in v0.5.0 Phase 8 (specialist externalization), where compiled-in sub-agent prompts were moved out to runtime Markdown files without altering observable behavior.

The rule is short: **before you change a complex module, write a test that records what it does today**. Then change the module. Then re-run the test and confirm the recording still matches. If you cannot write the test, you do not yet understand the module well enough to change it.

## When to write characterization tests

Reach for this discipline when at least one of the following is true:

- The target module is over ~200 lines of code, or
- You are externalizing compiled state to runtime data (config files, plugin systems, asset directories), or
- You are extracting a class/function used in more than one place, or
- The module has known unwritten contracts that callers rely on (canonical example: prompt strings whose exact bytes the model has been trained against).

If none of those apply — small private helper, fully-typed pure function, single caller — the existing unit tests are usually enough. Reserve this playbook for the cases where "behavior" is large enough that a free-form refactor risks invisible drift.

## How to capture behavior

The capture is a recording of what the module produces today, not an aspirational specification. Pick the cheapest accurate representation of the output:

- **`toMatchFileSnapshot`** for prose, prompt strings, large rendered Markdown — anything that should be inspected as text in a diff. The snapshot lives next to the test under `tests/snapshots/<module>/<scenario>.txt`. The Phase 8 specialist work uses [tests/snapshots/specialists/](../tests/snapshots/specialists/) (`research.txt`, `verification.txt`, `planning.txt`).
- **JSON snapshot** for structured outputs (tool scopes, settings shapes, plan steps). Stable key ordering matters; sort objects before snapshotting. The Phase 8 specialist work uses [tests/snapshots/specialists/tool-scope.json](../tests/snapshots/specialists/tool-scope.json).
- **Sub-string assertions** when full byte-equality is too brittle (e.g. a prompt assembled from templates with timestamps). Pin the parts that matter; let the rest float.
- **Property-based tests** when the output is large but the invariants are local (every error contains a `Usage:` hint; every JSON output round-trips through `JSON.parse`). v0.5.0 Phase 6 uses this pattern in [tests/unit/tools/errors.test.ts](../tests/unit/tools/errors.test.ts).

## What to exclude from snapshots

A snapshot is only useful if re-running it produces the same bytes. Exclude anything that breaks determinism:

- Timestamps, ISO dates, Unix epoch values.
- Session IDs, trace IDs, span IDs, UUIDs.
- Monotonic counters, per-process random seeds.
- File paths that include the test runner's temp directory; normalise to a placeholder before snapshotting.
- Embedded version numbers that change every release; if version *is* the thing under test, snapshot it but in its own assertion.

When in doubt, run the test twice in succession on the same code and confirm zero diff. If it diffs, your fixture leaked non-determinism.

## Re-running snapshots

`vitest --update` (or `vitest run -u`) regenerates all snapshots. Use it deliberately:

- **Use it** when you intentionally changed the captured behavior and the diff is the result you wanted.
- **Refuse it** when the diff is a surprise. A surprising diff means either (a) your refactor changed behavior, in which case the refactor is not behavior-preserving, or (b) your fixture is non-deterministic, in which case the snapshot itself is broken.

Do not commit a snapshot regeneration without reading the diff. The diff is the artefact under review; the green test only proves the new bytes match the new bytes.

## Worked example: Phase 8 specialist externalization

The reference implementation is in [tests/unit/agents/SubAgentManager.characterization.test.ts](../tests/unit/agents/SubAgentManager.characterization.test.ts). The flow:

1. **Lock the existing behavior.** Before any refactor, the test captured the exact system prompt produced by `SubAgentManager.spawn('research', ...)` for each role to a file snapshot, and the tool scope per role to a JSON snapshot. Four sub-agent roles meant five snapshot files (one prompt per role plus the shared tool-scope JSON).
2. **Refactor.** Move the prompt content from [src/agents/SubAgentPrompts.ts](../src/agents/SubAgentPrompts.ts) into Markdown+YAML-frontmatter files under [assets/specialists/](../assets/specialists/) and add [src/agents/SpecialistLoader.ts](../src/agents/SpecialistLoader.ts) to load them via the priority chain (workspace override -> bundled -> hardcoded fallback).
3. **Re-run.** The same characterization test, against the refactored loader path, must produce **byte-identical** snapshots. Any diff means the externalization changed behavior; the fix is to align the asset file content with the original hardcoded string, not to update the snapshot.
4. **Add new tests** for the *new* behavior introduced by the refactor: workspace override loads, bundled load, fallback when both are missing, malformed YAML falls through. These live in [tests/unit/agents/SpecialistLoader.test.ts](../tests/unit/agents/SpecialistLoader.test.ts).

The discipline is the *order*: capture, refactor, re-verify, *then* extend.

## Anti-patterns

- **Snapshot-the-world.** Capturing every byte of every method in a 2000-line module produces a fixture so brittle that the next legitimate change requires updating the entire snapshot. Pin the parts that matter; sub-string-assert the rest.
- **Zero snapshots, just trust the diff.** Refactoring without a recording means there is no anchor to detect drift. Reviewers will not catch "this refactor accidentally inverted the trim semantics" by reading the patch. The test catches it; nothing else does.
- **Inline snapshots that drift undetected.** `toMatchInlineSnapshot` is convenient but loses the sub-string-vs-byte-equality distinction; reviewers tend to skim long inline strings. Prefer `toMatchFileSnapshot` so the snapshot lives in a file the diff viewer renders nicely.
- **Updating snapshots before reading the diff.** `--update` should be a deliberate step ("yes, this diff is the result I wanted"), not a default re-run.
- **Capturing live data.** A snapshot of the test runner's temp directory or current timestamp is not behavior; it is environment. Normalize before snapshotting or you will get false flakiness.

## See also

- [docs/archive/versions/v0/v0.5.0/test-pyramid.md](v0.5.0/test-pyramid.md) — overall testing philosophy and the smoke-test classification rubric.
- [CONTRIBUTING.md](../CONTRIBUTING.md) — daily-loop commands and lint/test gates.
- ADR-0004 sub-agent isolation contract: [docs/adr/0004-sub-agent-isolation-contract.md](adr/0004-sub-agent-isolation-contract.md) — captures *what* the Phase 8 refactor preserved and *why*.
