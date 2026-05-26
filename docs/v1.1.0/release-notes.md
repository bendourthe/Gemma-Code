# Nexus 1.1.0 -- Release Notes

**Release date**: 2026-05-26 (target)
**Platforms**: Windows 10 / 11 (x86_64), macOS 13+ (Apple Silicon + Intel), Linux x86_64 (AppImage on Ubuntu 22.04 / 24.04 / Fedora 40).
**Repository**: https://github.com/bendourthe/Nexus-AI

---

## What is Nexus?

Nexus is a local-first agentic AI workstation. It runs on your own hardware, talks to your own GPU, and never sends prompts or generated content to anyone else's servers. One desktop app, four modules:

- **Agentic AI Coding** -- an autonomous coding assistant powered by local LLMs (Gemma 4, Llama 3, Qwen2.5-Coder, Phi-3.5 via Ollama). Reads files, writes patches, runs tests, iterates until your task is done.
- **Local Chatbot Explorer** -- a folder-organised chat workspace with per-folder memory scoping.
- **Image Studio** -- text-to-image, image-to-image, inpainting, outpainting via NVIDIA SANA-1.6B (new default), Sana-Sprint (Fast Preview), SANA 2K / 4K / INT4, SANA-ControlNet, plus the v1.0.0 catalog (SDXL Turbo, SDXL 1.0, FLUX Schnell, SD 1.5).
- **Video Lab** -- text-to-video and image-to-video via SANA-Video 2B (new Fast 720p tier), LTX-Video, SVD, CogVideoX.

v1.1.0 layers five new user-visible upgrades on top of v1.0.0 and closes the v1.0.0 shared-core build carryforward cluster.

---

## Highlights

### Cross-OS installer (Windows + macOS + Linux)

The v1.0.0 Windows-only installer becomes the canonical cross-platform installer. The PyQt5 wizard auto-detects host OS at first launch and provisions the platform-correct toolchain:

- **Windows**: CUDA 12.1 runtime + ffmpeg + Ollama service.
- **macOS Apple Silicon**: Metal Performance Shaders backend + Homebrew-style ffmpeg + Ollama for macOS.
- **Macos Intel**: same MPS backend with the Intel-specific Ollama binary.
- **Linux NVIDIA**: CUDA + ffmpeg + Ollama via the official Linux script.
- **Linux AMD**: ROCm-aware path (or CPU-only fallback if ROCm is absent) + ffmpeg + Ollama.

> ![Cross-OS installer wizard](screenshots/installer-cross-os.png)

### Hardware-aware multi-model picker with free-disk-space awareness

The recommended-models picker becomes a typed catalog UI with Text / Image / Video / Audio tabs. Each model card surfaces: size on disk, hardware compatibility (RAM / VRAM check against your host), release date, censored / uncensored flag, context window (in / out tokens), multimodality flag. The latest-top recommended models per type are auto-ticked.

Free disk space is read from the OS, displayed continuously in the Storage footer, and **selection of additional models is blocked when remaining disk would dip below a 10 GB OS reserve** (with a tooltip explaining why). The reserve is configurable via `nexus.installer.diskReserveGB`.

> ![Hardware-aware model picker](screenshots/picker-typed-catalog.png)

### Nexus VS Code extension (multi-model agentic add-on)

The renamed `nexus-coding` extension extends the v1.0.0 thin-adapter into a full agentic surface inside VS Code. The extension delegates every panel + every tool call to the desktop daemon over JSON-RPC; you get plan mode, auto mode, four-layer memory, skills, sub-agents, sessions, slash commands, and MCP tools -- all driven by the daemon -- and **you pick any installed local model from the model dropdown** (not just Gemma 4).

When the daemon is not running, the extension falls back to extension-only mode (in-process LLM hosting against your default model) so the v0.x behaviour is preserved as a graceful degrade.

The legacy `gemma-code` Marketplace listing receives a transition note pointing at the renamed listing; your existing `gemma-code.<cmd>` keybindings continue to work via the v1.1.0 compat shim (one-shot deprecation log per session) and are removed in v1.2.0.

> ![Nexus VS Code extension](screenshots/vscode-extension-nexus-coding.png)

### Image Studio upgrade: NVIDIA SANA family

SANA-1.6B replaces SDXL Turbo as the default 1024px image model (~2x faster than SDXL Turbo on the same hardware, Apache-2.0 weights). Sana-Sprint becomes the new "Fast Preview" speed tier (0.3 s on RTX 4090). SANA 2K (2048x2048) and SANA 4K (4096x4096) appear in the resolution dropdown, gated by `DiffusionTier` (2K on `diffusion-mid+`, 4K on `diffusion-high+`). SANA 4-bit (SVDQuant variant via `nunchaku`) lights up the `diffusion-low` tier on 8 GB cards. SANA-ControlNet integrates with the existing pose / depth / canny preprocessors. Flow-DPM-Solver appears as a sampler option.

