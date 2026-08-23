# Known Gaps - v2.2

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-22 (v2.2.3 Phase 2)

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v2.2.0-runtime-repair-and-ux-overhaul.md](plans/v2.2.0-runtime-repair-and-ux-overhaul.md), [plans/v2.2.1-field-repair-and-chrome-completion.md](plans/v2.2.1-field-repair-and-chrome-completion.md), [plans/v2.2.2-ready-shell-and-studio-chrome.md](plans/v2.2.2-ready-shell-and-studio-chrome.md), [plans/v2.2.3-glass-orbs-and-pillar-runtime.md](plans/v2.2.3-glass-orbs-and-pillar-runtime.md)

## v2.2.3

**Last updated**: 2026-08-22 (Phase 2 - liquid glass rail, full-perimeter beam, icon actions)

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 10 | 0 |
| Bugs / regressions (BG) | 0 | 5 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

### Open Items

#### Deferred

##### DF-1 - Node SEA / externalBin bundling remains deferred

- **Source phase**: Carried into v2.2.3 Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (Out of scope)
- **Reason**: The sidecar still uses the verified Node resolution chain rather than a Tauri `externalBin` or Node SEA artifact.
- **Suggested next step**: Revisit only in a packaging-focused cycle with clean-install validation for the replacement artifact.

##### DF-2 - Packaged clean-VM and Explorer-launch acceptance not executed

- **Source phase**: Carried into v2.2.3 Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (Residual risks)
- **Reason**: Vitest proves the async adapter and route behavior, but this phase did not launch a packaged shell from Explorer or run a clean-VM install. Packaged Chatbot first paint is not proven here.
- **Suggested next step**: Launch the packaged application from Explorer on a clean Windows VM and confirm `/chatbot` renders without a console or blank pane.

##### DF-4 - Live-GPU image and video generation soaks not executed

- **Source phase**: Carried into v2.2.3 Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (Residual risks, DF-4)
- **Reason**: This phase changes chat explorer and routing only; real SANA and LTX generation remain outside its test surface.
- **Suggested next step**: Run the existing generation smoke on a supported GPU after Phase 3 generation-honesty changes land.

##### DF-9 - Occupancy policy is not yet wired to all four submit surfaces

- **Source phase**: v2.2.3 verification addendum, reopened in Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (Phase 5)
- **Reason**: The earlier closure was not field-true. Chat and Coding do not gate submit, and App does not yet feed Image and Video live free VRAM plus the studio scheduler snapshot.
- **Suggested next step**: Implement Phase 5 and resolve this item only after four page-level residency tests pass.

##### DF-14 - CodingInput retains a separate composer implementation

- **Source phase**: Carried into v2.2.3 Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (Phase 8.1)
- **Reason**: Phase 2 aligns its chrome with MediaComposer but does not extract the duplicated surface implementation.
- **Suggested next step**: Evaluate extraction during the Phase 8 scoped architecture audit without changing behavior.

##### DF-16 - Native file dialogs remain unavailable

- **Source phase**: Carried into v2.2.3 Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (Phase 6.1, Phase 8.2)
- **Reason**: The repository has no Tauri dialog plugin. Phase 6 may use a persisted workspace text field, while Settings data transfer also remains path-text based.
- **Suggested next step**: Add and capability-scope the dialog plugin in a dedicated cross-platform file-dialog task.

##### DF-17 - Settings tabs are not URL-addressable

- **Source phase**: Carried into v2.2.3 Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (Phase 8.2)
- **Reason**: This patch does not change Settings navigation or deep-link behavior.
- **Suggested next step**: Add nested Settings routes in a future navigation-focused plan.

##### DF-18 - Packaged macOS and Linux sidecar native-addon paths are not proven

- **Source phase**: Carried into v2.2.3 Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (Phase 8.2)
- **Reason**: No macOS `.app` or Linux AppImage was executed in this session, so native-addon resolution on those targets is not proven here.
- **Suggested next step**: Run packaged `--healthcheck` acceptance on both operating systems and record the resolved addon path.

##### DF-19 - CREATE_NO_WINDOW parity is N/A on macOS and Linux

- **Source phase**: Carried into v2.2.3 Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (Phase 8.4)
- **Reason**: The Windows creation flag has no direct Unix counterpart. Absence of an observed terminal window on other platforms is not proven here.
- **Suggested next step**: Record platform-specific packaged-launch evidence and keep the Windows-only flag classified as N/A elsewhere.

