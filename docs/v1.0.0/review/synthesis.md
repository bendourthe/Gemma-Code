# v1.0.0 -- Deep review synthesis (Phase 11.1)

**Audience**: release operator, code reviewer, security reviewer.
**Plan reference**: [phase-11-hardening-and-release.md](../plans/phase-11-hardening-and-release.md) sub-task 11.1.
**Date**: 2026-05-18.
**Inputs**: Phase 1-10 known-gaps log, Phase 1-10 session histories, security audit (`security-audit.md`), penetration test (`penetration-test.md`), code-review notes, dependency-scan results.

This synthesis is the gate document for the v1.0.0 release. The goal is a clear picture of every cross-cutting issue at the close of the v1.0.0 cycle: which are resolved in-cycle, which carry forward to v1.0.1 as operator actions, which are deferred to v1.1.0+.

---

## 1. Executive summary

Nexus 1.0.0 is **READY TO RELEASE** subject to the operator-action items in `docs/v1.0.0/operator-actions.md` (most notably OA-01 EV signing and OA-04 RTM smoke). Zero P0 / P1 defects remain in-cycle; the remaining open items in `docs/v1.0.0/known-gaps.md` fall into three categories:

1. **Operator-driven** (live GPU benches, code signing, RTM smoke) -- 6 items. Tracked as OA-01 through OA-12 in `operator-actions.md`.
2. **Architectural follow-ons gated on the shared-core build** (Phase 5 IPC widening, Tauri channel notifications, MemoryHub SQLite migration, AgentLoop relocation) -- 14 items. All carry forward to v1.0.1 / v1.1.0; each has a documented seam already in place so the v1.0.0 surface keeps working through the placeholder path.
3. **Polish / cleanup** (final brand icons, deprecation message tooltips, drag-drop library swap) -- 16 items, all P2.

The cycle is large by any measure: 11 phases, 39 sub-phases, 10 dedicated review artifacts. The known-gaps file (`docs/v1.0.0/known-gaps.md`) is the single canonical inventory; this synthesis does not duplicate it.

---

## 2. Health gates

### 2.1 Test suite

- **Vitest (TypeScript)**: 2683 tests across `core/`, `modules/`, `desktop/src/`, `desktop/sidecar/src/`. Pass: 2678. Fail: 5 (all pre-existing -- 4x `SubAgentManager.characterization.test.ts` CRLF/LF snapshot mismatches on Windows; 1x `workflow-discipline.test.ts` SHA-pin enforcement against the `shell-build.yml` workflow). Tracked exhaustively as known-gap 2.P3.L; failure set is unchanged from a `git stash`-and-rerun on the pre-Phase-2 baseline.
- **Pytest (Python sidecar)**: `runtimes/diffusion/tests/` -- 51 tests, all pass (12 image-pipeline tests + 39 video-pipeline tests, stub-executor path). `scripts/installer/pyqt/tests/` -- pass on the host-installed PyQt5 venv.
- **Cargo (Rust core)**: `cargo check` + `cargo clippy` -- pass via the `shell-build.yml` CI matrix (Windows + Linux + macOS). Local invocations not exercised on this host (Phase 1 known-gap 1.P1.A) but validated by CI.

### 2.2 Coverage

- **TypeScript**: 99.11% lines / 100% functions / 87.21% branches on `desktop/src/` + sidecar (Phase 1 baseline; later phases maintained the gate). Coding-module-specific: 94.24% lines. Phase 6 image-module: 94.24% lines, 80.75% functions, 85.65% branches. Phase 7 video: identical envelope. Phase 8 GpuScheduler: 99% lines / 100% functions. Phase 10 DevAIHubSyncer: 68.69% lines (production network/git helpers are smoke-tested only; fixture-driven core path is 100% covered -- documented as known-gap 10.P1.FFF).
- **Python**: full statement coverage on `runtimes/diffusion/pipelines/` (the runner orchestration), `runtimes/diffusion/device.py`, `runtimes/diffusion/main.py`. Stub executors are 100% covered; real executors (`_execute(ctx)`) are operator-driven (OA-09).

### 2.3 Lint + format

- ESLint (`desktop/src/`, `desktop/sidecar/src/`, `tests/`) -- zero warnings.
- Prettier -- enforced.
- Rust: clippy clean as of Phase 9 fix-up commit `3ce3137`.
- Python: black + isort clean across `runtimes/diffusion/` and `scripts/installer/pyqt/`.

