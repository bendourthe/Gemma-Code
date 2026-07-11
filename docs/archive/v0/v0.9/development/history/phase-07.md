# v0.9.0 Phase 7 -- Session History

**Date**: 2026-05-16
**Phase**: 7 -- CI hardening from v0.8.0 post-CI audit
**Plan**: [docs/archive/versions/v0/v0.9.0/plans/v0.9.0-cycle.md](../../plans/v0.9.0-cycle.md)
**Sub-tasks landed**: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
**Carryovers closed**: v0.8.0 10.O.AB / AC / AD / AE / AF / AG

---

## 1. Chronological steps

### Step 1: Pre-implementation review

Read the full Phase 7 section of the cycle plan, the v0.8.0 post-CI audit follow-up rows 10.O.AB through 10.O.AG in [docs/archive/versions/v0/v0.8.0/known-gaps.md](../../../v0.8/known-gaps.md), and the current state of [.github/workflows/ci.yml](../../../../versions/.github/workflows/ci.yml). Phase 6 close was 19 open / 22 resolved; the six Phase 7 follow-ups were the entire scope of this phase (one phase per sub-task, no carryover code work).

Confirmed prerequisites: Phase 6 landed at commit `521cb64` on `main`; the prompt-oversized warning surfaced by `npm run check:prompts` (review-pr/SKILL.md ~811 tokens, tracked under 10.N.F) is non-blocking after v0.8.0 Phase 7's CLI exit-code realignment. The custom Vitest JSON reporter at [scripts/vitest-bench-json-reporter.mjs](../../../../versions/scripts/vitest-bench-json-reporter.mjs) already exists from `nightly.yml` and can be reused by the new fast-bench job.

### Step 2: 7.1 -- Node 24 actions upgrade

Began by replacing every `actions/checkout@11bd71...` SHA pin in `.github/workflows/*.yml` with `actions/checkout@v5`, and equivalent moves for setup-node, setup-python (v5 -> v6), upload-artifact, download-artifact, and cache. The change failed `tests/unit/workflow-discipline.test.ts` immediately: that test asserts every `uses:` reference resolves to a 40-character commit SHA, not a tag. Looked up real SHAs via `git ls-remote --tags https://github.com/actions/<name>.git 'v5*'` for each action and re-pinned: `actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5.0.1`, `actions/setup-node@a0853c2454...` (v5.0.0), `actions/setup-python@a309ff8b...` (v6.2.0), `actions/upload-artifact@330a01c4...` (v5.0.0), `actions/download-artifact@634f93cb...` (v5.0.0), `actions/cache@27d5ce7f...` (v5.0.5). The same `git ls-remote` approach gave the SHA for `github/codeql-action@v3.35.5` for sub-task 7.4.

Updated the Node test matrix in [.github/workflows/ci.yml](../../../../versions/.github/workflows/ci.yml) `lint-ts` / `test-ts` / `build-ts` from `["20.x", "22.x"]` to `["22.x", "24.x"]`, and updated the artifact-upload conditions from `matrix.node == '20.x'` to `'22.x'`. All standalone `node-version: "20"` references across `ci.yml`, `commitlint.yml`, `coverage-diff.yml`, `golden-tasks.yml`, `installer-smoke.yml`, `nightly.yml`, `pr-quality.yml`, `release.yml`, `semantic-release.yml` upgraded to `"22"`. The workflow-discipline test stayed green after the SHA re-pinning.

### Step 3: 7.2 -- Functions coverage gate

Edited the `coverage-gate` job's awk script in [.github/workflows/ci.yml](../../../../versions/.github/workflows/ci.yml) to read `.total.functions.pct` from `coverage/coverage-summary.json` via `jq` and assert it is `>= 80` alongside the existing `lines >= 80` and `branches >= 75` checks. Print lines pad column widths for the new metric (`TS function coverage: %s%%`).

Updated [configs/vitest.config.ts](../../../../versions/configs/vitest.config.ts) coverage thresholds to add `functions: 80` so local `npm test -- --coverage` enforces the same floor as CI.

Ran the full coverage suite once to confirm the global percentage clears the new gate: 88.94% (1199 / 1348). The 31 individual files below the per-file 80% threshold (top offenders: `src/panels/TraceDashboardPanel.ts` 25%, `MemoryPanel.ts` 37.5%, `ChatPanelBootstrap.ts` 39.5%, plus 12 `*.types.ts` files at 0% function coverage because they only export type aliases) stay tracked under new gap 10.N.T as a v0.10.0 candidate; the aggregate gate is what protects against regression.

### Step 4: 7.3 -- check-prompts CI job

