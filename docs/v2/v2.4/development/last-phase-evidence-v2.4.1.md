# v2.4.1 Last-Phase Evidence

**Date**: 2026-08-29
**Branch**: `feat/v2.4.1-field-reliability`
**Status**: T047 rerun after field-correction implementation; PR 58 is the integration vehicle and the replacement Windows installer is smoke-verified

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

> Field-correction rerun on 2026-08-29: the full installer suite passed 1,265 tests with 3 skips (1,268 collected); Python runtime passed 261 tests; focused root/default-order tests passed; focused desktop model UI tests passed 36/36. The aggregate root run passed 5,729 tests with 12 skips and produced two unrelated 5-second integration timeouts under parallel load; both affected files passed 7/7 in an immediate isolated rerun. The aggregate desktop run passed 1,856 tests with 1 skip and produced one unrelated Windows cancellation confirmation race; the complete affected file passed 21/21 in isolation. Root lint/build/check/dependency gates, desktop lint/typecheck/sidecar/web builds, installer Ruff format/check, and Rust format/Clippy/19 tests pass. The exact repository baseline remains 53 warnings, 56 matches, 0 stale, while Dependency Cruiser remains 0 errors and 18 inherited warnings.

## Post-integration field correction

> User observation on the first packaged candidate found four concrete regressions: Nomic remained required, incompatible models were not bottom-partitioned, gated Hugging Face setup remained manual, and progress motion/contrast/step accounting did not match the intended liquid global bar. The correction makes EmbeddingGemma 300M the sole required/default embedder across registry, installer, extension settings, and coding configuration; shares compatibility-first ordering across installer and Settings; adds browser device authorization with repo validation and manual-token fallback; and makes all weighted finalization steps visible while painting a repeating moving gradient and high-contrast percentage capsule. The replacement unsigned `dist/NexusSetup.exe` is 239.2 MB, SHA-256 `8D36450A6F5A751360E02548C6CC36BC622F4947D88F8F539B126312648B6769`, and passes version, registry, single-artifact, and embedded-desktop-payload smoke probes. Visual, live-account, clean-install, and repair-install observation of this replacement remains pending.

## Publish and integrate

> User authorized the 2.4.1 bump, one Phase 8 commit, the branch's first push/PR, remote integration CI, and rebuilt Windows test installers. The Phase 8 commit is `94a6d14`; PR 58 targets `develop`, and its initial CI passed before the field-correction follow-up. The same PR remains the authorized integration vehicle for this correction. Tag, GitHub Release, merge, and main integration remain outside this authorization and require a later explicit release decision.
