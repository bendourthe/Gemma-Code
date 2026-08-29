# Known Gaps - v2.3

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-28 (Phase 6)

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v2.3.0-adoption-qwen-video2x-openworker.md](plans/v2.3.0-adoption-qwen-video2x-openworker.md)

## v2.3.0

**Last updated**: 2026-08-28 (Phase 6)

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 4 | 0 |
| Bugs / regressions (BG) | 0 | 0 |
| Warnings (WN) | 1 | 0 |
| Missing tests / coverage gaps (MT) | 1 | 0 |
| Quality-gate gaps (QG) | 2 | 0 |

Phases 1-6 landed the enhancement contract, durable child jobs, Video Lab Enhance UI, fake-backend packaging evidence, and last-phase reconciliation. Real Video2X, GPU, packaged field detection, and perceptual review remain candidate (DF-3). The Nexus-Hub security-audit workflow is still an unreleased upstream item (DF-2). Pipeline topology differences were compared and not applied without approval (QG-1, QG-2).

### Open this cycle

##### DF-1 - Hydrated Video Lab sessions do not restore Enhance eligibility

- **Source phase**: Phase 4 - Video Lab Enhance Experience
- **Plan reference**: `docs/v2/v2.3/plans/v2.3.0-adoption-qwen-video2x-openworker.md` (T011, T013)
- **Reason**: Enhance requires a durable output id and SHA-256 from the generation completion event. Studio session turns persist a media path, not those identities, so remounting a saved clip shows the original video and download but not Enhance. not_observed != absent for a later persistence design.
- **Suggested next step**: Persist source output id and hash on studio turns, or recover them from the generation index by path/hash during hydrate, then prove Enhance returns after remount.

##### DF-2 - Nexus-Hub security-audit workflow is not released

- **Source phase**: Phase 5 - Quality, Performance, and Packaging Evidence
- **Plan reference**: `docs/v2/v2.3/plans/v2.3.0-adoption-qwen-video2x-openworker.md` (T015); `docs/v2/v2.3/development/nexus-hub-security-audit-handoff.md`
- **Reason**: The useful OpenWorker delta is a Hub-owned security-audit workflow. Upstream status is v4.1.1 confirmed, implementation not started, not released. Nexus-AI must not consume a Hub version without that evidence and must not edit the sibling repository.
- **Suggested next step**: When a Hub release publishes scanner-coverage and independent rescan receipts, record the version here and decide whether Nexus-AI should consume it.

##### DF-3 - Real Video2X, GPU, and packaged detection remain unmeasured

- **Source phase**: Phase 5 - Quality, Performance, and Packaging Evidence
- **Plan reference**: `docs/v2/v2.3/plans/v2.3.0-adoption-qwen-video2x-openworker.md` (T014, T015)
- **Reason**: The fake-backend harness proved fixture geometry, source preservation, and typed failures. Peak CPU/GPU/VRAM, real Video2X 6.4.0 wall time, and packaged-app executable detection are not observed. not_observed != absent.
- **Suggested next step**: Run `node scripts/bench-video-enhancement.mjs --backend real` on supported Windows/Linux hardware and a packaged Windows install that points at a user-installed Video2X 6.4.0 path.

##### WN-1 - jsdom canvas and React act notices in Video Lab tests

- **Source phase**: Phase 4 - Video Lab Enhance Experience
- **Plan reference**: `docs/v2/v2.3/plans/v2.3.0-adoption-qwen-video2x-openworker.md` (T013)
- **Reason**: Video Lab tests still emit `HTMLCanvasElement.getContext` and `act(...)` notices. They appeared in the passing Phase 2 desktop aggregate and in the Phase 4 focused run. They are not failed assertions.
- **Suggested next step**: Keep treating them as renderer-environment noise unless a test starts failing. Phase 6 compared a canvas stub and declined the churn.

##### DF-4 - Release-preconditions helper script is absent

- **Source phase**: Phase 6 - Architecture Refactor, Known-Gaps Reconciliation, and CI/CD
- **Plan reference**: `docs/v2/v2.3/plans/v2.3.0-adoption-qwen-video2x-openworker.md` (T020)
- **Reason**: `python scripts/check_release_preconditions.py --branches --repo-settings` is the skill-required git-tree hygiene command. The file does not exist in this repository (same finding as v2.2.9 last-phase evidence). Hygiene was reported from `git branch` / `git remote` only. Report-only; no branch was deleted.
- **Suggested next step**: Add the helper in a later hygiene plan, or keep quoting raw git output at each last phase.

##### QG-1 - Named repository-native CI profiles are not present

- **Source phase**: Phase 6 - Architecture Refactor, Known-Gaps Reconciliation, and CI/CD
- **Plan reference**: `docs/v2/v2.3/plans/v2.3.0-adoption-qwen-video2x-openworker.md` (T021)
- **Reason**: cicd-architect requires five named profiles (`fast`, `full`, `platform`, `report`, `release`) as repository commands. This repo validates with `npm test`, `npm run test:shell`, `npm run lint`, `python -m pytest tests/python`, and installer `uv run pytest`. Those commands exist and are what CI invokes, but they are not the named five-profile surface. No pipeline file was changed because silence is not approval.
- **Suggested next step**: If a later plan owns CI, add thin npm aliases that call the existing commands without rewriting workflow topology.

##### QG-2 - CI workflow lacks least-privilege permissions and an aggregate required check

- **Source phase**: Phase 6 - Architecture Refactor, Known-Gaps Reconciliation, and CI/CD
- **Plan reference**: `docs/v2/v2.3/plans/v2.3.0-adoption-qwen-video2x-openworker.md` (T021)
- **Reason**: `.github/workflows/ci.yml` SHA-pins actions, uses npm/pip cache, concurrency cancellation, and 7-day artifacts, but has no workflow-level `permissions` block and no always-resolving aggregate required job. `pull_request.branches` is `main` only; develop integration relies on the `push` trigger. Differences were proposed and not applied.
- **Suggested next step**: Approve a least-privilege permissions block and an aggregate required job in a CI-owned phase, then add `develop` to pull_request branches if branch protection should see merge-result checks.

##### MT-1 - VideoLabPage function coverage is below 80% on the focused run

- **Source phase**: Phase 4 - Video Lab Enhance Experience
- **Plan reference**: `docs/v2/v2.3/plans/v2.3.0-adoption-qwen-video2x-openworker.md` (Phase 4 quality gate)
- **Reason**: Focused Phase 4 coverage measured `VideoLabPage.tsx` at 85.64% lines and 72.41% functions. Phase 6 aggregate coverage is 86.94% lines and 72.41% functions. The new Enhance paths are covered; remaining function gaps are pre-existing page helpers. Global desktop coverage is 87.39% lines / 83.66% functions.
- **Suggested next step**: Leave pre-existing page helpers unless a later UI pass touches them. Do not treat this function percentage as a missing Enhance test.
