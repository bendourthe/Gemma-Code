# ADR-0017: Canonise the Python golden runner; defer a TS-native rewrite

- **Status**: Accepted
- **Date**: 2026-05-15
- **Deciders**: v0.8.0 Phase 0 implementer (per `docs/v0.8.0/plans/v0.8.0-cycle.md` sub-task 0.13)

## Context

The v0.7.0 cycle plan referenced a "TS-native golden runner" as a deliverable ("if not yet built, this is the cycle to build it" -- `docs/v0.7.0/plans/v0.7.0-cycle.md` sub-task 8.1). It was never built; the existing Python framework in [tests/golden/framework/](../../tests/golden/framework/) (`run_all.py`, `taxonomy.py`, `assertions.py`, the suites under `tests/golden/suites/`) is the only runner. The plan's reference was an aspiration carried forward from earlier cycles, not an executed work item. The mismatch was logged as `10.O.17` in `docs/v0.7.0/known-gaps.md` Section 10.

The runner sits outside CI by design: it executes against a live Ollama backend (`gemma4:e4b` pulled, `ollama serve` running on a quiescent workstation) and produces baseline JSON artifacts that are committed under `tests/golden/baselines/`. The CI suites (`npm run test`, `npm run test:integration`, `npm run bench`) do not consume the runner; they consume the committed baselines.

The question is whether to (a) build a TS rewrite to homogenise the toolchain or (b) explicitly canonise the Python runner as the project's canonical entry point.

## Decision

Canonise the Python runner. Reject the TS-native rewrite for v0.8.0+.

Concrete changes the decision requires:

1. `docs/v0.7.0/plans/v0.7.0-cycle.md` sub-task 8.1 narrative is updated retroactively to describe the Python runner as canonical (no rewrite in scope).
2. `README.md` and `CONTRIBUTING.md` golden-suite sections explicitly point at `python tests/golden/framework/run_all.py --model gemma4:e4b --output tests/golden/baselines/<version>.json` as the run-baseline command.
3. The v0.7.0 known-gap `10.O.17` moves to Resolved in `docs/v0.7.0/known-gaps.md` Section 10.2, with this ADR as the resolution reference.

## Consequences

- **Positive**:
  - Zero new code to maintain. The existing runner has been operator-validated against the v0.5.0 / v0.6.0 / v0.7.0 / v0.4.0 baseline captures and is well-understood.
  - The runner is invoked exactly once per cycle by the operator, not in CI. The maintenance pressure is low; the rewrite cost would be paid once but the runtime cost stays unchanged.
  - Python's assertion library + tokenizer + small dependency surface (`requests`, `tiktoken`, no extra) is appropriate for an offline operator tool; the project's existing TS test infrastructure (Vitest) is shaped around CI assertions, not against-live-LLM baseline capture loops.
- **Negative**:
  - The project carries two languages instead of one for the golden-suite surface. New contributors who want to extend the suite need to read Python.
  - The `tests/golden/framework/` directory is excluded from the packaged extension already (it lives under `tests/`); no packaging cost. But ESLint / Vitest do not lint or run the Python, so a regression in the runner only surfaces at the next operator capture.
- **Neutral**:
  - If the project ever moves to a TS-native rewrite, this ADR is superseded by a future ADR explicitly. The existing Python is then archived but not deleted (audit-trail preservation).

## Alternatives considered

- **Alternative A -- Build a TS-native runner in v0.8.0.** Rejected because: (1) the operator-facing invocation pattern is `python run_all.py --model gemma4:e4b ...` on a quiescent workstation with Ollama running -- there is no in-CI use case that benefits from a TS rewrite; (2) the existing Python is the only path the operator has been running for the four most recent baseline captures (v0.4.0, v0.5.0, v0.6.0, v0.7.0); rewriting it adds maintenance burden without runtime benefit; (3) v0.8.0 has a long phase plan already; allocating phase budget to a rewrite forces a higher-leverage adoption item off the cycle.
- **Alternative B -- Build a partial TS wrapper that shells out to `run_all.py` and presents a `npm run golden` script.** Rejected because the wrapper is a thin layer that adds no value (the operator already invokes `python` directly) and the shell-out introduces a Python-discovery failure mode on Windows where `python3` vs `python` vs `py -3` resolution varies by install. The current README guidance to install Python 3.10+ and run `python` directly is simpler and more robust.

## Links

- Related known-gap: [docs/v0.7.0/known-gaps.md](../v0.7.0/known-gaps.md) Section 10.2 row `10.O.17`.
- Related plan: [docs/v0.8.0/plans/v0.8.0-cycle.md](../v0.8.0/plans/v0.8.0-cycle.md) sub-task 0.13.
- Implementation: this ADR + README / CONTRIBUTING golden-suite section update.