##### DF-20 - Folder color changes are not persisted through the IPC adapter

- **Source phase**: v2.2.3 Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (verification addendum item 33)
- **Reason**: The explorer protocol exposes no `updateFolder` method. The existing UI can reflect a local color touch for the in-memory client, but a production IPC client cannot persist it.
- **Suggested next step**: Add an explicit explorer `updateFolder` protocol method and a persistence regression test in a later chat-organization phase.

### Resolved Items

#### Bugs found and fixed within this cycle

##### BG-15 (resolved) - Async explorer client crashed Local Chatbot on first paint

- **Source phase**: Phase 1
- **What happened**: ChatPage cast the promise-returning IPC client to the synchronous in-memory contract. `FolderTree.listTree()` threw immediately, and `ancestors()` would throw again after opening a chat.
- **Fix**: A promise-safe adapter now supplies the complete explorer contract, caches tree reads, invalidates after mutations, and lets FolderTree and breadcrumbs resolve async results without crashing. `ModuleErrorBoundary` contains future route failures.
- **Evidence**: Solo desktop Vitest run: 154 files and 1325 tests passed, including the new async adapter and breadcrumb regressions.

##### BG-16 (resolved) - Fresh launch opened the hidden Dashboard route

- **Source phase**: Phase 1
- **What happened**: `/` rendered Dashboard and missing or invalid persisted routes were not normalized to a visible module.
- **Fix**: `/` redirects to `/chatbot`; missing, `/`, `/dashboard`, and invalid stored routes normalize to `/chatbot`, while real module routes continue to restore.
- **Evidence**: App and persistence regression tests passed in the 1325-test solo desktop run.

##### BG-17 (resolved) - Module rail used four unrelated accent colors

- **Source phase**: Phase 2
- **What happened**: Each module NavLink painted its icon, active fill, and 3px left bar from a per-pillar accent token.
- **Fix**: Every module row now shares `.nexus-nav-link`: muted inactive text and a frosted selected fill with one hairline and inset highlight. Lucide icons inherit `currentColor`; the rail no longer consumes `accentVar`.
- **Evidence**: Sidebar and brand-token tests assert the glass class and absence of per-pillar icon color.

##### BG-18 (resolved) - Composer beam illuminated only a partial wedge

- **Source phase**: Phase 2
- **What happened**: The breathing beam moved only from 0 to 48 degrees, wrapped the outer attachment box, and competed with inner focused borders in pillar colors.
- **Fix**: The beam wraps the inner typing surface, breathes as a full masked ring, travels 360 degrees, uses brand cyan on every pillar, and is the only focus ring. Drag and send controls also use neutral brand tokens.
- **Evidence**: MediaComposer, CodingInput, and brand-token tests assert inner-surface nesting, `--accent-chatbot`, and the absence of `48deg`.

##### BG-19 (resolved) - Studio recall actions rendered as native text buttons

- **Source phase**: Phase 2
- **What happened**: Download, workflow, prompt, seed, remix, and use-as-source actions used native Windows button chrome and visible captions.
- **Fix**: The actions now share `.nx-icon-btn`, use lucide icons, retain every existing test ID, and expose their names through `aria-label` plus `title`. Coding New session also uses neutral glass instead of the retired per-pillar MetalAccent ring.
- **Evidence**: Image Studio and Coding page tests assert icon-accessible controls and the new glass New session contract.

## v2.2.2

**Last updated**: 2026-08-22 (ready-shell-and-studio-chrome)

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 8 | 0 |
| Bugs / regressions (BG) | 0 | 6 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

v2.2.2 does not re-run v2.2.0 or v2.2.1. It closes what the 2026-08-22 post-healthcheck GUI session still proved broken, and finishes composer / bubble / Data / Advanced chrome.

### Open Items

#### Deferred (carried from v2.2.0 / v2.2.1)

##### DF-1 - Node SEA / externalBin bundling not implemented (resolution chain shipped instead)

Unchanged. Spawn now also sets `CREATE_NO_WINDOW` on Windows. The Node binary is still resolved from the installer chain, not a Tauri `externalBin`.

##### DF-2 - Packaged-build acceptance legs not executed (clean-VM smoke)