> ![Image Studio with SANA](screenshots/image-studio-sana.png)

### Video Lab Fast 720p tier (SANA-Video 2B)

SANA-Video 2B joins the Video Lab catalog as the new "Fast 720p" tier between LTX-Video and CogVideoX. On an RTX 4070 with offload, a 4-second 720p clip generates in <= 60 s.

> ![Video Lab with SANA-Video](screenshots/video-lab-sana-video.png)

### Hybrid memory retrieval + session replay timeline + slash commands

The memory subsystem is upgraded end-to-end:

- **Hybrid retrieval**: BM25 + dense + graph traversal fused via Reciprocal Rank Fusion (k=60).
- **Local embedder**: `all-MiniLM-L6-v2` ONNX weights (~80 MB) bundled in the installer; the dense path is local-first by default.
- **Ebbinghaus decay**: working / episodic / semantic / graph tiers each get their own half-life (24 h / 7 d / 30 d / 365 d); the sweep runs as an `IdleTimeScheduler` worker on a 24-hour cadence.
- **Memory provenance**: every memory entry carries `{sessionId, hookKind, toolName, parentSpanId}` so you can trace any row back to the conversation that produced it.
- **12-hook lifecycle bus**: `lifecycle.session.start/stop/end`, `lifecycle.user.prompt`, `lifecycle.tool.pre/post/failed`, `lifecycle.subagent.start/stop`, `lifecycle.context.preCompact`, `lifecycle.skill.entry`. Skills observe and react to every stage.
- **Secret pre-index filter**: AWS access keys, GitHub PATs (classic + fine-grained), Slack tokens, JWTs, PEM private-key blocks, env-style assignments are redacted before SQLite insert.
- **Slash commands**: `/recall <query>` (hybrid top-K), `/remember <text>` (working-tier observation), `/forget --id <uuid>` or `/forget --pattern <regex>`, `/memory-compress <path>` (opt-in via `nexus.memory.consolidation.enabled`).
- **CLI surface**: `nexus memory audit`, `nexus memory export --out`, `nexus memory import`, `nexus memory decay --now`, `nexus memory compress --file`.
- **Session replay timeline**: TraceDashboard adds a `<TimelineScrubber>` with play / pause / speed (0.5x / 1x / 2x / 4x). A "Compare two sessions" view diffs trace deltas side-by-side.
- **Opt-in contradiction resolver** (`nexus.memory.consolidation.enabled`): when enabled, conflicting semantic-tier observations are adjudicated via a local Ollama prompt. Off by default.

> ![Memory panel with provenance chips](screenshots/memory-panel-provenance.png)
> ![Timeline scrubber](screenshots/timeline-scrubber.png)

### Shared-core build closure

v1.0.0 deferred 46 architectural items into the "shared-core build" cluster. v1.1.0's Phase 1 + Phase 2 commits closed the foundational pieces (storage-path rename, manifest IDs, npm package + publisher rename, duplicate-catalog removal, CRLF/LF snapshot normalization, SHA-pinned actions, curator-cadence fallback delete). Phase 3 landed the import-rewriting codemod and the first leaf-tree migration (`src/utils/` -> `modules/coding/utils/`). The remaining 12 `src/` sub-trees migrate incrementally in v1.2.0; each one is a near-pure rename driven by the same codemod.

---

## Compatibility notes

### Upgrading from v1.0.0

Your `~/.nexus/` directory layout is unchanged. The v1.1.0 cycle did not bump the SQLite schema beyond the additive provenance + scope_id columns added in Phase 4 (migration is idempotent + runs once on first launch). Existing memory rows are backfilled with `null` provenance / scope_id; new writes carry the structured object.

### Upgrading from the legacy `gemma-code` VS Code extension

The Marketplace listing for `gemma-code` will surface a transition note pointing at the renamed `nexus-coding` listing. Install the new listing (or `code --install-extension nexus-coding`); your `gemma-code.<cmd>` keybindings continue to work via the v1.1.0 compat shim. Legacy IDs are removed in v1.2.0.

The `gemma-check` CLI alias remains in place through v1.2.0.

### Default image model swap (SDXL Turbo -> SANA-1.6B)

Image Studio's default model changes from SDXL Turbo to SANA-1.6B. The change is reversible from the model dropdown (SDXL Turbo + SDXL 1.0 + FLUX Schnell + SD 1.5 remain in the catalog). If you have a saved workflow PNG with embedded SDXL Turbo metadata, Image Studio detects the legacy model and surfaces a "Re-render with SANA-1.6B?" toast (decline keeps the SDXL Turbo pipeline).

### Settings keys still under the v1.0.0 compat window

