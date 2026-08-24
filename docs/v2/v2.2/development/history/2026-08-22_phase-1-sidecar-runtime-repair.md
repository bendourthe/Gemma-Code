# Session History - Phase 1: Sidecar Packaging and Runtime Wiring Repair

**Date**: 2026-08-22
**Plan**: [v2.2.0-runtime-repair-and-ux-overhaul.md](../../plans/v2.2.0-runtime-repair-and-ux-overhaul.md) - Phase 1 of 8
**Outcome**: All 5 sub-tasks complete; all quality gates green.

## Context

A v2.1.0 field install reported success but the app was inert: `sidecar-not-running` on every IPC surface, zero models listed despite 9/10 verified downloads. Pre-implementation research confirmed four packaging root causes (sidecar not bundled, PATH `node` spawn, catalog not shipped, diffusion venv unwired) and this session discovered a fifth: the live installer never wired the v1.x provisioner chain, so Node was never provisioned on any shipped install.

## Sub-tasks

### 1.1 Bundle sidecar + catalog into the Tauri app

- `desktop/src-tauri/tauri.conf.json`: `bundle.resources` maps `../sidecar/dist` -> `sidecar/dist`.
- `desktop/sidecar/esbuild.config.mjs`: copies `core/registry/catalog.json` into `dist/` (the core loader resolves via `__dirname`, so no core change needed).
- `desktop/sidecar/src/models/modelsService.ts`: `resolveCatalog()` -> `{file, error}`; `ModelsRuntime.catalogStatus`; `models.list` reply carries `catalogStatus`; failure logged to stderr. Frontend three-way branching lands in Phase 2.2.

### 1.2 Node resolution chain + spawn diagnostics

- `desktop/src-tauri/src/sidecar.rs`: `resolve_node()` chain (env -> runtime.json -> provisioned per-OS path -> PATH), `SidecarStatus` (camelCase serialized), stderr drain thread with 50-line ring buffer (fixes a latent pipe-fill deadlock: stderr was piped but never read), `try_exit_code()` liveness probe, `spawn_with()` shared with the healthcheck path.
- `desktop/src-tauri/src/lib.rs`: `AppState` gains `status` + single-flight `restarting`; new `sidecar_status` / `sidecar_restart` commands; setup stores the spawn outcome instead of only stderr-logging it. `sidecar-not-running` kept as the IPC error string for frontend compatibility.
- 10 Rust unit tests (resolution chain incl. stale/corrupt runtime.json, status serialization, NotFound path); env-var tests serialized behind a mutex.

### 1.3 Runtime contract (installer <-> app)

- New `scripts/installer/src/nexus_installer/engine/runtime_provisioner.py`: Node provisioning (reuse -> payload -> pinned download, sha256-verified; real Node 22.11.0 pins fetched from nodejs.org SHASUMS256.txt replace the all-zero placeholders in `versions.lock.json`), `runtimes/` source copy (staged fail-closed by `nexus-installer.spec`), atomic `~/.nexus/runtime.json` write.
- `installer.py`: always-on "runtime" step after the component steps (stubbed via autouse fixture in engine tests).
- `desktop/sidecar/src/runtimeConfig.ts` + `main.ts` boot hook: applies `diffusionPython`/`diffusionCwd`/`modelsRoot` to env (env wins).
- `runtimeFactory.ts`: typed `UnavailableDiffusionRuntime` (`runtime-unavailable: ...`) when a configured path-like python is missing; bare command names (e.g. `python3`) still resolve via PATH.
- Contract documented in `../runtime-contract.md`.

### 1.4 Honest installer health check

- `lib.rs`: `--healthcheck` CLI mode - headless sidecar spawn, `models.list` + `skills.status` with retry/backoff (25 s budget), one JSON verdict line, exit code communicates health.
- `desktop_provisioner.py`: `first_run_health_check` runs `--healthcheck` (40 s budget), parses the verdict, fails with the reason; legacy no-verdict builds pass with a warning; zero catalog rows passes but is warned. `InstallerState.desktop_health_detail` surfaces on the Complete page.

### 1.5 Testing and stabilization

| Gate | Result |
|---|---|
| Root vitest (`--config configs/vitest.config.ts`) | 5325 passed / 12 skipped / 0 failed |
| Desktop vitest (full) | green; coverage 90.71% lines / 82.93% branches |
| Installer pytest (full) | all green (new `test_runtime_provisioner.py`, rewritten health-check tests, `TestSidecarPackagingContracts`, engine runtime-step tests) |
| cargo test / clippy | 10/10; 0 warnings |
| tsc -b / eslint (touched) / ruff (touched) | clean |

CI: no workflow changes needed - `shell-build.yml` (cargo, path-filtered, cached, concurrency-cancelled, PR-gated matrix) and `installer-tests.yml` already cover every touched path.

## Troubleshooting notes

- Rust env-var tests raced under the parallel runner -> serialized with a static mutex.
- The new always-on runtime step initially ran for real inside engine tests (writing the real `~/.nexus/runtime.json`) -> `RuntimeProvisioner` import hoisted to module level and stubbed with an autouse fixture.
- Two `test_ollama_installer` failures were a local ENV issue (missing `zstandard`), resolved by installing it; not a code change.
- A bare root `npx vitest run` (without `--config configs/vitest.config.ts`) sweeps desktop tests without their setup and mass-fails - the config flag is load-bearing.

## Deviations

Logged as DF-1 (Node SEA deferred), DF-2 (clean-VM smoke deferred), DF-3 (provisioner_dispatch still dead code) and MT-1/MT-2 in [known-gaps.md](../../known-gaps.md).

## Next steps

Phase 2 - Model Availability End to End. Its stability gate re-validates this phase's work on the reference RTX 3080 machine with the real downloaded models.