A 2026-08-22 Complete-page healthcheck on this Windows host printed sidecar ok. That is not a clean-VM proof, and this coding session did not launch `nexus-shell.exe` from Explorer to confirm zero Node consoles after the flag change. Unit tests cover the flag helper.

##### DF-4 - Live-GPU generation smoke written but not executed

Unchanged. Out of scope for v2.2.2.

##### DF-14 - CodingInput still has its own composer implementation

Unchanged as a shared primitive. v2.2.2 restyled CodingInput to the same in-field + / icon-send contract as MediaComposer (slash autocomplete stays). The duplicated surface style objects were not extracted.

##### DF-16 remaining - no native file dialog for data transfer

Unchanged. Settings > Data still takes a path string. Page padding now matches Models.

##### DF-17 - Settings tabs are not URL-addressable

Unchanged. Out of scope.

##### DF-18 - Sidecar cwd + native addon on macOS .app and Linux AppImage

Unchanged. This session did not execute a macOS `.app` or Linux AppImage install (`not_observed != absent`).

##### DF-19 - CREATE_NO_WINDOW / hidden Node console not applicable on macOS or Linux

- **Source phase**: v2.2.2 Phase 1 / Phase 6.4
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.2-ready-shell-and-studio-chrome.md` (1.1, 6.4)
- **Reason**: `creation_flags(CREATE_NO_WINDOW)` is `cfg(windows)` only. macOS and Linux do not allocate a console for a GUI-parented Node child the way Windows console-subsystem `node.exe` does. Those platforms are N/A for this flag, not proven hidden.
- **Suggested next step**: Record a packaged macOS/Linux launch screenshot showing no extra terminal; do not copy the Windows flag there.

### Resolved Items

#### Bugs found and fixed within this cycle

##### BG-9 (resolved) - Visible node.exe console then sidecar-exited:-1073741510

- **Source phase**: Phase 1
- **What happened**: After a passing installer healthcheck, the GUI spawned console-subsystem `node.exe` with no creation flags. Closing that CMD sent `STATUS_CONTROL_C_EXIT` (0xC000013A / -1073741510) and killed the sidecar.
- **Fix**: Shared `sidecar_command` sets `CREATE_NO_WINDOW` (`0x08000000`) on Windows. No `DETACHED_PROCESS`. In-app `ReadyOverlay` waits for sidecar running plus `models.list` (empty catalog ok), then dismisses. Failure shows `SidecarDownBanner` plus Restart, not a hung splash.

##### BG-10 (resolved) - Image generate 400d on sampler flow-dpm-solver

- **Source phase**: Phase 2
- **What happened**: UI default and Fast Preview sent `flow-dpm-solver`. Python already allowed it. Sidecar Zod `DiffusionSampler` was the six-value enum without that member.
- **Fix**: Enum includes `flow-dpm-solver`. Protocol tests parse the 2026-08-22 field payload.

##### BG-11 (resolved) - Settings > Data had no page padding

- **Source phase**: Phase 4
- **What happened**: Data controls sat on the pane edge. Models uses `padding: var(--space-6, 24px)`.
- **Fix**: The same token on the `settings-data` root.

##### BG-12 (resolved) - Generate/Send was a labeled MetalAccent box; Coding was a three-box row

- **Source phase**: Phase 3
- **What happened**: MediaComposer wrapped a captioned submit in MetalAccent (`.nexus-metal-fallback` ring). CodingInput kept + / textarea / Send as separate boxes.
- **Fix**: + and icon send grouped inside the field (right cluster). Submit is `aria-label` only. AccentBeam stays on the surface.

##### BG-13 (resolved) - Transcripts were full-width rectangles labeled You/Assistant

- **Source phase**: Phase 5
- **What happened**: MessageBubble was full-width with a role header. Image/Video used custom `<ul>` lists.
- **Fix**: User rows `flex-end`, assistant `flex-start`. Bubble `fit-content`, `max-width: 80%`. No You/Assistant on normal turns. Image/Video use MessageList.

##### BG-14 (resolved) - Chat and Coding looked empty when the sidecar was down

- **Source phase**: Phase 5
- **What happened**: Neither page mounted `SidecarDownBanner`. Empty copy read as a blank constellation.
- **Fix**: Banner on Chat and Coding when `useSidecarStatus` reports down. Composer stays visible.

## v2.2.1

**Last updated**: 2026-08-22 (field-repair-and-chrome-completion)

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 6 | 0 |
| Bugs / regressions (BG) | 0 | 6 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

v2.2.1 does not re-run the v2.2.0 cycle. It closes what the 2026-08-22 field install still proved broken, and finishes chrome that v2.2.0 claimed done. Carry-forwards from v2.2.0 that this patch did not close are listed below (same IDs).

### Open Items

#### Deferred (carried from v2.2.0)

##### DF-1 - Node SEA / externalBin bundling not implemented (resolution chain shipped instead)

Unchanged. Spawn now sets cwd to the script directory and waits for liveness; the Node binary is still resolved from the installer chain, not a Tauri `externalBin`.

##### DF-2 - Packaged-build acceptance legs not executed (clean-VM smoke)

A 2026-08-22 rebuild of `nexus-shell.exe --healthcheck` on this Windows host printed `"sidecar":"ok"` with `catalogRows: 38` after two packaging fixes: copy `unsloth-pins.json` next to the bundle (import-time ENOENT), and fetch `better-sqlite3` for installer Node 22.11.0 (ABI 127) instead of the developer Node 24 (ABI 137). The Complete-page install of a freshly built `dist/NexusSetup.exe` is still the remaining live-install proof.

##### DF-4 - Live-GPU generation smoke written but not executed

Unchanged. Out of scope for v2.2.1.

##### DF-16 remaining - no native file dialog for data transfer

Unchanged. Settings > Data still takes a path string. Preview-and-stage import is not a full restore into final destinations.

##### DF-17 - Settings tabs are not URL-addressable

Unchanged. Out of scope.

##### DF-18 - Sidecar cwd + native addon on macOS .app and Linux AppImage

- **Source phase**: v2.2.1 Phase 1 / Phase 5.4
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.1-field-repair-and-chrome-completion.md` (5.4)
- **Reason**: Spawn cwd is `script.parent()` and Tauri maps the whole `sidecar/dist` tree, which is OS-agnostic in source. This session did not execute a macOS `.app` or Linux AppImage install, so those resource layouts are not proven here (`not_observed != absent`).
- **Suggested next step**: Run `--healthcheck` on a packaged macOS and Linux build and confirm `better_sqlite3.node` resolves from the script directory.

