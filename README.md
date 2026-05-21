<p align="center"><a href="https://github.com/bendourthe/Nexus-AI"><img src="assets/nexus_banner.png" alt="Nexus" width="640" /></a></p>

<p align="center"><em>Your Local AI Studio. Four Pillars, One Desktop, Zero Tokens Billed.</em></p>

# Nexus

Nexus is a local-first, native desktop AI Studio that bundles four generative AI pillars behind one cohesive UI: agentic coding, organized local chat, image generation and editing, and short-form video synthesis. Everything runs on the host machine against optimized open-source models (Gemma 4, Llama 3, Qwen 2.5 Coder, SDXL / SANA-class diffusion, video-synthesis architectures), with real-time GPU / VRAM telemetry built into the dashboard. No API keys, no data leaving your machine, no per-token billing.

> **Renamed from Gemma Code at v1.0.0** to reflect the four-pillar pivot. The v0.1.0 - v0.22.x line shipped as a single-purpose local agentic coding VS Code extension; v1.0.0 folded that engine into the "Agentic AI Coding" pillar of a wider desktop app. The VS Code surface is preserved as an optional thin adapter that proxies to the desktop daemon. Historical Gemma Code docs remain under `docs/v0.1.0/` - `docs/v0.9.0/`; the v1.0.0 pivot is documented under `docs/v1.0.0/`; the active v1.1.0 cycle is at `docs/v1.1.0/`.

---

## How Nexus fits with Nexus-Hub

<p align="center">
<a href="https://github.com/bendourthe/Nexus-AI"><img src="assets/nexus_banner.png" alt="Nexus" width="360" align="middle" /></a>
&nbsp;&nbsp;&nbsp;<strong style="font-size: 28px;">&harr;</strong>&nbsp;&nbsp;&nbsp;
<a href="https://github.com/bendourthe/Nexus-Hub"><img src="https://raw.githubusercontent.com/bendourthe/Nexus-Hub/main/assets/nexus_hub_banner.png" alt="Nexus-Hub" width="360" align="middle" /></a>
</p>