Legacy `gemma-code.<x>` settings keys remain readable via the v1.0.0 `SettingsCompat` shim, with a deprecation log per first-read. The shim retires in v1.2.0 -- rename to `nexus.<x>` at your convenience.

### macOS Gatekeeper / Linux AppImage trust

The macOS DMG is notarized + stapled (OA-11); the first-launch Gatekeeper prompt is the standard "downloaded from internet" notice. The Linux AppImage is unsigned (no central trust authority on Linux); the SHA-256 manifest on the GitHub Release page is the canonical integrity check. Verify with `sha256sum -c Nexus-1.1.0-checksums.txt` before launching.

---

## Known limitations

These are recorded explicitly so you know what is and is not in v1.1.0. The exhaustive list lives in `docs/v1.1.0/known-gaps.md`.

- **`src/` -> `modules/coding/` wholesale move is incremental**: 12 of 13 sub-trees still live under `src/`; the import-rewriting codemod handles the boundary transparently. v1.2.0 finishes the move.
- **`LocalEmbedder` ONNX vs hash fallback**: on hosts where `@xenova/transformers` is not installed (e.g., minimal CI), the embedder falls back to a deterministic 384-dim hash sketch. The installer-provisioned production hosts run the real ONNX path. The contract is identical; the fallback is documented and unit-tested.
- **Live model install IPC**: the Settings -> Models page exposes the full UI; the live install IPC bridge that drives the Python sidecar's downloader is wired in v1.2.0. For v1.1.0, install models from the installer wizard or via `nexus models install <id>`.
- **Memory IPC pipeline cluster**: several "IdleTimeScheduler binding deferred to sidecar wiring" items (warm-rebuild worker, decay sweep, audit log SQLite table, export/import live store, ContradictionResolver scheduler, `/memory-compress` daemon dispatch, `SettingsStore` SQLite adapter) cluster into a single v1.2.0 `MemoryStore` adapter sweep. The in-memory facade + JSONL surfaces keep the user-visible behaviour correct in the interim.
- **Real-GPU `_execute(ctx)` for SANA pipelines**: the four new SANA pipeline modules ship with deterministic stub executors on CI hosts. The operator's GPU rig swaps in real diffusers calls (per OA-09); the contracted interface is identical.
- **SANA digest rotation**: the catalog's 10 SANA-family entries carry placeholder SHA-256 digests pending OA-V1.1.0-12A rotation against the upstream Hugging Face repos. The `catalog-digests.test.ts` test enumerates the placeholders so the operator can verify the rotation closes them.

---

## What is next (v1.2.0 teaser)

- **`src/` wholesale move completion**: the remaining 12 sub-trees migrate; `src/extension.ts` -> `modules/coding/extension.ts` is the last move, which flips the manifest `main` and unlocks the project-references build.
- **`MemoryStore` adapter cluster**: a coordinated sweep that closes the 7+ "IdleTimeScheduler binding deferred to sidecar wiring" items in one commit.
- **Audio module pillar**: the fifth module (text-to-speech, voice cloning, audio-conditioning).
- **Direct-download landing page**: `https://nexus.bendourthe.com/download` with platform-aware CTAs (deferred to v1.1.1 per OA-05).
- **Legacy `gemma-code` ID removal**: `gemma-code.<cmd>` and `~/.gemma-code/` and `gemma-check` are removed; the compat window closes.
- **Node-graph advanced tab**: ComfyUI-style node editor inside Image Studio + Video Lab.

---

## Acknowledgements

Nexus 1.1.0 stands on the shoulders of: the Ollama team for the local-LLM runtime, the NVIDIA SANA team for the new diffusion architecture (Apache-2.0 weights), the agentmemory authors for the lens that shaped the memory subsystem upgrades, Hugging Face for diffusers / accelerate / safetensors / transformers, Xenova for the bundled `transformers.js` ONNX path, Tauri for the desktop shell, PyQt5 for the cross-platform wizard, the React + Vite + Tailwind teams, the create-dmg + appimagetool + nunchaku + diffusers teams, and the broader local-AI community whose tools and discussions shaped every design decision.

---

## Get Nexus

- **Windows installer**: https://github.com/bendourthe/Nexus-AI/releases/download/v1.1.0/Nexus-1.1.0-Setup.exe
- **macOS installer**: https://github.com/bendourthe/Nexus-AI/releases/download/v1.1.0/Nexus-1.1.0.dmg
- **Linux AppImage**: https://github.com/bendourthe/Nexus-AI/releases/download/v1.1.0/Nexus-1.1.0-x86_64.AppImage
- **VS Code extension (Coding module, multi-model)**: search "Nexus Coding" in the Marketplace, or `code --install-extension nexus-coding`
- **Source code + issue tracker**: https://github.com/bendourthe/Nexus-AI
