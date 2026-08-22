# Known Gaps - v2.2

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-22 (Phase 2 of runtime-repair-and-ux-overhaul)

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v2.2.0-runtime-repair-and-ux-overhaul.md](plans/v2.2.0-runtime-repair-and-ux-overhaul.md)

## v2.2.0

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 6 | 0 |
| Bugs / regressions (BG) | 0 | 0 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 3 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

### Open Items

#### Deferred

##### DF-1 - Node SEA / externalBin bundling not implemented (resolution chain shipped instead)

- **Source phase**: Phase 1 - Sidecar Packaging and Runtime Wiring Repair (1.2)
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.0-runtime-repair-and-ux-overhaul.md` (sub-task 1.2)
- **Reason**: The plan prefers a Node SEA or Tauri `externalBin` next to the resources so the app is fully self-contained. This phase shipped the resolution chain (`NEXUS_NODE_PATH` -> `~/.nexus/runtime.json` `nodePath` -> per-OS provisioned path -> PATH `node`) plus a guaranteed installer runtime step (payload copy or pinned nodejs.org download, sha256-verified), which covers every installer-driven path. A machine whose app is installed WITHOUT the Nexus installer (raw NSIS bundle) and with no system Node still has no runtime.
- **Suggested next step**: Evaluate Tauri `externalBin` with the Node 22 binary at desktop build time in a later phase; if adopted, it becomes resolution source 2 and the download leg becomes repair-only.

##### DF-2 - Packaged-build acceptance legs not executed (clean-VM smoke)

- **Source phase**: Phase 1 (1.1 / 1.2 / 1.4 acceptance criteria)
- **Plan reference**: sub-tasks 1.1, 1.2, 1.4
- **Reason**: The 1.1/1.2/1.4 acceptance criteria include running a packaged NSIS build on a clean VM (resource-dir resolution, no-system-Node spawn, installer health-check verdict). This session validated the contracts statically (packaging assertion tests, Rust resolution-chain tests, stubbed healthcheck pytest) but did not produce and execute a full installer build.
- **Suggested next step**: On the next installer build (`build-windows.ps1` -> nexus-installer exe), run the install on a clean Windows VM/sandbox and confirm the Complete page reports `sidecar ok; catalogRows>0`. Phase 2's stability gate re-checks this on the reference machine.

##### DF-3 - provisioner_dispatch chain remains dead code in the GUI flow

- **Source phase**: Phase 1 (discovered during 1.3)
- **Plan reference**: sub-task 1.3
- **Reason**: The live `InstallEngine.run` never consumed `provisioner_dispatch.chain_for` ("node", "ffmpeg", python-venv provisioners) - that is WHY no Node was ever provisioned in shipped installs. Phase 1 added a dedicated always-on runtime step rather than rewiring the whole dispatch chain (diffusion venv wheels provisioning is still not wired into the GUI flow; runtime.json records the venv only if present).
- **Suggested next step**: Either wire the dispatch chain into `InstallEngine.run` (diffusion venv + ffmpeg steps) or delete the dead chain in the final refactor phase; the diffusion venv step matters for Phase 2's generation smoke on hosts that never had v1.x installs.

##### DF-4 - Live-GPU generation smoke written but not executed

- **Source phase**: Phase 2 - Model Availability End to End (2.5)
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.0-runtime-repair-and-ux-overhaul.md` (sub-task 2.5)
- **Reason**: `scripts/smoke/live-gpu-generation.mjs` renders one real image (sana-1.6b-2k) and one short clip (ltx-video) through the built sidecar and the installed weights, gated behind `NEXUS_LIVE_GPU=1`. It was verified to skip cleanly (exit 2) without the gate, but the actual GPU run was NOT performed in this session - no live render has been proven end to end. The mocked integration test covers routing and the typed `runtime-unavailable` path only.
- **Suggested next step**: Run `NEXUS_LIVE_GPU=1 node scripts/smoke/live-gpu-generation.mjs` on the RTX 3080 host after the next install, and record the outcome here. This is the leg that closes Phase 2's stability gate for real.

##### DF-5 - GPU telemetry reports no queue depth or active model

- **Source phase**: Phase 2 (2.4)
- **Plan reference**: sub-task 2.4
- **Reason**: `gpuRuntime.ts` builds `GpuTelemetrySource` with the default `activeJobProvider`, so `activeModelId` is null and `queuedJobs` is 0 in every sample. Real GPU/VRAM/device numbers are live, but the widget's "Idle vs model name" line and queue count are not yet fed by the scheduler. Wiring them means giving the sidecar handler access to the GpuScheduler snapshot, which is exactly what Phase 4's `ModelResidencyContext` introduces.
- **Suggested next step**: Feed the scheduler snapshot into `gpuTelemetrySource()` during Phase 4 (4.3), then assert a non-null `activeModelId` while a job runs.

##### DF-6 - Ollama upgrade path reaches through to a private helper

- **Source phase**: Phase 2 (2.3)
- **Plan reference**: sub-task 2.3
- **Reason**: `ensure_ollama_supports()` calls `OllamaInstaller._ollama_version()` (a private method, flagged with `noqa: SLF001`) because there is no public version accessor. Correct behavior, slightly leaky boundary.
- **Suggested next step**: Promote `_ollama_version` to a public `installed_version()` during the Phase 8 refactor and drop the noqa.

#### Missing tests / coverage

##### MT-3 - Studio backend-down banner not covered by a page-level test

- **Source phase**: Phase 2 (2.2)
- **Plan reference**: sub-task 2.2
- **Reason**: The classifier, the hook, and the settings pages are covered, but no test renders `ImageStudioPage` / `VideoLabPage` with a stubbed `sidecar_status` reporting `running: false` to assert the banner replaces the "No image models installed" button. The pages read the status through a Tauri command that is absent under Vitest (`ipc-unavailable` -> unknown -> not down), so this needs an injectable seam.
- **Suggested next step**: Add a `sidecarStatus` prop (or a context provider) to the studio pages in Phase 6's shell work and assert both branches.

##### MT-1 - Sidecar boot wiring (main.ts) covered only indirectly

- **Source phase**: Phase 1 (1.3)
- **Plan reference**: sub-task 1.3
- **Reason**: `applyRuntimeConfigEnv` is unit-tested, but the `main.ts` call site (applied before runtime construction, stderr log line) has no direct test - `main.ts` is the process entry and has no test harness today.
- **Suggested next step**: Cover via the Phase 2 sidecar-level integration test (spawn the built sidecar with a fixture `NEXUS_AI_HOME`/home and assert the boot log line).

##### MT-2 - Complete-page health detail line untested

- **Source phase**: Phase 1 (1.4)
- **Plan reference**: sub-task 1.4
- **Reason**: The Complete page now renders `state.desktop_health_detail`; existing complete-page tests pass but none assert the new detail string.
- **Suggested next step**: Add a QLabel-text assertion to the complete-page pytest when Phase 7 reworks settings/pages tests, or fold into the installer UI test pass.

### Resolved Items

(none yet)
