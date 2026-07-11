# Test Pyramid — v0.5.0

**Recorded**: 2026-04-25 (Phase 1 of v0.5.0 — carried forward from [docs/archive/versions/v0/v0.4.0/test-pyramid.md](../v0.4/test-pyramid.md))
**Purpose**: Document the ratio of unit / integration / e2e tests so regressions toward the "ice-cream cone" shape are visible in review, and define the rubric the project uses to decide whether a flaky or environment-dependent test should skip or fail.

## File-level counts (carried over from v0.4.0)

Counts below are `*.test.ts` files only. `*.ps1` and `*.sh` smoke scripts are tracked in [tests/smoke/](../../../tests/smoke) and [tests/integration/installer/](../../../tests/integration/installer) but intentionally excluded here because they execute out of the Vitest runner.

| Tier | Location | Test files | Share |
|------|----------|------------|-------|
| Unit | [tests/unit/](../../../tests/unit) | 78 | 86.7% |
| Integration (non-e2e) | [tests/integration/](../../../tests/integration) | 6 | 6.7% |
| E2E | [tests/integration/e2e/](../../../tests/integration/e2e) | 6 | 6.7% |

Total at start of v0.5.0: 90 Vitest test files. Total test cases: 1,168 (2 live-Ollama skips, 1,166 passing). New tests landed during v0.5.0 phases will continue to lean toward the integration tier per the v0.4.0 follow-up note.

## Pyramid target

The standing goal (from the v0.4.0 implementation plan Phase 5 stability gate) was to move the pyramid "closer to 70/20/10". The measured ratio at the start of v0.5.0 is **86.7 / 6.7 / 6.7** — still heavily top-heavy on unit tests, with the integration band growing from 4.6% to 6.7% during v0.4.0 Phase 5. v0.5.0 phases that touch tool-handler surfaces and harness wiring should preferentially add integration-tier coverage.

That shape is partly intentional: Gemma Code's surface is a VS Code extension whose integration seams (webview messaging, Ollama HTTP, SQLite storage, configuration reload) each have dedicated integration tests. The unit band is large because the agent loop, orchestration, and tool handlers have many branching behaviors that are cheap to unit-test and expensive to exercise end-to-end.

## Carried-over context from v0.4.0

The following structural improvements from v0.4.0 remain in force at the start of v0.5.0:

- **Shared test helpers** — [tests/helpers/factories.ts](../../../tests/helpers/factories.ts) with a `mockOf<T>()` generic and 10+ typed factories. v0.5.0 Phase 1 extends this file with `skipIfNoOllama()` and `skipIfMissingEnv()` helpers used by the rubric below.
- **Deterministic synchronization** — no `setTimeout(r, N)` test-sync primitives; suite uses `vi.waitFor` / `Promise.resolve()` / fake timers.
- **Consistent naming** — no `should ` prefix in `it()` descriptions in the orchestration suite.
- **Assertion strength** — weak `toBeDefined`/`toBeTruthy`/`toBeFalsy` assertions tightened where feasible; remaining ones are legitimate pre-specific-assertion null guards.
- **Golden-task cross-check** — [scripts/generate-golden-tasks.mjs](../../../scripts/generate-golden-tasks.mjs) regenerates [src/evaluation/goldenTasksYaml.generated.ts](../../../src/evaluation/goldenTasksYaml.generated.ts) on `prebuild`/`pretest`.
- **Installer test disambiguation** — nightly `installer-package-check-*` (verifies PyQt installer package); weekly `installer-smoke-*` (canonical full smoke surface).
- **Characterization-test discipline for refactors** — non-trivial refactors and externalization work follow the [refactor playbook](../../refactor-playbook.md): capture a behavior snapshot before touching the module, refactor, then re-verify byte-equivalence. Phase 8 (specialist externalization) is the canonical worked example.

## Smoke-Test Classification Rubric