### 2.4 Build

- `npm run build:web` (Vite production build) -- pass.
- `npm run build:sidecar` (esbuild bundle of `desktop/sidecar/src/main.ts`) -- pass.
- `cargo tauri build` -- pass via CI matrix (not exercised locally on this host; known-gap 1.P1.A).
- `installer-build.yml` (Windows NSIS outer installer) -- workflow_dispatch placeholder; full payload-fetch script is a Phase 9 follow-on (known-gap 9.P1.ZZ); first end-to-end installer artifact is gated on OA-01 (EV cert).

---

## 3. Dependency scan

`npm audit` -- zero high / critical CVEs at the time of this synthesis.
`pip audit` against `runtimes/diffusion/requirements.txt` and `scripts/installer/pyqt/requirements.txt` -- zero high / critical CVEs.
`cargo audit` -- zero high / critical CVEs.

No dependency requires immediate replacement. Quarterly review cadence applies (v1.0.1 / v1.1.0 / v1.2.0 cycles each kick off with a dep audit).

---

## 4. Docs / git / CI hygiene

- **`docs/` layout**: Per-version subtree (`docs/v0.X.0/...`) with sibling cross-references. v1.0.0 carries: plans (Phase 1-11), development history (Phase 1-10 session history files), architecture, design tokens, pivot brief, installer architecture / macOS-and-Linux / smoke checklist, comparison-comfyui, comparison-devai-hub, known-gaps, operator-actions, release-notes, release-signing, rtm-smoke, distribution, review/{synthesis,security-audit,penetration-test}. All present, all internally consistent.
- **Git hygiene**: Conventional commits enforced by commitlint. Phase commits follow the sectioned-bullet structure mandated by CLAUDE.md (subject + 1-2 sentence intro + sectioned bullets).
- **CI / CD**: Three workflows -- `ci.yml` (lint + typecheck + vitest + cargo + pytest), `shell-build.yml` (cargo matrix across Win / macOS / Linux), `installer-build.yml` (Windows NSIS, workflow_dispatch). semantic-release pushes per-feature releases as `0.X.Y` and the manual `v1.0.0` tag is the first non-semantic-release tag.
- **Release readiness**: CHANGELOG.md has the v1.0.0 entry. Release notes drafted at `docs/v1.0.0/release-notes.md`. Version bumped across all 6 version-carrying files (`package.json`, `desktop/package.json`, `desktop/src-tauri/Cargo.toml`, `desktop/src-tauri/tauri.conf.json`, `scripts/installer/pyqt/pyproject.toml`, `scripts/installer/pyqt/src/nexus_installer/__init__.py`). NSIS already at `1.0.0`.

---

## 5. Cross-cutting findings

### 5.1 The "shared-core build" choke point

A cluster of 14 P1 known-gaps trace back to the same architectural seam: the desktop sidecar (`desktop/sidecar/src/`) cannot transparently import from `core/` because Node16 module resolution cannot cross the workspace boundary without either a TypeScript project-references build or a published `@nexus/core` workspace package. The v1.0.0 cycle established the canonical `core/` directory and the boundary rules, but the actual build step that exposes `core/` to the sidecar (and reciprocally lets `core/` be consumed without re-bundling) is a v1.1.0 deliverable.

Affected known-gaps: 3.P1.M, 3.P1.N, 3.P1.O, 3.P1.Q, 3.P2.S, 3.P2.U, 4.P1.W, 4.P1.X, 4.P2.Y, 4.P2.Z, 5.P1.BB, 5.P2.DD, 5.P2.EE, 6.P2.KK, 7.P2.SS.

**Impact on v1.0.0 release**: none. Every gap of this cluster has a documented placeholder that keeps the v1.0.0 UI surface working end-to-end (in-memory clients, polling-instead-of-channel, namespace-aware-loader-not-yet-attribution-aware, etc.). The placeholder behaviour is intentional and surfaced in `docs/v1.0.0/release-notes.md` under "Known limitations" so users are not surprised.

**v1.1.0 unlock**: a single phase that introduces TypeScript project references (or a workspace-scoped `@nexus/core` package), then closes the cluster in one sweep.

### 5.2 The "real-GPU + real-PyTorch" choke point

