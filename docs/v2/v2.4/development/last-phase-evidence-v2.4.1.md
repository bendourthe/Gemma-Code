# v2.4.1 Last-Phase Evidence

**Date**: 2026-08-29
**Branch**: `feat/v2.4.1-field-reliability`
**Status**: T047 green after inherited-gate remediation; 2.4.1 integration candidate awaiting the single Phase 8 commit, first push/PR, and packaged rebuild

## Architecture refactor

> Scoped scan covered `desktop/`, `core/`, `modules/`, and `scripts/installer/`, excluding vendor/build/cache trees. It found no empty source directory and no redundant v2.4.1 file. Two empty `.ruff_cache` internals are ignored generated caches. The `workspacePath` field is intentionally retained as a one-cycle compatibility seam, and `CODING_FOLDER_OVERLAY_KEY` is intentionally retained to migrate old local history folders. No file move or unrelated cleanup was justified.

## Known-gaps reconciliation

> Created `docs/v2/v2.4/known-gaps.md` with 7 deferred field items and 4 quality-gate/tooling gaps. WN-1, WN-2, and QG-4 are now resolved by canonical Rust formatting, full installer Ruff remediation, and an exact-count stale-detecting `nexus-check` baseline. QG-1 through QG-3 and all field observations remain open. Reviewed v2.3 and finalized v2.2 ledgers; no historical field item was closed without new observation.

## Living docs architecture

> Updated README, ARCHITECTURE, installer README, v2.4 release notes, v2.4 known gaps, operator checklist, and `docs/todos.md`. Release-bound evidence stays under `docs/v2/v2.4/`; living product behavior stays in root README/ARCHITECTURE and `scripts/installer/README.md`.

## Git-tree hygiene

> `python scripts/check_release_preconditions.py --branches --repo-settings` failed before execution because the helper is absent. Manual fallback: branch `feat/v2.4.1-field-reliability`; base `198ff9c` equals `origin/develop`; commits `573b70f`, `ba82ce3`, `6db151b`, `d1d06ee`, `44eb45d`, `ced5500`, `c53b770`, and `8fab830` are one plan-baseline commit plus exactly one commit for Phases 1-7. `origin/feat/v2.4.1-field-reliability` does not exist, so no phase was pushed. No branch was deleted or rewritten.

## Terminal CI/CD reconciliation

> `.github/workflows/shell-build.yml` triggers on `desktop/**` and runs desktop lint, typecheck, sidecar build, coverage, Cargo check/clippy/test, and web build. `.github/workflows/installer-tests.yml` triggers on `scripts/installer/**`, canonical catalog/config files, desktop Rust/sidecar, package manifests, and installer/release workflows; it runs full installer pytest plus headless smoke. Root CI owns core/modules/tests, catalog sync, dependency, docs, Python runtime, and security gates. The `nexus-check` CI job and pre-push hook were intentionally widened from `src/` to `npm run check` across the repository so both enforce the same exact-count baseline. No other path-filter or command gap required a workflow change.

## Goal-vs-codebase review

> Verdict: code-complete at automated/internal-compatible evidence. Every requested issue traces to implementation and tests: overall progress and frozen optional assets (Phase 1); diffusion readiness/repair (Phase 2); pending/bubble/token/reasoning chrome (Phase 3); four-pillar archive transactions and reset (Phase 4); shared model display and live disk arithmetic (Phase 5); WorkspaceScope/path enforcement (Phase 6); native multi-root selector and workspace-grouped history (Phase 7). The remaining misses are observations, not silent passes, and are recorded as DF-1 through DF-7.

## Human testing

> Completed `docs/v2/v2.4/development/v2.4.1-operator-checklist.md` with a concrete Windows 11 Pro build 26200 / RTX 3080 Ti 16 GB / driver 596.08 / CUDA 13.2 host record and an explicit status for every item. Automated/internal-compatible evidence passed, but all nine packaged visual, install, live-model, destructive session-operation, and multi-root walkthrough items remain `Not observed`; none is inferred from tests. The checklist maps those deferrals to DF-1 through DF-7 and names `dist/NexusSetup.exe` as the post-push test artifact.

## Full local stabilization

> Re-executed after gate remediation on 2026-08-29. `npm run test -- --coverage --reporter=dot` exited 0; the companion count-only run reports 529 files passed, 3 skipped, 5,730 tests passed, and 12 skipped. The generated coverage summary records 87.80% lines/statements, 83.51% branches, and 90.59% functions. The first desktop single-worker attempt did not terminate and was explicitly discarded; the normal-concurrency rerun passed 202 files and 1,857 tests with 1 skipped at 87.01% lines/statements, 81.35% branches, and 82.83% functions. `uv run pytest tests --cov=src/nexus_installer --cov-report=term -q` passed the 1,261-test / 3-skip suite at 85% total coverage. `python -m pytest tests/python -q` passed 261 tests.
>
> Root ESLint/build and desktop ESLint/typecheck/sidecar/web builds pass. The desktop build retains its known mixed Tauri import and chunk-size warnings. Fresh `cargo fmt --all -- --check`, Clippy with warnings denied, and 19 Rust tests pass. Fresh `uv run ruff check .` and `uv run ruff format --check .` pass across all 171 installer files. Dependency Cruiser reports 0 errors and 18 inherited warnings. Security synchronization, tampering, naming, docs layout, production audit, and repository-check gates pass; `npm run check --silent` reports 0 errors, 53 warnings, 56 exact baseline matches, and 0 stale entries. The generated catalog index changed only for the current `AgentLoop` line count and is idempotent; its HEAD comparison will be rerun after the Phase 8 commit. The expected `scripts/validate_unicode_safety.py` helper remains absent, so the deterministic changed-content UTF-8/BOM/unsafe-punctuation fallback is retained under QG-3.
>
> No required inherited global gate remains failing. Rust and Ruff drift were remediated rather than waived. Historical `nexus-check` fixtures/examples are formally baselined with exact fingerprints and counts, and baseline behavior has focused tests for excess, stale, malformed, and JSON-report cases. QG-1 through QG-3 remain tooling-availability gaps with deterministic fallbacks, not product-gate failures. Packaged field observations remain deferred and constrain support claims, but they do not block the explicitly authorized integration-candidate push and installer rebuild.

## Publish and integrate

> User authorized the 2.4.1 bump, one Phase 8 commit, the branch's first push/PR, remote integration CI, and a rebuilt Windows installer. At this evidence snapshot no push, pull request, tag, GitHub Release, or integration action has occurred because the commit must exist first. Tag, GitHub Release, merge, and main integration remain outside this authorization and require a later explicit release decision.
