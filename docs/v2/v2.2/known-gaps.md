# Known Gaps - v2.2

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-22 (Phase 8 of runtime-repair-and-ux-overhaul)

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v2.2.0-runtime-repair-and-ux-overhaul.md](plans/v2.2.0-runtime-repair-and-ux-overhaul.md)

## v2.2.0

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 17 | 3 |
| Bugs / regressions (BG) | 0 | 2 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 3 | 1 |
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

##### DF-7 - Bundled hub snapshot is not produced by the release build yet

- **Source phase**: Phase 3 - Nexus-Hub Harness Provisioning (3.1)
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.0-runtime-repair-and-ux-overhaul.md` (sub-task 3.1)
- **Reason**: `scripts/installer/build/build-hub-snapshot.py` produces a checksummed `catalog.tar.gz` + `manifest.json`, the PyInstaller spec stages them when present (refusing a placeholder digest), and the provisioner extracts them. But no snapshot has been built and no build script calls the builder, so today's installer still falls back to the network sync. The OFFLINE-install guarantee is therefore implemented but not yet delivered.
- **Suggested next step**: Call `build-hub-snapshot.py` from `build-windows.ps1` (and the macOS/Linux build scripts) after a sync, so the release installer always carries a snapshot; then verify an offline install lands a populated catalog.

##### DF-8 - Hub tar extraction uses a minimal in-house reader

- **Source phase**: Phase 3 (3.1)
- **Plan reference**: sub-task 3.1
- **Reason**: `extractHubSnapshot` implements a small ustar reader (with a tar-slip guard) rather than adding a tar dependency to the sidecar bundle. It handles the regular-file and directory entries a catalog snapshot contains, but not symlinks, long-name (GNU/PAX) headers, or sparse entries. A snapshot built by `build-hub-snapshot.py` never contains those; a hand-rolled archive could.
- **Suggested next step**: Either keep it and assert the constraint in the builder (reject symlinks/long names at pack time), or vendor a small tar implementation, during the Phase 8 refactor.

##### DF-9 - The switch policy is wired to one submit surface, not four

- **Source phase**: Phase 4 - Smart Single-GPU Model Orchestration (4.3)
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.0-runtime-repair-and-ux-overhaul.md` (sub-task 4.3)
- **Reason**: sub-task 4.3 calls for integrating the policy into "the studios' and chat/coding submit paths". Only `ImageStudioPage.handleSubmit` is wired (classify, dialog, chip, resume-after-confirm). Video Lab, Local Chatbot, and the Agentic composer still submit without consulting the policy, so a submit from those surfaces cannot raise the confirm dialog.
- **Suggested next step**: Apply the same four-line gate to `VideoLabPage`, the chat composer, and the coding composer. The hook and dialog are surface-agnostic; the remaining work is per-surface wiring plus one test each.

##### DF-10 - The policy is not fed live residency or scheduler state

- **Source phase**: Phase 4 (4.1 / 4.3)
- **Plan reference**: sub-tasks 4.1, 4.3
- **Reason**: `ImageStudioPage` accepts `hostVramFreeGB` and `activeSchedulerJob` props, but `App.tsx` does not yet supply them, and `useModelResidency` starts with an empty resident list that nothing updates from the scheduler. In the shipped app the policy therefore sees "nothing loaded, VRAM unknown" and takes the no-incumbent path on every submit. The decision matrix is correct and fully tested; it is simply not being given real inputs yet. This is the same missing feed as DF-5 (telemetry carries no active model or queue depth).
- **Suggested next step**: Expose a `scheduler.snapshot` IPC (active job + queued) alongside the existing `gpu.sample`, feed `resident`/`freeVramGB`/`activeJob` from it in `App.tsx`, and assert an end-to-end confirm in a page test. Closing this also closes DF-5.

##### DF-11 - Cross-model orchestration is not wired to the real agent tools