### Resolved Items

#### Bugs found and fixed within this cycle

##### BG-3 (resolved) - Complete page printed os error 232 and `[ / / Nodejs v22.11.0]`

- **Source phase**: Phase 1
- **What happened**: Node 22.11.0 started, then the child died (native addon lookup with the wrong cwd). The next JSON-RPC write hit a closed pipe. Healthcheck joined the last three stderr fragments with `" / "`.
- **Fix**: `spawn_with` sets cwd to `script.parent()`, waits for `[nexus-sidecar] ready` or 500 ms of liveness, maps a dead child to `sidecar-exited:<code>`, and the installer prints `exitCode`, paths, and non-empty stderr lines.

##### BG-4 (resolved) - Approvals popover could not be dismissed

- **Source phase**: Phase 3
- **What happened**: Open toggled only from the bell. No X, Escape, or outside click. The card followed the user across tabs.
- **Fix**: Close control, Escape, pointerdown outside the dialog and the bell. Portal to the right of the rail so it cannot cover the toggle. Sidecar-down error is closable and does not auto-open.

##### BG-5 (resolved) - Settings leftover native search/text/action chrome

- **Source phase**: Phase 4
- **What happened**: Models Search, Skill Optimizer, and every other Settings tab still used unstyled native inputs and buttons after the v2.2.0 select pass.
- **Fix**: Shared `Button` and `TextField` primitives; sweep of every Settings tab body; coding-panel leftover `<select>`s wrapped. Vitest grep guards the settings pages.

##### BG-6 (resolved) - User Profile sidebar row and expanded-by-default rail

- **Source phase**: Phase 2
- **What happened**: `ADMIN_ENTRIES` still had User Profile -> `/profile`. Compact was `storedCompact ?? narrow`, so a wide window started expanded.
- **Fix**: Profile row removed. Compact default is true. Silent `/profile` redirect remains.

##### BG-7 (resolved) - Image/Video mapped sidecar-down to a fake installed SANA

