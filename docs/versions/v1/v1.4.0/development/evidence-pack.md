# Evidence-Pack Discipline (verified-only for PR and release)

**Adoption item**: A12 (skill-native) from [../../v1.3.0/comparison-claude-code-harness.md](../../v1.3.0/comparison-claude-code-harness.md).
**Source pattern**: claude-code-harness `docs/evidence/work-all.md`, `harness-release` skill.
**Status**: active convention (v1.4.0).
**Upstream gate**: the [self-review checklist](self-review-checklist.md) (A3).
**Wording authority**: [evidence-and-support-tiers.md](evidence-and-support-tiers.md) (A7).

## The discipline in one line

Only verified output may be packaged into a PR or a release artifact, and **"PR ready is not release ready"**.

## What "verified output" means

An evidence pack is the set of proofs that accompany a change. A proof is verified only when it is the captured result of a command that was actually run, not an assertion. The minimum bar:

- **Tests**: `npm test` (or the scoped suite) run, with the pass/fail/skip counts captured. The count must not regress against the pre-change baseline (self-review gate G4).
- **Lint**: `npm run lint` (eslint, `--max-warnings=0`) clean.
- **Build**: `npm run build` (`tsc`) clean.
- **Static checks**: `npm run check` (nexus-check) clean for the touched paths.
- **Coverage**: where the change adds behaviour, the coverage delta is captured (the [coverage-diff workflow](../../../../.github/workflows/coverage-diff.yml) is the CI surface).
- **Architecture**: `npm run check-architecture` reports no new violation attributable to the change.

Every captured proof is written using the A7 wording rules: a cited command and its outcome ("`npm test` -> 3704 passed / 0 failed"), and anything not run locally is recorded as "not proven here" with the reason and the tracking gap, never as a silent pass.

## "PR ready is not release ready"

These are two distinct evidence bars, and clearing the first does not clear the second.

| | PR ready | Release ready |
|---|---|---|
| **Gate** | [Self-review checklist](self-review-checklist.md) G1-G5 cleared; the [PR template](../../../../.github/PULL_REQUEST_TEMPLATE.md) Submission Checklist satisfied; [pr-quality workflow](../../../../.github/workflows/pr-quality.yml) green. | Everything in PR-ready, plus: the full CI matrix green (`ci.yml`, `codeql.yml`, `scorecard.yml`, `coverage-diff.yml`), `npm run check:audit-prod` clean, all ingested known-gaps for the cycle resolved or explicitly re-justified, and the release notes drafted. |
| **Scope** | One change, in isolation. | The whole cycle, integrated, on a tagged version. |
| **Owner** | Author + reviewer. | The final-phase release-readiness workflow (`/implement-phase` Phase 9, sub-phases 9A-9E). |

A PR can be honestly "ready" while the release is not: an open `P1` carryforward gap, a failing nightly job, or an un-drafted release-notes entry all block release without blocking the PR.

## Where the evidence pack lives in the release flow

Nexus's release process is the `/implement-phase` Phase 9 release-readiness workflow backed by semantic-release ([semantic-release.yml](../../../../.github/workflows/semantic-release.yml), [release.yml](../../../../.github/workflows/release.yml)). The evidence pack threads through it as follows:

1. **Per phase** (Phase 8 post-phase sequence): the self-review evidence and test/lint/build results are captured in the phase session history and the commit body.
2. **Cycle close** (Phase 9B): the whole-cycle test + CI/CD evidence is re-verified with fresh runs; nothing is carried over on trust from earlier phases.
3. **Release notes** ([RELEASE_NOTES.md](../RELEASE_NOTES.md), drafted in Phase 9E): the Highlights and Benchmarks sections cite only verified output. The v1.3.0 RELEASE_NOTES is the model: every benchmark row links to a published results file, and unmeasured surfaces (the full 213-skill catalog) are explicitly marked as awaiting an external dependency rather than claimed.
4. **Tag**: the annotated tag is prepared only when no hold condition is active (failing tests, unresolved release-blocker gap, inconsistent version strings). An un-evidenced claim is itself a hold condition.

## Anti-tampering link

The verified-only rule is enforced from two directions: this convention (what may be packaged) and the A2 test-tampering nexus-check rules landing in v1.4.0 Phase 3 (mechanical detection of skipped tests, hardcoded results, weakened assertions, and falsified evidence in diffs). An evidence pack that would trip an A2 rule is by definition not verified output and must not be packaged.

## Where this is referenced

The discipline is referenced from the [PR template](../../../../.github/PULL_REQUEST_TEMPLATE.md) Submission Checklist (the PR-ready gate) and is the standing convention for the Phase 9 release-readiness workflow and the [RELEASE_NOTES.md](../RELEASE_NOTES.md) authoring step (the release-ready gate).