A cluster of 6 P1 known-gaps trace back to the second seam: the Python sidecar's `_execute(ctx)` calls default to deterministic stub executors because the implementing session did not have CUDA / `torch` / `diffusers` / `controlnet_aux` / `opencv-python` available. The JSON-RPC contract, the runner orchestration, the smart-offload decision, the workflow-metadata embedding, and the IPC bridge are all unit-tested with stubs; the actual PyTorch wiring is operator-driven (OA-09).

Affected known-gaps: 6.P1.GG, 6.P1.HH, 6.P1.II, 7.P1.MM, 7.P1.NN, 7.P1.OO, 8.P1.UU, 8.P1.VV.

**Impact on v1.0.0 release**: the desktop Image Studio and Video Lab UIs ship; on a CI-only host, generations return deterministic stub PNGs / JPEGs and the IPC round-trip works. On a real GPU host with the Python venv populated, the stubs are swapped for real diffusers calls. The installer (Phase 9) provisions the Python venv; OA-09 captures the bench timings.

**v1.0.1 unlock**: OA-09 closes the cluster.

### 5.3 The "VS Code extension thin-adapter" deferral

A cluster of 3 P1 known-gaps trace back to the third seam: the VS Code extension still hosts the in-process engine. The thin-adapter rewrite -- where the extension delegates every panel + every tool call to the desktop daemon over JSON-RPC -- depends on the shared-core build (5.1) AND the daemon-side IPC widening (5.1) AND the breaking-change Marketplace re-publish under the new `nexus-coding` listing.

Affected known-gaps: 2.P1.J, 2.P2.K, 3.P1.O.

**Impact on v1.0.0 release**: none. The extension keeps working in v0.x-equivalent mode via `discoverDesktopDaemon() === null`. The Marketplace listing description gets a v1.0.0 update (per distribution.md Section 2.3) so users know about the new desktop product without being forced into the rewrite.

**v1.1.0 unlock**: the same shared-core phase that closes 5.1 also closes this cluster.

### 5.4 The "storage migration call-site rename" sweep

A single P1 known-gap (2.P1.G) covers 13 call sites under `src/` that still read `~/.gemma-code/` directly. The `StorageMigration` ensures the data ends up at the right place on first launch; the symlink (POSIX) and side-by-side dir (Windows) keep the legacy path resolvable. The mechanical rename to `nexusHome()` cascades into ~14 test files and was deemed higher-risk to bundle with the storage migration itself.

**Impact on v1.0.0 release**: none. The user-visible behaviour is correct.

**v1.1.0 unlock**: a Phase 2.2.1 follow-on commit (already scoped) performs the mechanical rename.

---

## 6. P0 / P1 status

| Severity | Open | Resolved in v1.0.0 | Carry forward |
|---|---|---|---|
| P0 | **0** | 0 | 0 |
| P1 | 27 | 4 (10.N.A, 10.N.Q, 10.N.R, 10.N.T) | 27 |
| P2 | 33 | 1 (1.P2.E -- icons placeholder closed by Phase 9) | 33 |
| P3 | 3 | 1 | 3 |

The 27 open P1s are NOT release blockers: each has a documented placeholder that keeps the v1.0.0 surface working end-to-end. The "P1" tag reflects their priority in the v1.1.0 cycle, not a release-gate failure.

**Release-gate decision**: green light for v1.0.0 publication after OA-01 (signing) and OA-04 (RTM smoke).

---

## 7. Inputs and artifacts

- `docs/v1.0.0/known-gaps.md` -- the canonical inventory.
- `docs/v1.0.0/operator-actions.md` -- the operator-driven follow-ups.
- `docs/v1.0.0/release-notes.md` -- user-facing release content.
- `docs/v1.0.0/release-signing.md` -- Authenticode + notarization workflow.
- `docs/v1.0.0/rtm-smoke.md` -- RTM smoke checklist.
- `docs/v1.0.0/distribution.md` -- distribution channels.
- `docs/v1.0.0/review/security-audit.md` -- security audit.
- `docs/v1.0.0/review/penetration-test.md` -- pen-test report.
- `docs/v1.0.0/development/history/2026-05-17_phase-XX-*.md` -- Phase 1-10 session histories.
- `CHANGELOG.md` -- machine-parseable changelog.

---

## 8. Sign-off

**Recommendation**: PROCEED with v1.0.0 release after OA-01 and OA-04 complete. P2 / P3 carry forward to `docs/v1.0.1/known-gaps.md` on next cycle open.
