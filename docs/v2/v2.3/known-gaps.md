# Known Gaps - v2.3

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-29

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plans: [plans/v2.3.0-adoption-qwen-video2x-openworker.md](plans/v2.3.0-adoption-qwen-video2x-openworker.md), [plans/v2.3.1-installer-field-repair.md](plans/v2.3.1-installer-field-repair.md)

## v2.3.1

**Last updated**: 2026-08-29 (post-tag Shell Build path patch)

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 0 | 0 |
| Bugs / regressions (BG) | 0 | 1 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 1 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

Phases 1-6 repaired the Windows wizard. PR 53 merged to `develop` at `838268f`. Tag `v2.3.1` was not rewritten. Pipeline topology diffs stay on v2.3.0 QG-1/QG-2. MT-1 is unchanged.

> Open items will be ingested by /plan when the next version's plan is created.

### Open Items

#### Missing Tests / Coverage Gaps

##### MT-1 - host_detect.py platform probes stay below 80% line coverage

- **Source phase**: Phase 1 - Honest host RAM and disk fields
- **Plan reference**: `docs/v2/v2.3/plans/v2.3.1-installer-field-repair.md` (1.1, 1.4)
- **Reason**: Full installer pytest measures `host_detect.py` at 40% lines. New Windows RAM routing, PowerShell fallback, and a live GlobalMemoryStatusEx success path on this Windows host are covered. Remaining misses are pre-existing OS-specific GPU/OS probes plus ctypes ImportError / missing-kernel32 / failed-API branches that this machine does not exercise.
- **Suggested next step**: Leave OS-specific GPU probes unless a later phase touches them. Add a mocked kernel32 failure test only if a frozen windowed build reports RAM-not-detected on a machine that has RAM.

### Resolved

##### BG-1 (resolved) - Windows and macOS Shell Build desktop vitest failed after the v2.3.1 tag

- **Source phase**: `/update release` (post-tag `main` Shell Build)
- **Plan reference**: `docs/v2/v2.3/plans/v2.3.0-adoption-qwen-video2x-openworker.md` (Phase 2-3 adapter/lifecycle); run [33264834351](https://github.com/bendourthe/Nexus-AI/actions/runs/33264834351)
- **What happened**: Same class as v2.3.0 BG-1. Ubuntu Shell Build succeeded. Windows and macOS failed 75 desktop tests because `os.tmpdir()` on those hosts is an OS path alias of `realpath` (GitHub Windows `RUNNER~1` 8.3 names, macOS `/var` to `/private/var`). Intake compared the requested string to `realpath` and rejected regular files as `source_invalid` / untrusted staging.
- **Fix**: Intake keeps rejecting leaf symlinks, then uses `realpath` as identity instead of requiring the caller's string to already equal it. Tests create temp roots through `canonicalMkDtemp`. Do not retag `v2.3.1`.
- **Evidence**: Local desktop vitest on this Windows host: 1821 passed / 1 skipped across 199 files, including the six previously red files. This host's `os.tmpdir()` already equals `realpath`, so the 8.3 / `/var` alias is not proven here. Remote Windows/macOS Shell Build remains not proven here until the develop PR is green on those jobs (or a `main` matrix run).

## v2.3.0

**Last updated**: 2026-08-29 (BG-1 path-alias patch)

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 4 | 0 |
| Bugs / regressions (BG) | 0 | 1 |
| Warnings (WN) | 1 | 0 |
| Missing tests / coverage gaps (MT) | 1 | 0 |
| Quality-gate gaps (QG) | 2 | 0 |

Phases 1-6 landed the enhancement contract, durable child jobs, Video Lab Enhance UI, fake-backend packaging evidence, and last-phase reconciliation. Real Video2X, GPU, packaged field detection, and perceptual review remain candidate (DF-3). The Nexus-Hub security-audit workflow is still an unreleased upstream item (DF-2). Pipeline topology differences were compared and not applied without approval (QG-1, QG-2). After tag `v2.3.0` landed, the first full-matrix Shell Build on `main` failed Windows and macOS desktop vitest (BG-1). Ubuntu on that run succeeded. The tags were not rewritten. The path-alias intake patch closed BG-1.

> Finalized on 2026-08-29 at the 2.3.0 bump. Open items will be ingested by /plan when the next version's plan is created.

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
- **Reason**: `.github/workflows/ci.yml` SHA-pins actions, uses npm/pip cache, concurrency cancellation, and 7-day artifacts, but has no workflow-level `permissions` block and no always-resolving aggregate required job. `pull_request.branches` is `main` only; develop integration relies on the `push` trigger. After PR 52 merged, the develop push reran the complete CI suite (observed finding against event separation). Differences were proposed and not applied.
- **Suggested next step**: Approve a least-privilege permissions block and an aggregate required job in a CI-owned phase, then add `develop` to pull_request branches if branch protection should see merge-result checks. Consider running Windows/macOS desktop vitest before a tag, because `shell-build.yml` keeps that matrix on `main` only.

##### BG-1 (resolved) - Windows and macOS Shell Build desktop vitest failed after the v2.3.0 tag

- **Source phase**: `/update release` (post-tag `main` Shell Build)
- **Plan reference**: `docs/v2/v2.3/plans/v2.3.0-adoption-qwen-video2x-openworker.md` (Phase 2-3 adapter/lifecycle); run [33235387928](https://github.com/bendourthe/Nexus-AI/actions/runs/33235387928)
- **Reason**: `shell-build.yml` on `main` runs Windows/macOS/Ubuntu. Ubuntu succeeded. Windows reported 75 failed tests, concentrated in `video2x-adapter.test.ts` (47), `video-enhancement-media-lifecycle.test.ts` (15), `video-enhancement-media-adapter.test.ts` (5), `video-enhancement-integration.test.ts` (4), and `windows-video-process-host.test.ts` (3). Observed mismatches include `cpu_probe_failed` vs `probe_failed`, expected `process_failed` / `provenance_failed` / `quarantined` codes vs actual messages such as "Staging root is not a canonical private...", and related lifecycle identity checks. macOS failed the same suite class. Develop Shell Build is Ubuntu-only, so this was not observed before the tag. Recurred on `v2.3.1` at [33264834351](https://github.com/bendourthe/Nexus-AI/actions/runs/33264834351).
- **Resolved**: Intake now treats OS path aliases as the same identity as `realpath` when the leaf is a regular file. Do not retag `v2.3.0` or `v2.3.1`.

##### MT-1 - VideoLabPage function coverage is below 80% on the focused run

- **Source phase**: Phase 4 - Video Lab Enhance Experience
- **Plan reference**: `docs/v2/v2.3/plans/v2.3.0-adoption-qwen-video2x-openworker.md` (Phase 4 quality gate)
- **Reason**: Focused Phase 4 coverage measured `VideoLabPage.tsx` at 85.64% lines and 72.41% functions. Phase 6 aggregate coverage is 86.94% lines and 72.41% functions. The new Enhance paths are covered; remaining function gaps are pre-existing page helpers. Global desktop coverage is 87.39% lines / 83.66% functions.
- **Suggested next step**: Leave pre-existing page helpers unless a later UI pass touches them. Do not treat this function percentage as a missing Enhance test.
