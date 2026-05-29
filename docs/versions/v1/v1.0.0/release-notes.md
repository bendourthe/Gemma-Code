# Nexus 1.0.0 -- Release Notes

**Release date**: 2026-05-18
**Platforms**: Windows 10 / 11 (x86_64) -- the macOS DMG and Linux AppImage land in v1.0.1 and v1.0.2 respectively.
**Repository**: https://github.com/bendourthe/Nexus-AI

---

## What is Nexus?

Nexus is a local-first agentic AI workstation. It runs on your own hardware, talks to your own GPU, and never sends prompts or generated content to anyone else's servers. One desktop app, four modules:

- **Agentic AI Coding** -- an autonomous coding assistant powered by local LLMs (Gemma 4, Llama 3, Qwen2.5-Coder via Ollama). Reads files, writes patches, runs tests, iterates until your task is done.
- **Local Chatbot Explorer** -- a folder-organised chat workspace with per-folder memory scoping. Bring your own LLM; conversations stay on disk.
- **Image Studio** -- text-to-image, image-to-image, inpainting, outpainting via SDXL Turbo / SDXL 1.0 / FLUX Schnell / SD 1.5. LoRA and ControlNet supported.
- **Video Lab** -- text-to-video and image-to-video via LTX-Video, SVD, and CogVideoX. Bring a 12 GB+ GPU.

Everything runs through a single Tauri desktop process (the shell), a Node sidecar (LLM + chat orchestration), and a Python sidecar (Stable Diffusion / video). The installer provisions all of it -- CUDA, Python venv, Node runtime, recommended models -- in one click.

---

## Highlights

### One installer, four modules

Run `Nexus-1.0.0-Setup.exe`. The wizard picks a model preset (Light / Recommended / Full), provisions a CUDA-aware Python venv, fetches the model weights, and hands you a working app under 20 minutes on a machine with the recommended models pre-cached (90 minutes on a clean download).

> ![Installer wizard](screenshots/installer-wizard.png)
> *The cross-platform PyQt5 wizard with provisioning steps.*

### Local-first by default

Every prompt, image, video, and chat lives in `~/.nexus/`. No telemetry, no cloud account, no API key required for any pillar. (Optional: point the Coding module at a cloud LLM if you prefer; Ollama is the default.)

### Hardware-aware

The new `DiffusionTier` classifier sizes Image Studio + Video Lab defaults to your GPU. A 6 GB card opens SD 1.5 at 512x512 with video disabled; a 24 GB card opens FLUX Schnell at 1024x1024 with CogVideoX 5B available. Live VRAM telemetry runs at 2 Hz; the floating Local Model Status widget shows you what is queued, what is running, and how much VRAM is free.

> ![Local Model Status widget](screenshots/local-model-status.png)
> *VRAM, queued jobs, and pinned models -- glance at the corner of every page.*

### Coding module

Twelve canonical slash commands (`/plan`, `/commit`, `/review-pr`, `/curate`, `/memory`, `/trace`, `/skill-metrics`, ...) with autocomplete. Three model backends out of the box: `gemma4:e4b`, `llama3.1:8b`, `qwen2.5-coder:7b`. The agent loop iterates until tests pass; the curator distills the session into reusable skills overnight on idle GPU time.

> ![Coding module](screenshots/module-coding.png)

### Chatbot Explorer

Folder tree on the left, chat on the right. Drag a chat into a folder to scope its memory; the agent only sees ancestors of the active folder. Drag a folder into a sibling to reorganise; the system refuses cycles.

> ![Chatbot Explorer](screenshots/module-chat.png)

### Image Studio

Prompt form with model dropdown, advanced LoRA + ControlNet stacking, live latent preview during generation, drag-and-drop image input, output gallery with PNG `tEXt`-embedded workflow JSON for full reproducibility.

> ![Image Studio](screenshots/module-image.png)

### Video Lab

Text-to-video and image-to-video modes; timeline scrubber, thumbnail strip during generation, MP4 output with embedded workflow metadata via ffmpeg.

> ![Video Lab](screenshots/module-video.png)

### Skill catalog with DevAI-Hub sync

Settings -> Skills surfaces an upstream skill catalog from the `bendourthe/DevAI-Hub` repository. Click "Sync now" to fetch the latest tag; namespaced skills under `devai-hub/` coexist with your custom skills under `user/`. A prompt-injection scanner gates every fetched skill before it lands on disk.

