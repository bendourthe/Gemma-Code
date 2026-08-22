<p align="center"><a href="https://github.com/bendourthe/Nexus-AI"><img src="assets/nexus-ai-banner.png" alt="Nexus" width="640" /></a></p>

<p align="center"><em>Your Local AI Studio. Four Pillars, One Desktop, Zero Tokens Billed.</em></p>

# Nexus

Nexus is a local-first, native desktop AI Studio that bundles four generative AI pillars behind one cohesive UI: agentic coding, organized local chat, image generation and editing, and short-form video synthesis. Everything runs on the host machine against optimized open-source models (Gemma 4, Llama 3, Qwen 2.5 Coder, SDXL / SANA-class diffusion, video-synthesis architectures), with real-time GPU / VRAM telemetry built into the dashboard. No API keys, no data leaving your machine, no per-token billing.

> **Renamed from Gemma Code at v1.0.0** to reflect the four-pillar pivot. The v0.1.0 - v0.22.x line shipped as a single-purpose local agentic coding VS Code extension; v1.0.0 folded that engine into the "Agentic AI Coding" pillar of a wider desktop app. The VS Code surface is preserved as an optional thin adapter that proxies to the desktop daemon. Historical Gemma Code docs remain under `docs/archive/versions/v0/v0.1.0/` - `docs/archive/versions/v0/v0.9.0/`; v1 milestones live under `docs/v1/v1.<MINOR>/`, and the current **v2.1.0** open local-AI wave lives under `docs/v2/v2.1/`. See [Project Status](#project-status-august-2026).

---

## How Nexus fits with Nexus-Hub

<p align="center">
<a href="https://github.com/bendourthe/Nexus-AI"><img src="assets/nexus-ai-banner.png" alt="Nexus" width="360" align="middle" /></a>
&nbsp;&nbsp;&nbsp;<strong style="font-size: 28px;">&harr;</strong>&nbsp;&nbsp;&nbsp;
<a href="https://github.com/bendourthe/Nexus-Hub"><img src="https://raw.githubusercontent.com/bendourthe/Nexus-Hub/main/assets/nexus_hub_banner.png" alt="Nexus-Hub" width="360" align="middle" /></a>
</p>

Nexus and [Nexus-Hub](https://github.com/bendourthe/Nexus-Hub) are two halves of the same idea, split along a deliberate seam.

- **Nexus (this repo)** is the runtime: a native desktop AI Studio with four pillars (Coding, Chat, Image, Video), four-layer local memory, hybrid retrieval (BM25 + dense + graph via RRF), session replay, GPU scheduling, hardware-aware model selection, and a cross-OS installer that provisions CUDA / Metal / ROCm tooling on first launch. It runs against local open-source models via Ollama; no outbound runtime calls without explicit user opt-in.
- **Nexus-Hub** is the catalog: a large curated set of skills, commands, hooks, agents, and language rule families, plus a handful of local-only internal MCP servers (see the [Nexus-Hub repo](https://github.com/bendourthe/Nexus-Hub) for the live counts). It is content-only, platform-agnostic, and installs into every supported AI assistant's per-platform config locations. Nexus consumes the same catalog as its upstream skill feed via the `nexus skills sync` CLI.

The two projects are designed to be useful independently: you can install Nexus-Hub into Claude Code / Codex / Gemini / Cursor without touching Nexus, and Nexus can run with or without the upstream catalog wired in. The combination is what gives a single curated skill set to every agent surface a developer touches: terminal, IDE, and now a dedicated desktop app.

---

## The Four Pillars

### 1. Agentic AI Coding

Autonomous code-generation and terminal environment. Reads local repositories, executes code in isolated environments, debugs, and implements complex features across files. Inherits everything Gemma Code shipped (tool registry, plan mode, four-layer memory, MCP support, skill catalog, sub-agent dispatch) and extends it to all installed local LLMs - not just Gemma 4. Available as a desktop pillar and as an optional VS Code extension (`nexus-coding`) that proxies to the desktop daemon when available and falls back to a legacy in-process engine when not. Later cycles added a local skill self-optimization loop (`nexus skills optimize`, v1.7.0 / v1.12.0) and a per-model harness selector that tunes the agent scaffold profile to each local model (v1.12.0; live in the prompt path behind `nexus.coding.harnessSelector.enabled` as of v1.18.0 Phase 2, still opt-in).

### 2. Local Chatbot Explorer

Conversational interface with a filesystem-style organizer: chats live in nested folders and subfolders, contexts can be compartmentalized per project, and the four-layer memory system (working / episodic / semantic / graph) keeps long-running threads coherent. Hybrid retrieval (BM25 + dense + graph via Reciprocal Rank Fusion, `k=60`) replaced the v0.x substring path in v1.1.0 Phase 5; the local `all-MiniLM-L6-v2` embedder is bundled by the installer so production hosts never hit the Hugging Face Hub.

### 3. Image Studio

Text-to-image, image-to-image, inpainting, and outpainting against local diffusion pipelines. Tuned for laptop-class single-GPU hardware. v1.1.0 Phase 12 makes SANA-1.6B the new default 1024px model (~2x faster than SDXL Turbo, Apache-2.0 weights), adds Sana-Sprint as the "Fast Preview" speed tier (~0.3 s on RTX 4090), gates SANA 2K / 4K behind a `DiffusionTier` policy, and ships SANA-ControlNet plus the Flow-DPM-Solver sampler.

### 4. Video Lab

Short-form video synthesis via text prompts or static reference images, with a timeline previewer and granular generation controls. v1.1.0 Phase 13 adds SANA-Video 2B as the "Fast 720p" tier between LTX-Video and CogVideoX. Targets local video-synthesis architectures sized for a single consumer GPU.

### Document parsing (OCR)

Attach a PDF, image, Word, PowerPoint, or Excel file in Local Chatbot or Agentic AI Coding and Nexus reads it into text on your machine. PDFs and images use **RapidOCR PP-OCRv4** (Apache-2.0, ~20 MB, CPU, every OS) or optionally **Unlimited-OCR 3B** (MIT, NVIDIA, layout-preserving markdown). `.docx` / `.pptx` / `.xlsx` parse with native libraries and do not need those OCR models or Docling. OCR models are optional, never auto-installed, and pinned to a specific revision. Extracted text is never sent to a model on its own - you decide what to do with it. OCR added in v1.16.0 Phase 3; native Office ingest in v1.20.0 Phase 2; Coding attach in v1.20.0 Phase 3.

### Local API server (opt-in)

Nexus can also *serve* the local models it has installed. Enable **Settings > Local API server** and Nexus exposes a loopback OpenAI- and Anthropic-compatible HTTP API (`GET /v1/models`, `POST /v1/chat/completions`, `POST /v1/messages`, buffered or streamed), so Claude Code, Codex, Cursor, and any OpenAI/Anthropic SDK client can drive the models you already downloaded - extending "Zero Tokens Billed" to your whole toolchain. Off by default and local by construction: with both the API server and the ACP agent off, no port is bound. The server refuses to start on any non-loopback address, and every request needs a locally-generated bearer token. Inference routes serve model output only - never files, terminal, or tools. Added in v1.16.0 Phase 1.

A second toggle on the same Settings section enables the **ACP agent** (`nexus.acp.enabled`, default off) on that shared loopback listener and token (`POST /acp`, JSON-RPC 2.0). Enabling ACP does not turn on the OpenAI/Anthropic routes, and the reverse is also true. Unattended CONFIRM and DANGEROUS tool calls park in the **Ask inbox** (Admin sidebar, dashboard bell). Approve replays the permission gate; deny and expiry refuse cleanly. Without an inbox the call fail-closes (it never auto-approves). Added in v1.18.0 Phase 5 (park path in Phase 4).

### Ask inbox and scheduled runs (opt-in)

Headless and scheduled agent runs no longer die on the 60s confirmation timeout. Consequential tools park until you approve or deny them in **Ask inbox**. A local scheduler can fire recurring runs (the built-in morning brief is **off by default**). Every wake still goes through the same permission tiers and Git checkpoint as an interactive run; there is no auto-approve path. Added in v1.18.0 Phase 4.

### MLX on Apple Silicon (via local adapters)

Nexus does not bundle an MLX runtime. Apple Silicon users who already run an OpenAI-compatible MLX server (mlx-vlm, LM Studio in MLX mode, or nativ) can register it as a loopback `nexus.llm.localAdapters` manifest and select it with `nexus.llm.backend`. The how-to is [docs/v1/v1.16/guides/mlx-via-local-adapters.md](docs/v1/v1.16/guides/mlx-via-local-adapters.md); the on-device smoke checklist is [docs/v1/v1.16/testing/macos-mlx-smoke.md](docs/v1/v1.16/testing/macos-mlx-smoke.md). Added in v1.16.0 Phase 5.

### llama.cpp on loopback (via local adapters)

Nexus does not bundle llama.cpp. If you already run `llama-server` on loopback (including large-MoE CPU-expert or mmap offload), register it as a `nexus.llm.localAdapters` manifest with `protocol: "openai"` and select it with `nexus.llm.backend`. The recipe is [docs/reference/llamacpp-loopback-adapter.md](docs/reference/llamacpp-loopback-adapter.md). This does not open the patient-tier gate ([EM.P4.A](docs/v1/v1.12/known-gaps.md)). Added in v1.18.0 Phase 1.

### Always-on telemetry

A persistent `Local Model Status` panel reports the active model architecture, parameter size, live GPU utilization, and free VRAM - so dense computational passes do not silently OOM. The same telemetry feeds the GPU scheduler (Phase 3) that prioritizes Coding token generation over background diffusion work when both pillars compete for the same GPU.

---

## Project Status (August 2026)

Nexus uses a single, convergent version line: git tags and `package.json` carry the same numbers as the milestone docs (`docs/v1/v1.<MINOR>/` through v1.20.0, then `docs/v2/v2.0/` for v2.0.0, `docs/v2/v2.1/` for **v2.1.0**).

Historical note: between 2026-06-18 and 2026-07-20 a decoupled "release track" cut five semantic-release versions numbered ahead of the milestones. Those tags were renumbered onto the milestone line on 2026-08-05: the old `v2.0.0` tag became `v1.6.0`, `v2.1.0` -> `v1.7.0`, `v2.2.0` -> `v1.12.0`, `v2.3.0` -> `v1.13.0`, and `v2.4.0` -> `v1.14.0`. This **v2.0.0** cut is the reserved convergence release (v1.18 plan + v1.19.x subplans + this adoption plan).

### Milestone ledger

| Milestone | Theme | Status | Docs |
|---|---|---|---|
| v1.0.0 | Four-pillar pivot: Gemma Code -> Nexus desktop AI Studio (Tauri shell + Node sidecar) | Landed | [docs/v1/v1.0/](docs/v1/v1.0/) |
| v1.1.0 | Stabilization + expansion: hybrid retrieval, session replay, SANA image / video tiers | Landed | [docs/v1/v1.1/](docs/v1/v1.1/) |
| v1.2.0 | 2026-05 ecosystem adoption: code-graph MCP, LEANN-derived pruned dense index, command-output compression | Landed | [docs/v1/v1.2/](docs/v1/v1.2/) |
| v1.3.0 | skill-cleaner adoption: `nexus skills audit` token-budget report | Landed | [docs/v1/v1.3/](docs/v1/v1.3/) |
| v1.4.0 | claude-code-harness adoption (A1-A12) + `src/` -> `modules/coding/` move + carryforward closure | Landed | [docs/v1/v1.4/](docs/v1/v1.4/) |
| v1.5.0 | Local Agent Maturity: Gemma 4 quant ladder, credential vault, energy telemetry, planner / critic / worker DAG | Landed | [docs/v1/v1.5/](docs/v1/v1.5/) |
| v1.6.0 | aisuite harness + the offline Nexus-AI interactive guide + opt-in local panel / judge fusion | Landed | [docs/v1/v1.6/](docs/v1/v1.6/) |
| v1.7.0 | Local skill self-optimization loop (golden-task runner, bounded-edit optimizer, Pareto frontier) | Landed | [docs/v1/v1.7/](docs/v1/v1.7/) |
| v1.8.0 | One-shot end-user installer: desktop bundles, Hugging Face weights puller, per-VRAM catalog curation | Landed | [docs/v1/v1.8/](docs/v1/v1.8/) |
| v1.9.0 | Installer + Nexus AI Studio experience overhaul (single-artifact branded wizard + full UI / UX rework) | Landed | [docs/v1/v1.9/](docs/v1/v1.9/) |
| v1.10.0 | Nexus-Hub consumption re-architecture: single-home `~/.nexus-ai/catalog/` + live first-launch fetch | Landed | [docs/v1/v1.10/](docs/v1/v1.10/) |
| v1.11.0 | Installer overhaul: one-shot reliability, clean-machine harness, embedded desktop bundle, background continuation | Landed | [docs/v1/v1.11/](docs/v1/v1.11/) |
| v1.12.0 | Local model-execution scaling (per-model harness, extreme-low-bit + disk-offload tiers) + surface the skill optimizer + exec-sandbox audit | Landed | [docs/v1/v1.12/](docs/v1/v1.12/) |
| v1.13.0 | Installer reliability + UX polish: fix the fresh-install model failures (registry routing + Ollama pin + pull/load preflight), gradient "AI Studio" wordmark, and the mockup-matched installing UI | Landed | [docs/v1/v1.13/](docs/v1/v1.13/) |
| v1.14.0 | Installer catalog curation + install reliability: best-of-family model collapse with release-date pills, gated-model auth flow (token discovery + guided license step), live reachability, and installing-page polish (uniform dependency bars, footer Cancel) | Landed | [docs/v1/v1.14/](docs/v1/v1.14/) |
| v1.15.0 | Post-reinstall fixes + chat-style studios: window controls / open maximized, installer relaunch starts at Welcome, catalog invariant guard + gated-token UX + post-install retry, real `models.*` registry reconciled with Ollama and the installer's weights tree, Image Studio and Video Lab rebuilt as chat, and a crash-proof "Nexus Code" VS Code extension | Landed | [docs/v1/v1.15/](docs/v1/v1.15/) |
| v1.16.0 | Local serving gateway + document OCR: opt-in loopback OpenAI/Anthropic API in front of installed models, per-model tokens/sec and TTFT on Traces, RapidOCR (CPU) + Unlimited-OCR (NVIDIA) in the catalog, a governed `parse_document` tool, MLX-via-adapters how-to, and a searchable Models page with Chat/Coding quick switcher | Landed | [docs/v1/v1.16/](docs/v1/v1.16/) |
| v1.17.0 | Agent-state motion identity: internal orbs, surface-liveness beam, and hero-action metal ring (no new npm packages), one primary motion per surface, recede-when-active ambient glow, halt-not-slow reduced-motion | Landed | [docs/v1/v1.17/](docs/v1/v1.17/) |
| v1.18.0 | Agent harness and governance: skill-native mappings, llama.cpp loopback recipe, live harness selector, catalog/registry governance, ask inbox + scheduler, ACP surface, OS process sandbox | Landed | [docs/v1/v1.18/](docs/v1/v1.18/) |
| v1.19.0 | Low-VRAM Agentic catalog: LFM2.5-2.6B CPU / sub-4 GB tool-calling pick, LFM Open License v1.0 use-restriction label, harness profile, 8B-A1B bake-off declined | Landed | [docs/v1/v1.19/](docs/v1/v1.19/) |
| v1.19.1 | Agent-loop and guardrail hardening: Hub skill-native wins, hard denials, LoopGuards, security-posture dial, provenance screening, DNS-pinned fetches | Landed | [docs/v1/v1.19/](docs/v1/v1.19/) |
| v1.19.2 | Catalog and model expansion: modalities + audioConditioning, official-only weight variants, Hermes 3 family, Inkling-Small patient-tier GGUF, calibrated patient-tier copy | Landed | [docs/v1/v1.19/](docs/v1/v1.19/) |
| v1.20.0 | Document ingest: wire `parse_document`, magic-byte Office routing, Chat and Coding attach, Docling layout engine deferred | Landed | [docs/v1/v1.20/](docs/v1/v1.20/) |
| v2.0.0 | Convergence: multimodal Chat + local voice loop, DANGEROUS isolated-profile browser tools, Video Lab continuation + gated avatar, ProjectScope stretch | Landed | [docs/v2/v2.0/](docs/v2/v2.0/) |
| v2.1.0 | Open local-AI wave: Muse Glimmer + Nemotron Lightning catalog/harness, adaptive routing, Image Studio depth, multimodal chat + SAM2, local fine-tuning, hardening | Landed | [docs/v2/v2.1/](docs/v2/v2.1/) |

Each v1 cycle's plan lives under `docs/v1/v1.<MINOR>/plans/`. v2.0.0 lives under `docs/v2/v2.0/plans/`. v2.1.0 lives under `docs/v2/v2.1/plans/`. Deferred work is in that version's `known-gaps.md`.

### What's new in v2.1.0

Open local-AI wave. Local-only. No new outbound destination. Vendor scores do not become default routes.

- **Muse Glimmer 30B** - Apache-2.0 Meta GGUF via Ollama `hf.co` (`muse-glimmer:30b` at 24 GB, Dynamic at 32 GB). Hidden below 16 GB VRAM and on Ollama older than 0.32.7. Harness profile `muse-glimmer` (detailed, thinking on, llama3-json).
- **Nemotron 3.5 Lightning 30B-A3B** - OpenMDW-1.1 worker (`nemotron-lightning:30b-a3b` native 24 GB, expert-offload at 16 GB). Pulls the Ollama library tag `nemotron-3.5-lightning:30b`. Hidden below 16 GB and on Ollama older than 0.32.9. Harness profile `lightning-worker` (concise, thinking off, qwen-json). Tagged `role: worker-candidate` for cheap-first routing.
- **Catalog flags** - `diffusion` (default false) and `codingEligible` (default true). `localEval` blocks are `not_run` this cycle; `recommended.json` is unchanged.
- **Adaptive routing** - cheap-first workers on Lightning, escalate to Muse on tool-error / identical-action / progress-free signals, GPU swap deferral when VRAM or diffusion would OOM, routing lane on the Traces tab.
- **Studio provenance and queue** - PNG `iTXt` plus `tEXt` alias and a content-hash index; Use Prompt / Use Seed / Use All / Remix; SQLite queue at `~/.nexus/generations/studio.db` with seed/prompt batches, restart recovery, and coding-over-diffusion pump.
- **Multimodal chat** - catalog `vision` plus a per-model visual-token budget. Gemma 4 12B accepts one image (or ffmpeg-sampled video frames). Chat indexes redacted multimodal surrogates and STT transcripts. Muse Glimmer is gated `vision: false` until its hf.co GGUF is proven to ship a projector.
- **Replace-the-X** - SAM2 Hiera Tiny (`sam2:hiera-tiny`, Apache-2.0 utility, hidden from the generator picker). "replace the car with a truck" segments then inpaints. Missing weights leave the original and ask you to install or paint a mask.
- **Fine-tuning** - Settings > Fine-tuning. Opt-in Unsloth Core (`unsloth` Apache-2.0 + `unsloth-zoo` LGPL). Dataset builder redacts secrets and can extract PDFs through the OCR spine. QLoRA jobs queue on the GPU scheduler. Studio/CLI extras are never installed. Live GPU train is local-only (`NEXUS_TUNING_LIVE=1`).
- **Audit log** - append-only SQLite at `~/.nexus/audit/audit.db`, Ed25519 per actor, Settings > Security viewer. Local-only. Tampered rows stay visible and untrusted. A notice appears when the OS keychain is unavailable.
- **JSON CLI** - `nexus session|models|generate` over `/nexus/*` on the sidecar loopback listener, same bearer token. The listener binds for JSON CLI even when Local API `/v1` is off. Schema errors exit 2 before any HTTP call. See [docs/v2/v2.1/development/json-cli.md](docs/v2/v2.1/development/json-cli.md).
- **Diffusion VRAM knobs** - Image Studio and Video Lab Advanced: cache VRAM/RAM caps, working reserve, layer streaming. Caps below the model minimum are rejected unless streaming is on.
- **DiffusionGemma** - watch item only (needs llama.cpp PR #24423 in a shipped Ollama release and sub-16 GB quants).

v2.0.0 already shipped the convergence cut. Known gaps: [docs/v2/v2.1/known-gaps.md](docs/v2/v2.1/known-gaps.md).

### What's new in v2.0.0

Convergence of the v1.18-v2.0 plan family. Local-only. No new outbound destination. Image, audio, and browser page bytes stay on the machine.

- **Chat vision and STT** - image attach follows catalog `modalities` including `image`. Audio files and the mic transcribe on-device via catalog `faster-whisper-large-v3`. Transcripts are labelled and secret-scrubbed.
- **Voice loop** - off by default (Local Chatbot **Voice loop** checkbox). Push-to-talk and button VAD. Spoken replies use catalog `kokoro-82m`. See CHANGELOG for activation, validation, rollback, and authority.
- **Coding browser tools** - `browser_navigate` / `browser_click` / `browser_type` / `browser_aria_snapshot` / `browser_close` at DANGEROUS over an isolated `~/.nexus/browser-profiles/` tree. Playwright is a local install, not a lockfile pin. Snapshots are provenance-labelled and injection-scanned.
- **Video Lab** - requested length longer than the tier clip chains segments. Talking-head (`audio2video`) is `diffusion-pro` only, official `longcat-video-avatar-1.5` INT8, explicit local-generation confirm. DiT inference is not vendored yet (DF-8).
- **Stretch** - `ProjectScope` (tightening-only), durable untrusted sandbox root, lesson/procedure memory kinds. Code-as-action, command router, and VRM pane transferred (DF-10-12).

v1.20.0 already shipped document ingest. Known gaps: [docs/v2/v2.0/known-gaps.md](docs/v2/v2.0/known-gaps.md).

### What's new in v1.20.0

Local document ingest on the existing OCR spine. No Docling. No new outbound destination. Parsed text is shown to you; it does not auto-enter a model prompt.

- **`parse_document` is live** - the existing agent tool is registered on sidecar, ACP, scheduler, and VS Code hosts when `nexus.coding.parseDocument.enabled` is on (sidecar: `NEXUS_PARSE_DOCUMENT=1` or the same key in `~/.nexus/settings.json`). Flag off keeps the tool absent. CONFIRM, redaction, and the inbound classifier still wrap it.
- **Office files parse natively** - `.docx` / `.pptx` / `.xlsx` use python-docx, python-pptx, and openpyxl. Magic bytes win over filename. Encrypted zip and OLE fail closed. Unsupported types return `unsupported-media` instead of being treated as one image.
- **Chat and Coding attach** - both composers accept PDF, images, and those Office types (`DOCUMENT_ACCEPT`). First attachment only (DF-4). Image Studio stays `image/*`.
- **Docling stays off the attach path** - Phase 4 bake-off is DEFER. RapidOCR library smoke ran on synthetic fixtures; catalog RapidOCR install and Unlimited-OCR remain DF-5. `runtimes/ocr/requirements.txt` still has no `docling` and no torch.

v1.19.2 already shipped catalog expansion. Known gaps stay in-progress.

### What's new in v1.19.2

Catalog and model plumbing for the v2.0.0 consumers. Local-only. No new outbound surfaces. sha256 pinning is unchanged. Unofficial community quants are rejected.

- **Modalities** - every catalog row declares input `modalities` (`text` / `image` / `audio`). Chat attachment gating in v2.0.0 reads this field. Video rows also declare `audioConditioning` (disabled until avatar models land).
- **Weight variants** - a catalog entry can list official fp16 / int8 / fp8 / GGUF lines, each with its own file list and sha256. The installer puller selects one (VRAM default or `NEXUS_WEIGHTS_VARIANT`). Community re-quants fail closed.
- **Hermes 3** - `hermes3:8b` and `hermes3:70b` in the Agentic catalog (Ollama library, Llama 3.1 Community License). Harness profile `hermes-agentic` uses llama3-json. The live coding loop still parses Gemma XML (v1.19.2 DF-3). `hermes3:70b` is not a recommended default.
- **Inkling-Small** - opt-in patient-tier GGUF (74.8 GB, Apache-2.0). Visible only when the patient tier is on. Shipped `modalities: ["text"]` because GGUF multimodal is unverified. Never a `recommended.json` default.
- **Patient-tier honesty** - warning floor is ~0.03 tok/s (~32 s/token laptop). RAM-budget presets (`laptop` / `workstation` / `max`) are copy only. Nexus does not bundle the offload runtime.

v1.19.1 already shipped loop hardening. Known gaps stay in-progress.

### What's new in v1.19.1

Agent-loop and guardrail hardening. Local-only. No new outbound surfaces. The coding agent cannot run away on a long auto-mode job, and Unattended is not a no-floor mode.

- **Skill-native wins** - Hub `deep-research-compilation` verifies quotes against fetched text. `prompt-engineering` / `creative-generation` carry persona-card, avatar-prep, and transcript-reasoning guidance. Mapping note: [skill-native-adoptions-v1.19.1.md](docs/reference/skill-native-adoptions-v1.19.1.md).
- **Hard denials** - recursive deletes, git history rewrites, and DROP/TRUNCATE SQL are blocked in every posture before confirmation.
- **LoopGuards** - identical-call veto, no-action budget, error-burst, bounded queue, 60-iteration ceiling. Shared with the existing LoopDetector.
- **Security posture** - Strict / Standard / Unattended (`nexus.coding.securityPosture`, default Standard). Unattended skips CONFIRM prompts only. DANGEROUS tools still confirm. Hard-denied commands never run.
- **Provenance and recovery** - tool results carry an origin label; web / MCP origins are always screened. Spill files are secret-scrubbed. Already-applied edits report success-noop. Empty grep returns near-miss probes.
- **DNS pin** - SSRF fetches connect to the first validated public address, not a re-resolved name.
- **watch_path / hash_file** - read-only workspace tools. Tool prompt docs are generated from the live registry.

v1.19.0 already shipped LFM2.5-2.6B as the low-VRAM Agentic pick. Known gaps stay in-progress.

---

## Design Principles

1. **Local-first.** Inference, embeddings, image and video synthesis, and memory storage all live on the host machine. No outbound calls without explicit user opt-in.
2. **Originality over wrappers.** When an external service or heavy framework can be reverse-engineered into a lean local module, we do that. The codebase follows this rule explicitly (see [AGENTS.md](AGENTS.md) "MCP Registry Policy" and the comparison matrices at [docs/v1/v1.1/comparison-agentmemory.md](docs/v1/v1.1/comparison-agentmemory.md) and [docs/v1/v1.1/comparison-sana.md](docs/v1/v1.1/comparison-sana.md)). The only external project we deliberately link to is [bendourthe/Nexus-Hub](https://github.com/bendourthe/Nexus-Hub), the author's own skill / hook / command catalog and the upstream feed for Nexus's skill harness.
3. **Single-GPU ceiling.** Every pillar must run on a laptop with a single consumer GPU (e.g. RTX 3070 - 4090 class). Hardware tiers are auto-detected at install and context budgets, batch sizes, and pipeline depths adapt accordingly.
4. **Installer carries the burden.** The cross-OS installer (shipped across the v1.8.0 -> v1.11.0 cycles) provisions CUDA / Metal Performance Shaders / ROCm, Python, Node, model runtimes, virtual environments, and the top recommended models so that when the installer finishes, every pillar works on first launch. No post-install scavenger hunt.
5. **Privacy by construction.** Memory writes pass through the [`redactSecrets`](core/observability/redactSecrets.ts) pre-index filter (AWS keys, classic + fine-grained GitHub PATs, Slack tokens, JWTs, PEM blocks, env-style assignments). Telemetry, traces, and logs are local-only by default and redact secret patterns before any opt-in export.
6. **OS parity (new in v1.1.0).** Every claim that works on Windows also works on macOS (Intel + Apple Silicon) and Linux (x86_64), or is explicitly documented in the per-platform notes.

---

## Quick Start (developer workflow)

End users: grab the one-file installer for your OS from the [releases page](https://github.com/bendourthe/Nexus-AI/releases) and follow the [installation guide](docs/install.md) (including the unsigned-binary warnings). Developers work against the source tree:

```bash
# Prereqs: Node 20+, Rust + Cargo (for Tauri core), Ollama for inference.
git clone https://github.com/bendourthe/Nexus-AI.git
cd Nexus-AI
npm ci                       # install root + desktop workspace dependencies
npm run build                # compile shared core + Coding module
npm run test                 # full vitest suite (4,800+ tests)

# Working on the desktop shell:
npm run dev:shell            # opens the Tauri window in dev mode (Vite HMR + sidecar)
npm run build:shell          # produces a platform-native bundle
npm run build:sidecar        # bundles the Node sidecar via esbuild
npm run lint:shell           # eslint --max-warnings=0 on desktop/
npm run test:shell           # vitest run for the desktop workspace
npm run test:shell:coverage  # 80% lines / 80% functions gate
```

The cross-platform CI gate is `.github/workflows/shell-build.yml` (windows-latest / macos-latest / ubuntu-latest).

### CLI tools (already shipped)

```bash
# Sync the Nexus-Hub skill catalog (single-home ~/.nexus-ai/catalog/ since v1.10.0):
nexus skills sync [--tag <tag>] [--apply]
nexus skills list [--namespace <ns>]
nexus skills install <namespace>/<name> --from <url>   # v1.1.0 Phase 8.3
nexus skills remove <namespace>/<name>                 # v1.1.0 Phase 8.3
nexus skills audit [--deep-logs] [--by-root]           # v1.3.0 five-section token-budget report
nexus skills optimize                                  # v1.12.0 surface of the v1.7 self-optimizer (held-out gate + approval)
nexus skills frontier                                  # v1.12.0 Pareto candidate frontier

# Skill / agent evaluation:
nexus golden run                                       # v1.7.0 golden-task live runner over the headless agent

# Memory introspection + maintenance:
nexus memory audit [--since <ISO>] [--tier <t>] [--scope <id>] [--session <id>]
nexus memory export --out <file>                       # JSONL, base64 vectors
nexus memory import --in <file>
nexus memory decay --now                               # manual Ebbinghaus sweep

# Deterministic source-code checks (lint + hook + skill validation):
nexus check ...

# Read-only stale-state inventory (legacy state, caches, dup skills, symlinks, memory):
nexus doctor [--migration-report] [--json]             # v1.4.0 Phase 5; never mutates disk
```

---

## Featured Capabilities

| Capability | Surface |
|---|---|
| **Plan mode** | `/plan` slash command produces a Markdown plan; the agent then walks each step. |
| **Auto mode** | End-to-end tool-using sessions with verification gates and git checkpoints. |
| **Four-layer memory** | Working / episodic / semantic / graph layers with per-tier Ebbinghaus half-lives (24h / 7d / 30d / 365d) and a scope-aware retriever. |
| **Hybrid retrieval** | BM25 + dense + graph via Reciprocal Rank Fusion (`k=60`); local `all-MiniLM-L6-v2` embedder bundled. |
| **Session replay** | Timeline scrubber + compare-two-sessions diff view in the Trace dashboard. |
| **Skill harness** | Nexus-Hub catalog synced via `nexus skills sync` into a single-home `~/.nexus-ai/catalog/`; hot-reload via fs.watch on the ACTIVE pointer; weekly auto-sync worker; allowlist + prompt-injection scanner on every install. |
| **Skill self-optimization** | Local golden-task-graded, held-out-validated, human-approved bounded edits to skills (`nexus skills optimize` / `frontier`, plus a desktop approval panel); opt-in and default-off. |
| **Per-model harness selection** | Auto-tunes the agent scaffold profile per local model with a golden A/B; opt-in (`nexus.coding.harnessSelector.enabled`). |
| **MLX via local adapters** | Apple Silicon: register an mlx-vlm / LM Studio MLX / nativ loopback server as `nexus.llm.localAdapters` ([how-to](docs/v1/v1.16/guides/mlx-via-local-adapters.md)). No bundled MLX runtime. |
| **llama.cpp via local adapters** | User-started `llama-server` on loopback as `nexus.llm.localAdapters` ([recipe](docs/reference/llamacpp-loopback-adapter.md)). No bundled runtime. Does not open the patient-tier gate. |
| **Local API server** | Opt-in loopback OpenAI/Anthropic gateway (`nexus.serving.enabled`, default off) so other tools on this machine reuse installed models. ACP (`nexus.acp.enabled`) mounts `POST /acp` on the same listener and token. Unattended ACP confirms park in the ask inbox. |
| **Ask inbox + scheduler** | Persistent local approval queue for headless/scheduled runs (`~/.nexus/ask-inbox.json`). Desktop `/inbox` panel, pending badge. Local cron-style scheduler; morning brief off by default; no auto-approve. |
| **Document parsing** | Optional RapidOCR (CPU, every OS) and Unlimited-OCR (NVIDIA) for PDF/image; native DOCX/PPTX/XLSX without those models. Chat attachments parse locally. Docling is not required. |
| **Motion identity** | Internal orbs / beam / metal on the desktop shell (v1.17.0). One winner per surface. Honors OS reduced-motion (halt, not slow). |
| **Slash commands** | `/recall`, `/remember`, `/forget`, `/curate`, `/trace`, `/memory`, `/plan`, plus the full skill-backed catalog with `preferUpstream` ordering. |
| **GPU scheduler** | Prioritizes Coding token generation over background diffusion work when both compete for the same GPU; tier-aware (`diffusion-low` / `mid` / `high`). |
| **MCP support** | Stdio MCP servers integrate via the per-project registry; reverse-engineering-first policy bans search / embeddings / scraping / generation as a service. Per-tool deny (v1.18.0 Phase 3) only tightens that default. |
| **Trace dashboard** | Tool spans, hook filter, session list side-rail, replay scrubber, side-by-side compare. |
| **Operation log** | Opt-in append-only Markdown line per tool call; secret-path denylist redacts paths before write. |

---

## Repository Layout

```
src/         VS Code extension host surface: activation, webview panels, tool handlers, storage, and the desktop-daemon adapter
core/        Shared-core packages imported by both src/ and desktop/sidecar/ (memory, skills, lifecycle, observability, storage, registry, telemetry, codegraph, scheduler, security, image, video)
modules/     Per-pillar engine code (coding, chat); the agentic-coding engine moved here from src/ in the v1.4.0 cycle
tests/       Unit, integration, e2e, and benchmark suites
desktop/     Tauri 2.x desktop shell + Node sidecar (v1.0.0 Phase 1+)
  src/         Vite + React 19 + TypeScript frontend (four-pillar UI)
  src-tauri/   Rust core (sidecar lifecycle, ipc_call command)
  sidecar/     Node sidecar (esbuild-bundled, JSON-RPC 2.0 over stdio)
docs/        Per-version architecture docs and history (docs/v1/v1.<MINOR>/; the v0 line archived under docs/archive/versions/v0/)
configs/     Linter, build, dependency-cruiser, and vitest configs
scripts/     Build, package, installer, and utility scripts
assets/      Icons, images, fonts, banners
.claude/     Agent-agnostic subagent prompts and slash-command definitions (committed)
bin/         CLI entry points (nexus, nexus-check, nexus-image, nexus-video)
```

The cross-OS installer source tree lives at [scripts/installer/](scripts/installer/) - a PyQt-based, single-artifact branded wizard. The one-shot installer landed across the v1.8.0 -> v1.11.0 cycles: dependency provisioning, an embedded desktop bundle, per-VRAM model curation, a clean-machine test harness, and full background continuation.

---

## Safety and Use in Regulated Industries

Nexus is built on a **local-first** principle: inference, embeddings, memory storage, and image / video synthesis all run on the host machine, and no outbound calls happen without explicit user opt-in. The MCP Registry Policy in [AGENTS.md](AGENTS.md) categorically rejects search-as-service, embeddings-as-service, scraping-as-service, and generation-as-service. The full threat-model breakdown and reporting policy is in [SECURITY.md](SECURITY.md).

Short version:

- **Open-source / hobby / internal commercial software**: green. No restrictions.
- **Regulated industries (healthcare, finance, government, life sciences, automotive, industrial)**: green WITH caveats. Nexus itself is local-only; the caveat is your chosen model and any MCP servers you add. Use a regulated-cloud option (AWS Bedrock, GCP Vertex AI, Azure OpenAI) only if your data-protection obligations require it, otherwise run fully local against Ollama.
- **Defense / classified / air-gapped**: feasible (the whole stack runs offline once the installer payload is staged) but do your own assessment.

What Nexus does NOT do by default: telemetry, analytics, phone-home, third-party data processors, model downloads at runtime, API-key requirements. Memory writes are scrubbed by [`redactSecrets`](core/observability/redactSecrets.ts) before SQLite insert. The `lifecycle.tool.failed` HookBus event redacts the error string at the bus boundary so leaked secrets in tool errors never reach trace consumers.

What is OUT of Nexus's control: your chosen LLM weights, any MCP server you wire in, user-initiated outbound calls (`gh`, `git push`, `curl`), and your own user-authored hooks and rules. Code the agent runs via `run_terminal` executes at your user privilege with tool-layer guardrails (command blocklist, touched-path / secret-path denylists, confirmation gate, env scrubbing). An optional OS process sandbox (`nexus.coding.execSandbox`, off by default) adds Seatbelt / Landlock+seccomp / Windows job-object confinement on top; when the setting is off or the host cannot apply a backend, the UI and logs state **unconfined**. Windows does not kernel-enforce filesystem or network (partial). See [SECURITY.md](SECURITY.md) for the full caveats.

To report a security issue: email [benjamin.dourthe@gmail.com](mailto:benjamin.dourthe@gmail.com) or open a private security advisory at [github.com/bendourthe/Nexus-AI/security](https://github.com/bendourthe/Nexus-AI/security).

---

## Roadmap

Nexus evolves in versioned slices. Each item below traces to a concrete plan or known-gaps entry under `docs/v1/v1.<MINOR>/` (the durable source) and resolves once its work lands and the next `[X.Y.Z]` block is cut into [CHANGELOG.md](CHANGELOG.md). No star gates, no sponsor tiers, no paid features.

| Focus | Status | Source |
|-------|--------|--------|
| OS-level process sandbox for agent code execution (Seatbelt / Landlock / seccomp / job object). Off by default; loud unconfined when off or the backend is missing. Windows is partial (job + token; filesystem and network not kernel-enforced) | Landed (v1.18.0 Phase 6; Windows remainder in DF-11) | [docs/v1/v1.18/known-gaps.md](docs/v1/v1.18/known-gaps.md) (`EM.P5.A`, `DF-11`) |
| Live extreme-low-bit (BitNet-class) + disk-offload "patient" catalog entries, once runtime support + independent benchmarks are confirmed | Gated | [docs/v1/v1.12/known-gaps.md](docs/v1/v1.12/known-gaps.md) (`EM.P3`, `EM.P4.A`) |
| Weak-model harness-selector enablement, pending a live A/B net-win on a low-cost model | Gated | [docs/v1/v1.12/known-gaps.md](docs/v1/v1.12/known-gaps.md) (`EM.P1`) |
| Skill-optimizer live A/B validation (ship the default-on rollout once a net win is measured) | Gated | [docs/v1/v1.7/known-gaps.md](docs/v1/v1.7/known-gaps.md) (`SO003.P3.A`) |
| Clean-machine installer rehearsals + on-device 3-OS visual QA (Actions freeze lifted 2026-08-01; remaining work is operator hardware) | Tracked | [docs/v1/v1.11/known-gaps.md](docs/v1/v1.11/known-gaps.md) (`IO.P2.A`) |

For narrative-style updates on what changed and why, see [docs/DEVLOG.md](docs/DEVLOG.md). For the formal Keep-a-Changelog log of every release, see [CHANGELOG.md](CHANGELOG.md). For the per-version unfinished-work tracker that the next plan reads to decide what carries forward, see `docs/v1/v1.<MINOR>/known-gaps.md`.

---

## Collaboration

Nexus is a curated open-source project. While pull requests are typically not accepted from outside contributors, suggestions, feedback, and recommendations are more than welcomed. If you have a better prompt, a smarter rule, or a pattern you would like to see in the catalog, please reach out directly:

- **Email**: [benjamin.dourthe@gmail.com](mailto:benjamin.dourthe@gmail.com)
- **GitHub**: [@bendourthe](https://github.com/bendourthe)

I am happy to discuss feature proposals, integration ideas, or specific use cases - especially when the proposal aligns with the policy direction of this project (local-first, reverse-engineering-first, no third-party data leaks).

For internal contributors and AI collaborators, the development workflow lives in [CONTRIBUTING.md](CONTRIBUTING.md); the step-by-step walkthrough for first-time contributors is in [CONTRIBUTING-BEGINNERS.md](CONTRIBUTING-BEGINNERS.md); the agent-agnostic engineering directive is in [AGENTS.md](AGENTS.md).

---

## License

MIT. See [LICENSE](LICENSE).
