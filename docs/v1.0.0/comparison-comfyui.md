# Nexus v1.0.0 vs ComfyUI - Comparison and Adoption Plan

> Date: 2026-05-17
> Author: Benjamin Dourthe (project lead) + Claude (synthesis)
> Status: Pre-plan. This doc is an input artifact for `/generate-plan` alongside [pivot-brief.md](pivot-brief.md) and [comparison-devai-hub.md](comparison-devai-hub.md).
> External reference: [Comfy-Org/ComfyUI](https://github.com/Comfy-Org/ComfyUI) on GitHub, [docs.comfy.org](https://docs.comfy.org/), [Comfy-Org/ComfyUI-Manager](https://github.com/Comfy-Org/ComfyUI-Manager).
> Applied lens: the AGENTS.md / pivot-brief decision tree -- **local-only > LLM-native skill > reverse-engineered internal module > trusted-vendor wrapper > drop**.

## 1. Summary

ComfyUI is the de facto open-source, node-graph-based diffusion playground: a Python backend plus a Vue/TypeScript frontend that lets users wire together image, video, audio, and 3D generation pipelines as DAGs of "nodes," with a sprawling third-party custom-node ecosystem (ComfyUI-Manager) layered on top. It is the most mature local-first reference for everything Nexus's **Image Studio** and **Video Lab** pillars need to do, and it has done extraordinary work on single-GPU memory management. The high-level takeaway for Nexus is: **we adopt ComfyUI's hard-won engineering ideas (smart offloading, model-paths-as-config, latent-preview UX, workflow-as-JSON, embed-workflow-in-PNG) by reverse-engineering them into native Nexus modules, but we deliberately do not vendor ComfyUI, ship a node graph as the primary UX, or import its custom-node ecosystem.** Nexus targets a different audience (creator/developer who wants results in clicks, not a wired graph) and a different scope (four pillars in one shell, not one diffusion playground). The node graph is a *power-user* surface, not the default. The custom-node ecosystem is a security liability we will not inherit; our skills/MCP harness is a safer functional equivalent.

## 2. ComfyUI - what it is and what it ships

### 2.1 Architecture

Three repos compose the project:

- **ComfyUI Core** ([github.com/comfyanonymous/ComfyUI](https://github.com/comfyanonymous/ComfyUI)) - Python backend. Implements the node graph executor, model loading, sampler/scheduler library, VAE/CLIP/UNet abstractions, and an HTTP+WebSocket API on which the frontend depends. Memory management ("smart offloading") lives here.
- **ComfyUI Frontend** ([Comfy-Org/ComfyUI_frontend](https://github.com/Comfy-Org/ComfyUI_frontend)) - Vue 3 + TypeScript SPA. Renders the node-graph editor (LiteGraph-derived), workflow JSON I/O, queue panel, and settings.
- **ComfyUI Desktop** (beta, Windows + macOS-ARM only) - Electron-style wrapper that bundles Python + the core + the frontend. Linux users still hand-install.

The backend is asynchronous: workflows are submitted to a queue and executed node-by-node, with caching at the node level ("Only parts of the graph that change will be executed").

### 2.2 Feature inventory relevant to Nexus

- **Workflow as JSON.** Every graph serializes to a flat node/link/group document. Workflows are auto-embedded in PNG/WebP metadata, so any output image is also a "save the workflow that made me" artifact. This is the single most-copied ComfyUI idea in the wider ecosystem.
- **Templates / Workflow Templates.** Built-in `Workflow -> Browse Workflow Templates` exposes a curated set of starter graphs (txt2img, img2img, inpaint, ControlNet, LoRA, AnimateDiff, etc.) that use only core nodes. Missing models trigger download prompts.
- **Comfy Hub** at [comfy.org/workflows](https://comfy.org/workflows) - community workflow sharing.
- **Model families supported (image):** SD 1.x/2.x, SDXL, Stable Cascade, SD3/3.5, PixArt, AuraFlow, HunyuanDiT, Flux, Flux 2, Lumina Image 2.0, HiDream, Qwen Image, Hunyuan Image 2.1, Z Image, Ernie.
- **Model families supported (video):** Stable Video Diffusion, Mochi, LTX-Video, Hunyuan Video, Wan 2.1/2.2.
- **Model families supported (audio):** Stable Audio, ACE Step.
- **Model families supported (3D):** Hunyuan3D 2.0.
- **Generation features:** LoRAs, hypernetworks, model merging, ControlNet, T2I-Adapter, GLIGEN, LCM, embeddings / textual inversion, latent previews via TAESD, ESRGAN/SwinIR upscalers, inpainting models, mask editor.
- **Queue manager.** Multiple prompts are queued; the user can re-order, cancel, and inspect history.
- **ComfyUI-Manager.** Out-of-tree extension that does custom-node install/update/disable, model download dialogs, snapshot/restore of installed nodes, and a CLI (`cm-cli`). Discovery uses three channel modes (cached / local / remote). Custom-node installs run `requirements.txt`, optional `install.py`, and pip - effectively arbitrary code execution.
- **Custom-node ecosystem.** Thousands of community nodes; ComfyUI-Manager treats them as first-class. Security model is "tiered allow/block lists + community PR review" - no sandboxing. Network modes (`public`, `private`, `offline`) restrict outbound fetches.

### 2.3 License, governance, community

- **License:** GPL-3.0 (both Core and Manager). This matters: vendoring ComfyUI into a derivative work forces Nexus to ship under GPL-3.0 too, which is incompatible with Nexus's current MIT posture and almost certainly with a future commercial pathway.
- **Governance:** Community-led, with Comfy-Org as the maintainer entity. Custom-node registration is PR-based against `custom-node-list.json` and the registry at [registry.comfy.org](https://registry.comfy.org/).
- **Community:** Active Discord (#help, #feedback), Matrix space, and a public hiring funnel at comfy.org/careers - this is now a real organization, not a hobby project.

### 2.4 Single-GPU behavior

The README claims:

> "Smart memory management: can automatically run large models on GPUs with as low as 1GB vram with smart offloading."

Concretely this is a mix of: CPU offload of UNet/VAE/CLIP between steps, `torch.float16` / `bf16` / `int8` weight casting, attention slicing, sequential UNet sub-block loading, and aggressive freeing of intermediate latents. The system also exposes `--lowvram`, `--novram`, `--cpu`, and `--bf16-vae` flags to bias the scheduler manually. The output is the best single-GPU experience on the open-source diffusion side - and it is the part of ComfyUI Nexus most needs to learn from.

### 2.5 Directory layout (concrete)

```
ComfyUI/
  models/
    checkpoints/          # SD/SDXL/Flux UNets
    vae/
    clip/
    loras/
    embeddings/
    controlnet/
    upscale_models/
    style_models/
    diffusion_models/     # video models
    audio_encoders/
    text_encoders/
  custom_nodes/           # ecosystem extensions (each its own folder with __init__.py)
  output/                 # generated images / videos
  input/                  # user-supplied source images for img2img / inpaint
  extra_model_paths.yaml  # share model dirs with A1111, ForgeUI, etc.
```

The `extra_model_paths.yaml` convention is the single most-imitated piece of ComfyUI plumbing and is the right shape for Nexus to adopt (see Section 4.2).

## 3. Mapping ComfyUI capabilities onto Nexus modules

| ComfyUI capability | Relevant Nexus module | Inherited from Gemma Code? | Status today |
|---|---|---|---|
| Text-to-image (SD/SDXL/Flux/HiDream) | Image Studio | No | Greenfield |
| Image-to-image | Image Studio | No | Greenfield |
| Inpaint / outpaint with mask editor | Image Studio | No | Greenfield |
| ControlNet / T2I-Adapter | Image Studio | No | Greenfield |
| LoRA loaders / model merging | Image Studio (+ Coding for code-LoRAs later) | No | Greenfield |
| Text-to-video (Mochi / LTX-Video / Wan / HunyuanVideo / SVD) | Video Lab | No | Greenfield |
| Image+text-to-video | Video Lab | No | Greenfield |
| Audio synthesis (Stable Audio, ACE Step) | Out of scope for v1.0.0 | No | Drop |
| 3D generation (Hunyuan3D) | Out of scope for v1.0.0 | No | Drop |
| Node-graph workflow editor | Image Studio + Video Lab (optional "Advanced" tab) | No | Greenfield, deliberately deprioritized |
| Workflow templates library | Image Studio + Video Lab | No | Greenfield |
| Workflow embed in PNG/WebP metadata | Image Studio | No | Greenfield, easy to copy |
| Queue manager (multi-prompt scheduling) | Image Studio + Video Lab + Coding | Partial: `AgentLoop` is per-conversation, no cross-module GPU queue | Needs cross-module scheduler |
| Custom-node ecosystem | Skills catalog (existing) | Yes - `src/skills/` already does this | Re-purpose for image/video presets |
| Model download manager | Shared core (`ModelRegistry`) | No (we have an installer model-list but not in-app fetch) | Greenfield |
| Smart memory management / offload | Shared core (GPU scheduler) | Partial: `HardwareTier` + `BudgetMiddleware` for LLM tokens, not diffusion VRAM | Needs diffusion-aware extension |
| `extra_model_paths.yaml` (shared model dirs with A1111/Forge) | Shared core (`ModelRegistry` config) | No | Greenfield, adopt the convention |
| Latent preview during sampling | Image Studio + Video Lab | No | Greenfield |
| ComfyUI Desktop installer | Nexus installer | Partial: PyQt5 installer wizard exists for Coding | Extend to carry diffusion models |

## 4. What Nexus should learn from ComfyUI

For each candidate I classify per the decision tree from `pivot-brief.md` section 4: **local-only > LLM-native skill > reverse-engineered internal module > trusted-vendor wrapper > drop**. "Reverse-engineer" here means: implement a lean Nexus-native equivalent of the *idea*, not a fork.

### 4.1 Node-graph workflow editor

**Decision: Reverse-engineer a minimal, *optional* graph editor; do not make it the default UX.**

ComfyUI's node graph is its differentiator and its barrier-to-entry. Nexus is not a power-user playground; the dashboard mockup is explicitly form-and-button driven. But two real cases need a graph:

1. **Image Studio "Advanced" tab.** Power users chaining ControlNet + LoRA + inpaint + upscaler want a graph. A linear form will frustrate them.
2. **Video Lab pipelines.** Video synthesis is intrinsically multi-stage (text encoder -> denoise -> decode -> interpolation -> upscale) and benefits from explicit stage visibility.

Implementation: a minimal in-house node editor using [`reactflow`](https://reactflow.dev/) (or `svelteflow` if the shell turns out to be Svelte/Tauri) wrapping a small Nexus-native graph runtime in TypeScript. Pipelines are still ultimately a JSON DAG with `nodes`, `links`, and per-node typed I/O contracts; we just refuse to ship a Turing-complete extension point (no `eval`, no arbitrary Python). **Module: Image Studio + Video Lab. Scope: M.**

### 4.2 Model download manager and `extra_model_paths.yaml`

**Decision: Reverse-engineer into a Nexus-native `ModelRegistry` + downloader. Adopt the `extra_model_paths.yaml` convention verbatim so Nexus can reuse existing user model directories.**

ComfyUI-Manager's model download dialog is a usability win we cannot skip. The win is not "an MCP that calls HuggingFace" - it is **the model-installation surface inside the app**, with progress, resume, dedup by SHA-256, and integrity verification.

Concretely Nexus's shared core should ship:

- `ModelRegistry` (TypeScript) - reads `~/.nexus/models/registry.json` plus `extra_model_paths.yaml` (if present). Each entry is `{name, family, sha256, url[], size_bytes, license, recommended_vram_gb, role}`.
- A native downloader with HTTP range-resume, SHA-256 verify, concurrent-segment fetch, and a simple "auth header" plug so users can paste a HuggingFace token if they want gated models (the token never leaves disk; no Nexus account exists).
- A "Recommended models" wizard step in the installer (Coding LLM, Chat LLM, Image base, Video base) so first launch lights up all four modules.
- **Crucially, no Civitai- or HF-specific MCP wrapper.** The downloader is HTTP-with-a-checksum; the registry is a JSON file. Originality preserved, GPL avoided.

**Module: Shared core. Scope: M.**

### 4.3 Templates / preset workflows

**Decision: Skill-level adoption + bundled JSON templates.**

ComfyUI's `Browse Workflow Templates` and `comfy.org/workflows` are functionally equivalent to Nexus's existing Skill catalog (`~/.gemma-code/skills/`, harvested skills, hot-reload). For v1.0.0 we extend the skill schema to allow `kind: "image-preset" | "video-preset" | "chat-preset"` in addition to the existing coding skill, and ship a starter set in `assets/presets/` (txt2img, img2img, inpaint, outpaint, ControlNet-pose, LoRA-portrait, SVD-loop, LTX-Video-clip, etc.).

This piggybacks on the existing skill hot-reload, the curator scheduler, and the DevAI-Hub upstream sync pathway, so Image Studio and Video Lab inherit the same `nexus skills sync` mechanism as Coding. **Module: Shared core (`SkillCatalog`) + Image Studio + Video Lab. Scope: S.**

### 4.4 Uncensored / NSFW pipelines

**Decision: Posture statement, not a feature.** Out of the catalog by default; users supply their own checkpoints if they want to.

ComfyUI is technically content-agnostic: it loads whatever `.safetensors` the user points it at, including community-tuned uncensored Flux / Pony / SDXL variants. Nexus inherits the same property *by construction* because we don't ship a content moderation server and we don't filter the model registry by content policy.

What Nexus will and will not do for v1.0.0:

- **Will:** allow the user to register any local model file via "Add model from disk" and run it. Memory budgets and VRAM telemetry apply regardless of model contents.
- **Will:** ship safe-by-default base checkpoints (SDXL base, an SDXL Lightning, Flux Schnell if license permits, LTX-Video, SVD) in the installer recommended set.
- **Will not:** bundle, recommend, or auto-fetch uncensored checkpoints. They are not in `registry.json`.
- **Will not:** add post-hoc image/output classifiers in v1.0.0. Privacy by construction means no telemetry, no scanning.
- **Will not:** crawl Civitai. Anyone who wants Pony goes and gets Pony themselves and points the registry at it.

This is the same line ComfyUI core walks; we just write it down explicitly in `docs/v1.0.0/content-policy.md`. **Module: Documentation + ModelRegistry. Scope: S.**

### 4.5 Memory management / model offloading on single GPU

**Decision: Reverse-engineer the specific techniques into a Nexus diffusion runtime; do not vendor ComfyUI's executor.**

This is where the most engineering value sits and where I most strongly recommend lifting *techniques* (not code, given GPL):

- **CPU offload of inactive sub-modules** between sampler steps (text encoder offloaded after prompt encoding; VAE offloaded until decode).
- **Sequential UNet block loading** for very-low-VRAM mode (the "1GB VRAM" claim).
- **Adaptive precision** (`bf16` UNet + `fp16` VAE + `int8` weight quant for >24B-param models).
- **Attention slicing** with auto-tuned slice size based on free VRAM.
- **Tiled VAE decode** for >2K images.
- **Latent preview** via TAESD - decodes a tiny preview every N steps so the user sees something happening (perceived-latency win, not a real one).

The existing `HardwareTier` system (constrained/balanced/full) maps cleanly onto a `DiffusionTier` table that selects the right combination of the above per-GPU. The `BudgetMiddleware` pattern from the LLM side becomes a `VRAMBudget` middleware on the diffusion side.

**Module: Shared core (`GpuScheduler`, new `DiffusionRuntime`) + Image Studio + Video Lab. Scope: L. This is the single biggest implementation risk in v1.0.0.**

### 4.6 Custom-node ecosystem ("skills" in Nexus terms)

**Decision: Drop the ComfyUI-Manager model. Keep and extend our existing skill catalog.**

ComfyUI-Manager's custom-node ecosystem is its biggest superpower *and* its biggest security smell:

- Custom-node installs run `requirements.txt` + arbitrary `install.py` + pip with no sandboxing.
- "Security levels" (`strong`/`normal`/`weak`) only restrict *install methods* (git URL vs. registry), not what installed code can do at runtime.
- Snapshot/restore is incomplete for non-Git nodes (per the Manager README).

This is precisely the surface the Nexus Skill catalog already replaces - safely:

- Skills are markdown + JSON metadata. No `setup.py`. No pip install at install time.
- Skill execution is mediated by the existing `ToolRegistry` + `ToolActivationRules` (15-tool cap, context-conditional).
- Hot-reload from `~/.nexus/skills/` is already implemented and proven.
- The DevAI-Hub upstream sync gives a single audited source for new skills.

For v1.0.0 we extend the skill schema (Section 4.3) to cover Image Studio and Video Lab presets, but we **explicitly do not import any ComfyUI custom node** and **explicitly do not expose a "pip install this random thing" surface** anywhere in Nexus. If a user needs Python-side custom logic, they wire it via MCP (already opt-in, already sandboxed by being an out-of-process server). **Module: SkillCatalog + ToolRegistry. Scope: S (extension of existing).**

### 4.7 Queue manager / multi-job scheduler

**Decision: Reverse-engineer a minimal cross-module GPU job queue. This is required, not optional, on a single GPU with four pillars.**

ComfyUI's queue is per-process FIFO with cancel/reorder. Nexus has a harder version of the problem: four modules (Coding LLM, Chat LLM, Image diffusion, Video diffusion) all competing for one GPU. We cannot run them concurrently at full VRAM.

The lean version:

- `GpuScheduler` in shared core. Single in-process queue with `priority` and `vram_estimate_gb`.
- Modules submit `GpuJob { module, kind, vram_estimate_gb, on_progress, cancel_token }` and `await result`.
- Scheduler unloads other modules' models before running the next job if `vram_estimate_gb` exceeds free VRAM (this is the bit that needs the offload primitives from 4.5).
- Telemetry feeds the dashboard's `Local Model Status` panel: "Image Studio: queued (1 ahead), Coding LLM: running, free VRAM 4.2 GB / 16 GB."

For v1.0.0 we ship FIFO + module-priority. Reordering and per-job cancel are P1; cross-module priority overrides are P2. **Module: Shared core (`GpuScheduler`). Scope: M.**

### 4.8 Inpaint / outpaint UX

**Decision: Reverse-engineer the UX, ship as a first-class Image Studio mode.**

ComfyUI's inpaint flow exposes a mask editor (paint over the area to regenerate), a "Set Latent Noise Mask" or "VAE Encode (for Inpainting)" node, and a separate "Inpaint Model" loader. The UX boils down to: load image -> brush mask -> prompt -> generate -> iterate.

For Nexus's Image Studio:

- A `Mask` tool inside the image canvas (brush, erase, fill, invert, feather).
- Outpaint = canvas-extension + auto-mask of the new region. UI is "drag handles outward" like Photoshop generative expand.
- Inpaint model selection is registry-driven (any `*-inpainting.safetensors` exposes itself as an inpaint-capable checkpoint).
- A simple "before / after" slider so the user can A/B their last n generations on the same mask.

We do not need a graph for this; a forms UX is strictly better here. **Module: Image Studio. Scope: M.**

### 4.9 Video pipelines (which models)

**Decision: Adopt model targeting, drop the AnimateDiff-on-SD1.5 era.**

ComfyUI supports SVD, Mochi, LTX-Video, Hunyuan Video, Wan 2.1/2.2 today. On a single laptop GPU (RTX 3070 - 4090) for v1.0.0 the realistic targets are:

| Model | VRAM (rough) | Speed (RTX 4070, 4s clip) | License | Verdict |
|---|---|---|---|---|
| **LTX-Video 2B** | ~8 GB | ~30s | OpenRAIL-M | **v1.0.0 default.** Fast, small, good quality, license-clean. |
| **Stable Video Diffusion** (img2vid) | ~10 GB | ~60s | SVD license | v1.0.0 alt for image+text-to-video. |
| **HunyuanVideo** | ~24 GB | minutes | OpenRAIL-M | v1.1.0 stretch. Quality leader but >RTX 4080 only. |
| **Wan 2.2** | ~16 GB | ~2 min | Apache-2 (rumored) | v1.1.0 stretch once stable. |
| **Mochi** | ~24 GB | minutes | Apache-2 | v1.1.0 stretch. |
| **CogVideoX** | ~12 GB | ~90s | Apache-2 | v1.0.0 alt; license is the cleanest. |
| AnimateDiff (SD1.5-based) | ~8 GB | ~45s | mixed | **Drop.** Era-of-2023, lower quality, ecosystem moving on. |

v1.0.0 ships LTX-Video as the default text-to-video, SVD as the default image+text-to-video, and CogVideoX as an opt-in alternative. All three are reasonable on a 12 GB card with the offload techniques from 4.5. **Module: Video Lab + ModelRegistry. Scope: L.**

### 4.10 Workflow-in-PNG metadata

**Decision: Reverse-engineer. This is a 200-line job and the UX payoff is huge.**

When Nexus saves an Image Studio output, it embeds the JSON of the generation graph in the PNG `tEXt` chunk (or WebP EXIF). Dragging that PNG back onto Image Studio restores the exact parameters. This is the single feature that makes ComfyUI outputs self-documenting and shareable. We adopt it verbatim under our own key namespace (`nexus:workflow`). **Module: Image Studio. Scope: S.**

### 4.11 Latent preview during sampling

**Decision: Reverse-engineer. Cheap, high-value perceived-latency win.**

Decode a 64x64 preview every N steps using TAESD (Tiny AutoEncoder for Stable Diffusion) so the user sees the image taking shape rather than a spinner. TAESD weights are tiny (a few MB) and the cost is negligible. Ship as part of the default `DiffusionRuntime`. **Module: Image Studio. Scope: S.**

## 5. What Nexus does better (or should keep distinct from ComfyUI)

- **Bundled desktop shell vs. "bring your own Python."** ComfyUI Desktop is beta, Windows + macOS-ARM only; the portable Windows zip ships an embedded Python but is still ComfyUI-only. Linux users hand-install. Nexus's installer carries CUDA + Python venv + Node + Ollama + models on first launch, and explicitly targets Windows-first with macOS/Linux to follow. (Pivot brief, section 4.5.)
- **Four pillars in one shell, no module-switching tax.** ComfyUI is a single playground; switching between coding and image generation today means alt-tabbing to VS Code (Gemma Code) and back. Nexus exposes Coding, Chat, Image, and Video behind one sidebar with shared model registry, shared GPU scheduler, and shared dashboard telemetry.
- **Agentic Coding pillar entirely absent in ComfyUI.** This is the v0.1.0-v0.22.x engine. ComfyUI does not have a tool registry, sub-agents, plan mode, MCP, memory layers, or a skill catalog. Coding is uniquely Nexus's.
- **Memory + chat persistence ComfyUI does not have.** Four-layer memory (working/episodic/semantic/graph), unified retrieval, anticipatory IntuitionCache, 8-stage compaction. ComfyUI is stateless between prompts; Nexus is the opposite.
- **Privacy posture - originality over wrappers.** No telemetry. No cloud calls. No automatic fetches from public registries. The DevAI-Hub link is the *one* explicitly-named upstream, opt-in, and synced via an audited pathway. ComfyUI-Manager defaults to fetching from a public channel on startup.
- **Skills as the extension surface, not arbitrary-code custom nodes.** This is a security gap ComfyUI has and Nexus deliberately closes.
- **Originality license posture.** ComfyUI core and Manager are GPL-3.0. Nexus stays MIT (or equivalent permissive) and avoids vendoring GPL code by reverse-engineering ideas rather than forking implementations.

## 6. Gap matrix

| Feature | ComfyUI | Nexus today | Nexus v1.0.0 target | Priority | Adoption mode |
|---|---|---|---|---|---|
| Native diffusion runtime (txt2img) | Yes (mature) | None | Yes, SDXL + Flux Schnell + LTX-Video baseline | **P0** | Reverse-engineer |
| Image-to-image | Yes | None | Yes | **P0** | Reverse-engineer |
| Inpaint / outpaint with mask editor | Yes (graph-based) | None | Yes (forms-based) | **P0** | Reverse-engineer |
| Text-to-video | Yes | None | Yes (LTX-Video default) | **P0** | Reverse-engineer |
| Image+text-to-video | Yes | None | Yes (SVD default) | **P0** | Reverse-engineer |
| Smart memory / offload on single GPU | Yes (best in class) | Partial (LLM-only) | Yes, diffusion-aware | **P0** | Reverse-engineer techniques |
| Cross-module GPU scheduler | N/A (single-app) | None | Yes (FIFO + priority) | **P0** | Reverse-engineer |
| Model download manager in-app | Yes (Manager) | Installer-only | Yes (`ModelRegistry` + downloader) | **P0** | Reverse-engineer |
| `extra_model_paths.yaml` convention | Yes | No | Yes (adopt verbatim) | **P1** | Reverse-engineer |
| Workflow-in-PNG metadata | Yes | No | Yes | **P1** | Reverse-engineer |
| Latent preview | Yes (TAESD) | No | Yes | **P1** | Reverse-engineer |
| Workflow templates library | Yes | Coding skills only | Yes, extend skill schema | **P1** | Skill-level adoption |
| Node-graph editor (optional power-user) | Yes (default UX) | No | Yes, *Advanced* tab only | **P2** | Reverse-engineer (minimal) |
| LoRA loaders + model merging | Yes | No | LoRA yes, merging P2 | **P1** | Reverse-engineer |
| ControlNet | Yes | No | Yes (pose, depth, canny baseline) | **P1** | Reverse-engineer |
| Queue manager (in-module, multi-prompt) | Yes | No | Yes (per-module FIFO) | **P1** | Reverse-engineer |
| Custom-node ecosystem | Yes (Manager) | Skills only | Skills extended; no custom nodes | **P0** | Drop (Manager model) / extend skills |
| Audio synthesis (Stable Audio, ACE Step) | Yes | No | No | - | Drop for v1.0.0 |
| 3D generation (Hunyuan3D) | Yes | No | No | - | Drop for v1.0.0 |
| Agentic coding | No | Yes (full engine) | Yes (preserved) | - | Keep, distinct |
| Local chat with folder organization | No | Partial (flat history) | Yes (nested folders, per-folder context) | **P0** | Distinct (Nexus-original) |
| Dashboard with GPU telemetry | No | Limited | Yes (always-on `Local Model Status`) | **P0** | Distinct (Nexus-original) |
| Bundled installer with CUDA + models | Beta (Desktop) | PyQt5 wizard for Coding | Yes, all four pillars | **P0** | Extend existing |

## 7. Prioritized adoption plan

These feed `/generate-plan` as the seed list of work items. Each is sized S/M/L for rough sequencing.

1. **`ModelRegistry` + native model downloader.** Build a shared-core registry (`~/.nexus/models/registry.json` + `extra_model_paths.yaml` support) and a resumable, SHA-256-verifying HTTP downloader. First-launch wizard fetches the recommended set (Coding LLM, Chat LLM, SDXL base, Flux Schnell or LTX-Video). This unblocks every diffusion feature.
   - Mode: reverse-engineer. Originality intact, no GPL dependency.
   - Scope: M.
   - Modules: shared core, installer, Image Studio, Video Lab.
   - Dependencies: none. **Earliest phase.**

2. **`DiffusionRuntime` with smart-offload + `VRAMBudget` middleware.** Implement CPU offload, sequential UNet block loading, adaptive precision, attention slicing, tiled VAE decode. Hook into the `HardwareTier` system. Add a `DiffusionTier` mapping so an RTX 3070 vs an RTX 4090 picks the right techniques automatically. This is the *enabling* layer for everything below.
   - Mode: reverse-engineer techniques (not code; GPL avoidance).
   - Scope: **L**. Single biggest risk.
   - Modules: shared core, Image Studio, Video Lab.
   - Dependencies: `ModelRegistry`. Sequence: phase 2-3.

3. **`GpuScheduler` cross-module FIFO queue.** Single in-process queue with `vram_estimate_gb`, `priority`, and module-aware unloading. Surfaces directly into the dashboard's `Local Model Status` panel.
   - Mode: reverse-engineer (the idea is generic; ComfyUI's queue is single-module).
   - Scope: M.
   - Modules: shared core, all four pillars.
   - Dependencies: `DiffusionRuntime` (needs the offload primitives). Sequence: phase 3.

4. **Image Studio MVP - txt2img + img2img + inpaint + outpaint + mask editor + LoRA + ControlNet baseline.** Forms-driven UX. SDXL base + Flux Schnell + at least one inpaint model in registry. TAESD latent previews. Workflow-in-PNG metadata. Pose/depth/canny ControlNet.
   - Mode: reverse-engineer.
   - Scope: L.
   - Modules: Image Studio.
   - Dependencies: items 1, 2, 3. Sequence: phase 4-5.

5. **Video Lab MVP - text-to-video (LTX-Video) + image+text-to-video (SVD) + timeline previewer.** Single-GPU-fit only. CogVideoX as opt-in alt. No Mochi/HunyuanVideo for v1.0.0 (24 GB+ required).
   - Mode: reverse-engineer.
   - Scope: L.
   - Modules: Video Lab.
   - Dependencies: items 1, 2, 3. Sequence: phase 5-6.

6. **Skill schema extension for image/video presets.** Add `kind: image-preset | video-preset` to existing skill metadata. Ship ~20 starter presets in `assets/presets/`. Wire into `nexus skills sync` so DevAI-Hub upstream feeds Image and Video too.
   - Mode: skill-level adoption.
   - Scope: S.
   - Modules: SkillCatalog, Image Studio, Video Lab.
   - Dependencies: items 4, 5. Sequence: phase 6.

7. **Workflow-in-PNG metadata + drag-to-restore.** Embed full generation JSON in the output image's `tEXt` chunk under `nexus:workflow`. Dragging a Nexus-generated PNG back into Image Studio restores prompt, model, LoRA, seed, mask, etc.
   - Mode: reverse-engineer.
   - Scope: S.
   - Modules: Image Studio.
   - Dependencies: item 4. Sequence: phase 5.

8. **Minimal node-graph "Advanced" tab.** Optional UX. ReactFlow / SvelteFlow front end over a typed Nexus-native graph runtime. No arbitrary-code extension point - only registry-typed nodes. Initial node set: `LoadCheckpoint`, `LoadLoRA`, `CLIPTextEncode`, `KSampler`, `VAEDecode`, `SaveImage`, `LoadImage`, `MaskEditor`, `ControlNetApply`. Not the default; revealed via a "Switch to Advanced" toggle.
   - Mode: reverse-engineer (minimal subset).
   - Scope: M.
   - Modules: Image Studio, Video Lab.
   - Dependencies: items 4, 5. Sequence: phase 7 (post-MVP).

9. **In-app model download UX.** Build the UI surface over the `ModelRegistry` from item 1: search, download with progress, disk-usage report, remove. Mirrors ComfyUI-Manager's model dialog functionally but without arbitrary-source fetching.
   - Mode: reverse-engineer.
   - Scope: M.
   - Modules: shared core (UI), all four pillars consume it.
   - Dependencies: item 1. Sequence: phase 4.

10. **Content-policy posture documented.** Write `docs/v1.0.0/content-policy.md` codifying the position from 4.4: Nexus is content-agnostic on user-supplied models, ships safe defaults, does not bundle uncensored checkpoints, does not run output classifiers, does not crawl Civitai.
    - Mode: documentation only.
    - Scope: S.
    - Modules: none (docs).
    - Dependencies: none. Sequence: phase 1 (sets posture early).

## 8. Risks and non-adoptions

What in ComfyUI we deliberately are NOT taking:

- **The ComfyUI codebase itself.** GPL-3.0 + Python-centric + huge surface area. Vendoring it would force a license change and balloon the installer.
- **ComfyUI-Manager and the custom-node ecosystem.** Security model is "trust the PR reviewers and pip"; we will not expose arbitrary code execution as an extension point. Skills + opt-in MCP cover the legitimate functional need.
- **Node graph as the default UX.** It is the right power-user surface but the wrong newbie surface. Forms first; graph in an Advanced tab.
- **Audio synthesis (Stable Audio, ACE Step) and 3D generation (Hunyuan3D).** Out of scope for v1.0.0. Re-evaluate at v1.1.0 if there is user pull.
- **AnimateDiff-on-SD1.5 video pipeline.** Quality is below 2025-era models. LTX-Video and CogVideoX are strictly better at similar VRAM.
- **Public custom-node registries / channels.** `registry.comfy.org` is great for ComfyUI; Nexus's only upstream is DevAI-Hub.
- **Civitai integration / model browsers.** Users can register any local file. We do not fetch from Civitai's API or expose a Civitai browser.
- **Stateless prompting model.** ComfyUI re-runs the graph each time; Nexus's chat memory layers and IntuitionCache go in the opposite direction.

### Implementation risks specific to this adoption set

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `DiffusionRuntime` smart-offload underestimates VRAM and OOMs mid-generation | High | High | `VRAMBudget` middleware with conservative defaults; lazy-load on first failure with auto-downgrade tier |
| LTX-Video / SVD licenses shift before v1.0.0 ships | Medium | Medium | Keep CogVideoX (Apache-2) as a fallback default; ModelRegistry already supports model swap |
| Native node-graph editor balloons in scope | Medium | Medium | Time-box to 2 weeks; ship locked node set; refuse the "arbitrary code node" pull request |
| Cross-module GPU scheduling deadlocks under contention | Medium | High | Single in-process queue, no module-level locks, scheduler holds the only mutex |
| Workflow-in-PNG metadata collides with ComfyUI's keys | Low | Low | Use `nexus:workflow` namespace; ignore `parameters` / `prompt` ComfyUI keys |
| Skill schema extension breaks existing coding skills | Medium | High | Add `kind` as optional with default `"coding"`; backfill in the same phase as the rename |

## 9. Open questions for the plan generator

These should surface as interview prompts in `/generate-plan`:

- **Diffusion stack language.** TypeScript wrapping a child Python process (ONNX/PyTorch via a sidecar), or a fully native Rust/TS stack via `candle` / `mistral.rs` / `wonnx`? The single-binary Tauri argument prefers the latter; the model-coverage argument prefers the former. Pivot brief section 6 already names this; this comparison reinforces it. **Default proposal: Python sidecar for v1.0.0** because every model in 4.9 has reference PyTorch and zero have proven `candle` ports yet. Revisit at v1.1.0.
- **Whether to ship Flux Schnell in the recommended-models installer step.** License is permissive but the weights are ~24 GB and saturate small SSDs. Default proposal: ship SDXL base by default; offer Flux Schnell as a one-click add inside the in-app model manager (item 9).
- **Node-graph implementation library.** ReactFlow vs SvelteFlow vs hand-rolled SVG. Hinges on the desktop-shell language decision in the pivot brief (Tauri+Svelte vs Electron+React).
- **Inpaint model strategy.** Ship a dedicated SDXL-inpaint model in the registry, or rely on noise-mask inpainting against the base SDXL? Quality vs. install size.
- **LoRA discovery UX.** Show all LoRAs in the registry regardless of base-model compatibility, or filter by detected base? Compatibility detection is non-trivial (requires reading the LoRA's metadata).
- **Cross-module priority policy.** When Coding is in the middle of an agent loop and the user clicks "Generate" in Image Studio, who wins? Default proposal: foreground module wins; background module's job is paused (not killed), VRAM is released, and resumed when foreground completes.
- **Workflow sharing.** Do we ship a "Share to Comfy Hub"-style outbound at all in v1.0.0, or is this strictly opt-in v1.1.0+? Default proposal: v1.0.0 ships export-to-disk only; no upload destination exists yet.
- **`extra_model_paths.yaml` priority.** If the same checkpoint exists in `~/.nexus/models/checkpoints/` *and* a user's existing ComfyUI install, which wins? Default proposal: explicit registry entries first, then `extra_model_paths.yaml` in declaration order, with checksums determining identity.
- **Custom-node compat layer (read-only).** Should Nexus be able to *import* a ComfyUI workflow JSON for users migrating? Default proposal: yes, but only against the locked Nexus node set (item 8); unsupported custom nodes show as a placeholder with a "this node is not available in Nexus" message.
- **Per-module audio / 3D in v1.1.0+.** Should the v1.0.0 architecture leave the door open with a generic `MediaModule` interface, or are audio/3D far enough out that we don't pay the abstraction cost now? Default proposal: leave the door open via shared `ModelRegistry` and `GpuScheduler`; do not pre-build a `MediaModule` interface.