> ![Skills settings](screenshots/settings-skills.png)

---

## Compatibility notes

### Upgrading from the Gemma Code VS Code extension (v0.x)

Your `~/.gemma-code/` directory is migrated to `~/.nexus/` on first launch. The old path is preserved (POSIX symlink on macOS / Linux, side-by-side directory on Windows) so the v0.x VS Code extension keeps working until you uninstall it.

Settings keys in the form `gemma-code.<x>` are still read; you will see a deprecation warning in the developer console. Rename them to `nexus.<x>` at your convenience -- the legacy keys are removed in v1.1.0.

The `gemma-check` CLI is retained as a compat alias for `nexus check`. Same removal schedule.

### VS Code extension Marketplace listing

The Marketplace listing remains under the `gemma-code` publisher for v1.0.0. A v1.1.0 re-publish under the new `nexus-coding` listing is staged for the next cycle so the breaking-change story bundles cleanly with the manifest-ID rename.

### Settings UI

Some Settings pages are wired against in-memory mock clients in v1.0.0 because the underlying IPC bridge needs a Phase 5 follow-on (model install progress, model pin toggles, Settings -> Hardware tier readout). The functionality is documented in `docs/versions/v1/v1.0.0/known-gaps.md`; UI behaviour is intentional and the surfaces ship live in v1.0.1.

---

## Known limitations

These are recorded explicitly so you know what is and is not in v1.0.0:

- **Live model install is operator-driven**: The Settings -> Models page exposes the full UI surface; the actual install IPC bridge that drives the Python sidecar's downloader is wired in a v1.0.1 polish pass (per known-gap 5.P1.BB). For v1.0.0, install models from the installer wizard or via `nexus models install <id>`.
- **macOS + Linux installers**: Deferred to v1.0.1 (macOS DMG with notarization) and v1.0.2 (Linux AppImage). The cross-platform PyQt wizard already targets both; only the outer-shell packaging differs.
- **Video Lab on small GPUs**: LTX-Video at 4 seconds / 480p needs ~10 GB VRAM peak. SVD at 4 seconds needs ~8 GB. CogVideoX 5B needs 16 GB+. The `DiffusionTier` classifier disables Video Lab on cards under 8 GB.
- **VS Code extension is still in-process**: The thin-adapter rewrite that delegates the extension to the desktop daemon is staged for v1.1.0. v1.0.0 ships the daemon-discovery hook (`desktop/src/desktop/daemonDiscovery.ts`) but the extension keeps hosting the full engine until then.

A complete carry-forward list lives in `docs/versions/v1/v1.0.0/known-gaps.md`.

---

## What is next (v1.1.0 teaser)

- **Audio pillar** -- a fifth module for text-to-speech, voice cloning, and audio-conditioning workflows.
- **macOS DMG with notarization** -- v1.0.1 lands the signed + stapled macOS installer.
- **Linux AppImage** -- v1.0.2 lands the AppImage build.
- **Node-graph advanced tab** -- ComfyUI-style node editor inside Image Studio + Video Lab for users who want pixel-level control over the diffusion graph.
- **Thin-adapter VS Code extension** -- the extension delegates to the desktop daemon, drops in-process LLM hosting, and re-publishes under the `nexus-coding` listing.
- **CHANGELOG.md.gemma-code -> nexus rename completion** -- `gemma-code` settings keys and the `gemma-check` CLI alias are removed.

---

## Acknowledgements

Nexus stands on the shoulders of: the Ollama team for the local-LLM runtime, Hugging Face for diffusers / accelerate / safetensors, Tauri for the desktop shell, the FLUX / Stable Diffusion / LTX / SVD / CogVideoX teams for the open-source weights, the React + Vite + Tailwind teams, and the broader local-AI community whose tools and discussions shaped every design decision.

---

## Get Nexus

- **Windows installer**: https://github.com/bendourthe/Nexus-AI/releases/download/v1.0.0/Nexus-1.0.0-Setup.exe
- **VS Code extension (Coding module only, headless)**: search "Nexus Coding" in the Marketplace, or `code --install-extension nexus-coding`
- **Source code + issue tracker**: https://github.com/bendourthe/Nexus-AI
