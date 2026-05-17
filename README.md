# Nexus — Local AI Studio

> A local-first, native desktop application for developers, creators, and data scientists who want a private, high-performance workspace for generative AI workloads. No API keys, no data leaving your machine, no per-token billing.

Nexus is a single laptop-class desktop app that bundles four generative AI pillars behind one cohesive UI: agentic coding, organized local chat, image generation and editing, and short-form video synthesis. Everything runs on the host machine against optimized open-source models (Gemma, Llama, SDXL/Flux-class diffusion, video-synthesis architectures), with real-time GPU/VRAM telemetry built into the dashboard.

> **Project status (May 2026).** Nexus is the successor product to **Gemma Code** (v0.1.0 - v0.22.x), a local agentic coding VS Code extension that this repository has shipped since April 2026. The v1.0.0 cycle (currently in planning) pivots the codebase from a single-purpose VS Code extension into a four-module native desktop app. The existing agentic-coding engine becomes the **Agentic AI Coding** module, with the VS Code extension preserved as an optional surface. Historical Gemma Code docs remain under `docs/v0.1.0/` through `docs/v0.9.0/` and continue to describe the engine as it was built. New docs land under `docs/v1.0.0/`.

---

## The Four Modules

### 1. Agentic AI Coding
Autonomous terminal and code generation environment. Reads local repositories, executes code in isolated environments, debugs, and implements complex features across files. Inherits everything Gemma Code has shipped (tool registry, plan mode, memory layers, MCP support, skill catalog) and extends it to additional open-source local LLMs — not just Gemma 4. Available as a desktop module and as an optional VS Code extension.

### 2. Local Chatbot Explorer
Conversational interface with a filesystem-style organizer: chats live in nested folders and subfolders, contexts can be compartmentalized per project, and the four-layer memory system (working / episodic / semantic / graph) keeps long-running threads coherent.

### 3. Image Studio
Text-to-image, image-to-image, inpainting, and outpainting against local diffusion pipelines. Tuned for laptop-class single-GPU hardware; infinite rapid prototyping without subscription costs.

### 4. Video Lab
Short-form video synthesis via text prompts or static reference images, with a timeline previewer and granular generation controls. Targets local video-synthesis architectures sized for a single GPU.

### Always-on telemetry
A persistent `Local Model Status` panel reports the active model architecture, parameter size, live GPU utilization, and free VRAM — so dense computational passes do not silently OOM.

---

## Design Principles

1. **Local-first.** Inference, embeddings, image and video synthesis, and memory storage all live on the host machine. No outbound calls without explicit user opt-in.
2. **Originality over wrappers.** When an external service or heavy framework can be reverse-engineered into a lean local module, we do that. The codebase already follows this rule (see `AGENTS.md` MCP Registry Policy and the `docs/v0.7.0/comparison-multi-source.md` adoption matrix). The only external project we deliberately link to is [bendourthe/DevAI-Hub](https://github.com/bendourthe/DevAI-Hub), which is the author's own skill/hook/command catalog and is intended as an upstream feed for Nexus's skill harness.
3. **Single-GPU ceiling.** Every module must run on a laptop with a single consumer GPU (e.g. RTX 3070 - 4090 class). Hardware tiers are auto-detected and context budgets, batch sizes, and pipeline depths adapt accordingly.
4. **Installer carries the burden.** The Windows installer (and later macOS / Linux packages) provisions CUDA, Python, Node, model runtimes, virtual environments, and the top recommended models so that when the installer finishes, every module works on first launch. No post-install scavenger hunt.
5. **Privacy by construction.** Memory, telemetry, traces, and logs are local-only by default and redact secret patterns before any opt-in export.

---

## Current State

The repository currently contains the Gemma Code engine at version 0.22.x. The v1.0.0 cycle is in flight: **Phase 1 (Tauri desktop shell foundation)** landed on 2026-05-17 and ships the `desktop/` Tauri 2.x workspace, design tokens, sidebar + 2x2 dashboard, Local Model Status widget, and a Node sidecar speaking JSON-RPC 2.0 over stdio. The user-facing surface remains the VS Code extension until Phase 9 (single-binary installer) lands.

For the existing extension's features, configuration keys, slash commands, installer, and architecture, see the legacy quick-start in [docs/v0.9.0/](docs/v0.9.0/) and the historical README content preserved at [docs/v0.9.0/legacy-readme.md](docs/v0.9.0/legacy-readme.md).

For the Nexus pivot — the v1.0.0 desktop-app plan, module decomposition, comparisons against ComfyUI and DevAI-Hub, installer scope, and phased delivery — see [docs/v1.0.0/](docs/v1.0.0/). Phase 1 outcome lives at [docs/v1.0.0/development/history/2026-05-17_phase-01-shell-foundation.md](docs/v1.0.0/development/history/2026-05-17_phase-01-shell-foundation.md); design tokens are documented at [docs/v1.0.0/design-tokens.md](docs/v1.0.0/design-tokens.md); known gaps at [docs/v1.0.0/known-gaps.md](docs/v1.0.0/known-gaps.md).

### Working on the desktop shell

```
npm run dev:shell          # opens the Tauri window in dev mode (Vite HMR + sidecar)
npm run build:shell        # produces a platform-native bundle
npm run build:sidecar      # bundles the Node sidecar via esbuild
npm run lint:shell         # eslint --max-warnings=0 on desktop/
npm run test:shell         # vitest run for the desktop workspace
npm run test:shell:coverage  # 80% lines / 80% functions gate
```

Cargo + Rust are required for the Tauri core; the workspace is otherwise standard `npm workspaces`. The cross-platform CI gate is `.github/workflows/shell-build.yml` (windows-latest / macos-latest / ubuntu-latest).

---

## Repository Layout

```
src/         TypeScript source for the current agentic-coding engine
tests/       Unit, integration, and e2e test suites
desktop/     Tauri 2.x desktop shell (v1.0.0 Phase 1+)
  src/         Vite + React 19 + TypeScript frontend
  src-tauri/   Rust core (sidecar lifecycle, ipc_call command)
  sidecar/     Node sidecar (esbuild-bundled, JSON-RPC 2.0 over stdio)
docs/        Per-version architecture docs and history (v0.1.0 -> v0.9.0 + v1.0.0 pivot)
configs/     Linter, build, and dependency-cruiser configs
scripts/     Build, package, installer, and utility scripts
assets/      Icons, images, fonts
.claude/     Agent-agnostic subagent prompts and slash-command definitions (committed)
```

The v1.0.0 cycle is in flight. `desktop/` ships in Phase 1; the `modules/` subtree (one folder per module: `coding/`, `chat/`, `image/`, `video/`) and the carve-out of `src/` into a shared core land in Phase 2.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and [CONTRIBUTING-BEGINNERS.md](CONTRIBUTING-BEGINNERS.md) for a step-by-step walkthrough. The agent-agnostic engineering directive lives in [AGENTS.md](AGENTS.md).

## License

MIT. See [LICENSE](LICENSE).
