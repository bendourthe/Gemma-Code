# Development Log: v0.6.0 Phase 2 -- Test pipeline reliability + release-gate baselines

**Date**: 2026-04-27
**Operator**: Benjamin Dourthe
**Assisted by**: Claude Opus 4.7 (1M context) via Claude Code
**Objective**: Make the test pipeline a real safety net for the deep restructuring in Phases 3-7. Verify CI fails on `vitest` non-zero exit. Land the missing v0.6.0-cycle test files. Capture release-gate bench baselines for v0.4.0 / v0.5.0 / v0.6.0. Either verify or retract the unverified `>=40%` token-savings claim from v0.5.0.
**Outcome**: CI fail-on-error verified end-to-end via a deliberate-fail audit branch (red commit then green revert). Three new test files + one fixture landed. Bench baselines captured for all three versions; the v0.6.0 vs. v0.5.0 regression check is green. The 12 token-estimation assertions cited by the plan no longer exist (already fixed in `4b4840e` pre-Phase-1). The `>=40%` claim never appeared in CHANGELOG.md -- it lives only in v0.5.0 plan docs -- so there is nothing to retract there. The Python golden framework's `_run_live()` is non-functional post-ADR-0001 (calls a deleted FastAPI backend), so live golden baselines are infeasible without rebuilding the runner; this is documented as a known gap rather than fixed in scope.

---

## 1. Starting State

- **Branch**: `main` (Phase 1 shipped at `4ddcec0`).
- **Environment**: Windows 11 Pro, Node 24, Bash via Git for Windows, Vitest 1.6.1, TypeScript strict + `noUncheckedIndexedAccess`, Ollama on `localhost:11434` with model `gemma4:latest` (8B, Q4_K_M).
- **Plan reference**: [docs/archive/versions/v0/v0.6.0/plans/v0.6.0-cycle.md](../../plans/v0.6.0-cycle.md), Phase 2 (sub-tasks 2.1 ... 2.6).
- **Prior session reference**: [docs/archive/versions/v0/v0.6.0/development/history/2026-04_phase-1-security-chain-closure.md](./2026-04_phase-1-security-chain-closure.md).

---

## 2. Plan / Reality Reconciliation

The plan was authored before Phase 1 shipped; pre-implementation review surfaced four divergences from current reality:

| # | Plan assumption | Reality (verified 2026-04-27) | Resolution |
|---|---|---|---|
| 1 | 12 token-estimation assertions in `CompactionStrategy.test.ts` / `ContextCompactor.test.ts` / `errors/error-handling.test.ts` are failing | Running those three files: 71 / 71 pass. Full suite: 1562 passed, 4 skipped, 0 failed. Already fixed in commit `4b4840e fix(tests): rewrite token-estimation tests for tiktoken` (2026-04-26, pre-Phase-1). | Sub-task 2.2 marked complete-by-prior-work in this log. No code edits. |
| 2 | Live runs use `gemma4:e4b` | Local Ollama has only `gemma4:latest` (8B, Q4_K_M). The `gemma4:e4b` tag is not available locally and would be a separate pull. | Bench captures done with `OLLAMA_URL` unset so live-Ollama benches auto-skip; deterministic in-process subset is what we measure. Golden runs are infeasible for an unrelated reason (see #4). |
| 3 | Generate `tests/golden/baselines/v0.4.0.json` (file does not exist; cited in known-gaps 2.2 as missing) | Confirmed: file does not exist. Existing baselines: `v0.3.0-{e2b,e4b}.json`, `v0.5.0+{agent-friendly,memory-hygiene}.json`. The `v0.5.0+*.json` files are hand-authored placeholders (`"timestamp": "pending"`, empty `aggregates.mean_time_ms`), not measured runs. | Cannot generate; see #4. Documented in this log and in plan exit-checklist. |
| 4 | Run `tests/golden/framework/run_all.py --mode live` against Ollama | The runner posts to `${GEMMA_BACKEND_URL:-http://localhost:11435}/chat`. That endpoint was the Python FastAPI backend deleted by [ADR-0001](../../../adr/0001-python-backend-disposition.md) at the v0.4.0 cycle. No `src/backend/` exists at v0.4.0, v0.5.4, or main; no TS-side runner replaces it. The framework's `_run_live()` is dead code. | Live golden runs across all three versions are infeasible without first building a TS-native runner. That work is product surface and out of scope per v0.6.0 hard constraint #1 ("No new product surface"). Captured as known-gap; see Section 6. |

---

## 3. Chronological Steps

### 3.1 Sub-task 2.1 -- CI fail-on-error wiring (static + live)

**Static audit**: [.github/workflows/ci.yml:42-64](../../../../.github/workflows/ci.yml#L42-L64) runs `npm run test -- --reporter=verbose --coverage`. The npm script (`package.json:354`) is `vitest run --config configs/vitest.config.ts` -- `vitest run` is one-shot and exits non-zero on any failed assertion. No `passWithNoTests`, `|| true`, `continue-on-error`, or other silent-failure pattern is present. The chain should fail-fast.

**Local proof**: Wrote [tests/unit/storage/dummy-fail.test.ts](../../../../tests/unit/storage/dummy-fail.test.ts) (later removed) with `expect(true).toBe(false)`. `npm run test --silent -- tests/unit/storage/dummy-fail.test.ts` exited with code 1. (Note: when piping `npm run test ... | tail`, `$?` reflects `tail`'s exit code, not `npm`'s -- a footgun that masks the very behavior under audit. Captured the real exit via `> /tmp/dummy-fail-output.txt 2>&1; echo $?`.)

**Live proof**: Pushed branch `chore/v0.6.0-ci-fail-on-error-audit` with two commits in sequence:

1. `af215a0 chore(ci): deliberate failing test for v0.6.0 sub-task 2.1 audit` -- adds the dummy-fail test.
2. `a9b1b18 chore(ci): revert deliberate failing test ...` -- removes it.

GitHub Actions outcomes (from the workflow_runs API):

- Run on `af215a0`: [`Test TypeScript (Node 20.x)`](https://github.com/bendourthe/Gemma-Code/actions/runs/25003351181) and `(Node 22.x)` -> **failure**. `Coverage gate (80%)` -> **skipped** (correctly, via `needs: [test-ts]`). Lint, Build, Catalog sync, Audit -> **success**. Overall conclusion: **failure**.
- Run on `a9b1b18`: every job -> **success**. Overall conclusion: **success**.

This is exactly the documented fail-on-error contract: any failed assertion in any test file fails the `test-ts` job and propagates to overall CI failure. The Coverage gate's `needs: [test-ts]` correctly skipped on the red run.

**Branch disposition**: `chore/v0.6.0-ci-fail-on-error-audit` exists on origin with both commits; final HEAD is the green revert. Pending user decision whether to delete (destructive on remote -- not auto-deleted).

### 3.2 Sub-task 2.2 -- 12 token-estimation tests

Already complete. `git log --oneline -- tests/unit/chat/CompactionStrategy.test.ts tests/unit/chat/ContextCompactor.test.ts tests/unit/errors/error-handling.test.ts` shows commit `4b4840e fix(tests): rewrite token-estimation tests for tiktoken` (pre-Phase-1). The three files now pass 71 / 71. No code work needed; logged here for traceability.

### 3.3 Sub-task 2.5 -- Three plan-required test files + access-trace fixture

Built four files instead of three (the latency-gate `it()` blocks needed a parallel `.test.ts` because `vitest bench` does not execute `it()` blocks and `vitest run` excludes `**/*.bench.ts` from `test.include`):

1. [tests/benchmarks/predictive-cache.bench.ts](../../../../tests/benchmarks/predictive-cache.bench.ts) -- 3 bench cases on `PredictiveCache.observe()`, `predict(5)`, and `forecastARIMA101`. Deterministic 1000-observation Zipf-like trace generated inline from a fixed RNG seed.
2. [tests/unit/storage/PredictiveCache.budget.test.ts](../../../../tests/unit/storage/PredictiveCache.budget.test.ts) -- 2 `it()` assertions for the 50 ms ARIMA budget. **Real gates** (run under `vitest run`), not just bench documentation.
3. [tests/benchmarks/eviction-strategies.bench.ts](../../../../tests/benchmarks/eviction-strategies.bench.ts) -- 5 `bench()` cases (LRU, LFU, ARC, W-TinyLFU, Clock) replaying the fixture trace. Plus 6 smoke `it()` assertions documenting hit-rate ordering. Cache size 16 against 64-path / 2048-access Zipf trace.
4. [tests/integration/heuristic-fallback.test.ts](../../../../tests/integration/heuristic-fallback.test.ts) -- 3 `it.todo` assertions for the F-007 threshold-elevation contract. Intentionally `it.todo` until Phase 5 sub-task 5.1 lands; marked in the doc comment so the next maintainer knows when to flip them.
5. [tests/fixtures/access-trace.json](../../../../tests/fixtures/access-trace.json) -- 2048-entry Zipfian access trace (skew 1.1, 64 paths, deterministic RNG seed `0x12345678`) consumed by `eviction-strategies.bench.ts`. Generated programmatically; replace with a golden-task-derived trace once cache instrumentation lands.

Verification:

- `npm run test -- tests/unit/storage/PredictiveCache.budget.test.ts tests/integration/heuristic-fallback.test.ts` -> 2 pass, 3 todo, 0 fail.
- `npm run bench -- ... tests/benchmarks/predictive-cache.bench.ts tests/benchmarks/eviction-strategies.bench.ts` -> 8 bench cases reported. ARIMA fit + predict over 1000 observations measured at p99 ~1.36 ms (well under the 50 ms budget). Eviction-strategy ranking on this trace: clock > lru > lfu > arc > wtinylfu (throughput).

### 3.4 Sub-task 2.4 -- Bench baselines

Captured three real `npm run bench` runs and seeded the corresponding baseline files via `node scripts/check-bench-regressions.mjs --update-baseline`:

| Version | Method | Bench cases | File |
|---|---|---|---|
| v0.4.0 | git worktree at tag `v0.4.0` (commit `ef6d8b3`); `npm ci`; `npm run bench` | 12 | [tests/benchmarks/baselines/v0.4.0.json](../../../../tests/benchmarks/baselines/v0.4.0.json) (replaces empty seed-time placeholder) |
| v0.5.0 | git worktree at tag `v0.5.4` (commit `2ca1625`); `npm ci`; `npm run bench` | 18 | [tests/benchmarks/baselines/v0.5.0.json](../../../../tests/benchmarks/baselines/v0.5.0.json) (new file) |
| v0.6.0 | main branch post-Phase-1; `npm run bench` (includes the two new bench files from sub-task 2.5) | 28 | [tests/benchmarks/baselines/v0.6.0.json](../../../../tests/benchmarks/baselines/v0.6.0.json) (new file) |

Live-Ollama benches (`model-tier-matrix.bench.ts`, `time-to-first-token.bench.ts`) auto-skip when `OLLAMA_URL` is unset; the captured set is the deterministic in-process subset across all three versions. This is intentional -- live-Ollama numbers depend on hardware + model state and would not be comparable across worktrees.

**Regression check**: `node scripts/check-bench-regressions.mjs --baseline v0.5.0 --floor v0.4.0 --current /tmp/v0.6.0-bench.json` -> **OK, no regressions beyond 20% across 28 benchmarks.** 15 benches are new in v0.6.0 (the eviction-strategy and predictive-cache cases plus the suite-level entries); they have no baseline yet and are tracked from this point forward.

### 3.5 Sub-tasks 2.3 + 2.4 (golden parts) -- Infrastructure gap, deferred

The plan asks for `tests/golden/baselines/v0.4.0.json`, `v0.5.0.json`, and `v0.6.0.json` to be generated by `python tests/golden/framework/run_all.py --mode live`. The runner's `_run_live()` (at [tests/golden/framework/task_runner.py](../../../../tests/golden/framework/task_runner.py) line 79) does:

```python
backend_url = os.environ.get("GEMMA_BACKEND_URL", "http://localhost:11435")
...
client.post(f"{backend_url}/chat", json=payload)
```

`http://localhost:11435/chat` was the Python FastAPI backend deleted by [ADR-0001](../../../adr/0001-python-backend-disposition.md) (Accepted 2026-04-18, shipped in v0.4.0). Verified: no `src/backend/` exists at the v0.4.0, v0.5.4, or main commits. The TypeScript extension talks directly to Ollama and exposes no equivalent HTTP shim. The framework's `_run_live()` is therefore dead code -- every task it runs against `localhost:11435/chat` returns `"backend call failed"` and `success=False` regardless of model state.

Implications:

- The 24 / 28 golden tasks cannot be executed live across any of the three versions in scope.
- The hand-authored `tests/golden/baselines/v0.5.0+agent-friendly.json` and `v0.5.0+memory-hygiene.json` are documentation, not measurements. (`"timestamp": "pending"`, `"aggregates.mean_time_ms": 0`.)
- The v0.5.0 plan's Definition of Done #2 ("`>=40%` average tool-output token reduction on the 24 golden tasks vs. v0.4.0 baseline") was never verifiable with the shipped framework.

The fix is a TS-native golden runner that drives `AgentLoop` directly (rather than over an HTTP boundary) and is invoked by either Vitest or a thin Node script. That is **product/test-infra surface**, explicitly out of scope for v0.6.0 (hard constraint #1: "No new product surface ... unless it directly closes a finding"). Building it as part of Phase 2 would also bypass the plan's intent (Phase 2 is supposed to make existing infrastructure trustworthy, not extend it). Recommended for the v0.7.0 cycle.

The CHANGELOG `>=40%` retraction: a careful re-read of CHANGELOG.md shows the explicit `>=40%` / "40 percent" / "token efficiency" / "token reduction" / "token savings" claims are **not present** in the v0.5.0 entry. The claim lives in `docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md` (Phase 12 goal) and in `docs/archive/versions/v0/v0.6.0/review/known-gaps.md` (which incorrectly cited CHANGELOG.md as the host). The published changelog entry was already honest; no edit needed there. The plan-doc claim is left intact as a planning artifact; the gap is captured here and in the plan exit checklist.

---

## 4. Tests Run

| Suite | Command | Result |
|---|---|---|
| Full unit + integration | `npm run test` | 1562 passed, 4 skipped (3 new `it.todo` heuristic-fallback + 1 pre-existing) |
| New budget gate | `npm run test -- tests/unit/storage/PredictiveCache.budget.test.ts` | 2 / 2 passed |
| Heuristic-fallback shell | `npm run test -- tests/integration/heuristic-fallback.test.ts` | 3 todo (intentional) |
| Bench (new files only) | `npm run bench -- tests/benchmarks/predictive-cache.bench.ts tests/benchmarks/eviction-strategies.bench.ts` | 8 bench cases reported |
| Bench (full suite, v0.6.0) | `npm run bench` | 28 bench cases reported, captured to `tests/benchmarks/baselines/v0.6.0.json` |
| Bench regression delta | `node scripts/check-bench-regressions.mjs --baseline v0.5.0 --floor v0.4.0 --current /tmp/v0.6.0-bench.json` | OK, no regressions beyond 20% |
| Live CI (deliberate-fail) | GitHub Actions on `af215a0` | conclusion: **failure** (test-ts on Node 20+22) |
| Live CI (revert) | GitHub Actions on `a9b1b18` | conclusion: **success** (every job) |

---

## 5. Worktrees

For sub-task 2.4 bench captures:

```
../gemma-worktrees/v0.4.0   <- detached HEAD at v0.4.0 (ef6d8b3)
../gemma-worktrees/v0.5.4   <- detached HEAD at v0.5.4 (2ca1625)
```

Both have their own `node_modules/` from `npm ci --prefer-offline --no-audit`. Pending user decision whether to remove. Each is ~500 MB on disk. `git worktree remove ../gemma-worktrees/v0.4.0` and similarly for v0.5.4 cleans up if not needed.

---

## 6. Known Gaps Carried Forward

1. **Golden-runner infrastructure**: `tests/golden/framework/_run_live()` calls a deleted backend. Either rebuild as a TS-native runner driving `AgentLoop` (preferred), or delete the dead code path and document the framework as evaluation-only. Tracked for v0.7.0.
2. **Token-savings claim**: the `>=40%` figure in v0.5.0 plan docs was never measured. Either verify in v0.7.0 (after #1 lands) or remove the claim from `docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md` and `docs/archive/versions/v0/v0.6.0/review/known-gaps.md`.
3. **Hand-authored v0.5.0 golden baselines** (`v0.5.0+agent-friendly.json`, `v0.5.0+memory-hygiene.json`) are documentation, not measurements. Either replace with real captures (gated on #1) or relabel as task-spec references rather than baselines.
4. **`tests/integration/heuristic-fallback.test.ts`** is `it.todo` until Phase 5 sub-task 5.1 lands the threshold-elevation logic. Flip from `it.todo` to `it` and implement the body at that point.
5. **Live-Ollama bench capture** (`OLLAMA_URL=...`) was deferred for the same hardware-dependence reason that made cross-worktree comparison meaningless. If the v0.6.0 release wants TTFT / throughput numbers, run the live benches once on the production-tier hardware and pin them as informational (not gating).

---

## 7. Next Step

Phase 3: Defense-in-depth ratchets (per [docs/archive/versions/v0/v0.6.0/plans/v0.6.0-cycle.md](../../plans/v0.6.0-cycle.md) Phase 3). Body-cap on outbound HTTP, npm audit gate at moderate, SHA-256 in cache fingerprint, ESLint rule against `innerHTML` concatenation, doc obfuscation of example webhook URLs.