Any test that may not be runnable in every environment must declare which of the four classes below applies. The class determines whether the test SKIPs (with a clear reason) or FAILs. No test may silently early-return on a bare `process.env` check — use the documented helpers in [tests/helpers/factories.ts](../../../tests/helpers/factories.ts).

### 1. `missing_env`

The required environment variable, credential, or configuration is absent.

- **Action**: SKIP with a clear reason. Do NOT fail.
- **Example**: a test that requires `OLLAMA_URL` to be set; if unset, skip.
- **Implementation**: use `skipIfMissingEnv("OLLAMA_URL", ...)` from [tests/helpers/factories.ts](../../../tests/helpers/factories.ts), or Vitest `describe.skipIf(!process.env.OLLAMA_URL)` if a class-level skip is more readable.

### 2. `upstream_unavailable`

A required external dependency is reachable in principle but down right now (Ollama not responding, model not pulled, network unreachable).

- **Action**: SKIP with a clear reason in the test output.
- **Example**: probe `OLLAMA_URL/api/tags` in `beforeAll`; if the probe fails, skip the whole suite.
- **Implementation**: use `skipIfNoOllama()` from [tests/helpers/factories.ts](../../../tests/helpers/factories.ts). The helper combines the `missing_env` and `upstream_unavailable` cases — env not set OR upstream not responding both result in skip.
- **Distinction from `missing_env`**: env is configured, but the upstream service is not currently usable.

### 3. `product_failure`

The test exposed a real bug in Gemma Code.

- **Action**: FAIL. Do NOT skip.
- This is the default class for any unexpected assertion failure.

### 4. `harness_bug`

The test itself is broken (flaky setup, race condition, fixture out of sync).

- **Action**: FAIL — but tag the test with `@harness-bug` in the title and open a tracking issue.
- The fix path is to repair the test, not to skip it. A `it.skip(` or `describe.skip(` is permitted only with an adjacent `// TODO(harness-bug): <issue link>` comment; the meta-test at [tests/unit/test-discipline.test.ts](../../../tests/unit/test-discipline.test.ts) enforces this.

### Helper utilities (canonical source)

The two helpers below live in [tests/helpers/factories.ts](../../../tests/helpers/factories.ts) and are the only sanctioned way to gate integration tests on environment state:

- `skipIfMissingEnv(...keys: string[]): boolean` — returns `true` when any listed env var is unset; `describe.skipIf(skipIfMissingEnv("OLLAMA_URL"))` skips the suite with a `missing_env` reason.
- `skipIfNoOllama(): boolean` — combined check: env not set OR `OLLAMA_URL/api/tags` unreachable. Used by every test that depends on a live Ollama.

### Relationship to the Blocker / Friction / Optimization rubric

The agent-friendly-tools severity rubric in [docs/archive/versions/v0/v0.5.0/comparison/comparison-7-principles-for-agent-friendly-clis.md](comparison/comparison-7-principles-for-agent-friendly-clis.md) (and, when Phase 11 lands, `docs/archive/versions/v0/v0.5.0/tool-audit.md`) is for tool-output quality. The four-class rubric above is for test-suite stability. Both are vocabulary tools, and contributors are expected to use the right one for the right problem.

### Cross-references

- [CONTRIBUTING.md](../../../CONTRIBUTING.md) — links here from the Testing section.
- [tests/helpers/factories.ts](../../../tests/helpers/factories.ts) — the implementation of the helpers.
- [tests/unit/test-discipline.test.ts](../../../tests/unit/test-discipline.test.ts) — the meta-test that enforces the rubric.

## How to reproduce the count

```bash
# Unit
git ls-files 'tests/unit/**/*.test.ts' | wc -l
# Integration (non-e2e)
git ls-files 'tests/integration/**/*.test.ts' | grep -v '/e2e/' | wc -l
# E2E
git ls-files 'tests/integration/e2e/**/*.test.ts' | wc -l
```
