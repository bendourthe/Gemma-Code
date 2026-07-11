# Nexus v1.0.0 - Pivot Brief

> Date: 2026-05-16
> Author: Benjamin Dourthe (project lead) + Claude (synthesis)
> Status: Pre-plan. This brief is the input artifact consumed by `/generate-plan`.

## 1. What is changing

The repository was named **Gemma Code** (v0.1.0 - v0.22.x): a single VS Code extension delivering a local agentic coding assistant powered by Gemma 4 via Ollama, designed to run on a single laptop GPU. As of 2026-05-16, the product is being renamed and rescoped to **Nexus**: a native desktop application that bundles four generative AI pillars behind one cohesive UI, still local-first, still single-GPU-aware, still privacy-by-construction.

The existing Gemma Code engine - AgentLoop, ToolRegistry, ConversationManager, PromptBuilder, the four-layer memory system, plan mode, skill catalog, MCP support, the trace dashboard, the curator scheduler, the v0.7.0 - v0.9.0 hardening - is **not** discarded. It becomes the **Agentic AI Coding** module of Nexus and continues to ship as a (now-optional) VS Code extension surface alongside the desktop app.

## 2. Product vision (paraphrased from the project lead's brief)

> Nexus is a local-first, native desktop application designed for developers, creators, and data scientists who require a private, high-performance workspace for generative AI workloads. By leveraging optimized open-source LLMs, diffusion models, and video synthesis architectures, Nexus eliminates reliance on cloud APIs. This architecture ensures complete data privacy, zero latency variance, and predictable offline availability. The user interface utilizes a dark-themed, sleek layout optimized for multi-tasking and real-time hardware performance monitoring.

The four pillars:

| Pillar | Inherits from | New surface |
|---|---|---|
| **Agentic AI Coding** | All of today's `src/` engine | Desktop module + optional VS Code extension; multi-LLM (Gemma 4, Llama 3, Qwen, etc.) |
| **Local Chatbot Explorer** | Conversation manager, memory layers, chat history store | Filesystem-style explorer for organizing chats in nested folders, per-folder context isolation |
| **Image Studio** | Nothing (greenfield) | Text-to-image, image-to-image, inpaint/outpaint via local diffusion |
| **Video Lab** | Nothing (greenfield) | Text-to-video, image+text-to-video via local video synthesis, with timeline previewer |

Always-on telemetry: a `Local Model Status` panel showing active model, parameter size, live GPU utilization, free VRAM.

## 3. UI mockup analysis (2026-05-16 reference image)

The project lead provided an AI-generated mockup of the dashboard. Verbatim observations:

- **Window chrome.** Custom title bar reading "Nexus - Local AI Studio", Windows 11 system tray controls on the right. Implies a native shell (Electron / Tauri / WinUI) rather than a browser tab.
- **Left sidebar (permanent).** Logo + wordmark at top. Five navigation entries with color-coded icons: Chatbot, Agentic AI (highlighted as active in the mockup), Images, Videos. Lower section is visually isolated: Settings, User Profile. The isolation prevents accidental admin clicks during a generation run.
- **Top bar.** Module title ("NEXUS Dashboard: Your Local AI Workspace"), search field, notification bell with red dot, gear icon.
- **Welcome line.** Greeting with first name ("Welcome, Alex!").
- **Dashboard cards (2x2 grid).** Each card has an icon, title, one-line subtitle, two-line description, and a primary CTA. Cards: Agentic Coding (Open Code Assistant), Local Chatbot (Start New Chat), Image Studio (Create Image), Video Lab (Generate Video). Each card has a small visual preview on the right.
- **Lower section (cut off but visible).** "Recent Projects" list (project name, model, last-updated timestamp) and "Local Model Status" panel (e.g. "Gemma 4 7B - Active. GPU Usage: 38% RTX 3080, 50GB VRAM Free").
- **Floating action button.** Bottom-right has a sparkle (AI assist) and a `?` (help).
- **Visual style.** Dark theme. Background hints at a faint constellation/graph motif (the "Nexus" identity). Cyan/blue accents on Chatbot, magenta/red on Agentic AI, orange/yellow on Images, green on Videos - the four-color palette must be defined as a design token early.

### UI primitives the v1.0.0 plan must commit to early

- Dark-theme design tokens (palette, typography, spacing, radius). The four module accent colors (cyan, magenta, orange, green) feed brand identity throughout the app.
- A `Local Model Status` widget contract: the same data model is consumed by the dashboard card and any module-internal hardware-watch panel.
- A `Module Card` component contract for the 2x2 dashboard grid (icon, title, subtitle, body, CTA, preview slot).
- A `Sidebar` component with a clean separation between primary modules and admin entries.

## 4. Constraints (non-negotiable)

