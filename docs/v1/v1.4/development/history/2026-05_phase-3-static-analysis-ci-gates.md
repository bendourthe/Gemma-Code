# Session history: v1.4.0 Phase 3 -- Static-Analysis & CI Gates

**Date**: 2026-05-30
**Cycle**: v1.4.0
**Phase**: 3 (Static-analysis & CI gates, claude-code-harness adoption track)
**Plan reference**: [docs/versions/v1/v1.4.0/plans/adoption-claude-code-harness.md](../../plans/adoption-claude-code-harness.md)
**Source comparison**: [docs/versions/v1/v1.3.0/comparison-claude-code-harness.md](../../../v1.3/comparison-claude-code-harness.md)
**Acceptance scope**: adopt A2 (the harness `go/internal/guardrail/tampering.go` T01-T12 "Beagle" anti-tampering behaviours, reimplemented as deterministic LLM-free `nexus-check` rules under `lib/checks/`) and A9 (an OpenSSF Scorecard CI workflow alongside CodeQL). Stability gate: `node bin/nexus-check.mjs --list-rules` shows the new rules; the rules fire on tampered fixtures and pass on clean code; the Scorecard workflow validates as YAML and pins its action by SHA.

---

## 1. Sub-tasks completed

| Sub-task | Output | Status |
|---|---|---|
| T009 (A2) | Five deterministic rules under `lib/checks/`, registered in `index.mjs`: `no-focused-tests` (error), `no-tautological-assertion` (error), `no-skipped-tests-without-reason` (warning), `no-commented-out-assertion` (warning), `no-disabled-ci-check` (warning, workflow YAML). Shared `helpers.mjs` gained `isQuoted`, `hasJustification`, and a `nexus-check-allow` marker alias in `isAllowed`. `bin/nexus-check.mjs` gained a `scannedExtensions` walker opt-in so the CI rule reaches `.yml`/`.yaml`. New `check:tampering` npm script wired into `.husky/pre-push` and the CI `nexus-check` job; four pre-existing legitimate `continue-on-error: true` flags annotated with `nexus-check-allow` markers. | Closed |
| T010 (A9) | New `.github/workflows/scorecard.yml`: SHA-pinned `ossf/scorecard-action@4eaacf0...` (v2.4.3), `schedule` (weekly) + `push` (main) + `branch_protection_rule` triggers, `permissions: read-all` top-level with `security-events: write` + `id-token: write` on the job, SARIF uploaded to code-scanning and as a 7-day artifact. Checkout / upload-artifact / upload-sarif pinned to the same SHAs the repo already uses. Mirrors `codeql.yml`. | Closed |
| T011 | Tests + stabilization: new `tests/unit/lib/checks-tampering-rules.test.ts` (35 assertions), Scorecard + edited-workflow YAML validated by parse, `--list-rules` and `check:tampering` confirmed. All gates green; see section 4. | Closed |

## 2. Deviations from the plan text

| # | Deviation | Resolution |
|---|---|---|
| D1 | The plan (T011) suggests `tests/unit/checks/` for the rule tests. | Placed at `tests/unit/lib/checks-tampering-rules.test.ts`, matching the established `checks-prompt-rules.test.ts` location that side-steps the historical vitest + Windows + node:vm cli-dir parse bug (10.O.D). Trigger substrings (`.only`, `expect`, `toBe`, ...) are assembled at runtime from fragments so the test file does not trip its own `check:tampering` scan. Informational only; no new gap. |
| D2 | The plan says wire the rules into "the husky pre-push `npm run check` and CI". | Honoured via a dedicated `check:tampering` script (scoped to `tests/` + `.github/workflows/`, since the default `npm run check src/` scans only `src/`). CI wiring added as a second step on the existing `nexus-check` job (nexus-check is dependency-free, so no `npm ci` is needed) rather than a new job, to keep the runner footprint small. |
| D3 | The new `no-disabled-ci-check` rule would flag the four pre-existing legitimate `continue-on-error: true` usages. | Annotated each (ci.yml x2, codeql.yml, coverage-diff.yml) with an explicit `nexus-check-allow: no-disabled-ci-check -- <reason>` marker; no behavioural change. The `isAllowed` helper now accepts the canonical `nexus-check-allow*` spelling alongside the legacy `gemma-check-allow*` (backward compatible). |
| D4 (IMPL fix) | First test run: `it.todo("x")` was not flagged. | Root cause: `hasJustification`'s `TODO\s*\(` alternative was case-insensitive, so the lowercase vitest `.todo(` marker matched its own justification. Fixed by making `TODO`/`FIXME` case-sensitive (the comment convention is upper-case). All 35 tests then passed; tree re-scanned clean. |

## 3. Open items added to known-gaps

None. A2 and A9 both landed with full test coverage and no bypassed gate. The v1.4.0 [known-gaps.md](../../known-gaps.md) was updated: the adoption ledger splits out T009-T011 as Resolved (A2, A9), a Phase 3 Open-Items entry records "no new gap" with the D1-D4 deviations, two Resolved rows are added, and the summary moves to 8-of-12 adoption items landed with the status line advancing to "Next: Phase 4".

## 4. Verification evidence

- `node bin/nexus-check.mjs --list-rules` -> 15 rules listed, including the five new `no-focused-tests` / `no-skipped-tests-without-reason` / `no-tautological-assertion` / `no-commented-out-assertion` / `no-disabled-ci-check`.
- `npm run check:tampering` (the five rules over `tests/` + `.github/workflows/`) -> 0 findings (clean tree). The rules' positive path is proven by an earlier self-trip (the test file's own titles flagged before they were reworded to prose) plus the 35 fixture assertions.
- `npm run lint` (`eslint src`) -> clean, exit 0.
- `npm run build` (`tsc`) -> clean (the new `.test.ts` compiles; the `.mjs` rules are plain JS).
- `npm run check-architecture` (depcruise over `src core modules`) -> 0 errors, 11 pre-existing warnings (none in files this phase touched; `lib/` and `bin/` are outside the depcruise scope).
- Workflow YAML validated by parse: `scorecard.yml` (1 job), `ci.yml` (17 jobs), `codeql.yml` (1), `coverage-diff.yml` (1) all parse with intact `jobs`.
- Targeted run (`vitest run` on the new file) -> 35 passed.
- Full suite (`npm run test`) -> 332 test files passed, 2 skipped (pre-existing), 0 failed; coverage 87.05% lines / 82.92% branches / 90.48% functions (the new `.mjs` rules are outside the coverage `include` set but are exercised by the 35 assertions).
- Scorecard action SHA (`4eaacf0543bb3f2c246792bd56e8cdeffafb205a` = v2.4.3) cross-verified against the upstream release and the tag's commit page.

## 5. Next steps

- Advance to Phase 4 (Safety config SSOT, A1): a `nexus.security.toml` SSOT extending `scripts/generate-tool-permission-table.mjs` to regenerate the egress denylist (A4), permission table, and secret-path denylist, plus a CI drift gate. Phase 4 builds on the A4 surface landed in Phase 2.
- The `check:tampering` gate is now a standing protection: every later phase's test edits and CI changes are scanned for focus/skip/tautology/commented-assertion/disabled-CI tampering at pre-push and in CI.
- The Scorecard workflow begins scoring supply-chain posture weekly; once a baseline is established, the score can inform later hardening (e.g. the A1 SSOT and the Phase 8 protobufjs CVE work).