- **Source phase**: Phase 5 leftover
- **What happened**: Catch on `models.list` set `noneInstalled` and showed `FALLBACK_MODEL` marked installed.
- **Fix**: Sidecar-down sets an empty list and `noneInstalled=false`. A genuine empty catalog is empty, not a fake installed row.

##### BG-8 (resolved) - Chat composer hidden until a chat existed

- **Source phase**: Phase 5 leftover
- **What happened**: `MediaComposer` rendered only when `activeChat` was set. Empty copy told the user to pick a folder first.
- **Fix**: Composer is always visible. First send creates a folder-less "New chat" and titles it from the first prompt when the generator is available.

## v2.2.0


### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 17 | 7 |
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

##### DF-7 [RESOLVED 2026-08-22, Phase 8] - Bundled hub snapshot is not produced by the release build yet

- **Source phase**: Phase 3 - Nexus-Hub Harness Provisioning (3.1)
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.0-runtime-repair-and-ux-overhaul.md` (sub-task 3.1)
- **Reason**: `scripts/installer/build/build-hub-snapshot.py` produces a checksummed `catalog.tar.gz` + `manifest.json`, the PyInstaller spec stages them when present (refusing a placeholder digest), and the provisioner extracts them. But no snapshot has been built and no build script calls the builder, so today's installer still falls back to the network sync. The OFFLINE-install guarantee is therefore implemented but not yet delivered.
- **Suggested next step**: Call `build-hub-snapshot.py` from `build-windows.ps1` (and the macOS/Linux build scripts) after a sync, so the release installer always carries a snapshot; then verify an offline install lands a populated catalog.

##### DF-8 - Hub tar extraction uses a minimal in-house reader

- **Source phase**: Phase 3 (3.1)
- **Plan reference**: sub-task 3.1
- **Reason**: `extractHubSnapshot` implements a small ustar reader (with a tar-slip guard) rather than adding a tar dependency to the sidecar bundle. It handles the regular-file and directory entries a catalog snapshot contains, but not symlinks, long-name (GNU/PAX) headers, or sparse entries. A snapshot built by `build-hub-snapshot.py` never contains those; a hand-rolled archive could.
- **Suggested next step**: Either keep it and assert the constraint in the builder (reject symlinks/long names at pack time), or vendor a small tar implementation, during the Phase 8 refactor.

##### DF-9 [RESOLVED 2026-08-22, Phase 8] - The switch policy is wired to one submit surface, not four

- **Source phase**: Phase 4 - Smart Single-GPU Model Orchestration (4.3)
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.0-runtime-repair-and-ux-overhaul.md` (sub-task 4.3)
- **Reason**: sub-task 4.3 calls for integrating the policy into "the studios' and chat/coding submit paths". Only `ImageStudioPage.handleSubmit` is wired (classify, dialog, chip, resume-after-confirm). Video Lab, Local Chatbot, and the Agentic composer still submit without consulting the policy, so a submit from those surfaces cannot raise the confirm dialog.
- **Suggested next step**: Apply the same four-line gate to `VideoLabPage`, the chat composer, and the coding composer. The hook and dialog are surface-agnostic; the remaining work is per-surface wiring plus one test each.

##### DF-10 [RESOLVED 2026-08-22, Phase 8] - The policy is not fed live residency or scheduler state

- **Source phase**: Phase 4 (4.1 / 4.3)
- **Plan reference**: sub-tasks 4.1, 4.3
- **Reason**: `ImageStudioPage` accepts `hostVramFreeGB` and `activeSchedulerJob` props, but `App.tsx` does not yet supply them, and `useModelResidency` starts with an empty resident list that nothing updates from the scheduler. In the shipped app the policy therefore sees "nothing loaded, VRAM unknown" and takes the no-incumbent path on every submit. The decision matrix is correct and fully tested; it is simply not being given real inputs yet. This is the same missing feed as DF-5 (telemetry carries no active model or queue depth).
- **Suggested next step**: Expose a `scheduler.snapshot` IPC (active job + queued) alongside the existing `gpu.sample`, feed `resident`/`freeVramGB`/`activeJob` from it in `App.tsx`, and assert an end-to-end confirm in a page test. Closing this also closes DF-5.

##### DF-11 [RESOLVED 2026-08-22, Phase 8] - Cross-model orchestration is not wired to the real agent tools

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