Added a new `check-prompts` job to [.github/workflows/ci.yml](../../../../versions/.github/workflows/ci.yml). Runs `actions/checkout@v5.0.1` + `actions/setup-node@v5.0.0` (Node 22) + `npm ci --prefer-offline --no-audit` + `npm run check:prompts`. No `--strict` flag: per the v0.8.0 Phase 7 CLI exit-code realignment, warnings emit but do not fail the exit, so the job only fails when a prompt-rule finding is `severity: error`. Verified locally: `npm run check:prompts` exits 0 with the one outstanding warning (`review-pr/SKILL.md ~811 tokens`, tracked under 10.N.F).

### Step 5: 7.4 -- CodeQL SAST workflow

Wrote new [.github/workflows/codeql.yml](../../../../versions/.github/workflows/codeql.yml) workflow running `github/codeql-action@v3.35.5` (SHA-pinned) `init` + `analyze` against the `javascript-typescript` language pack with the `security-and-quality` query set. Triggers: `push` on `main`, `pull_request` to `main`, and a weekly `schedule` cron (`27 4 * * 1` -- Monday 04:27 UTC). The `analyze` job has `continue-on-error: true` initially so a fresh advisory-ruleset rollout cannot stall PRs; the SARIF report still uploads to the GitHub Security tab for triage. Flip to blocking on critical+high after one clean week stays operator-driven under new gap 10.N.U.

### Step 6: 7.5 -- Fast-bench PR-time gate

Added a new `fast-bench` job to [.github/workflows/ci.yml](../../../../versions/.github/workflows/ci.yml). The job runs `npm run bench -- -t render --reporter=verbose --reporter=./scripts/vitest-bench-json-reporter.mjs --outputFile=bench-results.json`, then calls [scripts/check-bench-regressions.mjs](../../../../versions/scripts/check-bench-regressions.mjs) with `--baseline tests/benchmarks/baselines/v0.7.0.json --regression-pct 20 --fail-on-regression`. Uploads `bench-results.txt` + `bench-results.json` as the `fast-bench-results` 14-day artifact.

Extended [scripts/check-bench-regressions.mjs](../../../../versions/scripts/check-bench-regressions.mjs) `parseArgs` with a new `--fail-on-regression` flag. The flag is a forward-compatible alias: the script already exits 1 on regression by default, so the flag's role is to make the CI workflow's intent self-documenting and to give the future option of softening the default without breaking the gate. No-op semantically today; explicit tomorrow.

The plan called for `tests/benchmarks/baselines/v0.8.0.json` as the baseline, but that file does not exist yet (operator-driven baseline capture is tracked under v0.8.0 10.O.BB). v0.7.0 baseline serves as the interim reference; once 10.O.BB lands the operator updates the `--baseline` arg per new gap 10.N.V.

### Step 7: 7.6 -- Dep-graph SVG artifact upload

Extended the `check-architecture` job in [.github/workflows/ci.yml](../../../../versions/.github/workflows/ci.yml) to install Graphviz (`sudo apt-get install -y --no-install-recommends graphviz`), run `npm run deps:graph` (regenerates `docs/archive/versions/v0/v0.5.0/dep-graph.svg` via `depcruise --output-type dot | dot -Tsvg`), and upload it as the `dep-graph-svg` artifact with 7-day retention. The Graphviz install is required because the depcruise script pipes its DOT output through the `dot` binary -- without it the script would fail with `dot: command not found`.

### Step 8: 7.7 -- Phase 7 testing and stabilization

Ran the full quality-gate sweep:

- `npm run lint` -- exit 0.
- `npm run build` -- exit 0 (tsc clean).
- `npm test -- --coverage` -- 227 files, 2636 passed, 5 skipped, 0 failed; line coverage 85.53% / branch 81.85% / function 88.94% all clear the gate thresholds.
- `npm run check:prompts` -- 0 errors, 1 pre-existing warning.
- `npx vitest run --config configs/vitest.config.ts tests/unit/workflow-discipline.test.ts` -- 5 tests passed; the SHA-pinning gate validates every `uses:` reference across the 10 workflow files plus the new `codeql.yml`.

The plan's "open a synthetic PR that touches a file in `src/`; verify all new jobs fire" acceptance criterion requires a real PR against `main` to watch the new jobs fire on GitHub-Actions infrastructure. The workflow files are committed and lint-clean; full live validation is operator-driven and tracked under new gap 10.N.W.

Updated [docs/archive/versions/v0/v0.8.0/known-gaps.md](../../../v0.8/known-gaps.md): the six post-CI follow-ups (10.O.AB / AC / AD / AE / AF / AG) moved from Section 10.1 Open Items into Section 10.2 Resolved with full closure notes. The Section 10.3 summary recomputed (Open 15 -> 9, Resolved 36 -> 42; DF 14 -> 9, MT 1 -> 0). Added a new "Status (v0.9.0 Phase 7 close, 2026-05-16)" paragraph between Phase 1 close and the v0.9.0 ingest map.