- **Source phase**: Phase 4 (4.2)
- **Plan reference**: sub-task 4.2
- **Reason**: `runCrossModelRequest` implements hold -> classify -> run -> restore with the three failure modes, and is covered by tests against a mock runtime (which is what the sub-task's acceptance asks for). It is not yet called by the coding agent's image/video tools, so an actual agentic session cannot exercise it, and the Trace-panel progress lines it emits are not rendered anywhere.
- **Suggested next step**: Call it from the agent's image/video tool handlers, passing the session's current model as `agenticModelId`, and render `CrossModelProgress` in the coding Trace panel.

##### DF-12 [RESOLVED 2026-08-22, Phase 8] - The chat rail is not yet the chat-first session history (5.2)

- **Source phase**: Phase 5 - Local Chatbot Rebuild (5.2)
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.0-runtime-repair-and-ux-overhaul.md` (sub-task 5.2)
- **Reason**: 5.2 asks for a rebuilt rail: composer-first empty state, a "New chat" primary action, recent chats at root, an optional Projects section, drag between root/projects/folders, and a collapsible rail. This phase delivered the storage, titling, persona, and composer work; `FolderTree` still renders its original "Create your first folder" empty state and the page still requires selecting a chat before the composer is usable. The user's specific complaint ("it only starts a chat when we create a folder") is therefore NOT yet fixed in the UI, even though the store has supported root-level chats all along.
- **Suggested next step**: Rework `FolderTree` into the session rail and make `ChatPage` render the composer with no active chat, creating a root chat on first send. The storage calls it needs (`createChat` with `folderId: null`, `listMessages`) are already wired and tested.

##### DF-13 [RESOLVED 2026-08-22, Phase 8] - Auto-titling is implemented end to end but not called on first send

- **Source phase**: Phase 5 (5.3)
- **Plan reference**: sub-task 5.3
- **Reason**: `chat.generateTitle` (sidecar), `fallbackTitle`/`sanitizeTitle`, the `userRenamed` pin, and the `renameChat({byUser})` split are all implemented and tested. The client-side trigger - set the fallback title on first send, request the generated one in the background, apply unless the user renamed - is not yet in `ChatPage.handleSubmit`, so chats created today still carry the title `FolderTree` gives them.
- **Suggested next step**: In `handleSubmit`, when the chat has no messages yet, set the fallback title immediately, then call `generateTitle` and apply the result via `renameChat(id, title)` (machine path, so it never sets `userRenamed`).

##### DF-14 - CodingInput still has its own composer implementation

- **Source phase**: Phase 5 (5.4)
- **Plan reference**: sub-task 5.4 ("Update CodingInput to reuse the same base composer")
- **Reason**: `MediaComposer` was rebuilt as the single in-field surface used by Chat, Image Studio, and Video Lab. `CodingInput` keeps its own layout and its own duplicated `addBtnStyle`/`docChipStyle`/`removeBtnStyle` objects, because it carries the slash-command dropdown that the shared composer has no concept of.
- **Suggested next step**: Extract the surface (field + in-field controls) into a shared primitive that accepts an overlay slot, then have `CodingInput` supply its dropdown through that slot. Phase 6's ui-primitives work is the natural place.

##### DF-15 - Token aliases added rather than call sites migrated

- **Source phase**: Phase 6 - Shell UI Modernization (6.4)
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.0-runtime-repair-and-ux-overhaul.md` (sub-task 6.4)
- **Reason**: `--border-1`, `--accent-primary`, `--accent-danger`, and `--accent-warning` were referenced in 71 places but never defined, so each usage fell through to whatever inline literal its author happened to write. They are now DEFINED as aliases of the canonical tokens, which fixes the rendering immediately. The plan also asked to migrate the 71 call sites and delete the aliases; that rename was deliberately not done inside a UI phase, where it would have been a large mechanical diff competing with real behaviour changes.
- **Suggested next step**: Sweep the call sites to the canonical names and delete the alias block during the Phase 8 refactor, with the existing token test as the guard.

##### DF-16 [PARTIALLY RESOLVED 2026-08-22, Phase 8] - Data transfer has no IPC surface or file dialogs yet

- **Source phase**: Phase 7 - Settings modernization and data transfer (7.4)
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.0-runtime-repair-and-ux-overhaul.md` (sub-task 7.4)
- **Reason**: `transferRuntime.ts` implements export and import end to end (manifest, per-category checksums, credentials excluded by default, atomic write, path-escape refusal, dry run, pre-import backup) and is covered by 15 tests. Settings > Data renders the category picker and calls a `DataSettingsClient`, but no `data.export` / `data.import` IPC methods exist and no save/open dialog is wired, so the page reports "the Nexus backend is not reachable" in the running app. The import apply path also stages files under `~/.nexus/import-staging` rather than moving them into place.
- **Resolution (Phase 8)**: `data.categories`, `data.export`, and `data.import` are declared, handled, and covered; Settings > Data now reaches the real runtime, exports to an editable path defaulting to a timestamped name, and offers Preview before Import.
- **Remaining**: no native file dialog. Adding one means a Tauri plugin plus a capability change, which is not a change to slip into a release build; the path fields cover the same ground without it. The import apply path still stages under `~/.nexus/import-staging` rather than merging into final destinations, so an import is a preview-and-stage, not yet a full restore.

##### DF-17 - Settings tabs are still not URL-addressable

- **Source phase**: Phase 7 (7.2)
- **Plan reference**: sub-task 7.2
- **Reason**: 7.2 asks for a declarative tab registry with `/settings/:tab` routing, redirects, and lazy mounting. This phase added the Data tab to the existing hand-written button list and ternary chain instead. Deep links to a specific settings tab therefore still do not work, and `/profile` redirects to `/settings` rather than `/settings/profile`.
- **Suggested next step**: Convert the tab list to a registry with routing during the Phase 8 refactor; the tab bodies are already independent components.

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

#### Bugs found and fixed within this cycle

##### BG-1 (resolved) - the hub CLI reported a scanner-blocked sync as success

- **Source phase**: Phase 3 (3.1), found while restoring a catalog damaged by BG-2.
- **What happened**: `NexusHubSyncer.sync({apply: true})` returns `applied: false` when the prompt-injection scanner blocks the fetched bundle. The CLI reported that outcome as `{kind: "done", ok: true}`, so the installer would have recorded a successful harness install while the catalog on disk was untouched.
- **Fix**: a sync that did not apply and is not `alreadyUpToDate` now returns a `scan-quarantine` error and exit 1. Covered by `hub-catalog-phase3.test.ts` ("reports a fetched-but-not-applied sync as a failure").

##### BG-2 (resolved) - the hub CLI could only ever target the real `~/.nexus-ai/catalog`

- **Source phase**: Phase 3 (3.4).
- **What happened**: the CLI had no way to point at a different catalog directory, so a round-trip test that invoked the real `--extract-hub-snapshot` bundle overwrote the developer's installed catalog with a one-skill test fixture. The catalog was rebuilt from the intact top-level `~/.nexus-ai/` trees and its original tag (`3.12.0`) restored; no other data was affected.
- **Fix**: `--catalog-dir` (and `NEXUS_HUB_CATALOG_DIR`) are honoured by every CLI mode, the round-trip test passes an explicit target and asserts nothing was written outside it, and a regression test pins the override. The destructive extract path can no longer default onto a real home in a test.

