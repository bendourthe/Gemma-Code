# Unreleased

Post-cut work on `develop` after tag `v2.2.8`. No version bump. No retag.

# [2.2.8](https://github.com/bendourthe/Nexus-AI/compare/v2.2.5...v2.2.8) (2026-08-24)

Working local studio after the v2.2.5 cut (plans v2.2.6 through v2.2.8, one tag). Local-only. Packaged Chatbot `Hi`, live GPU generate, and packaged Hub Active=latest remain unproven (DF-32, DF-4, DF-35). Packaged Explorer launch is observed (DF-2 closed). The installer desktop pin stays `v2.1.0` until this tag's bundle assets attach.

This release changes no opt-in capability, installer flag, or host surface.


### Features

* **v2.2.6:** persist Image Studio and Video Lab named sessions with last-output follow-up ([d0f19e3](https://github.com/bendourthe/Nexus-AI/commit/d0f19e3), [df40e38](https://github.com/bendourthe/Nexus-AI/commit/df40e38), [83f50bc](https://github.com/bendourthe/Nexus-AI/commit/83f50bc))
* **v2.2.6:** restore Agents transcripts on resume and prove Chatbot remount hydration ([6112f6b](https://github.com/bendourthe/Nexus-AI/commit/6112f6b), [fc0ba55](https://github.com/bendourthe/Nexus-AI/commit/fc0ba55))
* **v2.2.7:** show catalog context windows as `<val>k` chips and persist per-turn token usage ([8cf5a56](https://github.com/bendourthe/Nexus-AI/commit/8cf5a56), [a71f531](https://github.com/bendourthe/Nexus-AI/commit/a71f531))
* **v2.2.7:** add the composer Context meter, 80% new-session CTA, and transcript date/time/token chrome ([d2893a0](https://github.com/bendourthe/Nexus-AI/commit/d2893a0), [946658b](https://github.com/bendourthe/Nexus-AI/commit/946658b))
* **v2.2.8:** keep local chat and generate RPCs open past 15s and treat Ollama `gemma4:12b` as Downloaded ([f672d6d](https://github.com/bendourthe/Nexus-AI/commit/f672d6d))
* **v2.2.8:** share FolderTree history chrome across Chatbot, Agents, Images, and Videos ([f47bc5e](https://github.com/bendourthe/Nexus-AI/commit/f47bc5e))
* **v2.2.8:** inset the module rail and center composing orbs ([d4c3a42](https://github.com/bendourthe/Nexus-AI/commit/d4c3a42))
* **v2.2.8:** match Settings Models sort to the installer catalog ([3b557c0](https://github.com/bendourthe/Nexus-AI/commit/3b557c0))
* **v2.2.8:** apply Hub latest with per-skill quarantine while the injection scanner stays on ([692d068](https://github.com/bendourthe/Nexus-AI/commit/692d068))


### Bug Fixes

* **v2.2.6:** prove Chatbot remount hydration and honest save failures ([fc0ba55](https://github.com/bendourthe/Nexus-AI/commit/fc0ba55))
* **v2.2.8:** remove leftover Agents SessionListPanel now that FolderTree owns history ([86dff64](https://github.com/bendourthe/Nexus-AI/commit/86dff64))


### Documentation

* **v2.2.6:** reconcile session-memory layout, known-gaps, and CI ([6fab8d9](https://github.com/bendourthe/Nexus-AI/commit/6fab8d9))
* **v2.2.7:** reconcile context-meter layout, known-gaps, and CI ([02616e9](https://github.com/bendourthe/Nexus-AI/commit/02616e9))
* **v2.2.8:** reconcile studio layout, known-gaps, and CI ([86dff64](https://github.com/bendourthe/Nexus-AI/commit/86dff64))

Plans: [v2.2.6](docs/v2/v2.2/plans/v2.2.6-session-memory-and-studio-history.md), [v2.2.7](docs/v2/v2.2/plans/v2.2.7-context-meter-and-transcript-chrome.md), [v2.2.8](docs/v2/v2.2/plans/v2.2.8-working-local-studio.md). Gaps: [docs/v2/v2.2/known-gaps.md](docs/v2/v2.2/known-gaps.md).

# [2.2.5](https://github.com/bendourthe/Nexus-AI/compare/v2.1.0...v2.2.5) (2026-08-23)

Field-repair cycle after the v2.1.0 cut (plans v2.2.0 through v2.2.5, one tag). Local-only. Packaged Explorer soak and live GPU generate remain unproven (DF-2, DF-4). The installer desktop pin stays `v2.1.0` until this tag's bundle assets attach.

This release changes no opt-in capability, installer flag, or host surface.


### Features

* **v2.2:** repair sidecar packaging so the Node backend can start, and show every installed model honestly ([bd63e52](https://github.com/bendourthe/Nexus-AI/commit/bd63e52), [972ccd0](https://github.com/bendourthe/Nexus-AI/commit/972ccd0), [6362a90](https://github.com/bendourthe/Nexus-AI/commit/6362a90))
* **v2.2:** provision the Nexus-Hub harness in-app and persist chats with auto-titles and a rebuilt composer ([8bacbd2](https://github.com/bendourthe/Nexus-AI/commit/8bacbd2), [1c4e49d](https://github.com/bendourthe/Nexus-AI/commit/1c4e49d))
* **v2.2:** switch models on submit with a single-GPU occupancy policy, not on tab click ([056dab4](https://github.com/bendourthe/Nexus-AI/commit/056dab4), [25a94f7](https://github.com/bendourthe/Nexus-AI/commit/25a94f7), [6310721](https://github.com/bendourthe/Nexus-AI/commit/6310721))
* **v2.2:** modernize the shell and Settings, retire User Profile, and add local data transfer ([530d5c2](https://github.com/bendourthe/Nexus-AI/commit/530d5c2), [0a22f53](https://github.com/bendourthe/Nexus-AI/commit/0a22f53), [06a8f3a](https://github.com/bendourthe/Nexus-AI/commit/06a8f3a))
* **v2.2.3:** glass chrome, durable chat memory, occupancy on submit, and a workspace-aware Hub harness ([a443f07](https://github.com/bendourthe/Nexus-AI/commit/a443f07), [6fbcd1c](https://github.com/bendourthe/Nexus-AI/commit/6fbcd1c), [8af593a](https://github.com/bendourthe/Nexus-AI/commit/8af593a))
* **v2.2.4:** open Chatbot on cold start, bind pickers to this-install snapshot, and show the user bubble before residency errors ([a7d8f43](https://github.com/bendourthe/Nexus-AI/commit/a7d8f43), [7f71bc7](https://github.com/bendourthe/Nexus-AI/commit/7f71bc7), [793b08a](https://github.com/bendourthe/Nexus-AI/commit/793b08a))
* **v2.2.4:** compact studio media, rebuild Settings Models as the installer catalog, and let Hub update finish without raising every RPC timeout ([ecf8c35](https://github.com/bendourthe/Nexus-AI/commit/ecf8c35), [0077ac6](https://github.com/bendourthe/Nexus-AI/commit/0077ac6), [fd82255](https://github.com/bendourthe/Nexus-AI/commit/fd82255))
* **v2.2.5:** fold catalog model ids onto Ollama tags before chat start ([8290192](https://github.com/bendourthe/Nexus-AI/commit/8290192))
* **v2.2.5:** fail closed when diffusion cannot return usable bytes ([5cd6892](https://github.com/bendourthe/Nexus-AI/commit/5cd6892))
* **v2.2.5:** match Settings Models scroll, badges, and installer chips ([37953b9](https://github.com/bendourthe/Nexus-AI/commit/37953b9))
* **v2.2.5:** add chat row icons and a chats-pane collapse pill ([bb8561e](https://github.com/bendourthe/Nexus-AI/commit/bb8561e))
* **v2.2.5:** pack and test Hub latest instead of a frozen 3.12.0 snapshot ([bea7594](https://github.com/bendourthe/Nexus-AI/commit/bea7594))
* add Qwen 3.5 4B/9B, gpt-oss 20B, Qwen3-Coder 30B, EmbeddingGemma, and Qwen3-Embedding 0.6B to the installer catalog
* drop pre-2025 installer-catalog opt-ins that are not required or recommended, retire Qwen 2.5 Coder / DeepSeek Coder V2, and sort remaining cards by recommendation then newest release then capability


### Bug Fixes

* **v2.1:** close remaining code-completeable known-gaps without claiming live GPU passes ([c366700](https://github.com/bendourthe/Nexus-AI/commit/c366700))
* **v2.2.3:** make studio generation honest and repair chat explorer startup ([d072d04](https://github.com/bendourthe/Nexus-AI/commit/d072d04), [b6bf877](https://github.com/bendourthe/Nexus-AI/commit/b6bf877))
* **v2.2.4:** treat unknown models as missing; do not invent Compatible or a default `gemma4:e4b` fallback ([b6c535e](https://github.com/bendourthe/Nexus-AI/commit/b6c535e))
* **v2.2.5:** include `catalog.json` in the core TypeScript project ([2884710](https://github.com/bendourthe/Nexus-AI/commit/2884710))
* show the Nexus mark on the Windows installer taskbar instead of the generic exe icon
* upgrade the installer Ollama pin to v0.32.15 so Gemma 4 12B can pull (HTTP 412 on older hosts)
* look up the Windows desktop binary in `%LOCALAPPDATA%\\Nexus AI Studio` (Tauri productName) instead of `%LOCALAPPDATA%\\Nexus\\Nexus.exe`


### Documentation

* **v2.2.5:** reconcile known-gaps and CI for first-successful-generation ([e07cfb5](https://github.com/bendourthe/Nexus-AI/commit/e07cfb5))
* track v2.2.6 session-memory and v2.2.7 context-meter plans (not started) ([6f17a4e](https://github.com/bendourthe/Nexus-AI/commit/6f17a4e))

Plans: [v2.2.0](docs/v2/v2.2/plans/v2.2.0-runtime-repair-and-ux-overhaul.md), [v2.2.4](docs/v2/v2.2/plans/v2.2.4-chatbot-first-and-runtime-honesty.md), [v2.2.5](docs/v2/v2.2/plans/v2.2.5-first-successful-generation.md). Gaps: [docs/v2/v2.2/known-gaps.md](docs/v2/v2.2/known-gaps.md).

# [2.1.0](https://github.com/bendourthe/Nexus-AI/compare/v2.0.0...v2.1.0) (2026-08-20)


### Features

* **v2.1.0:** add Muse Glimmer and Nemotron Lightning catalog and harness profiles ([d467e88](https://github.com/bendourthe/Nexus-AI/commit/d467e88))
* **v2.1.0:** add cheap-first worker-to-strong routing with GPU swap gates ([081d222](https://github.com/bendourthe/Nexus-AI/commit/081d222))
* **v2.1.0:** embed generation provenance and persist the studio queue ([2421139](https://github.com/bendourthe/Nexus-AI/commit/2421139))
* **v2.1.0:** add catalog vision budgets and SAM2 replace-the-X editing ([c831a54](https://github.com/bendourthe/Nexus-AI/commit/c831a54))
* **v2.1.0:** add license-gated Unsloth Core fine-tuning pillar ([1797afb](https://github.com/bendourthe/Nexus-AI/commit/1797afb))
* **v2.1.0:** add signed audit log, JSON CLI, and diffusion VRAM knobs ([33f32b3](https://github.com/bendourthe/Nexus-AI/commit/33f32b3))


### Bug Fixes

* **v2.1.0:** close code-completeable known-gaps without claiming live GPU passes ([04900fe](https://github.com/bendourthe/Nexus-AI/commit/04900fe))


### Documentation

* **v2.1.0:** reconcile known-gaps and document CI hardware gates ([d22cc48](https://github.com/bendourthe/Nexus-AI/commit/d22cc48))

Open local-AI wave. Local-only after weight download. `localEval.status` is `not_run`; `recommended.json` is unchanged. Plan: [v2.1.0](docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md).


### Opt-in surfaces

#### Local fine-tuning (Settings > Fine-tuning)

- Activation: Settings > Fine-tuning, then Provision. Default is off (`opt_in=False`; not on the installer `chain_for`). Live GPU train also needs `NEXUS_TUNING_LIVE=1`.
- Validation: after provision, Settings shows provision status ready (or unsupported with a reason). A stub job (`--stub`) completes without a GPU. `NEXUS_TUNING_LIVE=1` is required for a real Unsloth train.
- Rollback: do not provision. If already provisioned, leave the venv unused; jobs are cancelled from the Fine-tuning tab. Unsloth Studio/CLI extras are never installed.
- Authority: this does not add training to the default installer, does not import GGUF into Ollama unless you opt in, does not skip `redactSecrets` on datasets, and does not make zoo AGPL (zoo is LGPL).
- Docs: [README](README.md#whats-new-in-v210), [docs/v2/v2.1/development/unsloth-license-boundary.md](docs/v2/v2.1/development/unsloth-license-boundary.md), [docs/v2/v2.1/known-gaps.md](docs/v2/v2.1/known-gaps.md).

#### JSON CLI loopback (`/nexus/*`)

- Activation: start the desktop sidecar. JSON CLI binds `127.0.0.1:11500` (or `NEXUS_SERVING_PORT`) even when Settings > Local API server is off. OpenAI `/v1` stays off until that toggle is on. Auth is `nexus.serving.token`, `--token`, or `NEXUS_SERVING_TOKEN`.
- Validation: `nexus models list` returns JSON, or `curl -H "Authorization: Bearer <token>" http://127.0.0.1:11500/nexus/models`. Schema errors exit 2 with no HTTP call.
- Rollback: quit the app (no extra port once the sidecar stops). Local API `/v1` is a separate toggle and can stay off.
- Authority: loopback only, bearer required. This does not enable `/v1` completions, does not bind a non-loopback host, and does not skip ConfirmationGate on coding tools invoked through `nexus session send`.
- Docs: [docs/v2/v2.1/development/json-cli.md](docs/v2/v2.1/development/json-cli.md).

#### parse_document Settings checkbox

- Activation: Settings > Security, **Enable parse_document for coding sessions**, which writes `nexus.coding.parseDocument.enabled` in `~/.nexus/settings.json`. Env `NEXUS_PARSE_DOCUMENT=1` still wins. Default is false.
- Validation: with the box on, `coding.parseDocument.status` returns `{ enabled: true }` and the agent tool is registered. With it off, the tool is absent.
- Rollback: uncheck the box or set the key to false / `NEXUS_PARSE_DOCUMENT=0`. No extra files are written.
- Authority: this only registers the governed agent tool. It does not install Docling, does not skip CONFIRM or secret redaction, and does not ingest into a sidecar MemoryStore (VS Code ingest remains a second flag).
- Docs: [docs/v1/v1.20/known-gaps.md](docs/v1/v1.20/known-gaps.md).

# [2.0.0](https://github.com/bendourthe/Nexus-AI/compare/v1.20.0...v2.0.0) (2026-08-20)


### Features

* **v2.0.0:** add Chat vision routing, local STT, and an offline voice loop ([4767689](https://github.com/bendourthe/Nexus-AI/commit/4767689))
* **v2.0.0:** add DANGEROUS isolated-profile browser tools for the coding agent ([30fbcaa](https://github.com/bendourthe/Nexus-AI/commit/30fbcaa))
* **v2.0.0:** add Video Lab clip continuation and a gated local avatar mode ([59440cb](https://github.com/bendourthe/Nexus-AI/commit/59440cb))
* **v2.0.0:** add ProjectScope, durable sandbox, and advisory memory kinds ([21089c8](https://github.com/bendourthe/Nexus-AI/commit/21089c8))


### Documentation

* **v2.0.0:** reconcile known-gaps and document CI hardware gates ([07ec7be](https://github.com/bendourthe/Nexus-AI/commit/07ec7be))

This is the convergence cut of the v1.18-v2.0 plan family. Earlier changelog sections already record [v1.18.0](#1180) (harness, ask inbox, ACP, OS sandbox), [v1.19.0](#1190) (LFM2.5-2.6B), [v1.19.1](#1191) (loop guards and posture dial), [v1.19.2](#1192) (modalities, Hermes, Inkling), and [v1.20.0](#1200) (document ingest). Plans: [v1.18.0](docs/v1/v1.18/plans/v1.18.0-adoption-agent-harness-and-governance.md), [v1.19.0](docs/v1/v1.19/plans/v1.19.0-adoption-liquid-lfm-agentic.md), [v1.19.1](docs/v1/v1.19/plans/v1.19.1-adoption-agent-loop-and-guardrail-hardening.md), [v1.19.2](docs/v1/v1.19/plans/v1.19.2-adoption-catalog-and-model-expansion.md), [v2.0.0](docs/v2/v2.0/plans/v2.0.0-adoption-governed-autonomy-multimodal.md).


### Opt-in surfaces

#### Chat voice loop (Local Chatbot "Voice loop" checkbox)

- Activation: in Local Chatbot Explorer, check **Voice loop**. Default is off. Install catalog models `faster-whisper-large-v3` (STT) and `kokoro-82m` (TTS) through the installer for live engines. CI uses `NEXUS_AUDIO_STUB=1`.
- Validation: with the box on, the capture indicator reads "Recording -- microphone is open" while PTT or VAD is capturing. With the box off, PTT and VAD controls stay disabled.
- Rollback: uncheck **Voice loop**. The reducer resets. Installed weights stay on disk until you remove them.
- Authority: this only opens the local mic-to-STT-to-TTS loop. It does not send audio off-device, does not enable coding tools, does not skip secret redaction on transcripts, and does not register a network port.
- Docs: [README](README.md#whats-new-in-v200), [docs/v2/v2.0/known-gaps.md](docs/v2/v2.0/known-gaps.md) (DF-1, DF-3, DF-4).

#### Coding browser tools (local Playwright)

- Activation: the five `browser_*` tools are DANGEROUS and always confirm. Live Chromium is a local install: `npx playwright@1.55.0 install chromium`. There is no package.json Playwright dependency. Sidecar headless registers the family when `browserEnabled` is true (sidecar default).
- Validation: a confirmed `browser_navigate` to a local HTML file plus `browser_aria_snapshot` returns labelled `[origin:browser_snapshot]` text. Without Playwright, CI still passes on `InMemoryBrowser`. Set `NEXUS_BROWSER_PLAYWRIGHT=1` for the live skip-gated tests.
- Rollback: do not approve the DANGEROUS prompt. Uninstall Playwright/Chromium if you installed them. Isolated profiles live under `~/.nexus/browser-profiles/` and are not your default Chrome/Edge profile.
- Authority: this does not grant the user's logged-in browser, does not lower PermissionTiers, does not auto-approve, and does not treat page content as instructions (snapshots are screened).
- Docs: [docs/v2/v2.0/browser-surface-security.md](docs/v2/v2.0/browser-surface-security.md), [docs/v2/v2.0/ci-hardware-gates.md](docs/v2/v2.0/ci-hardware-gates.md).

#### Video Lab local talking-head (`longcat-video-avatar-1.5`)

- Activation: Hardware class `diffusion-pro` (about 20 GB+ VRAM), install catalog id `longcat-video-avatar-1.5` (official `meituan-longcat` INT8, sha256-pinned), attach a photo plus audio, and check **Generate talking-head locally. Photo and audio never leave this device.** IPC field `confirmLocalAvatar` must be true.
- Validation: below `diffusion-pro` the checkbox is hidden and `diffusion.video.audio2video` is refused. With confirm false the request is rejected. Workflow JSON records `provenance.neverLeftDevice`.
- Rollback: uncheck the confirm box; do not install the weights. Delete `~/.nexus/models/weights/longcat-video-avatar-1.5/` if already pulled. Continuation (clip chaining) is separate and does not require this catalog id.
- Authority: this does not upload photo or audio, does not enable community FP8 re-quants, does not vendor LongCat DiT Python (DF-8 stub until a scanned import), and does not skip the VRAM floor.
- Docs: [README](README.md#whats-new-in-v200), [docs/v2/v2.0/known-gaps.md](docs/v2/v2.0/known-gaps.md) (DF-8, DF-9).

# [1.20.0](https://github.com/bendourthe/Nexus-AI/compare/v1.19.2...v1.20.0) (2026-08-19)



### Features

* **v1.20.0:** wire parse_document on sidecar and VS Code hosts ([318e944](https://github.com/bendourthe/Nexus-AI/commit/318e944))
* **v1.20.0:** add magic-byte document router and native Office ingest ([374f227](https://github.com/bendourthe/Nexus-AI/commit/374f227))
* **v1.20.0:** let Coding attach and parse documents like Chat ([a20c21a](https://github.com/bendourthe/Nexus-AI/commit/a20c21a))


### Bug Fixes

* **ci:** stop Linux hash_file mkdir on /workspace and key uv cache on pyproject.toml ([756153f](https://github.com/bendourthe/Nexus-AI/commit/756153f))


### Documentation

* **v1.20.0:** add Docling comparison and document-ingest plan ([a472acd](https://github.com/bendourthe/Nexus-AI/commit/a472acd))
* **v1.20.0:** defer Docling layout engine after incomplete OCR bake-off ([c4530f5](https://github.com/bendourthe/Nexus-AI/commit/c4530f5))
* **v1.20.0:** close document-ingest cycle with known-gaps and CI notes ([b24b319](https://github.com/bendourthe/Nexus-AI/commit/b24b319))


### Opt-in surfaces

#### parse_document agent tool (`nexus.coding.parseDocument.enabled`)

- Activation: set `"nexus.coding.parseDocument.enabled": true` in VS Code settings, or `NEXUS_PARSE_DOCUMENT=1` for sidecar/ACP/scheduler, or the same JSON key in `~/.nexus/settings.json`. Default is false. Optional memory ingest is a second flag: `"nexus.coding.parseDocument.memoryIngest.enabled": true` (VS Code + MemoryStore only).
- Validation: with the tool flag on, a coding agent can call `parse_document` on a workspace PDF, image, or Office file and the tool appears in the catalog. With the flag off, `get_tool_schema` / the tool list omit it. Chat and Coding file attach still work without this flag.
- Rollback: set the setting to false or `NEXUS_PARSE_DOCUMENT=0`. The tool is unregistered on the next session. No extra files are written. Memory rows already stored stay until you delete them.
- Authority: this only registers the governed agent tool. It does not install Docling, does not add torch to the portable OCR venv, does not open a network port, does not auto-prompt parsed text into a model, and does not skip CONFIRM / secret redaction / inbound classification. Chat and Coding attach are separate UI paths and are not this flag.
- Docs: [README](README.md#whats-new-in-v1200), [ARCHITECTURE.md](ARCHITECTURE.md#document-ingest-v1200), [docs/v1/v1.20/known-gaps.md](docs/v1/v1.20/known-gaps.md).

# [1.19.2](https://github.com/bendourthe/Nexus-AI/compare/v1.19.1...v1.19.2) (2026-08-19)


### Features

* **v1.19.2:** add Hermes, Inkling, modalities, and weight variants ([17a0206](https://github.com/bendourthe/Nexus-AI/commit/17a0206))


### Opt-in surfaces

#### Weights variant override (`NEXUS_WEIGHTS_VARIANT`)

- Activation: set env `NEXUS_WEIGHTS_VARIANT` to a catalog variant id (for example `gguf-ud-iq1-s`), or the installer `weights_variant` field. Default is the entry's `defaultVariant` or a VRAM-aware official pick.
- Validation: install a model that declares `weights.variants` and confirm only that variant's files land under `~/.nexus/models/weights/<id>/`. An unofficial variant is rejected.
- Rollback: unset `NEXUS_WEIGHTS_VARIANT`. Already-downloaded files stay on disk until you delete them.
- Authority: this only chooses which official file set the puller verifies. It does not admit community quants, does not skip sha256, does not enable the patient tier, and does not open a network port beyond the existing Hugging Face install channel.
- Docs: [README](README.md#whats-new-in-v1192), [ARCHITECTURE.md](ARCHITECTURE.md#catalog-expansion-and-patient-tier-calibration-v1192).

#### Patient-tier RAM preset (`nexus.llm.patientTier.ramPreset`)

- Activation: set `"nexus.llm.patientTier.ramPreset": "laptop" | "workstation" | "max"` in settings. Default is `laptop`.
- Validation: the settings description shows that preset's expected s/token. It does not change adapter config.
- Rollback: set the setting back to `"laptop"`. No files outside settings are written.
- Authority: this is expectation copy only. It does not bundle or configure the llama.cpp offload runtime, does not download Inkling, and does not raise permission tiers.
- Docs: [README](README.md#whats-new-in-v1192), [docs/v1/v1.19/known-gaps.md](docs/v1/v1.19/known-gaps.md) (v1.19.2 DF-4).

# [1.19.1](https://github.com/bendourthe/Nexus-AI/compare/v1.19.0...v1.19.1) (2026-08-19)


### Features

* **v1.19.1:** Hub skill-native wins: grounded citations, persona cards, avatar-prep and transcript-reasoning (Phase 1) ([3f68051](https://github.com/bendourthe/Nexus-AI/commit/3f68051))
* **v1.19.1:** harden agent loop, denials, posture, and provenance (Phase 2) ([ddbb258](https://github.com/bendourthe/Nexus-AI/commit/ddbb258))


### Opt-in surfaces

#### Security posture dial (`nexus.coding.securityPosture`)

- Activation: set `"nexus.coding.securityPosture": "strict" | "standard" | "unattended"` in settings, or the matching VS Code / desktop Security tab control. Default is `standard`.
- Validation: with Standard, CONFIRM-tier tools still prompt. With Unattended, a CONFIRM-tier tool proceeds without that prompt, but `run_terminal` (DANGEROUS) still prompts and `rm -rf /` is still blocked. With Strict, more prompts and all tool output is screened.
- Rollback: set the setting back to `"standard"`. No files outside settings are written.
- Authority: this only changes confirmation frequency and screening strictness. It does not drop the PermissionTiers floor, does not allow hard-denied commands, does not auto-approve DANGEROUS tools, and does not open a network port. Unattended is not a no-floor mode.
- Docs: [README](README.md#whats-new-in-v1191), [ARCHITECTURE.md](ARCHITECTURE.md#agent-loop-and-guardrail-hardening-v1191-phase-2).

# [1.19.0](https://github.com/bendourthe/Nexus-AI/compare/v1.18.0...v1.19.0) (2026-08-19)


### Features

* **v1.19.0:** LFM2.5-2.6B as the low-VRAM Agentic catalog pick (Phase 1) ([58e2293](https://github.com/bendourthe/Nexus-AI/commit/58e2293))
* **v1.19.0:** LFM-aware harness profile and pythonic tool parser (Phase 2) ([6a8e3f0](https://github.com/bendourthe/Nexus-AI/commit/6a8e3f0))


### Bug Fixes

* **sandbox:** parse Seatbelt profiles and stage one Linux bundle ([f8c619e](https://github.com/bendourthe/Nexus-AI/commit/f8c619e))
* **ci:** unblock CI sandbox tests and catalog sync ([afcb0b8](https://github.com/bendourthe/Nexus-AI/commit/afcb0b8))


### Documentation

* **v1.19.0:** decline LFM2.5-8B-A1B until a local quality-per-GB win ([9f89f6d](https://github.com/bendourthe/Nexus-AI/commit/9f89f6d))


### Continuous Integration

* **v1.19.0:** path-filter installer tests and run desktop vitest on develop ([976cee5](https://github.com/bendourthe/Nexus-AI/commit/976cee5))


### Opt-in surfaces

This release changes no opt-in capability, installer flag, or host surface.

# [1.18.0](https://github.com/bendourthe/Nexus-AI/compare/v1.17.0...v1.18.0) (2026-08-17)


### Features

* **v1.18.0:** Hub skill-native mappings and llama.cpp loopback recipe (Phase 1) ([147cc39](https://github.com/bendourthe/Nexus-AI/commit/147cc39))
* **v1.18.0:** live harness selector with named family profiles (Phase 2) ([6666a74](https://github.com/bendourthe/Nexus-AI/commit/6666a74))
* **v1.18.0:** catalog tool-calling flags, MoE schema, and MCP tool deny (Phase 3) ([12fe79f](https://github.com/bendourthe/Nexus-AI/commit/12fe79f))
* **v1.18.0:** persistent ask inbox and local agent-run scheduler (Phase 4) ([ca02605](https://github.com/bendourthe/Nexus-AI/commit/ca02605))
* **v1.18.0:** loopback ACP agent on the shared serving control surface (Phase 5) ([9d88233](https://github.com/bendourthe/Nexus-AI/commit/9d88233))
* **v1.18.0:** OS process sandbox around `run_terminal` (Phase 6) ([8ac11ee](https://github.com/bendourthe/Nexus-AI/commit/8ac11ee))


### Bug Fixes

* **desktop:** use a c-string literal for LoadLibraryA so Windows clippy is clean ([f27bc65](https://github.com/bendourthe/Nexus-AI/commit/f27bc65))
* **ci:** attach release assets by waiting for the desktop bundle and running appimagetool without FUSE ([6e601d2](https://github.com/bendourthe/Nexus-AI/commit/6e601d2))
* **sandbox:** alias macOS `/var` and `/private/var` firmlink twins in writable roots so Seatbelt allows in-scope writes on GitHub runners
* **ci:** restore the skill-native "no new skill" phrase, probe live sandbox mode in the classifier test, and regenerate `docs/index.md`
* **sandbox:** drop invalid `network-outbound*` / `mach-register` Seatbelt ops that made sandbox-exec exit 65 before the child ran
* **ci:** stage one Linux `.deb` / AppImage when the cargo cache leaves multiple bundle versions


### Opt-in surfaces

#### Per-model harness selector (`nexus.coding.harnessSelector.enabled`)

- Activation: set `"nexus.coding.harnessSelector.enabled": true` in settings, or the matching VS Code setting. Default is false (`HARNESS_SELECTOR_SHIPPED_DEFAULT`).
- Validation: with the toggle on, send `/harness` in a coding session and confirm a named profile (plan-first, structured-edit, concise-loop, or minimal) is reported for the active model. With the toggle off, `/harness` reports the selector is disabled and prompt knobs match settings.
- Rollback: set the setting to false. Overlays stop applying; no files outside settings are written.
- Authority: this only changes prompt-scaffold knobs (style, thinking mode, system-prompt budget). It does not download models, raise permission tiers, auto-approve tools, or open a network port.
- Docs: [README](README.md#whats-new-in-v1180), [docs/reference/low-cost-model-optimization.md](docs/reference/low-cost-model-optimization.md).

#### ACP agent (`nexus.acp.enabled`)

- Activation: Settings > Local API server, enable the ACP toggle, or set `"nexus.acp.enabled": true`, or `NEXUS_ACP_ENABLED=1`. Reuses `nexus.serving.token`. Default off.
- Validation: with ACP on, Settings shows the shared loopback listener and `POST /acp`. `curl -i http://127.0.0.1:11500/acp` without a bearer token returns 401. With the toggle off and serving off, nothing listens on that port.
- Rollback: turn the ACP toggle off, or set `"nexus.acp.enabled": false`. The ACP mount goes away. If serving is also off, the listener stops. The token remains in `~/.nexus/settings.json` until you delete `nexus.serving.token`.
- Authority: ACP is loopback JSON-RPC only. Enabling it does not turn on OpenAI/Anthropic inference routes, does not auto-approve tools, and does not expose the filesystem. Unattended CONFIRM/DANGEROUS calls park in the ask inbox (or fail-closed if no inbox is configured).
- Docs: [README](README.md#local-api-server-opt-in), [docs/install.md](docs/install.md#after-you-install-v1180).

#### Exec sandbox (`nexus.coding.execSandbox`)

- Activation: set `"nexus.coding.execSandbox": true`, or `NEXUS_EXEC_SANDBOX=1` for the sidecar. Default off.
- Validation: run a `run_terminal` command and confirm the UI or logs say `confined` (macOS with sandbox-exec, Linux with Landlock+python3) or `partial` (Windows). With the setting off, they say `unconfined`.
- Rollback: set the setting to false or `NEXUS_EXEC_SANDBOX=0`. The next command is unconfined under the existing confirmation, denylist, and env-scrub guards. No extra artifacts to delete.
- Authority: this confines `run_terminal` spawn only. It does not skip confirmation, denylists, or the ask inbox. Windows does not kernel-enforce filesystem or network. Off or a missing backend is loud unconfined, never silent.
- Docs: [README](README.md#whats-new-in-v1180), [docs/v1/v1.18/known-gaps.md](docs/v1/v1.18/known-gaps.md) (DF-11).

#### Scheduled agent runs (`ask.scheduler.setEnabled`)

- Activation: desktop Admin > Ask inbox, enable a listed schedule (the built-in morning brief starts off). Equivalent IPC: `ask.scheduler.setEnabled`. Persist file: `~/.nexus/agent-schedules.json`.
- Validation: the Ask inbox panel shows the schedule as enabled. After a fire, consequential tools appear as pending asks in the same panel (they do not run silently).
- Rollback: disable the schedule in the panel, or set `enabled` to false in `~/.nexus/agent-schedules.json`. Disabling does not delete parked asks or `~/.nexus/ask-inbox.json`.
- Authority: enabling a schedule does not auto-approve CONFIRM or DANGEROUS tools, does not raise permission tiers, and does not bind a network port. Every wake checkpoints git and parks asks. Morning-brief content stays the Hub `agent-presets` / `morning-briefing` preset.
- Docs: [README](README.md#ask-inbox-and-scheduled-runs-opt-in), [docs/reference/skill-native-adoptions-v1.18.md](docs/reference/skill-native-adoptions-v1.18.md).

# [1.17.0](https://github.com/bendourthe/Nexus-AI/compare/v1.16.0...v1.17.0) (2026-08-16)


### Features

* **v1.17.0:** shared motion primitives and agent-state orbs (Phases 1-2) ([6f69324](https://github.com/bendourthe/Nexus-AI/commit/6f69324))
* **v1.17.0:** surface-liveness beam on composers, dock, and canvas frame (Phase 3) ([05d27f3](https://github.com/bendourthe/Nexus-AI/commit/05d27f3))
* **v1.17.0:** hero-action metal ring on send, Generate, and New session (Phase 4) ([210b7a6](https://github.com/bendourthe/Nexus-AI/commit/210b7a6))
* **v1.17.0:** one primary motion per surface (Phase 5) ([b28915a](https://github.com/bendourthe/Nexus-AI/commit/b28915a))


### Opt-in surfaces

This release changes no opt-in capability, installer flag, or host surface.

# [1.16.0](https://github.com/bendourthe/Nexus-AI/compare/v1.15.0...v1.16.0) (2026-08-16)


### Features

* **v1.16.0:** local serving gateway (Phase 1) ([67257df](https://github.com/bendourthe/Nexus-AI/commit/67257df))
* **v1.16.0:** per-model performance analytics (Phase 2) ([bfaeb86](https://github.com/bendourthe/Nexus-AI/commit/bfaeb86))
* **v1.16.0:** local document-OCR capability (Phase 3) ([c6b63a9](https://github.com/bendourthe/Nexus-AI/commit/c6b63a9))
* **v1.16.0:** document-parse agent tool + memory ingestion (Phase 4) ([e622cde](https://github.com/bendourthe/Nexus-AI/commit/e622cde))
* **v1.16.0:** MLX-via-adapters docs + model-library UX (Phase 5) ([605a0a7](https://github.com/bendourthe/Nexus-AI/commit/605a0a7))


### Opt-in surfaces

#### Local API server (`nexus.serving.enabled`)

- Activation: Settings > Local API server, or set `"nexus.serving.enabled": true` in `~/.nexus/settings.json`, or `NEXUS_SERVING_ENABLED=1`. Optional: `NEXUS_SERVING_HOST` (loopback only, default `127.0.0.1`), `NEXUS_SERVING_PORT` (default `11500`), `NEXUS_SERVING_TOKEN` (empty generates a persisted CSPRNG token).
- Validation: with the toggle on, Settings shows Running and a copyable `http://127.0.0.1:11500/v1`. `curl -i http://127.0.0.1:11500/v1/models` without a bearer token returns 401; with `Authorization: Bearer <token>` it lists installed models. With the toggle off, nothing listens on that port.
- Rollback: turn the Settings toggle off, or set `"nexus.serving.enabled": false`. The listener stops; the generated token remains in `~/.nexus/settings.json` until you delete `nexus.serving.token`. Turning the server off does not uninstall models.
- Authority: this serves model inference on loopback only. It does not expose files, terminal, tools, or memory, and it refuses to bind any non-loopback address.
- Docs: [README](README.md#local-api-server-opt-in), [docs/install.md](docs/install.md#after-you-install-v1160).

#### Document OCR models (`rapidocr-ppocrv4`, `unlimited-ocr-3b`)

- Activation: Settings > Models, install RapidOCR PP-OCRv4 (CPU, every OS) and/or Unlimited-OCR 3B (NVIDIA). Neither is auto-installed by the installer or by first launch.
- Validation: attach a PDF or image in Local Chatbot and confirm extracted text appears. RapidOCR needs no GPU; Unlimited-OCR needs a capable NVIDIA host.
- Rollback: Remove on Settings > Models. Uninstalling the model does not delete other catalog entries or Chat history.
- Authority: installing an OCR model does not send documents off the machine. Extracted text is not automatically forwarded to a chat/coding model; you choose what happens next. In-app HF install of these entries still fails digest verification until the all-zero `sha256` placeholders are rotated (LSO.P3.A); the Python installer puller is the working install path today.
- Docs: [README](README.md#document-parsing-ocr), [docs/v1/v1.16/known-gaps.md](docs/v1/v1.16/known-gaps.md).

`nexus.coding.parseDocument.enabled` and `nexus.coding.parseDocument.memoryIngest.enabled` exist and default off, but no host wires `parse_document` yet (LSO.P4.B/C), so they are not a shipped user-facing switch in this release.

# [1.15.0](https://github.com/bendourthe/Nexus-AI/compare/v1.14.0...v1.15.0) (2026-08-11)


### Bug Fixes

* **v1.15.0:** desktop shell - window controls visible + open maximized (Phase 1) ([3fca57a](https://github.com/bendourthe/Nexus-AI/commit/3fca57a341be77140fd0d626ccbd62c82f9a8ff5))
* **v1.15.0:** installer relaunch starts at Welcome; uninstall clears state (Phase 2) ([0b0247c](https://github.com/bendourthe/Nexus-AI/commit/0b0247c846a700bef7686e22ba1889731be24b38))
* **v1.15.0:** Nexus Code extension activates reliably + rename (Phase 7) ([6701f72](https://github.com/bendourthe/Nexus-AI/commit/6701f7245290565b9b029fa58ee2ab3d11334ebe))


### Features

* **v1.15.0:** Image Studio chat redesign (Phase 5) ([811a33d](https://github.com/bendourthe/Nexus-AI/commit/811a33dc56401a2b3410a7b220764604a778a17f))
* **v1.15.0:** installer download reliability + gated-token UX + retry (Phase 3) ([d0a5eac](https://github.com/bendourthe/Nexus-AI/commit/d0a5eacbace2a4145a426ab58d1e6845aed0b419))
* **v1.15.0:** real model registry - models.* IPC + disk/Ollama reconciliation (Phase 4) ([f240432](https://github.com/bendourthe/Nexus-AI/commit/f2404322505a9be56ea05da296bb273f107cfe7d))
* **v1.15.0:** Video Lab chat redesign (Phase 6) ([705cc7c](https://github.com/bendourthe/Nexus-AI/commit/705cc7c2fc37ca05fe17e3f2af512229fc8115f9))

# [1.14.0](https://github.com/bendourthe/Nexus-AI/compare/v1.13.0...v1.14.0) (2026-07-20)


### Features

* **v1.14.0:** installer catalog curation Phase 1 - release dates + gated remediation ([ae3172d](https://github.com/bendourthe/Nexus-AI/commit/ae3172da58ca3c0e9d06b1237923eaabc044af78))
* **v1.14.0:** installer install-reliability closure Phase 2 - HF auth flow + live reachability ([5e15ba3](https://github.com/bendourthe/Nexus-AI/commit/5e15ba3cf86289c01994c80c4d6e7acf5bafe254))
* **v1.14.0:** installer installing-page polish Phase 4 - uniform dependency bars, View Logs margin, footer Cancel ([91c5d56](https://github.com/bendourthe/Nexus-AI/commit/91c5d5692c70e9538ffe2b677ca94f9cc630643a))
* **v1.14.0:** installer Models-page best-of-family collapse Phase 3 - sort, disable, release-date pill ([41cb0eb](https://github.com/bendourthe/Nexus-AI/commit/41cb0eb5ffb7f103d7b0bcff271943ac6d53558c))

# [1.13.0](https://github.com/bendourthe/Nexus-AI/compare/v1.12.0...v1.13.0) (2026-07-18)


### Features

* **v1.13.0:** installer reliability Phase 1 - model catalog + Ollama pin + engine hardening ([e8b500c](https://github.com/bendourthe/Nexus-AI/commit/e8b500caba10b3689ba430c3e3fb3a7a89539cb1)), closes [#15447](https://github.com/bendourthe/Nexus-AI/issues/15447)
* **v1.13.0:** installer reliability Phase 2 - default-model preflight harness ([30bc2f0](https://github.com/bendourthe/Nexus-AI/commit/30bc2f023a2b279480a423fcd340a6695fdfdc36))
* **v1.13.0:** installer reliability Phase 3 - gradient AI Studio wordmark + truncation fix ([8c0a1c5](https://github.com/bendourthe/Nexus-AI/commit/8c0a1c55d07c59da6f37111297d270b5307cbfcd)), closes [#3b82f6](https://github.com/bendourthe/Nexus-AI/issues/3b82f6) [#38bdf8](https://github.com/bendourthe/Nexus-AI/issues/38bdf8) [#22d3ee](https://github.com/bendourthe/Nexus-AI/issues/22d3ee)
* **v1.13.0:** installer reliability Phase 4 - disk check + models tab-walk + VRAM sort/disable ([4ea25ac](https://github.com/bendourthe/Nexus-AI/commit/4ea25ac3fd853fa1119f867041e067283ddfdf79))
* **v1.13.0:** installer reliability Phase 5 - installing-page mockup redesign ([9af71d6](https://github.com/bendourthe/Nexus-AI/commit/9af71d621accdccb337d52b5a51e8b5585aad0f0))

# [1.12.0](https://github.com/bendourthe/Nexus-AI/compare/v1.7.0...v1.12.0) (2026-07-18)


### Bug Fixes

* **guide:** use Nexus AI favicon in the browser-tab instead of the placeholder X ([2fb2253](https://github.com/bendourthe/Nexus-AI/commit/2fb2253a4fe906382ae257ce0614e5d642f3afb8))
* **installer:** PS 5.1 PyInstaller build-reliability fix + v1.9.0 UI font-size polish ([bcdaba1](https://github.com/bendourthe/Nexus-AI/commit/bcdaba118892cb931b248429196647cace19ad6a))
* **installer:** resolve ollama pull target from source.url + never hang on a failed pull ([5411260](https://github.com/bendourthe/Nexus-AI/commit/54112605d10b263e3e22f7ffab58278e1f46ba4d))
* **installer:** VS Code extension install (no-console spawn) + enlarge header banner ([5341392](https://github.com/bendourthe/Nexus-AI/commit/5341392ba57ad17918f7c036a2cdb9beec818d1a))
* **packaging:** trim VSIX bloat + PS 5.1 vsce/electron-rebuild reliability ([fdf9013](https://github.com/bendourthe/Nexus-AI/commit/fdf901367d06199d823aca0da16957866f8f65c3))


### Features

* **desktop:** process-wide dark mode so native dialogs/file-pickers match the theme ([ec05830](https://github.com/bendourthe/Nexus-AI/commit/ec058300bb3399c13057251f9bea9699a6ee6b33))
* **installer:** installing-page redesign (per-step progress + logs export) + dark dialog title bars ([5aa156c](https://github.com/bendourthe/Nexus-AI/commit/5aa156ca8cbc02f0b82054d6666317c282144260))
* **v1.10.0:** Nexus-Hub consumption Phase 1 - catalog-path + layout resolver (T001-T005) ([6fae1fd](https://github.com/bendourthe/Nexus-AI/commit/6fae1fd86473e97f3cb147930ac8ad74856a4150))
* **v1.10.0:** Nexus-Hub consumption Phase 2 - rename + retarget syncer to isolated catalog subtree (T006-T013) ([01e081f](https://github.com/bendourthe/Nexus-AI/commit/01e081f612fa4e23503aa1409dbe503be839104c))
* **v1.10.0:** Nexus-Hub consumption Phase 3 - reroute readers to the catalog resolver (T014-T020) ([cc6f400](https://github.com/bendourthe/Nexus-AI/commit/cc6f400aef90d172b826528ff1a2f044827a19a0))
* **v1.10.0:** Nexus-Hub consumption Phase 4 - rename AutoSync + one-shot migration + guarded cleanup (T021-T025) ([b3c6866](https://github.com/bendourthe/Nexus-AI/commit/b3c68665d8b7b216fbd6882ba9cd55879851e1ec))
* **v1.10.0:** Nexus-Hub consumption Phase 5 - remove the installer bundled-baseline redundancy (T026-T030) ([2b7743d](https://github.com/bendourthe/Nexus-AI/commit/2b7743d26c0defd282b015c740b849ddfa5b90da))
* **v1.10.0:** Nexus-Hub consumption Phase 6 - live first-launch fetch + skills.* IPC + update detection (T031-T034,T036) ([cf89f01](https://github.com/bendourthe/Nexus-AI/commit/cf89f01f7c570c392ff8ffbc009db8f01459080a))
* **v1.10.0:** Nexus-Hub consumption Phase 7 - DevAI/devai naming scrub (T037-T040) ([6860db5](https://github.com/bendourthe/Nexus-AI/commit/6860db593861d5d3061ea2086c158aee945cdc8a))
* **v1.10.0:** Nexus-Hub consumption Phase 8 FINAL - docs architecture refactor + CI gate (T041-T048) ([620d709](https://github.com/bendourthe/Nexus-AI/commit/620d709885cb23284856ed379073c2fa5678028e))
* **v1.11.0:** installer overhaul Phase 1 - download-engine root-cause + parallel per-model progress (T101-T106) ([74ce18c](https://github.com/bendourthe/Nexus-AI/commit/74ce18c874d30ed34b03f884fae2c81663cd63e8))
* **v1.11.0:** installer overhaul Phase 2 - clean-machine test harness (T201-T205) ([946659a](https://github.com/bendourthe/Nexus-AI/commit/946659ad72e99dd31b1d41c3881eb43b4bfa857a))
* **v1.11.0:** installer overhaul Phase 3 - dependency self-sufficiency (T301-T304) ([9741c15](https://github.com/bendourthe/Nexus-AI/commit/9741c15da1f1a3f1c380b6c147672c1e4be4cb17))
* **v1.11.0:** installer overhaul Phase 4 - embed the desktop app (T401-T404) ([24047b6](https://github.com/bendourthe/Nexus-AI/commit/24047b633f1f85ba5ec6a46b7ff1723edf407d3b))
* **v1.11.0:** installer overhaul Phase 5 - installing-page progress UX v2 (T501-T506) ([6e1b0dc](https://github.com/bendourthe/Nexus-AI/commit/6e1b0dc0e16f0814252603338af42a885e35ced0))
* **v1.11.0:** installer overhaul Phase 6 - mockup shell (T601-T605) ([ef03f6a](https://github.com/bendourthe/Nexus-AI/commit/ef03f6a29ca901beb774148e9d25ee441d834638))
* **v1.11.0:** installer overhaul Phase 7 - full background continuation (T701-T705) ([17772ce](https://github.com/bendourthe/Nexus-AI/commit/17772ce3e30eda5ad0a992b1354cc02fcb1b14b7))
* **v1.11.0:** installer overhaul Phase 8 (final) - refactor + known-gaps + CI/CD (T801-T804) ([51983fb](https://github.com/bendourthe/Nexus-AI/commit/51983fb86c80412b91d36960550f8e934cf368ae))
* **v1.12.0:** ecosystem adoption Phase 1 - per-model harness selector + low-cost-model guidance ([5af03d4](https://github.com/bendourthe/Nexus-AI/commit/5af03d4115ec3d987385008ce764a153e58ce178))
* **v1.12.0:** ecosystem adoption Phase 2 - desktop skill-optimizer approval UI (EM.P2.A) ([d1a19b1](https://github.com/bendourthe/Nexus-AI/commit/d1a19b12639e80a92676866c0095621ba89581eb))
* **v1.12.0:** ecosystem adoption Phase 2 - nexus skills frontier CLI + Pareto composition root ([973061d](https://github.com/bendourthe/Nexus-AI/commit/973061d3f48fe4c0ff67352fb52c06f202fe901f))
* **v1.12.0:** ecosystem adoption Phase 2 - surface v1.7 optimizer via CLI + composition root ([390546f](https://github.com/bendourthe/Nexus-AI/commit/390546f36fda9fabb17eb07e12b066dfe909370d))
* **v1.12.0:** ecosystem adoption Phase 3 - extreme-low-bit (BitNet-class) tier gate (Q1) ([a2910af](https://github.com/bendourthe/Nexus-AI/commit/a2910af05d736c1d84dca483afc7b44b14ea45e8))
* **v1.12.0:** ecosystem adoption Phase 4 - disk-offload patient tier (E1/E3); E2 deferred ([ef53764](https://github.com/bendourthe/Nexus-AI/commit/ef5376419261775916f295d34c48b5e82cefc811))
* **v1.12.0:** ecosystem adoption Phase 5 - exec-sandbox audit (H3) + run_terminal secret-path gate ([9d63227](https://github.com/bendourthe/Nexus-AI/commit/9d632272a20f8ecff61e6e4203589945805db8b6))
* **v1.8.0:** brand installer + desktop icons with the Nexus logo (phase 6 follow-up) ([390983b](https://github.com/bendourthe/Nexus-AI/commit/390983b37bba5f6a04d8d0e8fdbbd48bf5afc63e))
* **v1.8.0:** catalog curation + chat/agentic split - uncensored tier defaults (phase 4) ([484e9ea](https://github.com/bendourthe/Nexus-AI/commit/484e9eab424383f73a09a07a5655caa03084cc09))
* **v1.8.0:** convenience-copy NexusSetup.exe to repo-root dist (phase 6 follow-up) ([2e6ada2](https://github.com/bendourthe/Nexus-AI/commit/2e6ada282fc036e64465d881f8dda9b5b18c2039))
* **v1.8.0:** desktop provisioner - the installer installs Nexus (phase 2) ([d13946a](https://github.com/bendourthe/Nexus-AI/commit/d13946ab88acfb103a1d66987591e3a6353bf109))
* **v1.8.0:** desktop-token restyle + per-phase progress UX (phase 5) ([5430cb4](https://github.com/bendourthe/Nexus-AI/commit/5430cb4a241128456f91d89ca98503f59390bea3)), closes [11151f/#181d2a](https://github.com/bendourthe/Nexus-AI/issues/181d2a) [#d6dbe7](https://github.com/bendourthe/Nexus-AI/issues/d6dbe7) [191c22/#272a30](https://github.com/bendourthe/Nexus-AI/issues/272a30) [#22d3ee](https://github.com/bendourthe/Nexus-AI/issues/22d3ee) [QWidget#modelCard](https://github.com/QWidget/issues/modelCard)
* **v1.8.0:** hugging face weights downloader - image/video models become real (phase 3) ([dbb2b99](https://github.com/bendourthe/Nexus-AI/commit/dbb2b9998449188be2bc0ad056722b06524ccdbe))
* **v1.8.0:** release pipeline ships desktop bundles + artifact rename (phase 1) ([e4b5212](https://github.com/bendourthe/Nexus-AI/commit/e4b5212476f848dee916311d632beb4ac7390fb7))
* **v1.8.0:** windows exe completion - real installer pipeline + download docs (phase 6) ([c1fa52e](https://github.com/bendourthe/Nexus-AI/commit/c1fa52efca04412c3a58d4706b8886ea83c83c94))
* **v1.9.0:** desktop app Nexus AI Studio overhaul - frameless title bar, constellation bg, rebrand, audio DTO (phase 5) ([af98fb7](https://github.com/bendourthe/Nexus-AI/commit/af98fb7a60852d314a19bf3048a7adc56c68b6e7))
* **v1.9.0:** installer visual overhaul - frameless title bar, constellation bg, Nexus AI Studio rebrand, NexusAI path (phase 3) ([db30ebb](https://github.com/bendourthe/Nexus-AI/commit/db30ebb5467fb4997c8c74c5244f680492c35db7))
* **v1.9.0:** model selector redesign - origin/guardrails/agentic metadata, card restyle, Gemma-4 agentic, audio pillar (phase 4) ([cac6f4a](https://github.com/bendourthe/Nexus-AI/commit/cac6f4a7ab0f978ba56eaf3bd10e9b9c5d54132c))
* **v1.9.0:** shared brand foundation - icons, glow tokens, constellation + float-logo primitives (phase 2) ([3ad61b8](https://github.com/bendourthe/Nexus-AI/commit/3ad61b8e6bff046010ab91a0d1999be7a7b1b523))
* **v1.9.0:** single-artifact installer build - drop NSIS (phase 1) ([b2f825e](https://github.com/bendourthe/Nexus-AI/commit/b2f825e82c45ad156cbef468feb8aab0f427d75d))
* **v1.9.0:** UI-rework Phase 1 - shared design foundations (T001-T004) ([7f93303](https://github.com/bendourthe/Nexus-AI/commit/7f9330300f538b990d6e51e2596a4f90cedd3318)), closes [#7](https://github.com/bendourthe/Nexus-AI/issues/7)
* **v1.9.0:** UI-rework Phase 2 - plain-language catalog copy rewrite (T005-T007) ([1f13bdc](https://github.com/bendourthe/Nexus-AI/commit/1f13bdcdf13477a9922cc04e9eefac6d0c88ecdb)), closes [#8](https://github.com/bendourthe/Nexus-AI/issues/8)
* **v1.9.0:** UI-rework Phase 3 - installer typography + hierarchy sweep (T008-T011) ([9bf992f](https://github.com/bendourthe/Nexus-AI/commit/9bf992f0b3c8723ac9164d19e7b42c3b1a7b29ae)), closes [QLabel#pageTitle](https://github.com/QLabel/issues/pageTitle) [QLabel#sectionHead](https://github.com/QLabel/issues/sectionHead) [QLabel#errorLabel](https://github.com/QLabel/issues/errorLabel)
* **v1.9.0:** UI-rework Phase 4 - logo de-lag + two-tone wordmark + stepper legibility (T012-T017) ([d74d9b5](https://github.com/bendourthe/Nexus-AI/commit/d74d9b521e0b119a5bf4a97e3d4edf382cd4a00b)), closes [#eaf6f8](https://github.com/bendourthe/Nexus-AI/issues/eaf6f8) [#6f8990](https://github.com/bendourthe/Nexus-AI/issues/6f8990)
* **v1.9.0:** UI-rework Phase 5 - installer chrome: taskbar/window icon + scrollbars + checkbox (T018-T021) ([cecb0a1](https://github.com/bendourthe/Nexus-AI/commit/cecb0a1bd4ee206024f27e4591ba4b98cdc0ade5))
* **v1.9.0:** UI-rework Phase 6 - Models page per-provider color + plain-language cards (T022-T025) ([10af81c](https://github.com/bendourthe/Nexus-AI/commit/10af81c46f3d2d23704a63e070a62c9768146d84)), closes [#7](https://github.com/bendourthe/Nexus-AI/issues/7)
* **v1.9.0:** UI-rework Phase 7 - installer copy/readability pass + end-to-end QA (T026-T028) ([e2cf0a7](https://github.com/bendourthe/Nexus-AI/commit/e2cf0a78529a8dc2cfb36458e5f7fad3cf869536))
* **v1.9.0:** UI-rework Phase 8 - app aurora generation animation (T029-T032) ([74c6410](https://github.com/bendourthe/Nexus-AI/commit/74c6410a14e5db91e33609c30ed9d25f6d8b4aab))
* **v1.9.0:** UI-rework Phase 9 FINAL - app chat disclaimer + logo/icon parity + cycle close (T033-T036) ([d291c2a](https://github.com/bendourthe/Nexus-AI/commit/d291c2a06ae704c67c4f63f830528dc518f40a33))

# [1.7.0](https://github.com/bendourthe/Nexus-AI/compare/v1.6.0...v1.7.0) (2026-07-02)


### Bug Fixes

* **ci:** clear prod-audit (undici 7.28.0) and catalog-sync (docs/index.md) gates ([d123c6c](https://github.com/bendourthe/Nexus-AI/commit/d123c6cb4e6986794f3c64680dfb4f61738fd495)), closes [hi#severity](https://github.com/hi/issues/severity)
* **ci:** cover the OF011 panel-router construction to satisfy the coverage gate ([dfce0d6](https://github.com/bendourthe/Nexus-AI/commit/dfce0d6ffb5b9d33ece0bb4129d9085daa9c1097))
* **skills:** cone-mode + canonical-LF sparse-checkout; make manifest verify advisory ([60ee303](https://github.com/bendourthe/Nexus-AI/commit/60ee303cb9dbe107f73edf0d285939ea1908c6ae))


### Features

* **cli:** nexus golden run over the headless agent (v1.7.0 SO001.P1.B) ([e816f17](https://github.com/bendourthe/Nexus-AI/commit/e816f172b51c9b96d1d5bd833718ac63581a9b18))
* **desktop:** route Image/Video to the real Python diffusion runtime ([05bd45d](https://github.com/bendourthe/Nexus-AI/commit/05bd45dd123d06dfe3a5fbe2e9bac7ae35cad0cc))
* **desktop:** wire the Local Chatbot Explorer to a real local-model chat stream ([9273303](https://github.com/bendourthe/Nexus-AI/commit/9273303c11fdc20de991bbe8d2bc9a7e7417ab05))
* **desktop:** wire the real headless agent into the sidecar Coding pillar (RT.P7.A) ([669f330](https://github.com/bendourthe/Nexus-AI/commit/669f3300c430096c0eb5c22403cb5eb345d62b99))
* **evaluation:** held-out split + validation gate + rejected-edit buffer (v1.7.0 P2, SO002) ([0b8ad7e](https://github.com/bendourthe/Nexus-AI/commit/0b8ad7e996920d5979fc3aaa2d24d2bc87b63c63))
* **evaluation:** TS-native golden-task live runner (v1.7.0 P1, SO001) ([a60714f](https://github.com/bendourthe/Nexus-AI/commit/a60714f2956d96329fae8f69bcbefd8e53285dc8))
* **guardrails:** tree-sitter shell-command introspection for permission gating (v1.7.0 P5, SO006) ([f027659](https://github.com/bendourthe/Nexus-AI/commit/f0276592c7a4e9f92e7cc03d29d0a759bc58089a))
* **observability:** add in-dashboard "Export trace" button (AS004.P2.B) ([56f208f](https://github.com/bendourthe/Nexus-AI/commit/56f208f3523532252eb6c63f81c5994efa8d6c3c))
* **runtime:** vscode-free headless agent runtime + AgentDriver (v1.7.0 SO001.P1.A) ([3278188](https://github.com/bendourthe/Nexus-AI/commit/327818817928305acf1cab30d62d9f68eecdc8df))
* **skilloptimizer:** bounded-edit skill optimizer + A/B (v1.7.0 P3, SO003 + SO004) ([02ab67f](https://github.com/bendourthe/Nexus-AI/commit/02ab67fdff8088e754ea011c8700d7f711c941ee))
* **skilloptimizer:** Pareto-frontier candidate management on git branches (v1.7.0 P4, SO005) ([21c52bc](https://github.com/bendourthe/Nexus-AI/commit/21c52bc9e4949f9fbc4697f3b9ad89bd0b67c2c3))
* **skilloptimizer:** production rollout + candidate seams (v1.7.0 SO003.P3.B, SO005.P4.A/B) ([f345639](https://github.com/bendourthe/Nexus-AI/commit/f345639f81a8202c876fda16c983e243df0bef4a))
* **skills:** Hub v3.10.0 supply-chain verify + HTTPS-only + hash-on-import (adoption P1) ([c6ef123](https://github.com/bendourthe/Nexus-AI/commit/c6ef1235ccb053f445730f2e0a407abdae69ba6b))
* **skills:** scanner allowlist for trusted Hub source; complete v3.10.0 adoption ([f80be0e](https://github.com/bendourthe/Nexus-AI/commit/f80be0e2611f9ac727fd68e40f68727303ccaad2))

## [1.6.0] - 2026-06-18

Major GA milestone consolidating the v1.4.0 -> v1.6.0 development line into the published release. Local-first, zero-outbound throughout (MCP Registry Policy clean).

### Highlights

- **Local model panel + judge fusion (opt-in).** A diverse panel of local models, fused by a local judge (the `fuse` skill), as the local stand-in for a frontier fallback. Wired into the live chat turn behind `nexus.llm.panelRouting` (default off); a local A/B measured no net win on a small coding fixture, so it ships opt-in (`PanelExecutor` / `FusionAgent` / `PanelRouter`, OF010 + OF011).
- **Local-runtime adapter registry.** Register a loopback-only inference runtime by manifest via `nexus.llm.localAdapters` (non-local endpoints rejected per the MCP Registry Policy).
- **Shareable trace export.** `nexus trace export` writes a self-contained, offline HTML session/trace viewer.
- **Session-state artifact dehydration**, **hierarchical sub-run trace nesting**, and the self-contained **Nexus-AI interactive guide**.

### Security / CI

- `dompurify` bumped to `^3.4.11` (clears 7 advisories in-range); the `protobufjs` advisory is allowlisted (optional, unreachable transitive with no in-range fix).
- All gates green: build, lint, architecture, prompts, tampering, security, prod-audit, the full TypeScript suite, and the desktop suite.

See the per-cycle docs under `docs/versions/v1/` and `docs/DEVLOG.md` for the full history.

## Earlier releases

# [0.44.0](https://github.com/bendourthe/Nexus-AI/compare/v0.43.0...v0.44.0) (2026-06-16)


### Bug Fixes

* **ci:** regenerate docs/index.md after the Phase 7 src move ([18a7be5](https://github.com/bendourthe/Nexus-AI/commit/18a7be5a6abab5a0d452b0136349cb3bdf1901bb))
* **test:** accept 1.x version in PyQt installer smoke tests ([e40ae20](https://github.com/bendourthe/Nexus-AI/commit/e40ae20be13a2e3853f87998e80798d3800192d3))
* **v1.2.0:** regenerate docs/index.md and record pre-existing protobufjs CVE ([5ecfa9b](https://github.com/bendourthe/Nexus-AI/commit/5ecfa9b935c6cd8b071ceef1667ffa9f3896c3de))
* **v1.2.0:** regenerate tool-permission table for codegraph + lsp tools ([65d1e35](https://github.com/bendourthe/Nexus-AI/commit/65d1e355a133ace30fe215e6041024f8bb13aab1))
* **v1.5.0:** fix Windows smoke Ollama detection (auto-start + IPv4) ([3189f88](https://github.com/bendourthe/Nexus-AI/commit/3189f880d62943f3d855941c4dd4f4dfff108be0))
* **v1.5.0:** green CI, Nightly, and Installer-smoke workflows ([81043b7](https://github.com/bendourthe/Nexus-AI/commit/81043b7cdb9eeeb0a58619616488a6cc1892e7a5))
* **v1.5.0:** install httpx in the Windows installer-smoke job ([b96fbb4](https://github.com/bendourthe/Nexus-AI/commit/b96fbb49e5f8aad9056dacd05b58b8761b6271db))
* **v1.5.0:** make Windows smoke Ollama startup robust + self-diagnosing ([8bdbd69](https://github.com/bendourthe/Nexus-AI/commit/8bdbd69a65411ecba84c39393edca3f3af7f203d))


### Features

* **v1.2.0:** phase 1 skill-native foundation ([d97a643](https://github.com/bendourthe/Nexus-AI/commit/d97a6438af8de52c57a9f43d56ca1929fd83d50f))
* **v1.2.0:** phase 2 command-output compression ([1d43b9f](https://github.com/bendourthe/Nexus-AI/commit/1d43b9f2ec2c46fdf7e6e4437e8bacf312bef4a9))
* **v1.2.0:** phase 3 code-graph mcp module ([5b63989](https://github.com/bendourthe/Nexus-AI/commit/5b6398975e33cf8529bc74861aaaa1c665181a41))
* **v1.2.0:** phase 4 memory enhancements (leann-derived) ([e690f97](https://github.com/bendourthe/Nexus-AI/commit/e690f9705978d63e691ce44ee770e943b9680d29))
* **v1.2.0:** phase 5 agent loop policy enforcement ([8cff2ec](https://github.com/bendourthe/Nexus-AI/commit/8cff2eca0a64f700b95e2037df2e7e0f70114ee6))
* **v1.2.0:** phase 6 re-partial integrations ([ab830ae](https://github.com/bendourthe/Nexus-AI/commit/ab830aea2f0212fcf34f4177d1828ac743ae881e))
* **v1.2.0:** phase 7 stabilization benchmarks and adoption closure ([d20743b](https://github.com/bendourthe/Nexus-AI/commit/d20743b5a594f51ad8fc2d3843f6427b4acbfd75))
* **v1.3.0:** foundational skills-audit utilities ([eeb56c4](https://github.com/bendourthe/Nexus-AI/commit/eeb56c446b37a1eaadd36ff117421f9aa0884157))
* **v1.3.0:** skills audit command (phase 3) ([24eaab5](https://github.com/bendourthe/Nexus-AI/commit/24eaab591b136c7a9464d148c075d190da2ddf25))
* **v1.3.0:** skills-audit benchmark + P7 docs ([4250df6](https://github.com/bendourthe/Nexus-AI/commit/4250df672f3ba4f2f3a718f0edc721bb2adbf074))
* **v1.3.0:** skills-audit P3 flags + hub rules ([b58dfd4](https://github.com/bendourthe/Nexus-AI/commit/b58dfd403041c1e8f76c1848b3beedf34006bff2))
* **v1.3.0:** skills-audit render-budget ladder ([248091d](https://github.com/bendourthe/Nexus-AI/commit/248091d54bd76f1f5a152299a81f8ba95b86a15b))
* **v1.3.0:** skills-audit similarity + usage ([e207f4e](https://github.com/bendourthe/Nexus-AI/commit/e207f4e7e17263d9afbb65e6ce706281ca3fa131))
* **v1.4.0:** phase 1 skill-native conventions ([03e9e30](https://github.com/bendourthe/Nexus-AI/commit/03e9e300477c8af88cef93a18a6da1bd02472724))
* **v1.4.0:** phase 2 egress denylist + env scrub ([e48127c](https://github.com/bendourthe/Nexus-AI/commit/e48127cb6dd475b3eb9d361141d9fad14e4212f7))
* **v1.4.0:** phase 3 test-tampering + scorecard ([f9d7883](https://github.com/bendourthe/Nexus-AI/commit/f9d788368b45e6dfaab16dacbab16d534dd59088))
* **v1.4.0:** phase 4 safety config SSOT ([8e98da3](https://github.com/bendourthe/Nexus-AI/commit/8e98da39b96047be05680d5890efd672dfc9384e))
* **v1.4.0:** phase 5 operator tooling (A6, A8) ([e162e27](https://github.com/bendourthe/Nexus-AI/commit/e162e279556e37712d1ab4215d05d45f5f5e7d52))
* **v1.4.0:** phase 6 parallel agent exec (A10) ([4f51e53](https://github.com/bendourthe/Nexus-AI/commit/4f51e53d1b5ec0f38159bea362be3cfcdd7b4a11))
* **v1.4.0:** phase 7 T020 src->modules/coding move (gap 1.4.P1.B) ([3588dc3](https://github.com/bendourthe/Nexus-AI/commit/3588dc38a36bc6734a2155fa30ca9da3920435e1))
* **v1.4.0:** phase 7 T021 tsc -b project references (gap 1.1.P1.A) ([43fbd24](https://github.com/bendourthe/Nexus-AI/commit/43fbd24985cae825b0ae3a35db0a5513b3cc4442))
* **v1.4.0:** phase 7 T022 tree-sitter (WASM) scanner (gap 3.3.P2.G) ([f921bb4](https://github.com/bendourthe/Nexus-AI/commit/f921bb49fc434a6354f348fc51daee73928fa9e8))
* **v1.4.0:** phase 7 T023 PrunedDenseIndex multi-layer HNSW build (gap 4.2.P3.K) ([435c38e](https://github.com/bendourthe/Nexus-AI/commit/435c38e1c03677b01a9f3744ec5ae006d3edb768))
* **v1.4.0:** phase 8 T025 migrate embedder to @huggingface/transformers (gap 7.x.P1.D) ([b048438](https://github.com/bendourthe/Nexus-AI/commit/b048438da88e4416b2770e3a8a57523b7e8bd9f8))
* **v1.4.0:** phase 8 T026 wire permissions.deny gate + unify codegraph ignore parser (gaps 5.3.P2.R, 5.3.P3.S, 6.1.P3.W) ([a076f0d](https://github.com/bendourthe/Nexus-AI/commit/a076f0d393cb7463076e367c9b3fc9b27b1ce447))
* **v1.4.0:** phase 8 T027 live-wire session-reflection, path-scope reevaluation, explore-MCP classification (gaps 5.4.P3.T, 5.2.P3.Q, 5.1.P2.P, 5.1.P2.O) ([3a2852f](https://github.com/bendourthe/Nexus-AI/commit/3a2852f15dac393ac18fb5c5b2f0b8b340450d49))
* **v1.4.0:** phase 8 T028 LSP install prompts + desktop DOMPurify sanitiser (gaps 6.2.P2.X, 6.2.P3.Y, 6.3.P2.Z) ([fd04d4e](https://github.com/bendourthe/Nexus-AI/commit/fd04d4e88b114789ef2c9bd72b766d91613f3463))
* **v1.4.0:** phase 8 T029 clear remaining v1.2.0 hygiene deferrals (gaps 2.4.P2.E, 2.4.P3.F, 4.3.P3.M, 4.x.P3.N, 3.4.P3.H, 3.5.P3.I, 6.1.P3.U) ([0672871](https://github.com/bendourthe/Nexus-AI/commit/0672871646686ef8f59bf35a8ea91565c4a452a6))
* **v1.4.0:** phase 8 T030 100k memory benchmark, multi-root usage scan, audit deferrals (gaps 4.4.P2.L, 7.1.P2.A, T012.P2.C, T013.P3.D) ([dcd843f](https://github.com/bendourthe/Nexus-AI/commit/dcd843f65f793399f6cc21cca2d0a989e75867b0))
* **v1.4.0:** phase 9 FINAL Nexus-Hub sync + whole-plan acceptance gate ([0034c12](https://github.com/bendourthe/Nexus-AI/commit/0034c12686dfde02873c5ae70e8e3c63b9a4263a))
* **v1.5.0:** Hub integration HUB.P3.AGENT (Phase 7) ([55833d9](https://github.com/bendourthe/Nexus-AI/commit/55833d9ee440049c3c5ccb709b93dfb7273f86c6))
* **v1.5.0:** Hub integration HUB.P3.CMD (Phase 7) ([5641009](https://github.com/bendourthe/Nexus-AI/commit/564100980ec78c509ffa9c6908703687d566a7d9))
* **v1.5.0:** Hub integration HUB.P3.DATA + HUB.P3.RULES (Phase 7) ([04a0c43](https://github.com/bendourthe/Nexus-AI/commit/04a0c4318d4239662b432bcd6131b2abb89a0ca2))
* **v1.5.0:** Hub integration HUB.P3.HOOK + HUB.P3.MCPCFG (Phase 7) ([3e918a1](https://github.com/bendourthe/Nexus-AI/commit/3e918a1ef3334eea45727ed1a3ff2f3b680ea64b))
* **v1.5.0:** phase 1 local-only foundations (GGUF ladder, credential vault, energy telemetry) ([b60dfca](https://github.com/bendourthe/Nexus-AI/commit/b60dfcafb56e91162a319775e2ada63841e0bd49))
* **v1.5.0:** phase 3 inbound prompt-injection classifier (warn-then-allow) ([ee64720](https://github.com/bendourthe/Nexus-AI/commit/ee64720177f6c533064294a14d0a6ac23523ff94))
* **v1.5.0:** phase 4 swarm/DAG orchestration (planner/critic/worker; closes T018.P3.A/B + T016.P3.A) ([04efdbf](https://github.com/bendourthe/Nexus-AI/commit/04efdbf6f59cb9b26b20aa4e88567e984282b983))
* **v1.5.0:** phase 5 model-layer & desktop re-partials (multimodal input, preview pane, vault-only credential UI, cross-surface session resume; closes T015-T020, defers item 38) ([72b562a](https://github.com/bendourthe/Nexus-AI/commit/72b562a6a855db3274871ae83d5c111d92916dbe))
* **v1.5.0:** phase 6 Tree-sitter wasm packaging closure (closes T021-T022, T022.P3.A) ([04e1da4](https://github.com/bendourthe/Nexus-AI/commit/04e1da41d00f23629e1edbd60eeb7c800f4912d9))

# [0.43.0](https://github.com/bendourthe/Nexus-AI/compare/v0.42.0...v0.43.0) (2026-05-26)


### Features

* **v1.1.0:** phase 15 hardening and release gate static portion ([de150d7](https://github.com/bendourthe/Nexus-AI/commit/de150d71ff762872e7f9d0dc6b3ecb93cccfb9e7))

# [1.1.0](https://github.com/bendourthe/Nexus-AI/compare/v1.0.0...v1.1.0) (2026-05-26)

The stabilization-plus-expansion release that follows v1.0.0. Closes the v1.0.0 shared-core build carryforward cluster (storage-path rename, manifest IDs, npm package + publisher rename, duplicate-catalog removal, curator-cadence fallback delete, CRLF/LF snapshot normalization, SHA-pinned actions), turns the Windows-only PyQt installer into a canonical cross-platform installer (Windows + macOS + Linux), ships the renamed `nexus-coding` VS Code extension as a multi-model agentic add-on, adopts the NVIDIA SANA family as the default Image Studio + Video Lab pipeline, and upgrades the memory subsystem end-to-end (hybrid retrieval, local embedder, provenance, 12-hook lifecycle bus, Ebbinghaus decay, session replay timeline, `/recall` / `/remember` / `/forget` slash commands, opt-in contradiction resolver, file compressor).

The cycle ingests 65 carryforward items from `docs/versions/v1/v1.0.0/known-gaps.md` plus 22 new items across the agentmemory and SANA comparisons. 66 close in cycle (Phases 1-14); 33 carry forward to v1.2.0 (8 P1 + 24 P2 + 1 P3 -- all documented deferrals with placeholders, none release-blocking).

### Added

Phase 1 -- Shared-core decision + carryforward closure (commit `ec3ff0e`):
- Shared-core ADR at `docs/versions/v1/v1.1.0/development/decisions/shared-core-build.md` records option (a) -- project references with `composite: true` -- as the chosen strategy.
- Storage-path rename: `~/.gemma-code/` -> `~/.nexus/` cascaded across `src/`, `tests/`, `scripts/`. The `nexusHome()` helper is the single source of truth.
- Settings `package.json` `deprecationMessage` injection for every legacy `gemma-code.*` schema entry.
- Curator-cadence fallback deleted from `AgentLoop`; `IdleTimeScheduler` is the sole curator entry point.
- CRLF/LF snapshot normalization across `SubAgentManager.characterization.test.ts` (Windows / Linux parity).
- SHA-pin enforcement against the `shell-build.yml` workflow actions.

Phase 2 -- Rebrand + sidecar core extraction (commit `de219a5`):
- VS Code manifest IDs flip from `gemma-code.*` to `nexus.coding.*`; npm package + publisher rename to `nexus-coding`.
- Sidecar duplicate model catalogs deleted in favour of the canonical `core/registry/` source.

Phase 3 -- Coding-module codemod + first sub-tree migration (commit `f3429c4`):
- `scripts/dev/rewrite-imports.mjs` -- generic import-rewriting codemod consumed by Phase 3 + future sub-tree migrations.
- `src/utils/` -> `modules/coding/utils/` migration (6 files moved, 65 importers rewritten).

Phase 4 -- Memory provenance + HookBus + secret pre-index filter (commit `9323352`):
- `MemoryEntry.lifecycleProvenance: {sessionId, hookKind, toolName?, parentSpanId?}` field on every memory write.
- SQLite migration adds `provenance TEXT NULL` + `scope_id TEXT NULL` to `memories`, `episodic_events`, `graph_relations` with helper indexes. Schema version bumped to 3.
- `core/lifecycle/HookBus.ts` defines a 12-variant `LifecycleEvent` discriminated union; `InProcessHookBus` wraps `TelemetryBus` so existing trace consumers see the events. `AgentLoop.run` / `_runToolCall` / `spawnSubAgent` emit five of the twelve hooks today; four remain deferred to Phase 1b alongside the `src/runtime/` migration.
- `core/observability/redactSecrets.ts` consolidates the trace-side patterns into a single string-in / string-out scrubber (AWS keys, GitHub PATs classic + fine-grained, Slack tokens, JWTs, PEM private-key blocks, env-style assignments). Wired into `MemoryStore.save(...)` so every memory write is scrubbed before SQLite insert. Adopts agentmemory A8 + A5 + A7.

Phase 5 -- Hybrid retrieval + local embedder + warm-rebuild worker (commit `afac447`):
- `core/memory/LocalEmbedder.ts` wraps `@xenova/transformers` + the `all-MiniLM-L6-v2` ONNX weights (~80 MB; production hosts source from `~/.nexus/runtimes/embedder/`). Falls back to a deterministic 384-dim hash sketch when the optional dependency is absent (CI-friendly).
- `core/memory/Bm25Index.ts` builds an inverted index over `memory_entries` with 5 ms median rebuild on memory write.
- `core/memory/HybridRetriever.ts` fuses BM25 + dense + graph traversal via Reciprocal Rank Fusion (k=60 default; exposed via `nexus.memory.rrf.k`).
- `core/memory/WarmRebuildWorker.ts` reads all `memory_entries` rows and embeds them in batches of 32 on first launch or when the indexes are detected stale via a hash-of-row-count fingerprint. Adopts agentmemory A1 + A2.

Phase 6 -- Memory CLI + Ebbinghaus decay + slash commands (commit `c8d9e0b`):
- `nexus memory audit --since <date>` prints a tabular log of memory writes with provenance.
- `nexus memory export --out <path.jsonl>` and `nexus memory import` (round-trip integrity asserted at the unit level).
- `nexus memory decay --now` fires the sweep manually for debugging.
- `/recall <query>` (hybrid top-K), `/remember <text>` (working-tier observation), `/forget --id <uuid>` or `/forget --pattern <regex>`.
- `core/memory/DecaySweep.ts` implements the closed-form Ebbinghaus retention curve `R(t) = exp(-t/halfLife * ln(2))` with per-tier half-lives (working = 24 h, episodic = 7 d, semantic = 30 d, graph = 365 d). Eviction rule: `retention < 0.05 AND accessCount < 3`. Adopts agentmemory A3 + A10 + A11 + A12.
- Memory panel "Forget" button per row (signals via `onForget` callback; IPC delete pipeline clusters with the v1.2.0 `MemoryStore` adapter sweep).

Phase 7 -- Session replay timeline (commit `2864f68`):
- TraceDashboard `<TimelineScrubber>` with play / pause / speed (0.5x / 1x / 2x / 4x).
- "Compare two sessions" view diffs trace deltas side-by-side. Adopts agentmemory A6.

Phase 8 -- DevAI-Hub closures + skill hot-reload + AgentLoop skill provenance (commit `fffee43`):
- `core/skills/SkillsReloader.ts` with 200 ms debounce, `onReload`/`onError` callbacks, graceful behaviour when the `ACTIVE` pointer does not yet exist.
- Weekly auto-sync worker factory + bootstrap registration on `IdleTimeScheduler`.
- `nexus skills install user/<name> --from <url>` + `nexus skills remove user/<name>` with documented allowlist + `PromptInjectionScanner` + path-clamped writes under `~/.nexus/skills/user/`.
- `filterSlashCommandsWithSkills(input, skills, {preferUpstream})` orders devai-hub variants first when `nexus.skills.preferUpstream=true`.
- `AgentLoop.setCurrentSkill(...)` + `lifecycle.skill.entry` fires at slash-command entry; trace spans for tool calls inside a skill body carry `skill.{id, namespace, provenance}` attributes.

Phase 9 -- Opt-in memory consolidation (commit `1307ff2`):
- `core/memory/ContradictionResolver.ts` adjudicates conflicting semantic-tier entries via a local Ollama prompt; default off, gated by `nexus.memory.consolidation.enabled`.
- `nexus memory compress --file <path>` summarizes long files into structured facts via the same local Ollama; `/memory-compress <path>` slash command wired to the same code path. Adopts agentmemory A4 + A9 (gated, opt-in).

Phase 10 -- VS Code extension thin-adapter rewrite (commit `08e14dd`):
- `src/extension.ts` drops from 478 to 64 lines; activation dispatches between `src/activation/proxy.ts` and `src/activation/extensionOnly.ts` via `discoverDesktopDaemon()`.
- Compat shim tightened to once-per-session deprecation logs for legacy `gemma-code.<cmd>` keybindings.

Phase 11 -- Nexus VS Code extension (multi-model agentic surface, commit `093be67`):
- `ModelDropdown`, `PlanArtifact`, `AutoModeStream`, `MemorySnapshotView`, `SlashAutocomplete`, `SessionList`, `McpBridge`, `SettingsBridge` -- the seven new `core/coding/*` modules form the agentic surface.
- Parity test suite + proxy / IPC-client wiring (100 new test cases).
- Five new IPC method schemas wired into `desktop/sidecar/src/protocol.ts` with `implemented: true`: `models.list`, `coding.chat.autocomplete`, `mcp.list`, `mcp.invoke`, `settings.get`, `settings.set`.
- Model dropdown is **selectable across all installed local models** (not just Gemma 4); the daemon's `models.list` enumerates Ollama-resident models for the picker.

Phase 12 -- Image Studio upgrade (NVIDIA SANA family, commit `563c817`):
- SANA-1.6B replaces SDXL Turbo as the default 1024px image model (Apache-2.0 weights).
- Sana-Sprint speed tier ("Fast Preview", 1-step Flow-DPM-Solver).
- SANA 2K + 4K behind `DiffusionTier` gating.
- SANA 4-bit (SVDQuant variant via `nunchaku`) on the `diffusion-low` 8 GB tier (operator-pending license verification under 12.4.P2.GG).
- SANA-ControlNet integrates with the existing pose / depth / canny preprocessors.
- Flow-DPM-Solver appears as a sampler option.
- DC-AE-f32c32 VAE registration.
- Adopts SANA S1, S2, S3, S4, S7, S8, S9, S10.

Phase 13 -- Video Lab Fast 720p tier (SANA-Video 2B, commit `1dabb27`):
- SANA-Video 2B joins the catalog as the "Fast 720p" tier between LTX-Video and CogVideoX.
- Video Lab "Fast 720p" preset is visible and selectable; sampler dropdown widens with `flow-dpm-solver`.
- Adopts SANA S5.

Phase 14 -- Cross-OS installer with hardware + disk-aware model picker (commit `0ead8f3`):
- `HostProfile` detection auto-identifies host OS + arch + GPU vendor.
- OS-aware provisioner dispatch: CUDA on Windows + Linux NVIDIA, Metal Performance Shaders on Apple Silicon, ROCm-aware fallback on Linux AMD, CPU-only fallback elsewhere.
- macOS provisioners: Metal + Ollama for macOS + Homebrew-style ffmpeg.
- Linux provisioners: CUDA + ROCm + CPU fallback + Ollama via the official Linux script.
- Live disk-aware footer + 10 GB OS reserve (configurable via `nexus.installer.diskReserveGB`).
- Text / Image / Video / Audio tabbed model picker fed by `core/registry/catalog.json` + `recommended.json` with hardware compatibility badges and disk-aware checkbox greying.
- Nexus VS Code extension add-on page with `code` / `code-insiders` / `cursor` auto-detection.
- Final disk + hardware guard at "Begin Installation" with re-detection and a bounce-back to the picker on failure.
- macOS DMG and Linux AppImage outer-shell workflows promoted to `push: tags` with payload-fetch + PyInstaller freeze + create-dmg / appimagetool assembly.
- Cross-OS payload fetcher at `scripts/installer/build/fetch-payload.py` parameterized by `--os` + `--arch` with SHA-256 pinning via `versions.lock.json`.
- Storage Review page with runtime / models / DevAI-Hub / reserve / net coloring.
- Cross-OS first-launch migration shim (Python-side).
- Three RTM smoke checklists at `docs/versions/v1/v1.1.0/installer-smoke-{windows,macos,linux}.md`.

Phase 15 -- Hardening + release gate (this commit):
- Version bump across `package.json`, `package-lock.json`, `desktop/package.json`, `desktop/src-tauri/Cargo.toml`, `desktop/src-tauri/tauri.conf.json`, `scripts/installer/pyqt/pyproject.toml`, `scripts/installer/pyqt/src/nexus_installer/__init__.py`, and `scripts/installer/build/nsis/nexus-setup.nsi`.
- `docs/versions/v1/v1.1.0/distribution.md` -- distribution channels mirroring the v1.0.0 structure across three OS surfaces + the renamed Marketplace listing.
- `docs/versions/v1/v1.1.0/release-notes.md` -- user-facing release content.
- `docs/versions/v1/v1.1.0/review/synthesis.md` -- static deep-review synthesis (live `/run-deep-review` chain operator-gated and tracked as OA-V1.1.0-15-DR-A through DR-D).
- `docs/versions/v1/v1.1.0/known-gaps.md` finalized: Phase 15 closures appended, Section 3 summary recomputed, Section 4 carryforward map populated, status flipped from `in-progress` to `finalized at v1.1.0 release`.

### Changed

- Default 1024px image model: SDXL Turbo -> SANA-1.6B (reversible via the model dropdown).
- VS Code Marketplace listing: `gemma-code` -> `nexus-coding` (legacy listing carries a transition note pointing at the renamed listing through the v1.2.0 compat window).
- Curator entry point: `IdleTimeScheduler` is the sole curator dispatcher; the legacy `AgentLoop._runOneIteration` curator block is removed.
- Storage paths: `~/.gemma-code/` -> `~/.nexus/` (POSIX symlink + Windows side-by-side dir for one-cycle compat).
- Memory retrieval: substring search -> hybrid (BM25 + dense + graph via RRF, k=60). Substring fast-path retained for corpora <100 entries via `nexus.memory.hybridMinCorpus`.

### Deferred to v1.2.0

- 12 of 13 `src/` -> `modules/coding/` sub-trees remain open under 1.4.P1.B (per-sub-tree status table maintained in `docs/versions/v1/v1.1.0/known-gaps.md`).
- `MemoryStore` adapter cluster: `MemoryStoreWarmRebuildSource`, `MemoryStoreDecayProvider`, `MemoryStoreAuditLog`, `MemoryStoreExportSource`, `MemoryStoreSettingsStore` -- all clustered with the v1.2.0 first commit.
- Audio module pillar.
- Direct-download landing page (`https://nexus.bendourthe.com/download`) -- deferred to v1.1.1 per OA-05.
- Legacy `gemma-code.<cmd>` keybindings + `gemma-check` CLI alias removal (compat window closes in v1.2.0).
- Node-graph advanced tab.

### Operator-action carryforwards

Live operator-driven items required to close v1.1.0 (tracked in `docs/versions/v1/v1.0.0/operator-actions.md` plus `docs/versions/v1/v1.1.0/operator-actions.md`):

- OA-01 -- EV Code Signing certificate procurement + Windows Authenticode signing (carried forward from v1.0.0).
- OA-08 -- Live golden-task replay against `gemma4:e4b` / `llama3.1:8b` / `qwen2.5-coder:7b`.
- OA-09 -- Real-GPU bench (extended in v1.1.0 for SANA-1.6B / Sana-Sprint / SANA 2K / SANA 4K / SANA INT4 / SANA-ControlNet / SANA-Video 2B).
- OA-10 -- Live `nexus skills sync` against `bendourthe/DevAI-Hub`.
- OA-11 -- macOS Developer ID + notarization.
- OA-12 -- Linux AppImage RTM smoke on Ubuntu 22.04 / 24.04 / Fedora 40.
- OA-V1.1.0-10A -- Publish the renamed `nexus-coding` Marketplace listing.
- OA-V1.1.0-10B -- Update the legacy `gemma-code` listing with the transition note.
- OA-V1.1.0-12A -- Rotate SANA placeholder SHA-256 digests in `core/registry/catalog.json`.
- OA-V1.1.0-15-DR-A/B/C/D -- Live `/run-deep-review` + `/run-security-audit` + `/run-penetration-test --depth=deep` + `semantic-release --dry-run` capture.

# [0.42.0](https://github.com/bendourthe/Nexus-AI/compare/v0.41.0...v0.42.0) (2026-05-21)


### Features

* **v1.1.0:** phase 13 video lab sana-video fast 720p tier ([1dabb27](https://github.com/bendourthe/Nexus-AI/commit/1dabb27b1d65720644e30d2702be3307ee69654b))
* **v1.1.0:** phase 14 cross-os installer with hardware + disk-aware model picker ([0ead8f3](https://github.com/bendourthe/Nexus-AI/commit/0ead8f31df0c432938f03e7a95721fb7fbd3cdb6))

# [0.41.0](https://github.com/bendourthe/Nexus-AI/compare/v0.40.0...v0.41.0) (2026-05-21)


### Features

* **v1.1.0:** phase 12 image studio sana family adoption ([563c817](https://github.com/bendourthe/Nexus-AI/commit/563c817299f6946d4c294ce96117ab792745e330)), closes [tier-hint-on-too-hi#resolution](https://github.com/tier-hint-on-too-hi/issues/resolution)

# [0.40.0](https://github.com/bendourthe/Nexus-AI/compare/v0.39.0...v0.40.0) (2026-05-21)


### Features

* **v1.1.0:** phase 11 nexus vscode extension multi-surface scaffolding ([093be67](https://github.com/bendourthe/Nexus-AI/commit/093be671f537cce43bf97dc41a6ff688899fb72a))

# [0.39.0](https://github.com/bendourthe/Nexus-AI/compare/v0.38.0...v0.39.0) (2026-05-21)


### Features

* **v1.1.0:** phase 10 vscode thin-adapter rewrite ([08e14dd](https://github.com/bendourthe/Nexus-AI/commit/08e14dd073828a9fd2fe2f7b0c19d6e0eddc8491))

# [0.38.0](https://github.com/bendourthe/Nexus-AI/compare/v0.37.0...v0.38.0) (2026-05-21)


### Features

* **v1.1.0:** phase 9 opt-in memory consolidation (contradiction resolver + file compressor) ([1307ff2](https://github.com/bendourthe/Nexus-AI/commit/1307ff26de1fd2894093b64443e21d76f021a5ac))

# [0.37.0](https://github.com/bendourthe/Nexus-AI/compare/v0.36.0...v0.37.0) (2026-05-20)


### Features

* **v1.1.0:** phase 8 devai-hub closures + skill hot-reload + agentloop provenance ([fffee43](https://github.com/bendourthe/Nexus-AI/commit/fffee43cfd6f0d980049992ae296acd963d25f48))

# [0.36.0](https://github.com/bendourthe/Nexus-AI/compare/v0.35.0...v0.36.0) (2026-05-20)


### Features

* **v1.1.0:** phase 5 hybrid retrieval + local embedder + warm-build worker ([afac447](https://github.com/bendourthe/Nexus-AI/commit/afac447aba6c13e967227acd74df945f644dc679)), closes [hi#frequency](https://github.com/hi/issues/frequency)
* **v1.1.0:** phase 6 memory CLI + Ebbinghaus decay + /recall /remember /forget ([c8d9e0b](https://github.com/bendourthe/Nexus-AI/commit/c8d9e0b858d79698ba62b2a9fef0d0ac0cf5c8fe))
* **v1.1.0:** phase 7 session replay timeline + lockfile sync ([2864f68](https://github.com/bendourthe/Nexus-AI/commit/2864f68e810bb5d2560b78408221971c99350138))

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
- `docs/versions/v1/v1.0.0/release-signing.md` -- Authenticode (Windows) workflow + macOS notarization workflow placeholder.
- `docs/versions/v1/v1.0.0/release-notes.md` -- user-facing release announcement with module screenshots and v1.1.0 teaser.
- `docs/versions/v1/v1.0.0/rtm-smoke.md` -- operator-driven RTM smoke checklist (fresh Win 11 VM, 4 modules end-to-end, target <= 90 min total).
- `docs/versions/v1/v1.0.0/distribution.md` -- distribution-channel runbook (GitHub Releases, VS Code Marketplace re-publish, optional direct-download site).
- `docs/versions/v1/v1.0.0/operator-actions.md` -- consolidated operator checklist covering live-GPU benches, code-signing cert procurement, SHA-256 rotation, RTM execution.
- `docs/versions/v1/v1.0.0/review/synthesis.md`, `security-audit.md`, `penetration-test.md` -- consolidated Phase 11 review artifacts.

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
- v0.9.0 known-gap 10.N.T (operator-action consolidation): Phase 11 ships `docs/versions/v1/v1.0.0/operator-actions.md` as the consolidated operator checklist for v1.0.0; future cycles inherit the same file layout.
- Pre-existing Phase 2 test failures (`SubAgentManager.characterization.test.ts` CRLF/LF snapshot mismatches; `workflow-discipline.test.ts` SHA-pin enforcement) recorded under v1.0.0 known-gap 2.P3.L and tracked as a Phase 11 / v1.0.1 fix.
- Phase 9 CI block on missing `tauri::Manager` import (`desktop/src-tauri/src/sidecar.rs::app.path().resolve()` against Tauri 2.11) -- import added in lockstep with the icons.

### Security

- Windows installer Authenticode signing workflow documented at `docs/versions/v1/v1.0.0/release-signing.md`. Actual signing requires the operator-procured EV Code Signing certificate (tracked as v1.0.0 operator action OA-01).
- macOS notarization workflow documented (deferred to v1.0.1 per Phase 9.8 + known-gap 9.P2.EEE).
- Prompt-injection scanner (`core/skills/PromptInjectionScanner.ts`) screens every skill body before it lands in `~/.nexus/skills/`; the DevAI-Hub sync pathway routes every fetched skill through the scanner; the un-namespaced `nexus skills install` CLI path is stubbed (P2 known-gap 10.P2.III) so no scanner-bypassing install surface ships in v1.0.0.
- Path-clamping on `~/.nexus/skills/user/` writes (resolved + parent-dir check before write).
- HTTPS-only model downloader; rejects `file://`, `localhost`, internal IP ranges; SHA-256 digest verification gates every non-Ollama install (catalog digests for HTTP-sourced models are placeholders pending v1.0.0 release-gate rotation per known-gap 5.P2.CC).
- Sidecar process runs as user (not admin); `~/.nexus/` permissions are user-only (verified in `docs/versions/v1/v1.0.0/review/security-audit.md`).
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

Adoption cycle driven by `docs/archive/versions/v0/v0.7.0/comparison-multi-source.md` (S1-S7 multi-source competitive review). Closes every P1 carryover from the v0.6.0 known-gaps catalog in Phase 0 (panel hoist down to 305 lines via ADR-0011; `marked` v4 -> v12 migration; mutation-testing gap fixes across `policy.ts` / `ActionClassifier.ts` / `terminal.ts` / `filesystem.ts`; `Orchestrator.test.ts` re-included in Stryker). Then adopts the C-items from buckets 1-3 of the comparison report: a deterministic compaction stack expansion plus a model-callable compress tool (ADR-0012), an Instructions / Memory / Context / Archive memory file architecture (ADR-0014), a webview render protocol with seven new chat primitives (ADR-0013), per-model context-limit overrides, six new skills, multi-harness skill packaging plus a standalone `gemma-check` CLI, an optional HNSW vector index with linear-scan fallback, and post-N-edits audit / testgaps background workers. Three new ADRs (0012-0014) capture the material decisions. The v0.5.0 retrospective `>= 40%` token-savings claim is now measured against the live-Ollama v0.4.0 + v0.6.0 baselines (operator-action; see Fixed below).

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
- Standalone `gemma-check` CLI under `bin/gemma-check.mjs` (`npm run check`); ships the four deterministic-check rules used by the audit background worker. See `docs/archive/versions/v0/v0.7.0/development/cli-gemma-check.md`.
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

- v0.6.0 Phase 0 close-out (all items in `docs/archive/versions/v0/v0.7.0/known-gaps.md` Section 2-4):
  - `GemmaCodePanel.ts` 305 lines (was 935; v0.6.0 target was < 400). Construction graph extracted to `ChatPanelBootstrap.ts` and static factories on `ChatController` (`buildContextCompactor`, `buildSubAgentManager`, `buildOrchestrator`, `buildAgentLoop`, `buildStreamingPipeline`). Helpers: `ChatPanelInit.ts`, `ChatStatusReporter.ts`, `ChatMessageRouter.ts`, `ToolActivationContext.ts`, `ToolRegistryBuilder.ts`. New ADR-0011 documents the OllamaClient injection pattern. Closes v0.7.0 known-gaps 2.3 + 2.4.
  - `marked` bumped to `^12.0.0` (resolved at 12.0.2) via `marked.parse(text, { async: false })`; the v12 Renderer API turned out to retain the v4 positional signature so the three custom renderers are unchanged-by-need. All 8 renderer tests green; sanitisation chain (CSP + DOMPurify) intact. Closes v0.7.0 known-gaps 2.1.
  - Mutation-testing gap fixes: new `tests/unit/guardrails/policy.test.ts` (18 assertions), `tests/unit/guardrails/ActionClassifier.coverage.test.ts` (113 parametric assertions), `tests/unit/tools/handlers/terminal.coverage.test.ts` (58 parametric assertions), `tests/unit/tools/handlers/filesystem.coverage.test.ts` (13 error-path assertions). `Orchestrator.test.ts` timing assertion rewritten `> 0` -> `>= 0` and re-included in `configs/stryker.config.json`. Closes v0.7.0 known-gaps 4.1-4.5.
- Live-Ollama baseline capture for the v0.5.0 retrospective `>= 40%` token-savings claim: in-process v0.7.0 baseline captured (see Added); the corresponding v0.4.0 + v0.6.0 live-Ollama captures remain operator-action, tracked in `docs/archive/versions/v0/v0.7.0/known-gaps.md`.
- Filesystem tool handler split (v0.6.0 plan sub-task 6.5) formally deferred to v0.8.0 with a documented cost/benefit decision (~25 import sites; file is functioning correctly today). See v0.7.0 known-gaps 2.2.

### Security

- The `compress` tool ships at permission tier 0 (auto-approve) by design: it operates on the in-process conversation transcript only and never touches the filesystem, network, or external state. No new auth surface. See [ADR-0012 Consequences](./docs/adr/0012-model-callable-compress-tool.md#consequences).
- v0.6.0 Phase 1 path-guard contract preserved: every filesystem tool handler still routes through `pathGuard.resolveInsideWorkspace`. The new memory file architecture writes only under `~/.gemma-code/memory/<workspace-id>/`, an out-of-workspace location; no new symlink-traversal surface introduced.
- `permissionOverrides` tier-floor clamp (v0.6.0 ADR-0007) preserved; the new `Yes-for-all` workspace persistence respects the same clamp.

### Explicitly NOT in v0.7.0

Policy-grounded drops from `docs/archive/versions/v0/v0.7.0/comparison-multi-source.md` Section 13:

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
- `tests/golden/baselines/v0.6.0.json` (post-Phase-1 measurement; final regeneration scheduled against the post-Phase-7 build with live Ollama -- see [docs/archive/versions/v0/v0.6.0/development/history/2026-05_phase-8-release-gate.md](docs/archive/v0/v0.6/development/history/2026-05_phase-8-release-gate.md)).
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
- Documentation example webhook URLs in `docs/archive/versions/v0/v0.5.0/comparison/comparison-token-optimizer-mcp.md` obfuscated to `https://example.invalid/<redacted>` placeholders (closes pen-test F-011).
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

The v0.5.0 plan stated a target of `>=40% average tool-output token reduction vs. v0.4.0`. This claim never appeared in the v0.5.0 CHANGELOG entry below; it lived in `docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md` and the Phase 12 history. The measured number was deferred at v0.5.0 ship time (`tests/golden/baselines/v0.4.0.json` was not captured). v0.6.0 captures `v0.6.0.json` against live Ollama as part of the release-gate procedure documented in `docs/archive/versions/v0/v0.6.0/development/history/2026-05_phase-8-release-gate.md`; the long-arc compare against `v0.4.0.json` is logged as the first action of the post-cycle measurement window. The `>=40%` figure remains a *target*, not a verified shipping claim, until the comparison run lands.

---

## [0.5.0] -- 2026-04-26

Unified adoption release. Combines five comparison-driven adoption plans (token-optimizer-mcp, agent-friendly-CLIs, routa-harness, free-claude-code, foundry-vault) into a coherent dozen-phase roadmap. The product surface stays the same (offline VS Code extension on top of Gemma 4 via Ollama); the changes are inside the harness, the tool catalogue, the cache stack, and the operational hygiene.

### Phase 1 -- Identity and Naming

- AGENTS.md adopted as the sole canonical directive; no CLAUDE.md anywhere in the repo
- Test-pyramid taxonomy split into "smoke" / "regression" / "scenario" with the rubric in [docs/archive/versions/v0/v0.5.0/test-pyramid.md](docs/archive/v0/v0.5/test-pyramid.md)
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
- [docs/archive/versions/v0/v0.5.0/architecture.md](docs/archive/v0/v0.5/architecture.md) describing the v0.5.0 architecture
- v0.5.0 git tag prepared (push deferred to explicit user confirmation)

### Deferred / Out of Scope

The following are recorded for v0.6.0+: LSTM predictive caching (hard constraint), multi-provider LLM proxy, voice transcription, distributed cache, `/memory prune` and `/memory lint --apply`, auto-merge for Dependabot, `format=json` on `read_file` and `run_terminal`. See [docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md](docs/archive/v0/v0.5/plans/implementation-plan.md) "Out of Scope" section for the full table.

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
- Full architecture documentation at `docs/archive/versions/v0/v0.2.0/architecture.md`

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
- CI documentation in `docs/archive/versions/v0/v0.1.0/ci-setup.md`
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
- Security audit documentation (`docs/archive/versions/v0/v0.1.0/security-audit.md`) with findings and remediations
- Performance benchmark documentation (`docs/archive/versions/v0/v0.1.0/performance-benchmarks.md`)
- Architecture documentation (`docs/archive/versions/v0/v0.1.0/architecture.md`) with component descriptions and data-flow diagrams
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
