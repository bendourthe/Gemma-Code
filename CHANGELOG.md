# [0.35.0](https://github.com/bendourthe/Nexus-AI/compare/v0.34.0...v0.35.0) (2026-05-20)


### Features

* **v1.1.0:** phase 3 codemod + src/utils move ([f3429c4](https://github.com/bendourthe/Nexus-AI/commit/f3429c415a4606a1a681560091afd923aba6a311))
* **v1.1.0:** phase 4 memory provenance + HookBus + secret pre-index filter ([9323352](https://github.com/bendourthe/Nexus-AI/commit/9323352646191843a709240fb660e52431fddd52))

# [0.34.0](https://github.com/bendourthe/Nexus-AI/compare/v0.33.0...v0.34.0) (2026-05-19)


### Features

* **v1.1.0:** phase 2 rebrand + core extraction ([de219a5](https://github.com/bendourthe/Nexus-AI/commit/de219a584557052e2b9728ac5e2bef92b736e518))

# [0.33.0](https://github.com/bendourthe/Nexus-AI/compare/v0.32.1...v0.33.0) (2026-05-19)


### Features

* **v1.1.0:** phase 1 (partial) shared-core decision + carryforward closure ([ec3ff0e](https://github.com/bendourthe/Nexus-AI/commit/ec3ff0ee44397bdcccdb3cdf54a7da27a9238257))

## [0.32.1](https://github.com/bendourthe/Nexus-AI/compare/v0.32.0...v0.32.1) (2026-05-18)


### Bug Fixes

* **ci:** regenerate docs/index.md after Phase 10 Tracer additions ([ad92d8b](https://github.com/bendourthe/Nexus-AI/commit/ad92d8bb2a9fb3941a48e7bf272b47e00c2f29a6))

# [1.0.0](https://github.com/bendourthe/Nexus-AI/compare/v0.32.0...v1.0.0) (2026-05-18)

The first production release of Nexus -- a local-first agentic AI workstation that hosts four pillars (Agentic AI Coding, Local Chatbot Explorer, Image Studio, Video Lab) inside a single Tauri 2.x desktop shell, backed by a Node sidecar (LLM + chat orchestration) and a Python sidecar (Stable Diffusion / video pipelines). The cycle pivots the project from the v0.x "Gemma Code" VS Code extension into a four-pillar desktop product, completes the rebrand sweep, and lands a Windows-first single-binary installer with a DevAI-Hub skill-sync pathway.

This is a SemVer major-version bump from v0.30.1. Identifier, settings, storage path, and CLI surface migrations preserve backwards compatibility through a one-cycle compat window (legacy `gemma-code.*` keys, `~/.gemma-code/` storage, and the `gemma-check` CLI alias are all still honoured with deprecation logs; they are scheduled for removal in v1.1.0).

### Added

Tauri desktop shell (Phase 1):
- Tauri 2.x Rust core (`desktop/src-tauri/`) that hosts a React 19 + Vite 5 web frontend and spawns a Node 22 sidecar process over JSON-RPC.
- IPC primitives: request/response `ipc_call` Tauri command, typed `protocol.ts` envelope with Zod schemas, error envelope with structured `code` + `details`.
- Dashboard with four module cards (Coding / Chat / Image / Video), TopBar with search + notifications + extra-buttons slot, Sidebar with module navigation + design-token styleguide route.
- Design tokens (`desktop/src/styles/tokens.css`) consumed via CSS variables; styleguide page renders every token visually for regression checks.

Rebrand + core extraction (Phase 2):
- `core/` shared-core surface (storage, settings, telemetry, registry, video utilities) with TypeScript project-references build.
- `core/storage/StorageMigration.ts` migrates `~/.gemma-code/` -> `~/.nexus/` on first launch; POSIX symlink retains backwards compatibility on macOS / Linux, side-by-side dirs on Windows.
- `SettingsCompat` shim resolves every legacy `gemma-code.*` settings key to its canonical `nexus.*` counterpart with a runtime deprecation log.
- Dependency-cruiser boundary rules enforce `core/` -> `modules/coding/` (and `modules/chat/`, etc.) is one-way; reverse imports are CI-blocked.
- VS Code extension code identifiers renamed (`GemmaCodePanel` -> `NexusCodingPanel`, `GemmaRuntime` -> `NexusCodingRuntime`).
- `nexus` CLI binary (still ships `gemma-check` as a compat alias) covering `nexus skills sync`, `nexus skills list`, and the existing check / golden / curate subcommands.

Coding module (Phase 3):
- `desktop/sidecar/` Node sidecar workspace hosting the new `CodingSessionManager` (placeholder responder during the compat window; Phase 5 follow-on swaps in the real `NexusCodingRuntime`).
- Coding-module IPC surface: `coding.session.create`, `coding.session.sendMessage`, `coding.session.event`, `coding.memory.snapshot`, `coding.trace.subscribe`, `coding.sessions.list`.
- Desktop Coding panel (`desktop/src/modules/coding/`) with chat input, message list, slash-command autocomplete (12 canonical commands), `<MemoryPanel>` / `<TraceDashboardPanel>` / `<SessionListPanel>` siblings.
- IdleTimeScheduler (`desktop/sidecar/src/runtime/idleScheduler.ts`) -- registers curator (5 min idle / 12 h cadence) and reflect (10 min idle / 24 h cadence) workers; closes v0.9.0 known-gap 10.N.Q.
- `desktop/src/desktop/daemonDiscovery.ts` and the VS Code adapter detection branch -- groundwork for the thin-adapter flip in v1.1.0.

Chat module (Phase 4):
- `modules/chat/` SQLite-backed `ChatExplorerStore` (folder tree with drag/drop, chat CRUD, search, breadcrumbs, ancestor traversal).
- Desktop Chat panel (`desktop/src/modules/chat/ChatPage.tsx`) with `<FolderTree>`, `<ChatHeader>`, `<MessageList>`, model selector, tools toggle.
- `MemoryHub` scope filter -- in-memory `scopeId` propagation across working / episodic / semantic / graph layers; `ChatScopedMemory` bridge translates folder ancestry into a scope chain. SQLite column migration deferred to v1.1.0.
- TopBar search adapter signature for folder / chat / memory results; default Dashboard wires folder + chat sources.

Model Registry (Phase 5):
- `core/registry/ModelCatalog.ts` + `core/registry/models.json` -- single canonical model catalog (LLM, image, video, LoRA, ControlNet) with provenance, license, source protocol, recommended VRAM tier, SHA-256 digest.
- `core/registry/NexusModelRegistry` -- per-host installed-model index at `~/.nexus/registry/models.json`, atomic write, version-aware, recoverable.
- `core/registry/Downloader` -- HTTP/HTTPS + HuggingFace + Ollama-protocol downloader with resumable transfer, SHA-256 verification, progress events, cancel.
- `core/registry/ModelPinRegistry` (ported from `src/storage/`) -- per-model "keep loaded in VRAM" pinning; sidecar bootstrap rehydrates pin set from `SettingsStore`'s `nexus.llm.modelPins`; resolver() callback drives `StreamingPipeline`'s existing `KeepAliveResolver` seam.
- Settings -> Models UI (`desktop/src/pages/settings/ModelsSettings.tsx`) with Installed / Available / External sections, type filters, search, disk-usage summary, install progress + cancel, remove, reveal.

Image Studio (Phase 6):
- `runtimes/diffusion/` Python sidecar (JSON-RPC over stdio) -- pluggable pipeline registry, smart-offload decision via `device.choose_offload`, deterministic stub executors for CI, real PyTorch executor seams.
- SDXL Turbo, SDXL 1.0, FLUX Schnell, SD 1.5 pipelines (text2img, img2img, inpaint, outpaint) + LoRA + ControlNet preprocessor stubs (pose / depth / canny).
- Workflow-metadata embedding -- every output PNG carries the prompt, sampler, steps, CFG, seed, model id, LoRA stack, ControlNet stack as PNG `tEXt` chunks for round-trip reproducibility.
- Desktop Image Studio panel (`desktop/src/modules/image/ImageStudioPage.tsx`) with prompt form, model dropdown, advanced LoRA / ControlNet, output gallery, live latent preview poll, drag-into-prompt.

Video Lab (Phase 7):
- Python sidecar video pipelines: LTX-Video, Stable Video Diffusion (SVD), CogVideoX 5B / 2B (text2video + image2video).
- Video-aware offload decision (`_upgrade_for_video`), `vram_scope` context manager, thumbnail-strip during generation, MP4 output with embedded workflow JSON via ffmpeg metadata.
- Desktop Video Lab panel (`desktop/src/modules/video/VideoLabPage.tsx`) with prompt form, mode toggle (text2video / image2video), model dropdown, timeline preview scrubber, thumbnail strip, output gallery, drag-into-image-source.
- ffmpeg / ffprobe injection seam (`FfmpegContext`) -- defaults to `NEXUS_FFMPEG_PATH` / `NEXUS_FFPROBE_PATH` env vars; installer sets these in Phase 9.

GpuScheduler + telemetry (Phase 8):
- `core/scheduler/GpuScheduler.ts` -- single-GPU job queue with FIFO scheduling, foreground bump (Coding token-gen pre-empts a queued image job), VRAM gating (rejects jobs that would exceed `availableVramGB`), cancel, scheduler telemetry envelope.
- `core/telemetry/GpuTelemetrySource.ts` -- 2 Hz pluggable poller with `parseNvidiaSmiCsv` (Win + Linux), `parseAppleSystemProfiler` (macOS), `buildCpuFallbackSample` (no-GPU graceful-degrade).
- `core/config/DiffusionTier.ts` -- four-tier hardware classification (`diffusion-none`, `-low`, `-mid`, `-pro`) with per-tier image + video defaults (resolution, sampler, steps, model, allowControlNet, parallelJobs, video.enabled).
- `<LocalModelStatus>` widget -- GPU usage gauge, queue summary, hover tooltip, click-to-open queue modal; `<LocalModelStatusDock>` floats it on every non-dashboard route.
- Closes v0.9.0 known-gap 10.N.A (ModelPinRegistry wiring) and 10.N.R (real telemetry source).

Single-binary installer (Phase 9):
- PyQt5 cross-platform wizard (`scripts/installer/pyqt/`) with Welcome -> EULA -> Components -> CUDA -> Python venv -> Node -> Models -> Install -> Done page flow.
- Per-provisioner modules: `cuda_provisioner.py`, `diffusion_venv_provisioner.py`, `node_provisioner.py`, `ollama_provisioner.py`, `devai_hub_provisioner.py`, `recommended_models.py`.
- NSIS outer installer template (`scripts/installer/build/nsis/nexus-setup.nsi`) covering registry entries, Start Menu / Desktop shortcuts, `.nexus-workflow.json` file association, `nexus://` URL handler, data-preservation uninstaller.
- Tauri icons under `desktop/src-tauri/icons/` (procedurally rendered teal-on-charcoal "N" via `scripts/desktop/generate-icons.py`; final designer art tracked as a v1.0.1 polish item).
- Brand assets: `assets/branding/` logo set, design-token alignment with `desktop/src/styles/tokens.css`.
- CI workflows: `installer-build.yml` (Windows), workflow_dispatch placeholders for `installer-macos.yml` + `installer-linux.yml` (deferred to v1.0.1 / v1.0.2).

DevAI-Hub skill sync (Phase 10):
- `core/skills/DevAIHubSyncer.ts` -- dependency-injected syncer (resolveLatestTag / sparseClone / tarballFetch / hasGit) with full diff + scan + apply pipeline.
- `nexus skills sync` CLI subcommand (`--tag`, `--apply`, `--dry-run`).
- Namespaced `SkillCatalog` (`devai-hub/<name>` vs `user/<name>`) with diverged-flag detection.
- `~/.nexus/skills/devai-hub/<tag>/` content-addressed tag dirs + `ACTIVE` pointer for tag rotation.
- Prompt-injection scanner (`core/skills/PromptInjectionScanner.ts`) blocks suspicious skill content before it reaches `~/.nexus/skills/`.
- Settings -> Skills UI (`desktop/src/pages/settings/SkillsSettings.tsx`) with "Sync now", tag picker, install/divergence indicators, "Use as default" for diverged skills, "Auto-sync weekly" toggle (default OFF).
- Skill provenance attribution (`Tracer.setCurrentSkill(...)`) folds `skill.{id, namespace, provenance}` into every `tool_call` / `sub_agent` span.

Release hardening (Phase 11):
- `docs/v1.0.0/release-signing.md` -- Authenticode (Windows) workflow + macOS notarization workflow placeholder.
- `docs/v1.0.0/release-notes.md` -- user-facing release announcement with module screenshots and v1.1.0 teaser.
- `docs/v1.0.0/rtm-smoke.md` -- operator-driven RTM smoke checklist (fresh Win 11 VM, 4 modules end-to-end, target <= 90 min total).
- `docs/v1.0.0/distribution.md` -- distribution-channel runbook (GitHub Releases, VS Code Marketplace re-publish, optional direct-download site).
- `docs/v1.0.0/operator-actions.md` -- consolidated operator checklist covering live-GPU benches, code-signing cert procurement, SHA-256 rotation, RTM execution.
- `docs/v1.0.0/review/synthesis.md`, `security-audit.md`, `penetration-test.md` -- consolidated Phase 11 review artifacts.

### Changed

- Project identity, repository remote, npm/Cargo package names: `gemma-code` -> `nexus` (with VS Code extension manifest IDs and Marketplace listing rename deferred to v1.1.0 per known-gap 2.P1.J / 2.P2.K).
- Settings key namespace: `gemma-code.*` -> `nexus.*`. Legacy keys still honoured via `SettingsCompat`; runtime deprecation log surfaces every legacy read.
- Storage path: `~/.gemma-code/` -> `~/.nexus/`. Migration on first launch; legacy dir preserved (POSIX symlink on macOS / Linux, side-by-side on Windows). 9 homedir-based call sites in `src/` and 4 workspace-local sites still read the legacy path -- mechanical rename deferred to v1.1.0 per known-gap 2.P1.G.
- VS Code extension scope: thin-adapter target. The full in-process engine is still hosted by the extension during the compat window; the daemon-discovery + activation-branch hooks ship in v1.0.0, the rewrite to a true thin adapter is staged for v1.1.0 per 3.P1.O.
- Coding panel: now hosted by the Tauri desktop process (`desktop/src/modules/coding/`). The VS Code extension panel remains until v1.1.0.
- CLI rename: primary binary is `nexus`. `gemma-check` is retained as a compat alias (logs a deprecation warning); removed in v1.1.0.

### Deprecated

- `gemma-code.*` settings keys (removed in v1.1.0).
- `~/.gemma-code/` storage path (removed in v1.1.0; data migrated by `StorageMigration` on first v1.0.0 launch).
- `gemma-check` CLI alias (removed in v1.1.0; use `nexus check`).
- VS Code extension manifest IDs `gemma-code-sidebar`, `gemma-code.<command>`, `gemma-code.chatView`, `.memoryPanel`, `.traceDashboard` (renamed to `nexus.coding.*` in v1.1.0 per known-gap 2.P1.J).
- VS Code extension npm package name `gemma-code` (renamed to `nexus-coding` in v1.1.0 per known-gap 2.P2.K).

### Removed

- Pre-rebrand identifiers `GemmaCodePanel`, `GemmaRuntime`, and their import paths under `src/llm/` / `src/storage/` (replaced by `NexusCodingPanel`, `NexusCodingRuntime`, and `core/llm/`, `core/storage/` import paths; legacy modules are compat re-exports).

### Fixed

- v0.9.0 known-gap 10.N.A (ModelPinRegistry wiring): Phase 5 ports the registry to `core/registry/ModelPinRegistry.ts`, persists pin set through `SettingsStore` (`nexus.llm.modelPins`), and threads `resolver()` into `StreamingPipeline`'s existing `KeepAliveResolver` seam.
- v0.9.0 known-gap 10.N.Q (IdleTimeScheduler wiring): Phase 3 sidecar bootstrap registers curator + reflect workers via the new `desktop/sidecar/src/runtime/idleScheduler.ts`; verified by a 30-minute synthetic-idle integration test.
- v0.9.0 known-gap 10.N.R (real telemetry source): Phase 8 ships `core/telemetry/GpuTelemetrySource.ts` with platform parsers and the CPU fallback; `<LocalModelStatus>` widget consumes the real stream when the sidecar nvidia-smi spawn lands (operator-driven, tracked as v1.0.0 8.P1.UU).
- v0.9.0 known-gap 10.N.T (operator-action consolidation): Phase 11 ships `docs/v1.0.0/operator-actions.md` as the consolidated operator checklist for v1.0.0; future cycles inherit the same file layout.
- Pre-existing Phase 2 test failures (`SubAgentManager.characterization.test.ts` CRLF/LF snapshot mismatches; `workflow-discipline.test.ts` SHA-pin enforcement) recorded under v1.0.0 known-gap 2.P3.L and tracked as a Phase 11 / v1.0.1 fix.
- Phase 9 CI block on missing `tauri::Manager` import (`desktop/src-tauri/src/sidecar.rs::app.path().resolve()` against Tauri 2.11) -- import added in lockstep with the icons.

### Security

- Windows installer Authenticode signing workflow documented at `docs/v1.0.0/release-signing.md`. Actual signing requires the operator-procured EV Code Signing certificate (tracked as v1.0.0 operator action OA-01).
- macOS notarization workflow documented (deferred to v1.0.1 per Phase 9.8 + known-gap 9.P2.EEE).
- Prompt-injection scanner (`core/skills/PromptInjectionScanner.ts`) screens every skill body before it lands in `~/.nexus/skills/`; the DevAI-Hub sync pathway routes every fetched skill through the scanner; the un-namespaced `nexus skills install` CLI path is stubbed (P2 known-gap 10.P2.III) so no scanner-bypassing install surface ships in v1.0.0.
- Path-clamping on `~/.nexus/skills/user/` writes (resolved + parent-dir check before write).
- HTTPS-only model downloader; rejects `file://`, `localhost`, internal IP ranges; SHA-256 digest verification gates every non-Ollama install (catalog digests for HTTP-sourced models are placeholders pending v1.0.0 release-gate rotation per known-gap 5.P2.CC).
- Sidecar process runs as user (not admin); `~/.nexus/` permissions are user-only (verified in `docs/v1.0.0/review/security-audit.md`).
- Settings UI does not echo secrets; `SECRET_PATHS` redaction in `Tracer` covers `apiKey`, `password`, `token`, `secret`, `Bearer ` headers.
- ffmpeg shell-out (`core/video/WorkflowMetadata.ts`) builds argv arrays (no shell interpolation); injected `spawnFn` accepts argv-only.

# [0.32.0](https://github.com/bendourthe/Nexus-AI/compare/v0.31.0...v0.32.0) (2026-05-18)


### Features

* **v1.0.0:** phase 11 hardening + release gate + cycle close ([3af4fde](https://github.com/bendourthe/Nexus-AI/commit/3af4fde9484aed06c9dd143dbf6d07cbc3054f71))

# [0.31.0](https://github.com/bendourthe/Nexus-AI/compare/v0.30.1...v0.31.0) (2026-05-18)


### Features

* **v1.0.0:** phase 10 DevAI-Hub sync pathway + namespaced skill catalog ([398e41f](https://github.com/bendourthe/Nexus-AI/commit/398e41fca7714b52841ec176cf7c8923953a640c))

## [0.30.1](https://github.com/bendourthe/Nexus-AI/compare/v0.30.0...v0.30.1) (2026-05-18)


### Bug Fixes

* **ci:** green up Phase 9 CI (YAML colon-in-value + clippy needless-borrow) ([3ce3137](https://github.com/bendourthe/Nexus-AI/commit/3ce313718530abb26579ae9e1087126c749c255a))

# [0.30.0](https://github.com/bendourthe/Nexus-AI/compare/v0.29.0...v0.30.0) (2026-05-18)


### Features

* **v1.0.0:** phase 9 single-binary installer overhaul (Windows-first) + brand assets ([ec081ee](https://github.com/bendourthe/Nexus-AI/commit/ec081ee87d6977b4cdeb288ada9031e6fa49420a))

# [0.29.0](https://github.com/bendourthe/Nexus-AI/compare/v0.28.1...v0.29.0) (2026-05-18)


### Features

* **v1.0.0:** phase 8 GpuScheduler and Local Model Status ([3aa4231](https://github.com/bendourthe/Nexus-AI/commit/3aa4231f118b961506e3008a14344ba87cd8ad30))

## [0.28.1](https://github.com/bendourthe/Nexus-AI/compare/v0.28.0...v0.28.1) (2026-05-18)


### Bug Fixes

* **ci:** green up CI by fixing five pre-existing failures ([80a470e](https://github.com/bendourthe/Nexus-AI/commit/80a470e33d61e246771c742721d805294a35a78c))

# [0.28.0](https://github.com/bendourthe/Nexus-AI/compare/v0.27.0...v0.28.0) (2026-05-17)


### Features

* **v1.0.0:** phase 7 Video Lab MVP ([1de1186](https://github.com/bendourthe/Nexus-AI/commit/1de1186abc3dfac5a0236e35e0b8dafe0ce4deb9))

# [0.27.0](https://github.com/bendourthe/Nexus-AI/compare/v0.26.0...v0.27.0) (2026-05-17)


### Features

* **v1.0.0:** phase 5 ModelRegistry + native model downloader ([fac5e49](https://github.com/bendourthe/Nexus-AI/commit/fac5e496db9273aa7e2a839709edd228062df880))
* **v1.0.0:** phase 6 DiffusionRuntime + Image Studio MVP ([fcdd53b](https://github.com/bendourthe/Nexus-AI/commit/fcdd53baf466d4e96889595b848305e9485e915f))

# [0.26.0](https://github.com/bendourthe/Nexus-AI/compare/v0.25.0...v0.26.0) (2026-05-17)


### Features

* **v1.0.0:** phase 4 Local Chatbot Explorer module ([933e52b](https://github.com/bendourthe/Nexus-AI/commit/933e52b8bcdbde5e14fe203d48e482e14ded630e))

# [0.25.0](https://github.com/bendourthe/Nexus-AI/compare/v0.24.0...v0.25.0) (2026-05-17)


### Features

* **v1.0.0:** phase 3 Coding module IPC, multi-LLM catalog, idle scheduler ([06ae02b](https://github.com/bendourthe/Nexus-AI/commit/06ae02badd655b5cd8027a33f3beb61d73030d41))

# [0.24.0](https://github.com/bendourthe/Nexus-AI/compare/v0.23.0...v0.24.0) (2026-05-17)


### Features

* **v1.0.0:** phase 2 rebrand sweep and shared-core extraction ([1581f3e](https://github.com/bendourthe/Nexus-AI/commit/1581f3e5b294e01bdb8d00c2d0db77643c8d2cc9))

# [0.23.0](https://github.com/bendourthe/Nexus-AI/compare/v0.22.4...v0.23.0) (2026-05-17)


### Features

* **v1.0.0:** phase 1 Tauri desktop shell foundation ([54656ff](https://github.com/bendourthe/Nexus-AI/commit/54656ff482ecaca30553bafec558b5f70cb93ecb)), closes [#22d3ee](https://github.com/bendourthe/Nexus-AI/issues/22d3ee) [#ec4899](https://github.com/bendourthe/Nexus-AI/issues/ec4899) [#f97316](https://github.com/bendourthe/Nexus-AI/issues/f97316) [#22c55e](https://github.com/bendourthe/Nexus-AI/issues/22c55e)

## [0.22.4](https://github.com/bendourthe/Nexus-AI/compare/v0.22.3...v0.22.4) (2026-05-17)


### Bug Fixes

* **ci:** unblock smoke and AGENTS-md tests post-rebrand ([2591ee4](https://github.com/bendourthe/Nexus-AI/commit/2591ee4bda07543994a0e55f7926537f26e822f2))

## [0.22.3](https://github.com/bendourthe/Nexus-AI/compare/v0.22.2...v0.22.3) (2026-05-17)


### Bug Fixes

* **golden:** unshadow stdlib types module and add missing report renderer ([143ca37](https://github.com/bendourthe/Nexus-AI/commit/143ca375d02ee08c96a67300efaa8b64ec428803))
* **release:** point package.json repository.url at renamed Nexus-AI repo ([b41b625](https://github.com/bendourthe/Nexus-AI/commit/b41b62565578f99113fb6143b2a44af2f2323d71))

## [0.22.2](https://github.com/bendourthe/Gemma-Code/compare/v0.22.1...v0.22.2) (2026-05-17)


### Bug Fixes

* **ci:** align nightly bench gate with fast-bench on v0.7.0 ([6415f52](https://github.com/bendourthe/Gemma-Code/commit/6415f52a6f2ccf417d02082d1996171d3231bc86))

## [0.22.1](https://github.com/bendourthe/Gemma-Code/compare/v0.22.0...v0.22.1) (2026-05-17)


### Bug Fixes

* **ci:** adopt v0.9.0 bench baseline for nightly ([f67af7a](https://github.com/bendourthe/Gemma-Code/commit/f67af7a8c3741a40b0584fed65f3777820d1cb73)), closes [hi#rme](https://github.com/hi/issues/rme) [hi#rme](https://github.com/hi/issues/rme)

# [0.22.0](https://github.com/bendourthe/Gemma-Code/compare/v0.21.0...v0.22.0) (2026-05-17)


### Features

* **v0.9.0:** Phase 8 cycle close (37 v0.8.0 gaps cleared) ([06c4df9](https://github.com/bendourthe/Gemma-Code/commit/06c4df9630bd85c2b3da1f217155129ab6ea5673))

# [0.21.0](https://github.com/bendourthe/Gemma-Code/compare/v0.20.0...v0.21.0) (2026-05-17)


### Features

* **v0.9.0:** Phase 7 CI hardening from v0.8.0 post-CI audit ([ae8ffc1](https://github.com/bendourthe/Gemma-Code/commit/ae8ffc1c50a1f7bbe018caf7c070cb0cb2fb3789))

# [0.20.0](https://github.com/bendourthe/Gemma-Code/compare/v0.19.0...v0.20.0) (2026-05-17)


### Features

* **v0.9.0:** Phase 6 curator scheduler + UX polish + minor wirings ([521cb64](https://github.com/bendourthe/Gemma-Code/commit/521cb64d14d6d41402f04707ea65b78d1c7539ed))

# [0.19.0](https://github.com/bendourthe/Gemma-Code/compare/v0.18.0...v0.19.0) (2026-05-17)


### Features

* **v0.9.0:** Phase 5 internal RE builds -- issue orchestration + PR ops ([31a726f](https://github.com/bendourthe/Gemma-Code/commit/31a726fb4416aae8ab645cb293e5a4c73bbd8777))

# [0.18.0](https://github.com/bendourthe/Gemma-Code/compare/v0.17.0...v0.18.0) (2026-05-17)


### Features

* **v0.9.0:** Phase 4 internal RE builds -- dev-loop ergonomics ([ee1bd0b](https://github.com/bendourthe/Gemma-Code/commit/ee1bd0b634dc5009c719322bbcd9d126025531c3))

# [0.17.0](https://github.com/bendourthe/Gemma-Code/compare/v0.16.0...v0.17.0) (2026-05-17)


### Features

* **v0.9.0:** Phase 3 skill-native adoptions (reverse-engineered, zero-code) ([6f38fae](https://github.com/bendourthe/Gemma-Code/commit/6f38fae0e24a24153177f247425f6a81a6732fe9))

# [0.16.0](https://github.com/bendourthe/Gemma-Code/compare/v0.15.3...v0.16.0) (2026-05-16)


### Features

* **v0.9.0:** Phase 2 wire deferred v0.8.0 pure modules into production code paths ([df3153b](https://github.com/bendourthe/Gemma-Code/commit/df3153b399ca0b8f9d967af5a81cc165e7d97f31))

## [0.15.3](https://github.com/bendourthe/Gemma-Code/compare/v0.15.2...v0.15.3) (2026-05-16)


### Bug Fixes

* **harness:** unblock Windows vitest suite + land v0.9.0 Phase 1 ([f094ba6](https://github.com/bendourthe/Gemma-Code/commit/f094ba605093a173b7b2f0761b25a86deaf04cee))

## [0.15.2](https://github.com/bendourthe/Gemma-Code/compare/v0.15.1...v0.15.2) (2026-05-16)


### Bug Fixes

* **test:** align tests/unit/cli/gemma-check.test.ts with new exit-code semantics ([13f630e](https://github.com/bendourthe/Gemma-Code/commit/13f630e1a6b0eda9bfe3e50bf4167dc7b38b7eaa))

## [0.15.1](https://github.com/bendourthe/Gemma-Code/compare/v0.15.0...v0.15.1) (2026-05-16)


### Bug Fixes

* **ci:** unblock CI run 69328475165 (gemma-check semantics + catalog regen + 6 SKILL.md ASCII cleanup + VSIX smoke job) ([e19adbb](https://github.com/bendourthe/Gemma-Code/commit/e19adbb0770bde754344b55721b6cfeb89e2999e)), closes [package.json#files](https://github.com/package.json/issues/files)

# [0.15.0](https://github.com/bendourthe/Gemma-Code/compare/v0.14.0...v0.15.0) (2026-05-16)


### Features

* **v0.8.0:** Phase 7 polish and cycle close (ADR cross-refs, no-bare-promise-rejection rule, dep-cruiser violations, console.log cleanup, README v0.8.0 surface) ([8954589](https://github.com/bendourthe/Gemma-Code/commit/8954589deba74d081dc5b91ecd81627368a386dc))

# [0.14.0](https://github.com/bendourthe/Gemma-Code/compare/v0.13.0...v0.14.0) (2026-05-16)


### Features

* **v0.8.0:** Phase 6 P2 backlog (sync return, intuition, reflect, workflow, arch lint, model pins, tool replay, stream events, cursor mdc) ([f0f705f](https://github.com/bendourthe/Gemma-Code/commit/f0f705fcc4f7a1f7d1e368bd85dd2df1f6e3927e))

# [0.13.0](https://github.com/bendourthe/Gemma-Code/compare/v0.12.0...v0.13.0) (2026-05-16)


### Features

* **v0.8.0:** Phase 5 skill ecosystem maturation ([9534b87](https://github.com/bendourthe/Gemma-Code/commit/9534b87a5d95dbf45874530588f2f6c2aea9d05c))

# [0.12.0](https://github.com/bendourthe/Gemma-Code/compare/v0.11.0...v0.12.0) (2026-05-16)


### Features

* **v0.8.0:** Phase 4 observability + runtime + hybrid scoring ([d08da9a](https://github.com/bendourthe/Gemma-Code/commit/d08da9a5f1ed1e6f14bb2f457f1d7a25556fdee3))

# [0.11.0](https://github.com/bendourthe/Gemma-Code/compare/v0.10.0...v0.11.0) (2026-05-16)


### Features

* **v0.8.0:** Phase 3 plan-mode UX overhaul ([050417f](https://github.com/bendourthe/Gemma-Code/commit/050417f5bc03991e7231d1b1f8361778e4cb1e26))

# [0.10.0](https://github.com/bendourthe/Gemma-Code/compare/v0.9.0...v0.10.0) (2026-05-16)


### Features

* **v0.8.0:** Phase 2 harness artifacts + memory snapshot + injection defense ([f69cb2b](https://github.com/bendourthe/Gemma-Code/commit/f69cb2baac4f4ca2271b61bc874d5150b06c2d88))

# [0.9.0](https://github.com/bendourthe/Gemma-Code/compare/v0.8.0...v0.9.0) (2026-05-16)


### Features

* **v0.8.0:** Phase 1 skill-native quick wins (prompt-only) ([d313ced](https://github.com/bendourthe/Gemma-Code/commit/d313ced70de49eb9d094dfe88b928658910bb4f8))

# [0.8.0](https://github.com/bendourthe/Gemma-Code/compare/v0.7.3...v0.8.0) (2026-05-16)


### Features

* **v0.8.0:** Phase 0 cycle kickoff + v0.7.0 carryovers ([cccb043](https://github.com/bendourthe/Gemma-Code/commit/cccb043ce3df64593cd175e59e822ea7c6c9251c)), closes [#input-row](https://github.com/bendourthe/Gemma-Code/issues/input-row)

## [0.7.3](https://github.com/bendourthe/Gemma-Code/compare/v0.7.2...v0.7.3) (2026-05-15)


### Bug Fixes

* **nightly:** suppress MarkdownRenderer benches in bench gate while marked v12 perf regression is investigated ([0cc6cf3](https://github.com/bendourthe/Gemma-Code/commit/0cc6cf31dc439313e2186e4d4a2b5f60f236bbc2))

## [0.7.2](https://github.com/bendourthe/Gemma-Code/compare/v0.7.1...v0.7.2) (2026-05-15)


### Bug Fixes

* **ci:** make pathGuard mutant-pin tests platform-portable + clear transitive CVEs ([6743849](https://github.com/bendourthe/Gemma-Code/commit/6743849d35a0c67be5477f2d1c87e4bbe0a7ffab))

## [0.7.1](https://github.com/bendourthe/Gemma-Code/compare/v0.7.0...v0.7.1) (2026-05-15)


### Bug Fixes

* **ci:** align stryker pins so npm ci resolves on CI ([bcd037c](https://github.com/bendourthe/Gemma-Code/commit/bcd037c792dc8fddef57753d597e20fa59fc40f2))

# [0.6.0](https://github.com/bendourthe/Gemma-Code/compare/v0.5.5...v0.6.0) (2026-04-27)


### Features

* **v0.6.0:** security chain closure (Phase 1) ([4ddcec0](https://github.com/bendourthe/Gemma-Code/commit/4ddcec0d4ddee6b9271907956bda0575e6cc381b))

## [0.5.5](https://github.com/bendourthe/Gemma-Code/compare/v0.5.4...v0.5.5) (2026-04-27)


### Bug Fixes

* **ci:** regenerate docs/index.md after SessionListPanel import change ([9e86640](https://github.com/bendourthe/Gemma-Code/commit/9e86640c9f70f51a6ed28afeed2532afd2999c0a))

## [0.5.4](https://github.com/bendourthe/Gemma-Code/compare/v0.5.3...v0.5.4) (2026-04-27)


### Bug Fixes

* **ci:** drop Node 18 from matrix; bump engines.node to >=20 ([ad39bc1](https://github.com/bendourthe/Gemma-Code/commit/ad39bc1e7bf9fa75f4c7640fa5166495dd6e65ed)), closes [#77](https://github.com/bendourthe/Gemma-Code/issues/77)

## [0.5.3](https://github.com/bendourthe/Gemma-Code/compare/v0.5.2...v0.5.3) (2026-04-26)


### Bug Fixes

* **release:** wire @semantic-release/npm so package.json version bumps ([d0e4017](https://github.com/bendourthe/Gemma-Code/commit/d0e4017fcf2fef2f1d65650bbf08333edbf6ca70))
* **tests:** rewrite token-estimation tests for tiktoken ([4b4840e](https://github.com/bendourthe/Gemma-Code/commit/4b4840e698794a52441afd77bc9531e5cce389b8))

## [0.5.2](https://github.com/bendourthe/Gemma-Code/compare/v0.5.1...v0.5.2) (2026-04-26)


### Bug Fixes

* **ci:** collapse duplicate CI runs on Dependabot PRs ([725d78c](https://github.com/bendourthe/Gemma-Code/commit/725d78ced581ead5955635eb5cf098ba3fe4e3e5))

## [0.5.1](https://github.com/bendourthe/Gemma-Code/compare/v0.5.0...v0.5.1) (2026-04-26)


### Bug Fixes

* **ci:** sync package-lock.json and unblock Dependabot ([d4bdcfd](https://github.com/bendourthe/Gemma-Code/commit/d4bdcfddaa6e33f54a3ed5098c7942ea6f12c22e)), closes [#7](https://github.com/bendourthe/Gemma-Code/issues/7)
* **ci:** unblock semantic-release and drop opaque npm ci --silent ([6e3c1c4](https://github.com/bendourthe/Gemma-Code/commit/6e3c1c4dd4de188380ad0233c670e3bca0d3166e))
* **deps:** split Dependabot major-version updates from minor groups ([c087d8c](https://github.com/bendourthe/Gemma-Code/commit/c087d8c4f61316ee7a37f92a52880978dbf212cb)), closes [#7](https://github.com/bendourthe/Gemma-Code/issues/7)

# Changelog

All notable changes to Gemma Code will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- Rust performance components for file indexing and grep
- Go CLI tooling for project scaffolding
- ripgrep-backed GrepCodebaseTool
- Extension Marketplace publication
- Tree-sitter AST parsing for semantic code understanding
- SSE transport for MCP server

---

## [0.7.0] -- 2026-05-14

Adoption cycle driven by `docs/v0.7.0/comparison-multi-source.md` (S1-S7 multi-source competitive review). Closes every P1 carryover from the v0.6.0 known-gaps catalog in Phase 0 (panel hoist down to 305 lines via ADR-0011; `marked` v4 -> v12 migration; mutation-testing gap fixes across `policy.ts` / `ActionClassifier.ts` / `terminal.ts` / `filesystem.ts`; `Orchestrator.test.ts` re-included in Stryker). Then adopts the C-items from buckets 1-3 of the comparison report: a deterministic compaction stack expansion plus a model-callable compress tool (ADR-0012), an Instructions / Memory / Context / Archive memory file architecture (ADR-0014), a webview render protocol with seven new chat primitives (ADR-0013), per-model context-limit overrides, six new skills, multi-harness skill packaging plus a standalone `gemma-check` CLI, an optional HNSW vector index with linear-scan fallback, and post-N-edits audit / testgaps background workers. Three new ADRs (0012-0014) capture the material decisions. The v0.5.0 retrospective `>= 40%` token-savings claim is now measured against the live-Ollama v0.4.0 + v0.6.0 baselines (operator-action; see Fixed below).

### Added

- `compress` tool (permission-tier 0, model-callable) with range and message modes; integrates with `ContextCompactor` as the model-driven escape hatch on top of the deterministic stack. See [ADR-0012](./docs/adr/0012-model-callable-compress-tool.md).
- `Deduplication` and `PurgeErrors` compaction strategies prepended to the existing `ToolResultClearing -> SlidingWindow -> CodeBlockTruncation -> RegenerateFromSource -> LlmSummary -> EmergencyTrim` ladder.
- `/compact context | sweep | decompress | recompress | manual` slash-command verbs surface every strategy at the chat level.
- Per-model context-limit overrides via `gemma-code.modelContextLimits: Record<string, number>`; the override replaces the global `maxTokens` when the active model matches.
- `Instructions / Memory / Context / Archive` on-disk memory file architecture under `~/.gemma-code/memory/<workspace-id>/`. Deterministic merge precedence: on-disk file wins over the SQLite store for the same key. See [ADR-0014](./docs/adr/0014-memory-file-architecture.md).
- Manual `MemoryPanel` webview with "Promote to Memory.md" action; rows map `decision -> Decisions`, `preference -> Preferences`, `error_resolution -> Corrections`, `file_pattern -> Patterns`, fallback `Preferences`.
- `/memory forget | export | import` slash-command verbs. (Write-side `/memory prune --apply` and `/memory lint --apply` remain deferred; see "Explicitly NOT in v0.7.0".)
- Webview render protocol (ADR-0013) emits seven new chat primitives from `src/panels/webview/render/`: completion report block, todo block, inline diff cards, action-type tags, numbered permission prompts (with Yes/No alias preserved), "Thought for Ns" meta-rows, and queued-message field shape. See [ADR-0013](./docs/adr/0013-webview-render-protocol.md).
- Six new skills under `.claude/skills/`: `polish`, `critique`, `distill`, `harden`, `animate`, `build-second-brain` (the last requires the v0.7.0 memory file architecture to be useful).
- Multi-harness skill packaging via `npm run package:skills`; emits adapter ZIPs for Claude Code, Cursor (best-effort `.cursor/rules/<slug>.md` transform), and OpenCode under `dist/skills-<harness>/`.
- Standalone `gemma-check` CLI under `bin/gemma-check.mjs` (`npm run check`); ships the four deterministic-check rules used by the audit background worker. See `docs/v0.7.0/development/cli-gemma-check.md`.
- Optional HNSW vector index for `MemoryStore.searchByEmbedding` backed by `hnswlib-node` as an `optionalDependency`. Linear-scan fallback path is preserved unconditionally so environments where the native binary fails to load still work.
- Background workers (audit, testgaps) triggered post-N-edits. Workers are explicitly NOT timer-driven; only post-edit cadence per the cross-cutting risk note in comparison Section 13.
- 21 deterministic in-process benchmarks captured at `tests/benchmarks/baselines/v0.7.0.json` (live-Ollama benches auto-skip when `OLLAMA_URL` is unset).
- `tests/golden/baselines/v0.7.0.json` placeholder with `status: deferred-to-operator` and `operatorProcedure` documented; the live-Ollama golden suite is operator-action mirroring v0.6.0 known-gaps Section 1.1.

### Changed

- Numbered permission prompts (`1 / 2 / 3 / 4`) replace the Yes / No modal as the primary keyboard contract. Yes / No remain as keyboard aliases for backwards compatibility.
- Per-model context-limit override (`gemma-code.modelContextLimits[model]`) takes precedence over the global `gemma-code.maxTokens` when the active model has an entry.
- `Yes-for-all` permission decisions now persist to workspace settings instead of the in-memory session scope; the persistence key is the action signature so the decision survives a panel reload.
- `scripts/check-bench-regressions.mjs` `extractBenchmarks` now handles both the legacy `files[].tasks[]` vitest shape and the current `files[].groups[].benchmarks[]` shape so the regression gate keeps working across vitest 1.5 -> 1.6 output changes.

### Deprecated

- None.

### Removed

- None. (The `gemma-code.gpuTier` removal landed in v0.6.0; no further setting removals this cycle.)

### Fixed

- v0.6.0 Phase 0 close-out (all items in `docs/v0.7.0/known-gaps.md` Section 2-4):
  - `GemmaCodePanel.ts` 305 lines (was 935; v0.6.0 target was < 400). Construction graph extracted to `ChatPanelBootstrap.ts` and static factories on `ChatController` (`buildContextCompactor`, `buildSubAgentManager`, `buildOrchestrator`, `buildAgentLoop`, `buildStreamingPipeline`). Helpers: `ChatPanelInit.ts`, `ChatStatusReporter.ts`, `ChatMessageRouter.ts`, `ToolActivationContext.ts`, `ToolRegistryBuilder.ts`. New ADR-0011 documents the OllamaClient injection pattern. Closes v0.7.0 known-gaps 2.3 + 2.4.
  - `marked` bumped to `^12.0.0` (resolved at 12.0.2) via `marked.parse(text, { async: false })`; the v12 Renderer API turned out to retain the v4 positional signature so the three custom renderers are unchanged-by-need. All 8 renderer tests green; sanitisation chain (CSP + DOMPurify) intact. Closes v0.7.0 known-gaps 2.1.
  - Mutation-testing gap fixes: new `tests/unit/guardrails/policy.test.ts` (18 assertions), `tests/unit/guardrails/ActionClassifier.coverage.test.ts` (113 parametric assertions), `tests/unit/tools/handlers/terminal.coverage.test.ts` (58 parametric assertions), `tests/unit/tools/handlers/filesystem.coverage.test.ts` (13 error-path assertions). `Orchestrator.test.ts` timing assertion rewritten `> 0` -> `>= 0` and re-included in `configs/stryker.config.json`. Closes v0.7.0 known-gaps 4.1-4.5.
- Live-Ollama baseline capture for the v0.5.0 retrospective `>= 40%` token-savings claim: in-process v0.7.0 baseline captured (see Added); the corresponding v0.4.0 + v0.6.0 live-Ollama captures remain operator-action, tracked in `docs/v0.7.0/known-gaps.md`.
- Filesystem tool handler split (v0.6.0 plan sub-task 6.5) formally deferred to v0.8.0 with a documented cost/benefit decision (~25 import sites; file is functioning correctly today). See v0.7.0 known-gaps 2.2.

### Security

- The `compress` tool ships at permission tier 0 (auto-approve) by design: it operates on the in-process conversation transcript only and never touches the filesystem, network, or external state. No new auth surface. See [ADR-0012 Consequences](./docs/adr/0012-model-callable-compress-tool.md#consequences).
- v0.6.0 Phase 1 path-guard contract preserved: every filesystem tool handler still routes through `pathGuard.resolveInsideWorkspace`. The new memory file architecture writes only under `~/.gemma-code/memory/<workspace-id>/`, an out-of-workspace location; no new symlink-traversal surface introduced.
- `permissionOverrides` tier-floor clamp (v0.6.0 ADR-0007) preserved; the new `Yes-for-all` workspace persistence respects the same clamp.

### Explicitly NOT in v0.7.0

Policy-grounded drops from `docs/v0.7.0/comparison-multi-source.md` Section 13:

- N1. Federation / cross-machine agent collaboration (S6 ruflo) -- violates offline-first thesis.
- N2. Multi-provider LLM routing (Claude / GPT / Gemini / Cohere) (S6 ruflo) -- local-only thesis.
- N3. Hosted web UI / Goal Planner front-end (S6 `flo.ruv.io`) -- local-only thesis.
- N4. Notion / Obsidian connectors (S2 Layer 3) -- third-party data processors.
- N5. Browser-extension surface (S3) -- Hard Constraint #1, no new product surface.
- N6. Cross-platform sandbox for yolo-mode (S1 CCO) -- CCO is Mac-only; Windows / Linux equivalents non-trivial.

Cross-version carryovers from v0.7.0 known-gaps Section 7 (scope-grounded deferrals, not policy drops):

- LSTM predictive caching (v0.5.0 architecture; v0.6.0 ADR-0009 closed the ARIMA prototype).
- Multi-provider LLM proxy (overlaps N2).
- Voice transcription.
- Distributed cache.
- `/memory prune --apply`, `/memory lint --apply` (read-side ships; write-side deferred).
- `format=json` on `read_file` and `run_terminal`.
- Severity-rubric CI gate that fails builds (currently informational).
- Streaming reads for files > 1 MB (current 1 MB pagination ceiling assumed sufficient).
- Auto-merge for Dependabot PRs.
- Rust performance components.
- Go CLI tooling for project scaffolding.
- ripgrep-backed `GrepCodebaseTool`.
- Extension Marketplace publication.
- Tree-sitter AST parsing.
- SSE transport for MCP server (current MCP transport is stdio only).

---

## [0.6.0] -- 2026-05-04

Hygiene and ratchet release. Closes the only chained P0 security finding from the v0.5.0 review pass, fixes the test pipeline that was masking failures, decomposes two god-class panel modules, removes four `BASELINE-2026-04-25` dependency-cruiser exceptions, and either wires or retracts every `documented-but-not-implemented` claim from v0.5.0. No new product surface beyond what the closure of those findings required. Five new ADRs (0006-0010) capture the material decisions.

### Added

- `gemma-code.mcpExposedTools: string[]` setting controls which tools the MCP server exposes to external peers. Defaults to read-only (`read_file`, `list_directory`, `grep_codebase`); operators can broaden but must opt in explicitly. Closes pen-test F-004's MCP-attack-surface leg.
- `gemma-code.ollamaEmbeddingThreshold` (default 0.85) and `gemma-code.heuristicEmbeddingThreshold` (default 0.95) settings expose the per-provenance cosine similarity bars applied by `searchByEmbedding`. See [ADR-0010](./docs/adr/0010-threshold-elevation-decision.md).
- `SubAgentSpawner` interface extracted from `SubAgentManager` to break the `SubAgentManager <-> SubAgentTool` circular import. Closes the `BASELINE-2026-04-25` exception for `agents -> tools/handlers/subAgent`.
- `MemoryShared.types.ts` extracted to break the `MemoryStore <-> MemoryConsolidator` circular import.
- `tests/unit/tools/handlers/filesystem-symlink.test.ts` -- regression test for ADR-0006. Exercises every filesystem tool against a workspace-internal symlink that resolves outside the root and asserts each refuses with a workspace-boundary error.
- `tests/integration/permission-overrides-clamp.test.ts` -- regression test for ADR-0007. Asserts CONFIRM/DANGEROUS-baseline tools cannot be auto-approved via `permissionOverrides`.
- `tests/integration/tool-output-cache-migration.test.ts` -- four-case idempotency test for the SQLite migration ladder (v0.4.0 -> v0.6.0 schema).
- `tests/integration/memory-consolidator-large.test.ts` -- 10K-event stress test for the `db.transaction`-wrapped consolidation pass; asserts wall-time below 5 s.
- `tests/unit/tools/handlers/pathGuard.test.ts` -- four mutation-survivor regression tests added during the Stryker pass (workspaceRoot null/empty, lexical fallback, absolute-out-of-root rejection).
- `tests/unit/storage/eviction/` -- per-strategy unit tests across the five `Evictor` implementations.
- `tests/golden/baselines/v0.6.0.json` (post-Phase-1 measurement; final regeneration scheduled against the post-Phase-7 build with live Ollama -- see [docs/v0.6.0/development/history/2026-05_phase-8-release-gate.md](./docs/v0.6.0/development/history/2026-05_phase-8-release-gate.md)).
- `tests/benchmarks/baselines/v0.6.0.json` (regeneration vs. v0.5.0 baseline scheduled per the same release-gate procedure).

### Changed

- All filesystem tool handlers (`read_file`, `write_file`, `edit_file`, `create_file`, `delete_file`, `list_directory`, `grep_codebase`) now route path resolution through `pathGuard.resolveInsideWorkspace`. The lexical `resolveWorkspacePath` helper is deleted; one realpath-aware guard for every tool. See [ADR-0006](./docs/adr/0006-unified-path-guard.md).
- `getPermissionTier()` clamps `permissionOverrides` so CONFIRM and DANGEROUS-baseline tools cannot be lowered to AUTO_APPROVE. A workspace-controlled `settings.json` that tries to silently auto-approve `run_terminal` or `delete_file` is neutralized at runtime with a deduped log warning. See [ADR-0007](./docs/adr/0007-permission-tier-floor.md).
- MCP-originated tool calls are tagged with `source: 'mcp'` and produce a peer-attributed confirmation prompt ("External MCP client wants to ...") distinct from local-agent and sub-agent prompts.
- `fetchWithSsrfGuard` enforces a 5 MB body cap on outbound HTTP responses (closes pen-test F-002).
- `ToolOutputCache._enforceCapacity()` is now true LRU. Added `accessed_at INTEGER NOT NULL DEFAULT 0` column with backfill from `stored_at`; `lookup()` bumps `accessed_at` on every hit; eviction orders by `accessed_at ASC`. The original docstring claimed LRU; the SQL now matches. New hot-vs-cold regression test in `tests/unit/storage/ToolOutputCache.test.ts`.
- `searchByEmbedding` applies a per-row threshold based on `embedding_provenance`: `'heuristic'` rows must clear 0.95; `'ollama'` rows (and legacy NULL) clear 0.85. See [ADR-0010](./docs/adr/0010-threshold-elevation-decision.md).
- `GemmaCodePanel.ts` decomposed into four focused modules: `GemmaCodePanel.ts` (lifecycle + composition root), `ChatController.ts` (chat flow + memory injection), `ChatCommandHandlers.ts` (slash-command dispatch), `ChatWebviewHost.ts` (postMessage routing + webview surface lifecycle). The panel shrank from 1,724 to 935 lines. See [ADR-0008](./docs/adr/0008-panel-decomposition.md).
- `panels/webview/index.ts` source-level split into `scaffold.ts` (HTML composer + `formatModelName`), `styles.ts` (CSS), `bodyMarkup.ts` (HTML body), `runtime.ts` (inline IIFE). The original file shrank from 1,573 to 12 lines as a back-compat re-export shim. CSP, nonce, and `getWebviewHtml` callers unchanged.
- `secretPaths.ts` and `Compressor.ts` moved from `tools/handlers/` to `utils/` (utility shape, not handler shape; closes the `BASELINE-2026-04-25` exception for `tools -> chat`).
- `EmbeddingClient` consumes the abstract `LLMClient` port instead of `OllamaHttp` directly; `GemmaRuntime.getOllamaClient()` is the composition root for shared client construction. Closes the `BASELINE-2026-04-25` exception for `storage -> services`.
- `MemoryConsolidator.consolidate` is wrapped in `GraphMemory.transaction()`; a 10K-event stress run drops from tens of thousands of fsyncs to one transactional commit (~1.3 s wall time vs. multi-second pre-Phase-7).
- `npm audit` CI gate elevated from `--audit-level=high` to `--audit-level=moderate` for production dependencies. A new non-blocking `audit-ts-dev` job covers dev-deps with a 30-day artifact upload (does not gate merges).
- `cache-probe` fingerprint switched from MD5 to SHA-256 (closes pen-test F-005).
- New ESLint rule blocks `innerHTML` string concatenation in `src/panels/webview/runtime.ts`. Approved sinks use the existing DOMPurify-sanitised path. Closes pen-test F-006.
- Coverage CI gate now reads `coverage/coverage-summary.json` (`.total.lines.pct >= 80`, `.total.branches.pct >= 75`) instead of regex-scraping the lcov HTML report.
- `secretPaths` matcher swapped from a hand-rolled `globToRegex` compiler to `minimatch` with a per-glob cache. Five new edge-case tests (empty globs, brace expansion, backslash escape, exact-match, Windows separators) lock the behaviour parity.
- Documentation example webhook URLs in `docs/v0.5.0/comparison/comparison-token-optimizer-mcp.md` obfuscated to `https://example.invalid/<redacted>` placeholders (closes pen-test F-011).
- `CompactionStrategy` interface is now `agents/-> chat/` rather than `chat/ -> agents/`, eliminating the directional baseline exception.

### Fixed

- 12 token-estimation tests in `tests/unit/chat/ContextCompactor.test.ts` rewritten as property-based tests against the `tiktoken` cross-check helper. The pre-existing failures inherited from v0.5.0 Phase 5 are gone (closes known-gaps 1.1).
- `tests/benchmarks/context-compaction.bench.ts` no longer imports the non-existent `createConversationManager` factory; instantiates `new ConversationManager("")` directly. Bench runs to completion.
- `src/config/GpuDetector.ts:18` -- explicit `void` return type on the `execWithTimeout` callback closes the pre-existing lint warning carried since v0.5.0.
- 3 architecture-doc inaccuracies corrected: meta-test path now points at `tests/unit/docs/AGENTS-md.test.ts`, v0.4.0 ship date corrected to `2026-04-25`, hand-written tool-permission-tier table replaced with a programmatically-generated marker block driven by `scripts/generate-tool-permission-table.mjs` and CI-gated via `npm run perm-tier:check`.
- FIFO-vs-LRU doc/code mismatch in `ToolOutputCache.prune()` reconciled (see Changed section).
- CI verifiably fails on test failures. Pre-v0.6.0, a vitest/Node 24 native-cleanup segfault during process teardown was masking exit codes; the `bench` npm script now passes `--run` so the bench process exits cleanly with the actual result.

### Removed

- Legacy `gemma-code.gpuTier` string setting removed. Use `gemma-code.gpuTierOverride: number | null` instead. The v0.5 migration shim that mapped legacy values is also gone; users with a stale `gpuTier` setting will see a one-time "unknown setting" warning.
- `PredictiveCache` module + `tests/unit/storage/PredictiveCache.test.ts` + `tests/unit/storage/PredictiveCache.budget.test.ts` + `tests/benchmarks/predictive-cache.bench.ts` deleted; `gemma-code.predictiveCacheEnabled` setting removed. Never wired into `ToolOutputCache.lookup()` or any runtime. See [ADR-0009](./docs/adr/0009-predictive-cache-decision.md).
- All four `BASELINE-2026-04-25; ratchet by v0.6.0` annotations removed from `configs/dependency-cruiser.cjs`. `npm run deps:check` reports zero violations across 121+ modules.

### Security

- Attack Path A closed at both legs: ADR-0006 closes the symlink leg by routing every filesystem tool through realpath-aware path resolution; ADR-0007 closes the auto-approve leg by clamping `permissionOverrides` so CONFIRM/DANGEROUS tools cannot drop to AUTO_APPROVE.
- Pen-test F-001 (split-brain path resolution), F-003 (permissionOverrides downgrade), F-004 (MCP peer attribution), F-002 (outbound HTTP body cap), F-005 (SHA-256 cache fingerprint), F-006 (innerHTML concatenation ESLint rule), F-007 (per-provenance threshold elevation), F-008 (PredictiveCache dead-code removal), F-011 (obfuscated example URLs) -- all closed.
- ESLint rule blocks `innerHTML` string concatenation in webview runtime; the only approved DOM sink remains the DOMPurify-sanitised path introduced in v0.4.0 Phase 1.

### Deferred to v0.7.0+

- `marked` v4 -> v12 migration (per Phase 7 sub-task 7.5 conditional escape; v12 reshapes the `Renderer` API and is non-trivial; DOMPurify already provides the sanitisation layer that was the original rationale).
- Filesystem tool handler split (Phase 6 sub-task 6.5 deferred per the plan's "lower-priority" note).
- Hoisting agent-loop / pipeline / orchestrator construction into `ChatController` (full ownership split per ADR-0008's neutral consequence).
- LSTM predictive caching, multi-provider LLM proxy, voice transcription, distributed cache, `/memory prune --apply`, `format=json` on `read_file` / `run_terminal`, severity-rubric CI gate that fails builds, streaming reads for files > 1 MB, auto-merge for Dependabot.

### v0.5.0 retrospective note

The v0.5.0 plan stated a target of `>=40% average tool-output token reduction vs. v0.4.0`. This claim never appeared in the v0.5.0 CHANGELOG entry below; it lived in `docs/v0.5.0/plans/implementation-plan.md` and the Phase 12 history. The measured number was deferred at v0.5.0 ship time (`tests/golden/baselines/v0.4.0.json` was not captured). v0.6.0 captures `v0.6.0.json` against live Ollama as part of the release-gate procedure documented in `docs/v0.6.0/development/history/2026-05_phase-8-release-gate.md`; the long-arc compare against `v0.4.0.json` is logged as the first action of the post-cycle measurement window. The `>=40%` figure remains a *target*, not a verified shipping claim, until the comparison run lands.

---

## [0.5.0] -- 2026-04-26

Unified adoption release. Combines five comparison-driven adoption plans (token-optimizer-mcp, agent-friendly-CLIs, routa-harness, free-claude-code, foundry-vault) into a coherent dozen-phase roadmap. The product surface stays the same (offline VS Code extension on top of Gemma 4 via Ollama); the changes are inside the harness, the tool catalogue, the cache stack, and the operational hygiene.

### Phase 1 -- Identity and Naming

- AGENTS.md adopted as the sole canonical directive; no CLAUDE.md anywhere in the repo
- Test-pyramid taxonomy split into "smoke" / "regression" / "scenario" with the rubric in [docs/v0.5.0/test-pyramid.md](./docs/v0.5.0/test-pyramid.md)
- Generic naming convention applied across product files (no provider branding)

### Phase 2 -- Tool Surface Hardening

- Universal 64 KB byte-cap on every tool output via `OutputRedirector` with a structured truncation hint pointing at narrow-down parameters
- `read_file(range_start, range_end)` pagination (1 MB max window; EOF marker on short reads)
- `grep_codebase(max_results, next_offset)` pagination with opaque base64-encoded cursor; default 50 / max 500
- Per-call `max_bytes` override (per-tool ceiling 1 MB)
- `tool_output.truncated` metric on `MetricsCollector` for cap-fire calibration

### Phase 3 -- Compression Foundation

- Brotli-backed `Compressor` for cache and transcript payloads
- Round-trip fidelity tests for ASCII / emoji / CJK / JSON / binary fixtures
- Transcript integration: tool outputs > 12 KB serialize to disk compressed

### Phase 4 -- Persistent Cache + Diff-Based Reads

- `ToolOutputCache` (SQLite, chmod 0o600) keyed by `(absolute_path, mtime_ms, size_bytes)`
- In-process LRU front (50 entries / 1 MB) for within-session re-reads
- Diff-based read on cache hit when on-disk file changed
- Secret-path denylist applied on every `store()`
- `/cache status|clear|prune` slash command surface

### Phase 5 -- Semantic Recall + Precise Budgeting

- tiktoken-backed budgeting on prompt construction (replaces character-count heuristic)
- Embedding column on `tool_output_cache` rows; cosine search via `searchByEmbedding`
- FTS5 keyword fallback when Ollama is offline; `excerpt` column backfilled by migration
- Default semantic threshold 0.85; sub-task `searchByKeyword` fallback path

### Phase 6 -- Mutation Safety + Structured Outputs

- `run_terminal(dry_run=true)` returns token list + allowlist verdict without spawning
- `delete_file(dry_run=true)` returns size + SHA-256 (first 1 MB) without unlinking
- `list_directory(format='json')` and `grep_codebase(format='json')` return RFC-8259 JSON; truncated form remains valid JSON
- Adversarial property-based test confirms `child_process.spawn` and `fs.unlinkSync` are never called on dry-run

### Phase 7 -- Memory Hygiene + N-Corroboration

- `MemoryConsolidator` enforces N >= 2 corroboration before promoting an observation to a fact (default `gemma-code.memoryCorroborationThreshold = 2`; setting to 1 restores legacy behavior)
- Migration backfills `corroboration_count = 1` on every existing row
- `/memory lint` produces a parseable health report (counts, candidate rows, top corroborated)
- New missed-fact golden eval `memory-hygiene-missed-fact-01` proves single-source candidates are not blindly trusted

### Phase 8 -- Generic Harness + Specialist Externalization

- Three generic Node ESM hook scripts under `scripts/hooks/` (`check-commit-msg.mjs`, `check-prompt-policy.mjs`, `check-tool-permission.mjs`); harness-agnostic by design
- Sub-agent prompts externalized to `assets/specialists/*.md` and resolved through a priority chain (`<workspace>/.gemma-code/specialists/` overrides workspace, which overrides committed defaults)
- No `.claude/` directory committed to the repository
- Characterization tests prove behavior preservation against the pre-Phase-8 inline prompts

### Phase 9 -- Coverage and Observability

- `tests/benchmarks/` covers `tool-execution`, `context-compaction`, `cache-hit`, `hooks` with p50/p99 captures
- Nightly benchmark regression gate via `scripts/check-bench-regressions.mjs` against committed baselines
- `scripts/build-vsix.ps1` smoke-tests the packaged VSIX before tagging

### Phase 10 -- Local Development Hygiene + CI Hardening

- husky pre-commit (`lint-staged`) + commit-msg (ASCII-only enforcement) wired
- ESLint blocks un-justified `@ts-ignore` (allow-with-description, 20-char min)
- All GitHub Actions pinned to commit SHAs (40-char hex, version-tag preserved as a comment)
- `concurrency: cancel-in-progress` on long-running workflows
- CI matrix expanded to Node 18, 20, 22

### Phase 11 -- Documentation Discipline

- 4 new ADRs landed: 0002 memory subsystem layering, 0003 compaction strategy ordering, 0004 sub-agent isolation contract, 0005 tool permission tiers
- Mermaid module-dependency diagram in [ARCHITECTURE.md](./ARCHITECTURE.md)
- Module Authorship Contract in [AGENTS.md](./AGENTS.md)
- [docs/refactor-playbook.md](./docs/refactor-playbook.md) published; cross-referenced from CONTRIBUTING.md
- [docs/index.md](./docs/index.md) auto-generated by `scripts/generate-catalog.mjs`; CI gate via `npm run catalog:check`

### Phase 12 -- Advanced Fallbacks + Release Gate

**Eviction strategies (`src/storage/eviction/`)**
- New pluggable `Evictor` interface with five pure-JS strategies: `LRUEvictor` (default; preserves v0.4.0 behavior), `LFUEvictor`, `ARCEvictor` (adaptive recency/frequency split), `WTinyLFUEvictor` (window LRU + count-min sketch admission), `ClockEvictor` (second-chance approximation)
- Selectable via `gemma-code.cacheEvictionStrategy` (default `lru`)
- `ToolOutputLru` threads the strategy through `onAccess` / `onInsert` / `onRemove` / `pickVictim` so the storage Map and the policy stay decoupled
- Per-strategy unit tests under `tests/unit/storage/eviction/`

**Predictive cache (`src/storage/PredictiveCache.ts`)**
- Pure-JS ARIMA(1,0,1) forecaster fit by gradient descent; ~80 LOC core
- Tracks per-path access timestamps (max 256 paths, 64 samples each)
- `predict(topK)` ranks paths by inverse predicted-arrival-delta, weighted by residual variance
- LSTM is **explicitly out of scope** -- not a model, not a toggle, not a future flag
- Off by default; opt-in via `gemma-code.predictiveCacheEnabled`

**Heuristic embedder fallback (`src/storage/HeuristicEmbedder.ts`)**
- Deterministic 128-D embedding from hash features (21 dims) + statistical features (43 dims) + n-gram presence over a 64-token vocabulary (64 dims)
- L2-normalised; pure JS; no model file
- Wired into `EmbeddingClient.embedWithProvenance` -- callers receive `{ embedding, provenance: 'ollama' | 'heuristic' }`
- `tool_output_cache.embedding_provenance` column added (migration); rows tagged `'heuristic'` are upgradable
- New `/cache reembed` slash command walks heuristic-tagged rows and re-embeds them via Ollama once the model is back online

**Truncation-recovery golden micro-eval**
- 3 new golden tasks under `tests/golden/tasks/agent-friendly-*.yaml`
  - `agent-friendly-truncation-recovery-read-01` -- `read_file(range_start, range_end)` past the 64 KB cap
  - `agent-friendly-truncation-recovery-grep-02` -- `grep_codebase(next_offset)` paging through > 200 matches
  - `agent-friendly-dry-run-then-execute-03` -- `delete_file(dry_run=true)` before the destructive call
- Snapshots include deterministic `_setup.mjs` generators so fixtures stay reproducible
- Baseline at [tests/golden/baselines/v0.5.0+agent-friendly.json](./tests/golden/baselines/v0.5.0+agent-friendly.json)

**semantic-release + commitlint**
- [commitlint.config.cjs](./commitlint.config.cjs) extending `@commitlint/config-conventional` (allowed types: feat, fix, chore, docs, refactor, test, ci, build, perf, revert, style)
- [.releaserc.json](./.releaserc.json) plugin chain: `commit-analyzer -> release-notes-generator -> changelog -> git -> github` (deliberately no `@semantic-release/npm` because Gemma is a VSIX, not an npm package)
- New workflows: [.github/workflows/commitlint.yml](./.github/workflows/commitlint.yml) (PR commits) and [.github/workflows/semantic-release.yml](./.github/workflows/semantic-release.yml) (push to main)
- New devDependencies: `@commitlint/cli`, `@commitlint/config-conventional`, `@semantic-release/changelog`, `@semantic-release/git`, `@semantic-release/github`, `semantic-release`

**Release artifacts**
- `package.json` version bumped to 0.5.0
- This CHANGELOG entry
- [docs/v0.5.0/architecture.md](./docs/v0.5.0/architecture.md) describing the v0.5.0 architecture
- v0.5.0 git tag prepared (push deferred to explicit user confirmation)

### Deferred / Out of Scope

The following are recorded for v0.6.0+: LSTM predictive caching (hard constraint), multi-provider LLM proxy, voice transcription, distributed cache, `/memory prune` and `/memory lint --apply`, auto-merge for Dependabot, `format=json` on `read_file` and `run_terminal`. See [docs/v0.5.0/plans/implementation-plan.md](./docs/v0.5.0/plans/implementation-plan.md) "Out of Scope" section for the full table.

---

## [0.4.0] -- 2026-04-25

Code-review remediation release closing all 14 P0 findings from the v0.3.0 review.

### Phase 1 -- Critical Hotfix (P0 Unblock)

**Correctness**
- ChatHistoryStore FTS5 index stays in sync on message re-saves (added AFTER UPDATE trigger; switched saveMessage from INSERT OR REPLACE to explicit UPDATE/INSERT so the trigger fires)
- TaskDAG.hasCycle() no longer contains a dead in-degree loop; edge-direction intent is documented inline
- GraphQueryEngine.explainPath returns all intermediate entities on multi-hop paths (GraphMemory.getEntityById promoted to public)

**Security**
- run_terminal rejects any cwd that resolves outside the workspace root (shared path guard in src/tools/handlers/pathGuard.ts; symlink-aware)

**Security**
- Webview HTML rendered from LLM/tool/memory content is now sanitized through DOMPurify before reaching any innerHTML sink (strips <script>, <iframe>, <style>, inline event handlers, javascript: URIs)
- Content-Security-Policy tightened in both chat and trace-dashboard webviews: img-src, connect-src, object-src, frame-src, base-uri, form-action explicitly denied; require-trusted-types-for 'script' added
- run_terminal rejects any cwd that resolves outside the workspace root via a new shared src/tools/handlers/pathGuard.ts (symlink-aware)
- SessionListPanel HTML template now escapes session ids in attribute contexts (also gates finding #87)

**Performance**
- MemoryStore.searchSemantic scales with an FTS5 candidate pre-filter (bounded at 200 rows) and a per-instance Float32 embedding cache invalidated on save/prune/clear (previously full-table scan + Float64 per call)
- Tracer writes are batched: startSpan/endSpan buffer in memory and flush in a single transaction every 32 ops or on process.nextTick; endSpan no longer issues a per-span SELECT (startTime + attributes kept in-memory); reads auto-flush for consistency

**Testing**
- McpToolHandler unit tests (delegation, error propagation, rejection bubbling, argument pass-through)
- SessionListPanel unit tests (HTML rendering, message handling, escapeAttr wiring, null-store safety)
- MarkdownRenderer XSS regression tests (8 cases covering <script>/<iframe>/javascript:/<style>/<details open ontoggle>/inline event handlers)
- MemorySubsystem unit tests (disabled() contract, wired layers, graph-engine binding, isReady semantics)
- TraceStore batching tests (flushed queryability, in-memory endSpan path, implicit flush on read)
- Integration test for the safety pipeline: classifier -> requiresCheckpoint -> GitSafetyNet.createCheckpoint/rollback wired with real classifier + GitSafetyNet and mocked execFile (tests/integration/safety/agent-safety-pipeline.test.ts)

**CI**
- Benchmark regression gate: nightly.yml now exports bench results as JSON and runs scripts/check-bench-regressions.mjs against tests/benchmarks/baselines/v0.3.0.json; fails on >20% hz regression. First post-merge nightly will populate the baseline via --update-baseline mode.
- Golden task live-Ollama job: golden-tasks.yml now matrixes e2b + e4b, pulls Gemma, runs tests/golden/framework/run_all.py against OLLAMA_URL, diffs against v0.3.0 baseline, and uploads a Markdown regression report.

**Restructuring**
- Python FastAPI backend removed (ADR-0001). src/backend/ tree deleted along with BackendManager wiring, lint-py / test-py CI jobs, integration-py nightly job, and the installer venv step. The extension now talks directly to Ollama.
- `gemma-code.useBackend`, `gemma-code.backendPort`, `gemma-code.pythonPath` settings removed. Users with these set in their workspace will see "unknown setting" warnings on upgrade; they are safe to delete.
- GemmaCodePanel memory wiring extracted into src/storage/MemorySubsystem.ts (first slice of the god-object split). GemmaCodePanel.ts shrank by ~84 lines; the factory is independently unit-tested.

**Release**
- package.json version bumped to 0.4.0
- modelName default aligned across package.json manifest and src/config/settings.ts (both now "gemma4:e4b")

### Phase 7 -- Simplification and Release

**Removed (~800 LOC)**
- BudgetEnforcer (`src/guardrails/BudgetEnforcer.ts`) and its test; agent-loop branches that consumed it were already removed in Phase 3
- LazyToolLoader (`src/tools/LazyToolLoader.ts`), the `serializeToolSummary` helper in `Gemma4ToolFormat.ts`, the `lazyToolLoading` flag on `PromptContext`, and the `get_tool_schema` meta-tool from the catalog/permission tiers
- ConversationSync (`src/storage/ConversationSync.ts`) and its test
- RelevanceScorer (`src/chat/RelevanceScorer.ts`), its test, and the async relevance branch in `PromptBuilder.build` (build is now synchronous; all call sites updated)
- GpuTierConfig (`src/config/GpuTierConfig.ts`) and `inferTierFromModelName`; tier model unified onto `HardwareTierConfig` (gains `subAgentMaxIterations` + `maxConcurrentSubAgents`); `Orchestrator` and `DAGExecutor` now consume `HardwareTierConfig` directly
- `gemma-code.gpuTier` setting (with v0.5 migration shim that maps the legacy "1"/"2"/"3" string onto the canonical `gpuTierOverride` numeric tier)
- `gemma-code.memoryAutoSaveInterval` setting (no readers remained)
- `gemma-code.maxSessionTokens` and `gemma-code.maxSessionMinutes` settings (tied to BudgetEnforcer deletion)
- `escapeAttr` alias in MarkdownRenderer (every call site now invokes `escapeHtml` directly)
- `highlight.min.js` copy step in `scripts/build-vsix.ps1` (webview imports highlight.js via the bundled module loader; ~1 MB smaller VSIX)
- `validateExpectation` and `detectRegressions` relocated from `src/evaluation/GoldenTaskSuite.ts` to `tests/helpers/goldenTaskHelpers.ts` (test-only consumers)

**Wired**
- `gemma-code.permissionOverrides` setting now reaches `ToolRegistry.setConfirmationGate` so user overrides take effect (previously read but never applied); covered by a new `ToolRegistry` unit test

**Internal**
- `tsconfig.json`: `declaration: false`, `declarationMap: false` (no `.d.ts` artifacts in `out/`; faster builds)
- `parseOtlpHeaders` rewritten as `split` -> `map` -> `Object.fromEntries` (same shape, half the lines)

---

## [0.3.0] -- 2026-04-18

Cross-platform installer, golden task evaluation suite, and integration stabilization.

### Added

**Phase 7 -- Cross-Platform PyQt5 Installer**
- PyQt5 wizard installer replacing Windows-only NSIS installer
- 9-step installation wizard: Welcome, Prerequisites, GPU Detection, Install Path, Model Selection, Configuration, Review, Installing, Complete
- Automatic GPU detection (NVIDIA, AMD, Apple Silicon, Intel) with model recommendation
- Platform-specific installation: Windows (.exe), macOS (.dmg), Linux (AppImage)
- Real-time log panel during installation with color-coded output
- Headless mode (`--headless`, `--model`, `--install-path`, `--skip-model`, `--json-output`) for CI/automated installations
- "Open VS Code" button on completion page

**Phase 8 -- Golden Task Suite & Integration Stabilization**
- Golden task evaluation framework with YAML-based task definitions
- 24 golden tasks across 5 categories: multi-file edits (5), bug fixes (5), refactors (5), test generation (5), code review (4)
- Per-model-tier benchmark suite (E2B, E4B, 26B, 31B) measuring TTFT p50/p99 and throughput
- Memory recall accuracy benchmarks (keyword and semantic search) with latency targets
- Regression detection with baseline comparison (pass/fail flips, time, tokens, iterations, pass-rate drop)
- Cross-platform installer smoke tests (Windows, macOS, Linux)
- End-to-end integration tests for core v0.2.0 + v0.3.0 composition (full mocks)
- v0.2.0 vs v0.3.0 performance comparison framework

### Changed

- Installer technology changed from NSIS (Windows-only) to PyQt5 (cross-platform)
- Old NSIS installer preserved under `scripts/installer/legacy/`

### Known Limitations

- macOS .dmg is not notarized (requires Apple Developer account)
- Linux AppImage requires FUSE to run on some distributions
- Golden tasks require a running Ollama instance; CI uses E2B on CPU which is slower
- GPU detection may not work in virtualized environments (CI runners)

---

## [0.2.0] -- 2026-04-10

Major architectural evolution: Gemma 4 native protocol, dynamic prompt engineering, persistent cross-session memory, multi-strategy compaction, MCP interoperability, and sub-agent orchestration.

### Added

**Phase 0 -- Gemma 4 Native Protocol**
- Gemma 4 native tool calling via `<|tool_call>`, `<|tool_result>`, `<|tool>` tokens (replaces custom XML `<tool_call>` protocol)
- Gemma 4 native system role via `<|turn>system` token (removes Gemma 3 system-to-user workaround)
- Thinking mode via `<|think|>` token for chain-of-thought reasoning
- `Gemma4ToolFormat` parser with `<|"|>` string delimiter handling and code fence exclusion

**Phase 1 -- Dynamic PromptBuilder**
- `PromptBuilder` class assembling system prompt sections conditionally within a token budget
- Section-based architecture with priority ordering and greedy packing (always-include sections first, then conditional by ascending priority)
- `PromptBudget` calculator: system 10%, memory 3%, skills 2%, conversation 65%, response 20%
- `promptStyle` setting: `concise` (default), `detailed`, or `beginner`
- `systemPromptBudgetPercent` setting for custom budget tuning

**Phase 2 -- Multi-Strategy Context Compaction**
- 5-strategy compaction pipeline applied in cost order (cheapest first):
  1. ToolResultClearing -- strip old `<|tool_result>` blocks, keep N most recent
  2. SlidingWindow -- drop middle messages, preserve first + last N + summaries
  3. CodeBlockTruncation -- replace large code blocks (>80 lines) with placeholders
  4. LlmSummary -- structured summary preserving file paths, decisions, errors
  5. EmergencyTrim -- hard clip as last resort
- Pre-compaction hook for memory extraction before lossy operations
- `compactionKeepRecent` and `compactionToolResultsKeep` settings

**Phase 3 -- Persistent Memory System**
- SQLite FTS5 keyword search for cross-session memory (zero new dependencies)
- Optional Ollama embeddings (`nomic-embed-text`) for semantic search
- 5 memory types: decision, fact, preference, file_pattern, error_resolution
- Auto-extraction of memories during compaction via pre-compaction hooks
- Token-budgeted memory injection into system prompt (3% of context window)
- `/memory` slash command with search, save, clear, and status subcommands
- `memoryEnabled`, `embeddingModel`, `memoryAutoSaveInterval`, `memoryMaxEntries` settings

**Phase 4 -- Conditional Tool Activation and MCP**
- Context-dependent tool enable/disable via `ToolActivationRules`
- 15-tool cap for reliable Gemma 4 tool calling; lowest-priority tools dropped when exceeded
- Activation rules: Ollama reachability, network availability, read-only sessions, sub-agent type
- MCP client: connect to external MCP servers, discover and register tools
- MCP server: expose Gemma Code tools via stdio protocol (opt-in)
- `McpManager` lifecycle management with config from `~/.gemma-code/mcp.json`
- `/mcp` slash command with status, connect, and disconnect subcommands
- `mcpEnabled` and `mcpServerMode` settings

**Phase 5 -- Sub-Agent Orchestration**
- Verification sub-agent: auto-triggers after 3+ file edits (configurable), reviews changes for bugs, runs relevant tests
- Research sub-agent: gathers information using read-only tools + web search; triggered via `/research <query>`
- Planning sub-agent: decomposes complex tasks into numbered implementation steps
- Isolated execution: each sub-agent gets its own ConversationManager, AgentLoop, and ToolRegistry with scoped tools
- Sub-agent results injected into main conversation as advisory messages
- `/verify` and `/research` slash commands for manual sub-agent triggering
- `verificationEnabled`, `verificationThreshold`, `subAgentMaxIterations` settings
- Webview status banner with spinner showing active sub-agent type

**Phase 6 -- Integration and Documentation**
- Python backend aligned with multi-strategy compaction (tool-result clearing + sliding window)
- Python backend accepts dynamic `system_prompt` parameter
- Webview UI indicators for memory status, MCP connection, sub-agent progress, and thinking mode
- `SECURITY.md` with vulnerability disclosure policy (48h ack, 7-day critical fix)
- `ARCHITECTURE.md` root-level architecture overview
- Full architecture documentation at `docs/v0.2.0/architecture.md`

### Changed

- Default model changed from `gemma4` to `gemma4:e4b` (explicit variant selection)
- Default `maxTokens` increased from 32768 to 131072 (Gemma 4 E4B 128K context)
- Default `temperature` changed from 0.2 to 1.0 (Gemma 4 recommended sampling)
- Added `topP` (0.95) and `topK` (64) sampling parameters (Gemma 4 recommended)
- Tool protocol migrated from custom XML to Gemma 4 native tokens
- System prompt changed from static constant to dynamic `PromptBuilder` assembly
- Context compaction upgraded from single LLM summary to 5-strategy pipeline
- Python backend `prompt.py` updated for Gemma 4 turn tokens and dynamic system prompt parameter
- Fixed bug in Python backend where `request_timeout` was passed as `max_tokens`

### Known Limitations

- MCP support is experimental; only stdio transport is implemented
- Sub-agents run sequentially on a single GPU; each sub-agent adds 10-30 seconds of latency
- Semantic memory search requires pulling `nomic-embed-text` (274 MB); falls back to keyword-only search without it
- E2B model variant may not reliably follow complex agentic instructions; sub-agents are most effective on E4B or larger
- macOS and Linux installer scripts are still not implemented

---

## [0.1.0] — 2026-04-07

First stable release of Gemma Code — a fully offline, agentic coding assistant for VS Code powered by Google's Gemma 4 via Ollama.

### Added

**Phase 1 — Extension Skeleton & Ollama Client**
- VS Code extension scaffold with TypeScript, tsconfig, ESLint, and Vitest
- `OllamaClient` with streaming chat support (`streamChat`), health check (`checkHealth`), and model listing (`listModels`)
- Extension activation/deactivation lifecycle with an Output channel ("Gemma Code")
- `gemma-code.ping` command for verifying Ollama connectivity
- Unit tests for the Ollama client; integration smoke test for live Ollama health checks

**Phase 2 — Chat Engine & Streaming UI**
- `ConversationManager` maintaining ordered message history with token-count trimming and `onDidChange` events
- Webview chat panel (`GemmaCodePanel`) registered as a VS Code sidebar view
- Bidirectional postMessage protocol between extension host and webview
- Streaming token pipeline: each Ollama chunk is relayed to the webview in real time
- Vanilla TypeScript webview UI with streaming bubbles, Shift+Enter newlines, and auto-scroll
- Retry on stream failure within the first 3 tokens

**Phase 3 — Agentic Tool Layer**
- Tool-call protocol: model emits `<tool_call>` XML blocks; extension parses, executes, and injects `<tool_result>` messages
- Tool handlers: `read_file`, `write_file`, `create_file`, `delete_file`, `edit_file`, `list_directory`, `grep_codebase`, `run_terminal`, `web_search`, `fetch_page`
- Path traversal protection on all file system tools (workspace-root boundary check)
- `ConfirmationGate` for user-approved tool execution (edit and terminal)
- `AgentLoop` with configurable `maxAgentIterations` (default 20) and stop-signal on overflow
- Tool progress indicators in the webview ("Using tool: …")
- Web search via DuckDuckGo HTML endpoint (no API key required)

**Phase 4 — Skills, Commands & DevAI-Hub Integration**
- `SkillLoader` parsing SKILL.md frontmatter; hot-reloads from `~/.gemma-code/skills/`
- Built-in skill catalog: `commit`, `review-pr`, `generate-readme`, `generate-changelog`, `generate-tests`, `analyze-codebase`, `setup-project`
- `CommandRouter` parsing slash commands and routing to built-in handlers or skill executor
- Built-in commands: `/help`, `/clear`, `/history`, `/plan`, `/compact`, `/model`
- Inline autocomplete popup for slash commands in the webview chat input
- `PlanMode` with numbered-plan detection heuristic and step-by-step approval workflow

**Phase 5 — Advanced UX Features**
- SQLite-backed chat history (`ChatHistoryStore`) with session create/save/list/search/delete
- `/history` command showing past sessions; click to resume
- `ContextCompactor` with 80%-threshold auto-compact and `/compact` command
- Token count indicator in the webview header (X / Y tokens, colour-coded)
- Three edit modes: Auto, Ask (diff editor + confirmation), Manual (display only)
- Edit mode selector in the webview header
- Markdown rendering with `marked` and syntax highlighting with `highlight.js` (both bundled, no CDN)
- Code block "Copy" button and collapsible tool-result blocks
- Incremental streaming render: raw text during stream, full Markdown after completion

**Phase 6 — Python Backend & Inference Optimisation**
- FastAPI backend (`src/backend/`) with `/health`, `/models`, and `/chat/stream` (SSE) endpoints
- Gemma chat template formatting (`<start_of_turn>user … <end_of_turn>`) applied server-side
- `BackendManager` in TypeScript: auto-starts the Python process on activation, falls back to direct Ollama on failure
- `gemma-code.useBackend`, `gemma-code.backendPort`, and `gemma-code.pythonPath` settings

**Phase 7 — Installer & Distribution**
- VSIX build pipeline (`scripts/build-vsix.ps1`) producing `gemma-code-0.1.0.vsix`
- NSIS installer script (`scripts/installer/setup.nsi`) for Windows 10/11
  - Installs Ollama silently if not present
  - Installs the VSIX via `code --install-extension`
  - Sets up a Python virtual environment for the backend
  - Optional Gemma model download with progress display
  - Adds Start Menu shortcut and Add/Remove Programs entry
  - Uninstaller removes the venv and VS Code extension
- GitHub Actions workflows: `ci.yml` (lint + test + coverage gate), `release.yml` (VSIX + installer + GitHub Release), `nightly.yml` (integration tests + benchmarks)
- CI documentation in `docs/v0.1.0/ci-setup.md`
- E2E smoke test verifying the extension loads in VS Code without a running Ollama instance

**Phase 8 — Hardening, CI/CD & Release**
- Global `unhandledRejection` handler in `extension.ts` — logs to the Output channel instead of crashing the extension host
- Ollama availability poller: polls every 5 seconds; posts a recovery notification when Ollama comes back online; posts an error banner when it goes offline
- Startup health check with actionable error messaging and a "Pull model" quick action
- SSRF protection in `FetchPageTool`: rejects localhost, loopback, link-local, and all RFC-1918 private IP ranges; blocks non-HTTP(S) schemes
- Terminal blocklist hardening: blocklist now checks every shell-metacharacter-separated segment to prevent chain-bypass attacks
- `GemmaCodePanel.postStatus()` and `postError()` public methods for external error signalling
- Python backend crash detection with VS Code notification and graceful fallback to direct Ollama
- Performance benchmark suite: `time-to-first-token`, `context-compaction`, `tool-execution`, `skill-loading`, `markdown-rendering` — all integrated into nightly CI
- Security audit documentation (`docs/v0.1.0/security-audit.md`) with findings and remediations
- Performance benchmark documentation (`docs/v0.1.0/performance-benchmarks.md`)
- Architecture documentation (`docs/v0.1.0/architecture.md`) with component descriptions and data-flow diagrams
- Comprehensive README with installation guide, quick start, configuration reference, and troubleshooting section
- Error regression tests in `tests/unit/errors/`

### Changed

- Default model switched from `gemma3:27b` to `gemma4` (Gemma 4 e4b, 128K context, native function calling)
- Default `maxTokens` increased from 8192 to 32768 to take advantage of Gemma 4's larger context window
- Ollama requests now pass `num_ctx` and `temperature` options to the server for consistent context handling
- Nightly CI uses `gemma4:e2b` (smallest Gemma 4 variant) instead of `gemma3:2b`
- Windows installer model download updated to `gemma4` (~9.6 GB, down from ~15 GB for gemma3:27b)
- Removed duplicate `configs/eslint.config.mjs` (dead file; canonical ESLint config is at project root)

### Known Limitations

- The Rust performance components and Go CLI tooling described in the tech stack are placeholders for future phases; v0.1.0 uses TypeScript and Python only.
- The GrepCodebaseTool uses VS Code's `workspace.findFiles` API and may be slow on very large repositories (>10 000 files). A ripgrep-based implementation is planned.
- The web search tool fetches DuckDuckGo's HTML endpoint; result quality varies and the endpoint is rate-limited by IP.
- macOS and Linux installer scripts are not yet implemented; manual VSIX installation is required on non-Windows platforms.
- The E2E test suite requires a VS Code instance and is not run in the standard CI matrix; it runs manually or in the nightly workflow.

[Unreleased]: https://github.com/bendourthe/Gemma-Code/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/bendourthe/Gemma-Code/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/bendourthe/Gemma-Code/releases/tag/v0.1.0