Updated [docs/archive/versions/v0/v0.9.0/known-gaps.md](../../known-gaps.md): added the six Phase 7 closures as Resolved rows in Section 10.2 and the five new in-cycle deferrals (10.N.T / U / V / W / X) in Section 10.1. Section 10.3 summary recomputed (Open 19 -> 24, Resolved 22 -> 28). Added the Phase 7 close status paragraph.

---

## 2. Validation gate summary

| Gate | Threshold | Result | Notes |
|---|---|---|---|
| Lint (ESLint) | 0 errors | OK | `npm run lint` exit 0 |
| Build (tsc) | clean | OK | `npm run build` exit 0 |
| Tests | 0 failures | OK | 2636 / 2641 pass + 5 skipped |
| Line coverage | >= 80% | OK | 85.53% |
| Branch coverage | >= 75% | OK | 81.85% |
| Function coverage | >= 80% | OK | 88.94% (new gate, this phase) |
| gemma-check src/ | 0 errors | OK | 0 errors, 1 pre-existing warning |
| Workflow SHA-pinning | every `uses:` | OK | `tests/unit/workflow-discipline.test.ts` 5/5 |

---

## 3. Files changed

| File | Change |
|---|---|
| `.github/workflows/branch-cleanup.yml` | action SHAs bumped to v5 |
| `.github/workflows/ci.yml` | action SHAs bumped to v5/v6; Node matrix `["22.x", "24.x"]`; new functions coverage assertion; new `check-prompts` job; new `fast-bench` job; `check-architecture` now installs Graphviz + uploads `dep-graph-svg` |
| `.github/workflows/codeql.yml` | new -- CodeQL SAST workflow (non-blocking initially) |
| `.github/workflows/commitlint.yml` | action SHAs bumped to v5 |
| `.github/workflows/coverage-diff.yml` | action SHAs bumped to v5/v6 |
| `.github/workflows/golden-tasks.yml` | action SHAs bumped to v5/v6 |
| `.github/workflows/installer-smoke.yml` | action SHAs bumped to v5/v6 |
| `.github/workflows/nightly.yml` | action SHAs bumped to v5/v6 |
| `.github/workflows/pr-quality.yml` | action SHAs bumped to v5 |
| `.github/workflows/release.yml` | action SHAs bumped to v5/v6 |
| `.github/workflows/semantic-release.yml` | action SHAs bumped to v5 |
| `configs/vitest.config.ts` | coverage thresholds extended with `functions: 80` |
| `scripts/check-bench-regressions.mjs` | new `--fail-on-regression` CLI flag (forward-compatible alias) |
| `docs/archive/versions/v0/v0.8.0/known-gaps.md` | rows 10.O.AB / AC / AD / AE / AF / AG moved Open -> Resolved; summary recomputed; Phase 7 status paragraph added |
| `docs/archive/versions/v0/v0.9.0/known-gaps.md` | six Phase 7 v0.8.0-carryover closures added to Resolved; five new in-cycle deferrals (10.N.T / U / V / W / X) added to Open; summary recomputed; Phase 7 status paragraph added |
| `docs/DEVLOG.md` | new Phase 7 entry |
| `docs/archive/versions/v0/v0.9.0/development/history/phase-07.md` | new -- this file |

---

## 4. Deviations from the plan

- **Plan literal `npm run bench -- --grep "render" --fail-on-regression`**: `--grep` is not a flag the `npm run bench` proxy understands directly because `vitest bench` uses `-t` / `--testNamePattern` for the same purpose; used `-t render` instead. `--fail-on-regression` is implemented as a flag on the downstream `scripts/check-bench-regressions.mjs` (which runs after vitest produces JSON), not as a vitest flag.
- **Baseline file**: plan called for `tests/benchmarks/baselines/v0.8.0.json` but the file does not exist (operator-driven capture under v0.8.0 10.O.BB). Used `v0.7.0.json` as the interim baseline; migration tracked under new gap 10.N.V.
- **Atomic commits per artifact**: every Phase 7 sub-task touches `.github/workflows/ci.yml`, so the bundled single-commit pattern Phases 2-6 used is the only mechanically clean option here. Tracked under new gap 10.N.X.
- **Per-file function coverage backfill (plan step 7.2.3)**: the global function coverage already clears the 80% gate (88.94%); the 31 files individually below 80% are documented under new gap 10.N.T rather than backfilled this phase. Per-file backfill is cost-benefit gated (12 of the 31 are `*.types.ts` shims that could simply be excluded from coverage config; the panels need VSCode-host integration tests). Acceptable per plan ("Backfill tests for any surfaced functions OR document inline rationale + add to known-gaps if test cost > benefit").

---

## 5. Next steps

- **Phase 8**: cycle close (sync docs, regen catalogs, finalize known-gaps, ship the cycle). v0.9.0 Phase 8 picks up the remaining open items.
- **Operator follow-ups**: 10.N.U (CodeQL flip after one clean week), 10.N.V (v0.8.0-baseline migration once v0.8.0 10.O.BB lands), 10.N.W (live-PR Phase 7 smoke).