1. **Local-first.** All four modules must operate fully offline once installed. No background telemetry. Opt-in only for any outbound call.
2. **Single-GPU ceiling.** Every module must run on a laptop with a single consumer GPU (RTX 3070 - 4090 class). When two modules contend for VRAM, scheduling is explicit (one foreground module at a time per VRAM budget); the telemetry panel must always reflect the truth.
3. **Originality over wrappers.** Per AGENTS.md MCP Registry Policy, the decision tree is: local-only > LLM-native skill > reverse-engineered internal module > trusted-vendor wrapper (your-own-account only, justified) > drop. Apply the same lens to libraries: prefer reverse-engineering ComfyUI-style pipeline orchestration and SD-WebUI-style image editors into lean Nexus-native modules over vendoring them wholesale.
4. **DevAI-Hub is the one explicitly linked upstream.** Skills, hooks, slash commands, and rules from [bendourthe/DevAI-Hub](https://github.com/bendourthe/DevAI-Hub) are intended as an upstream feed. The plan must include a `nexus skills sync` pathway that pulls the latest catalog into the Agentic AI Coding module without manual copy-paste.
5. **Installer carries the burden.** A single `.exe` (Windows first, macOS / Linux later) downloads, installs, and PATH-registers CUDA, Python venv, Node, Ollama, model runtimes, and the top recommended models. When the installer finishes, every module is ready to run with zero manual setup. Model selection is part of the wizard (default to a recommended set; advanced users can add more).
6. **Audience: solo developer / creator / data scientist on a laptop.** No multi-user, no cloud sync, no team admin for v1.0.0.

## 5. Inherited assets (the v0.1.0 - v0.22.x engine)

The Gemma Code engine ships a deep agentic-coding stack that the v1.0.0 Coding module inherits as-is and refactors behind a module boundary. Highlights worth preserving across the pivot:

- AgentLoop + ToolRegistry + ToolCatalog + ToolActivationRules (15-tool cap, context-conditional)
- Plan mode + inline diff annotation
- 4-layer memory: working / episodic / semantic (FTS5 + embeddings + HNSW vector) / graph (entity-relationship triples), unified retrieval, anticipatory IntuitionCache
- 8-stage compaction pipeline + model-callable `compress` tool
- Two LLM backends (Ollama, LM Studio) selectable via `gemma-code.llm.backend = auto | ollama | lmstudio`; auto-detect on macOS
- Skill catalog with hot-reload at `~/.gemma-code/skills/`, harvested skills, per-skill metrics, dual-loop curator
- Sub-agents (verify, research, plan) with isolated tool scopes; auto-verification after file edits
- MCP client + server (opt-in)
- Pass-state gating (turn cannot terminate without a verification-class success since last user message)
- Trace dashboard (`/trace enable | dump | clear | status`) with secret-path redaction
- `gemma-check` standalone deterministic checks CLI (10 rules)
- PyQt5 installer wizard (cross-platform, with `--headless --skip-model --json-output` for CI)
- Hardware-tier auto-detection (constrained / balanced / full) + per-tier benchmarks and golden tasks
- Vendor-neutral LLM port + dependency-cruiser-enforced module boundaries
- Cursor-native skill bundle, Claude Code / OpenCode / Gemini CLI bundles via `npm run package:skills`

The v1.0.0 plan extracts these into the `coding/` module and exposes them to the desktop shell via a stable IPC contract.

## 6. Open questions (to be answered during plan generation)

These will be surfaced as interview prompts in `/generate-plan`:

1. **Desktop shell technology.** Electron vs Tauri vs native (WinUI / Qt). Trade-offs: Electron (mature, large bundle), Tauri (small bundle, Rust core, single-binary distribution, good fit with the originality principle), native (best UX, highest cost). Default proposal: **Tauri**, with the existing TypeScript engine reused via a sidecar process.
2. **Diffusion stack.** Pure-PyTorch local stack vs ComfyUI-derived node graph vs custom reverse-engineered orchestrator. The ComfyUI comparison doc (next step) feeds this.
3. **Video synthesis stack.** Stable Video Diffusion, ModelScope T2V, CogVideoX, or AnimateDiff-class. Each has different VRAM characteristics on a single GPU. Plan will pick one as the v1.0.0 default.
4. **Model download manager.** Reverse-engineered HuggingFace+Civitai-style fetcher vs trusted-vendor wrapper. Default proposal: a Nexus-native fetcher with content-addressable storage and resume support.
5. **Settings key migration.** All `gemma-code.*` settings keys need to become `nexus.*` (or `nexus.coding.*`) with a one-cycle compat shim that reads the old keys and emits a deprecation log. Plan must sequence this so it ships in one phase.
6. **VS Code extension future.** Continue shipping as `vscode-extension/` workspace, or fold into the Agentic AI Coding module as a thin adapter that proxies to the desktop daemon? Default proposal: thin adapter, so the engine has a single home.

## 7. Repository-wide rebrand scope

A grep on 2026-05-16 found **1,932 mentions of "Gemma-Code" / "Gemma Code" / "gemma-code" / "GemmaCode" / "gemmaCode" across 250 files**. Rebrand is staged:

- **Done in this pivot brief commit:** `README.md`, `ARCHITECTURE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `CONTRIBUTING-BEGINNERS.md`, `package.json` (`displayName`, `description`, sidebar `title`, `configuration.title`).
- **Completed in v1.0.0 Phase 2 (Rebrand sweep + shared-core extraction):**
  - **Code identifiers** (Phase 2.7): `GemmaCodePanel` -> `NexusCodingPanel`, `GemmaRuntime` -> `NexusCodingRuntime`. The Gemma 4 *model* (`Gemma4ToolFormat`, `gemma4:e4b`, `Gemma 4`) is intentionally preserved.
  - **Settings keys** (Phase 2.1): `gemma-code.*` -> `nexus.*` / `nexus.coding.*` / `nexus.llm.*` / `nexus.memory.*` with one-cycle compat shim at [`src/config/SettingsCompat.ts`](../../../src/config/SettingsCompat.ts). Legacy keys emit a one-line deprecation log; removed in v1.1.0.
  - **Storage paths** (Phase 2.2): `~/.gemma-code/` -> `~/.nexus/` via idempotent first-launch migration at [`core/storage/StorageMigration.ts`](../../../core/storage/StorageMigration.ts). POSIX symlinks the legacy directory; Windows leaves a README. Wholesale rename of every `.gemma-code/` literal across `src/` is tracked in [known-gaps.md](known-gaps.md) under code `DF` for v1.0.0 cleanup.
  - **`gemma-check` CLI -> `nexus-check`** (Phase 2.4): renamed [`bin/nexus-check.mjs`](../../../bin/nexus-check.mjs); legacy `gemma-check` exposed via [`bin/gemma-check-compat.mjs`](../../../bin/gemma-check-compat.mjs) shim with a one-line deprecation. `GEMMA_CHECK_PROMPT_TOKEN_BUDGET` env var becomes `NEXUS_CHECK_PROMPT_TOKEN_BUDGET` (legacy honored).
  - **Python installer package** (Phase 2.5): `scripts/installer/pyqt/src/gemma_installer/` -> `scripts/installer/pyqt/src/nexus_installer/`. `pyproject.toml` `[project.scripts]` entry-point and PyInstaller spec updated. Installer binaries: `NexusSetup.exe`, `Nexus Installer.app`, `nexus-setup` (Linux).
  - **Shared core surfaces** (Phase 2.6): `core/registry/ModelRegistry`, `core/memory/MemoryHub`, `core/telemetry/TelemetryBus`, `core/skills/SkillCatalog` stubs landed with full unit-test coverage.
  - **`core/` + `modules/coding/` layout** (Phase 2.3): top-level directories created; dependency-cruiser boundary rules `no-core-from-modules` and `no-cross-module-deps` enforced via `npm run check-architecture`.
- **Deferred to a follow-up cycle (tracked in [known-gaps.md](known-gaps.md)):**
  - VS Code command IDs and view container IDs: `gemma-code.*` -> `nexus.*` (breaking change for user keybindings; rides v1.1.0).
  - npm package `"name"` and `"publisher"`: `gemma-code` -> `nexus-coding` (re-publish under the new identifier).
  - Wholesale physical move of `src/` files into `modules/coding/<sub-tree>/` (the boundary is enforced for new code; the move is mechanical and high-cascade).
  - 200+ docs under `docs/v0.X.0/development/history/` are **explicitly preserved as-is** - they describe past state and rewriting them would corrupt history.
  - `docs/v0.X.0/architecture.md`, `docs/v0.X.0/known-gaps.md`, `docs/v0.X.0/plans/*` are also preserved as-is per the same rule.
  - `CHANGELOG.md` entries up to v0.22.2 stay as written; v0.23.0+ entries adopt the Nexus naming.

## 8. Inputs to `/generate-plan`

The plan generator should ingest:

1. This pivot brief.
2. The two `/compare-project` outputs (ComfyUI, DevAI-Hub) that will land in `docs/versions/v1/v1.0.0/comparison-comfyui.md` and `docs/versions/v1/v1.0.0/comparison-devai-hub.md`.
3. The current state of `src/` (Gemma Code engine).
4. The latest known-gaps from `docs/archive/versions/v0/v0.9.0/known-gaps.md` (any unresolved items roll forward).
5. The UI mockup described in section 3.

Output: `docs/versions/v1/v1.0.0/plans/v1.0.0-cycle.md` with sub-plans per phase under `docs/versions/v1/v1.0.0/plans/<phase-slug>.md`.

## 9. Success criteria for v1.0.0

A v1.0.0 release is "done" when a fresh laptop with a single GPU can:

1. Run a single `Nexus-1.0.0-Setup.exe`, click through a wizard, and land on the dashboard with all four modules ready.
2. Open the **Agentic AI Coding** module, type "fix the failing test in `tests/unit/foo.test.ts`", and watch the agent succeed without any external network call.
3. Open the **Local Chatbot Explorer**, create nested folders, drag chats between them, and have per-folder context isolation work.
4. Open **Image Studio**, type a prompt, get a 1024x1024 image in under 30 seconds on an RTX 4070-class GPU.
5. Open **Video Lab**, type a prompt, get a 4-second clip in under 5 minutes on the same hardware.
6. Pull the latest DevAI-Hub skills with one command and have them light up in the Coding module immediately.
7. See live GPU utilization and free VRAM in the dashboard at all times.

All without `pip install`, `npm install`, `nvidia-smi --whatever`, or "did you remember to start Ollama" appearing in a help thread.