Nexus and [Nexus-Hub](https://github.com/bendourthe/Nexus-Hub) are two halves of the same idea, split along a deliberate seam.

- **Nexus (this repo)** is the runtime: a native desktop AI Studio with four pillars (Coding, Chat, Image, Video), four-layer local memory, hybrid retrieval (BM25 + dense + graph via RRF), session replay, GPU scheduling, hardware-aware model selection, and a cross-OS installer that provisions CUDA / Metal / ROCm tooling on first launch. It runs against local open-source models via Ollama; no outbound runtime calls without explicit user opt-in.
- **Nexus-Hub** is the catalog: 203 curated skills, 36 commands, 14 hooks, 10 agents, 4 language rule families, plus 3 internal MCP servers. It is content-only, platform-agnostic, and installs into every supported AI assistant's per-platform config locations. Nexus consumes the same catalog as its upstream skill feed via the `nexus skills sync` CLI.

The two projects are designed to be useful independently: you can install Nexus-Hub into Claude Code / Codex / Gemini / Cursor without touching Nexus, and Nexus can run with or without the upstream catalog wired in. The combination is what gives a single curated skill set to every agent surface a developer touches: terminal, IDE, and now a dedicated desktop app.

---

## The Four Pillars

### 1. Agentic AI Coding

Autonomous code-generation and terminal environment. Reads local repositories, executes code in isolated environments, debugs, and implements complex features across files. Inherits everything Gemma Code shipped (tool registry, plan mode, four-layer memory, MCP support, skill catalog, sub-agent dispatch) and extends it to all installed local LLMs - not just Gemma 4. Available as a desktop pillar and as an optional VS Code extension (`nexus-coding`) that proxies to the desktop daemon when available and falls back to a legacy in-process engine when not.

### 2. Local Chatbot Explorer

Conversational interface with a filesystem-style organizer: chats live in nested folders and subfolders, contexts can be compartmentalized per project, and the four-layer memory system (working / episodic / semantic / graph) keeps long-running threads coherent. Hybrid retrieval (BM25 + dense + graph via Reciprocal Rank Fusion, `k=60`) replaced the v0.x substring path in v1.1.0 Phase 5; the local `all-MiniLM-L6-v2` embedder is bundled by the installer so production hosts never hit the Hugging Face Hub.

### 3. Image Studio

Text-to-image, image-to-image, inpainting, and outpainting against local diffusion pipelines. Tuned for laptop-class single-GPU hardware. v1.1.0 Phase 12 makes SANA-1.6B the new default 1024px model (~2x faster than SDXL Turbo, Apache-2.0 weights), adds Sana-Sprint as the "Fast Preview" speed tier (~0.3 s on RTX 4090), gates SANA 2K / 4K behind a `DiffusionTier` policy, and ships SANA-ControlNet plus the Flow-DPM-Solver sampler.

### 4. Video Lab

Short-form video synthesis via text prompts or static reference images, with a timeline previewer and granular generation controls. v1.1.0 Phase 13 adds SANA-Video 2B as the "Fast 720p" tier between LTX-Video and CogVideoX. Targets local video-synthesis architectures sized for a single consumer GPU.

### Always-on telemetry

A persistent `Local Model Status` panel reports the active model architecture, parameter size, live GPU utilization, and free VRAM - so dense computational passes do not silently OOM. The same telemetry feeds the GPU scheduler (Phase 3) that prioritizes Coding token generation over background diffusion work when both pillars compete for the same GPU.

---

## Project Status (May 2026)

The v1.0.0 cycle (Q4 2025 - Q1 2026) landed all 11 phases, shipping a working four-pillar desktop app with a Windows installer, four-layer memory, GPU scheduler, MCP harness, skill catalog backed by Nexus-Hub (formerly DevAI-Hub), and a Tauri 2.x shell speaking JSON-RPC 2.0 to a Node sidecar.

The v1.1.0 cycle (currently in flight) is the **stabilization-plus-expansion** wave. Phase 1-8 have landed; phases 9-15 close out the cycle.

| Phase | Title | Status |
|---|---|---|
| 1 | Shared-core build + carryforward closure | Landed |
| 2 | Sidecar IPC widening + `tauri::Channel` notifications | Landed (partial; closures tracked under 1.4.P1.B) |
| 3 | GpuScheduler integration + Hardware Settings + DiffusionTier defaults | Landed (partial) |
| 4 | Memory provenance + 12-hook lifecycle + secret pre-index filter | Landed |
| 5 | Hybrid retrieval (BM25 + dense + graph via RRF) + local embedder | Landed |
| 6 | Memory CLI + Ebbinghaus decay + `/recall` `/remember` `/forget` slash commands | Landed |
| 7 | Session replay timeline + compare-two-sessions mode | Landed |
| 8 | DevAI-Hub closures + skill hot-reload + AgentLoop skill provenance | Landed |
| 9 | Opt-in memory consolidation (contradiction resolver + file compressor) | Planned |
| 10 | VS Code extension thin-adapter rewrite + Marketplace re-publish | Planned |
| 11 | Nexus VS Code extension (multi-model agentic add-on) | Planned |
| 12 | Image Studio upgrade (NVIDIA SANA family) | Landed (2026-05-20) |
| 13 | Video Lab fast tier (SANA-Video 2B) | Planned |
| 14 | Cross-OS installer (Windows + macOS + Linux) with hardware + disk-aware model picker | Planned |
| 15 | Hardening + release gate | Planned |

The cycle plan lives at [docs/v1.1.0/plans/v1.1.0-cycle.md](docs/v1.1.0/plans/v1.1.0-cycle.md). Per-phase plans are siblings under the same directory. The per-version unfinished-work tracker is at [docs/v1.1.0/known-gaps.md](docs/v1.1.0/known-gaps.md).

---

## Design Principles

1. **Local-first.** Inference, embeddings, image and video synthesis, and memory storage all live on the host machine. No outbound calls without explicit user opt-in.
2. **Originality over wrappers.** When an external service or heavy framework can be reverse-engineered into a lean local module, we do that. The codebase follows this rule explicitly (see [AGENTS.md](AGENTS.md) "MCP Registry Policy" and the comparison matrices at [docs/v1.1.0/comparison-agentmemory.md](docs/v1.1.0/comparison-agentmemory.md) and [docs/v1.1.0/comparison-sana.md](docs/v1.1.0/comparison-sana.md)). The only external project we deliberately link to is [bendourthe/Nexus-Hub](https://github.com/bendourthe/Nexus-Hub), the author's own skill / hook / command catalog and the upstream feed for Nexus's skill harness.
3. **Single-GPU ceiling.** Every pillar must run on a laptop with a single consumer GPU (e.g. RTX 3070 - 4090 class). Hardware tiers are auto-detected at install and context budgets, batch sizes, and pipeline depths adapt accordingly.
4. **Installer carries the burden.** The cross-OS installer (Phase 14) provisions CUDA / Metal Performance Shaders / ROCm, Python, Node, model runtimes, virtual environments, and the top recommended models so that when the installer finishes, every pillar works on first launch. No post-install scavenger hunt.
5. **Privacy by construction.** Memory writes pass through the [`redactSecrets`](core/observability/redactSecrets.ts) pre-index filter (AWS keys, classic + fine-grained GitHub PATs, Slack tokens, JWTs, PEM blocks, env-style assignments). Telemetry, traces, and logs are local-only by default and redact secret patterns before any opt-in export.
6. **OS parity (new in v1.1.0).** Every claim that works on Windows also works on macOS (Intel + Apple Silicon) and Linux (x86_64), or is explicitly documented in the per-platform notes.

---

## Quick Start (developer workflow)

Production-ready installers ship in v1.1.0 Phase 14 (the cross-OS installer). Until then, develop against the source tree:

```bash
# Prereqs: Node 20+, Rust + Cargo (for Tauri core), Ollama for inference.
git clone https://github.com/bendourthe/Nexus-AI.git
cd Nexus-AI
npm ci                       # install root + desktop workspace dependencies
npm run build                # compile shared core + Coding module
npm run test                 # full vitest suite (3,200+ tests)

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
# Sync the DevAI-Hub / Nexus-Hub skill baseline:
nexus skills sync [--tag <tag>] [--apply]
nexus skills list [--namespace <ns>]
nexus skills install <namespace>/<name> --from <url>   # v1.1.0 Phase 8.3
nexus skills remove <namespace>/<name>                 # v1.1.0 Phase 8.3

# Memory introspection + maintenance:
nexus memory audit [--since <ISO>] [--tier <t>] [--scope <id>] [--session <id>]
nexus memory export --out <file>                       # JSONL, base64 vectors
nexus memory import --in <file>
nexus memory decay --now                               # manual Ebbinghaus sweep

# Deterministic source-code checks (lint + hook + skill validation):
nexus check ...
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
| **Skill harness** | DevAI-Hub baseline synced via `nexus skills sync`; hot-reload via fs.watch on the ACTIVE pointer; weekly auto-sync worker; allowlist + prompt-injection scanner on every install. |
| **Slash commands** | `/recall`, `/remember`, `/forget`, `/curate`, `/trace`, `/memory`, `/plan`, plus the full skill-backed catalog with `preferUpstream` ordering. |
| **GPU scheduler** | Prioritizes Coding token generation over background diffusion work when both compete for the same GPU; tier-aware (`diffusion-low` / `mid` / `high`). |
| **MCP support** | Stdio MCP servers integrate via the per-project registry; reverse-engineering-first policy bans search / embeddings / scraping / generation as a service. |
| **Trace dashboard** | Tool spans, hook filter, session list side-rail, replay scrubber, side-by-side compare. |
| **Operation log** | Opt-in append-only Markdown line per tool call; secret-path denylist redacts paths before write. |

---

## Repository Layout

```
src/         TypeScript source for the agentic-coding engine (the v0.x line; migrates to modules/coding/ across the v1.1.0 cycle)
core/        Shared-core packages imported by both src/ and desktop/sidecar/ (memory, skills, lifecycle, observability, storage, registry, telemetry)
modules/     Per-pillar code; coding/ moved first under v1.1.0 Phase 3 codemod
tests/       Unit, integration, e2e, and benchmark suites
desktop/     Tauri 2.x desktop shell + Node sidecar (v1.0.0 Phase 1+)
  src/         Vite + React 19 + TypeScript frontend
  src-tauri/   Rust core (sidecar lifecycle, ipc_call command)
  sidecar/     Node sidecar (esbuild-bundled, JSON-RPC 2.0 over stdio)
docs/        Per-version architecture docs and history (v0.1.0 -> v1.1.0)
configs/     Linter, build, dependency-cruiser, and vitest configs
scripts/     Build, package, installer, and utility scripts
assets/      Icons, images, fonts, banners
.claude/     Agent-agnostic subagent prompts and slash-command definitions (committed)
bin/         CLI entry points (nexus, nexus-check, nexus-image, nexus-video)
```

The cross-OS installer source tree lives at [scripts/installer/](scripts/installer/) (PyQt-based Windows wizard today; macOS + Linux outer shells land in v1.1.0 Phase 14).

---

## Safety and Use in Regulated Industries

Nexus is built on a **local-first** principle: inference, embeddings, memory storage, and image / video synthesis all run on the host machine, and no outbound calls happen without explicit user opt-in. The MCP Registry Policy in [AGENTS.md](AGENTS.md) categorically rejects search-as-service, embeddings-as-service, scraping-as-service, and generation-as-service. The full threat-model breakdown and reporting policy is in [SECURITY.md](SECURITY.md).

Short version:

- **Open-source / hobby / internal commercial software**: green. No restrictions.
- **Regulated industries (healthcare, finance, government, life sciences, automotive, industrial)**: green WITH caveats. Nexus itself is local-only; the caveat is your chosen model and any MCP servers you add. Use a regulated-cloud option (AWS Bedrock, GCP Vertex AI, Azure OpenAI) only if your data-protection obligations require it, otherwise run fully local against Ollama.
- **Defense / classified / air-gapped**: feasible (the whole stack runs offline once the installer payload is staged) but do your own assessment.

What Nexus does NOT do by default: telemetry, analytics, phone-home, third-party data processors, model downloads at runtime, API-key requirements. Memory writes are scrubbed by [`redactSecrets`](core/observability/redactSecrets.ts) before SQLite insert. The `lifecycle.tool.failed` HookBus event redacts the error string at the bus boundary so leaked secrets in tool errors never reach trace consumers.

What is OUT of Nexus's control: your chosen LLM weights, any MCP server you wire in, user-initiated outbound calls (`gh`, `git push`, `curl`), and your own user-authored hooks and rules. See [SECURITY.md](SECURITY.md) for the full caveats.

To report a security issue: email [benjamin.dourthe@gmail.com](mailto:benjamin.dourthe@gmail.com) or open a private security advisory at [github.com/bendourthe/Nexus-AI/security](https://github.com/bendourthe/Nexus-AI/security).

---

## Roadmap

Nexus evolves in versioned slices. Each upcoming line item below traces to a concrete plan file under `docs/<version>/plans/` (the durable source) and resolves once its `[<version>]` block lands in [CHANGELOG.md](CHANGELOG.md). No star gates, no sponsor tiers, no paid features.

| Focus | Target | Status | Source |
|-------|--------|--------|--------|
| Opt-in memory consolidation (contradiction resolver + `nexus memory compress --file`) via local Ollama | v1.1.0 | Planned | [docs/v1.1.0/plans/phase-09-memory-consolidation-optin.md](docs/v1.1.0/plans/phase-09-memory-consolidation-optin.md) |
| VS Code extension thin-adapter rewrite + Marketplace re-publish as `nexus-coding` | v1.1.0 | Planned | [docs/v1.1.0/plans/phase-10-vscode-thin-adapter-and-republish.md](docs/v1.1.0/plans/phase-10-vscode-thin-adapter-and-republish.md) |
| Nexus VS Code extension as a full agentic surface inside VS Code, model-selectable across all local LLMs | v1.1.0 | Planned | [docs/v1.1.0/plans/phase-11-nexus-vscode-extension.md](docs/v1.1.0/plans/phase-11-nexus-vscode-extension.md) |
| Image Studio: SANA-1.6B default + Sana-Sprint speed tier + SANA 2K / 4K + ControlNet + Flow-DPM-Solver | v1.1.0 | Landed (2026-05-20) | [docs/v1.1.0/plans/phase-12-image-studio-sana.md](docs/v1.1.0/plans/phase-12-image-studio-sana.md) |
| Video Lab: SANA-Video 2B "Fast 720p" tier | v1.1.0 | Planned | [docs/v1.1.0/plans/phase-13-video-lab-sana-video.md](docs/v1.1.0/plans/phase-13-video-lab-sana-video.md) |
| Cross-OS installer (Windows + macOS + Linux) with hardware-aware typed catalog UI + 10 GB OS reserve | v1.1.0 | Planned | [docs/v1.1.0/plans/phase-14-cross-os-installer.md](docs/v1.1.0/plans/phase-14-cross-os-installer.md) |
| Hardening + release gate (deep review, security audit, pen-test, signing, notarization, AppImage) | v1.1.0 | Planned | [docs/v1.1.0/plans/phase-15-hardening-and-release.md](docs/v1.1.0/plans/phase-15-hardening-and-release.md) |

For narrative-style updates on what changed and why, see [docs/DEVLOG.md](docs/DEVLOG.md). For the formal Keep-a-Changelog log of every release, see [CHANGELOG.md](CHANGELOG.md). For the per-version unfinished-work tracker that the next plan reads to decide what carries forward, see `docs/<version>/known-gaps.md`.

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
