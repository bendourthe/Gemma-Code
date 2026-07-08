# Nexus v1.9.0 - UI Rework Design Spec (installer + app)

> **Status**: RATIFIED (Phase 1, 2026-07-07). This is the design contract every later phase of [installer-and-app-ui-rework.md](plans/installer-and-app-ui-rework.md) consumes. It records four foundations decided once: the installer **type scale** (T001), the **provider color palette** (T002), the **aurora/shimmer animation spec** (T003), and the **plain-language model-copy template** (T004). Complements (does not replace) [design-tokens.md](design-tokens.md), which holds the shared glow-layer palette.
>
> Sources of truth for code: the type scale + provider palette live in [scripts/installer/src/nexus_installer/constants.py](../../../../scripts/installer/src/nexus_installer/constants.py); the aurora tokens are the existing app tokens in [desktop/src/styles/tokens.css](../../../../desktop/src/styles/tokens.css). Update code and this doc together.

---

## 1. Installer type scale (T001)

One coherent, strictly-descending pixel scale replaces the ~90 ad-hoc inline `font-size` strings and the 8pt/11pt lows. Hierarchy is **Display > H1 > H2 > H3 > Body > Caption** with a hard **14px floor**. Operator-confirmed 2026-07-07.

| Token (`constants.py`) | px | Weight token | Role |
|---|---|---|---|
| `FS_DISPLAY` | 34 | `FW_BOLD` (700) | Page hero / Welcome title |
| `FS_H1` | 28 | `FW_BOLD` (700) | Page titles |
| `FS_H2` | 20 | `FW_SEMIBOLD` (600) | Section heads |
| `FS_H3` | 17 | `FW_SEMIBOLD` (600) | Sub-heads / card titles |
| `FS_BODY` | 16 | `FW_REGULAR` (400) | Paragraph / descriptions |
| `FS_BODY_STRONG` | 16 | `FW_SEMIBOLD` (600) | Emphasized body (same size as Body) |
| `FS_CAPTION` | 14 | `FW_MEDIUM` (500) | Pills, meta, step labels -- **hard floor** |

Weight tokens: `FW_REGULAR=400`, `FW_MEDIUM=500`, `FW_SEMIBOLD=600`, `FW_BOLD=700`.

**Rules**
- `FS_BODY_STRONG` shares `FS_BODY`'s size; emphasis comes from `FW_SEMIBOLD`, never a larger size. It is therefore excluded from `TYPE_SCALE` (the strict-descent tuple).
- `TYPE_SCALE = (34, 28, 20, 17, 16, 14)` is strictly descending and floored at 14 (Phase-1 verification asserts both).
- The QSS base font stays 15px (`theme.py`); the scale drives the Phase-3 scale-classes (`pageTitle`, `sectionHead`, `subHead`, `bodyText`, `caption`) and every page/widget label.
- Sizes are px ints; QSS consumers format as `f"{FS_H1}px"`. Qt point-size APIs (`QFont(family, pt)`) must be converted or replaced with pixel sizing so the scale is honored consistently.

**Label -> level mapping (Phase 3 guidance)**
- Page title (`welcome`, `prerequisites`, ...) -> `FS_H1`; the Welcome hero title may use `FS_DISPLAY`.
- Section subhead / group heading -> `FS_H2`.
- Card title / callout heading / the one-off 19px GPU-name label -> `FS_H3`.
- Body copy, descriptions, list rows -> `FS_BODY` (emphasis: `FS_BODY_STRONG`).
- Pills, badges, dots, "Step X of Y", stepper labels, log meta -> `FS_CAPTION` (never below 14).

---

## 2. Provider color palette (T002)

The Models page colors each model by its **publisher**, not by the tab it appears under, so a model listed in both Chat and Agentic shows **one consistent color** (DoD #7). The catalog has no `publisher` field (its `origin` is a *country*), so the publisher -- and thus the color -- is **derived from the existing `family` field** (operator-confirmed: derive-from-family, no schema change). Tabs render **neutral** (a single lead accent), so the provider color is the only card color signal.

### 2.1 Publisher colors (`PROVIDER_COLORS`)

| Publisher | Color | Hue |
|---|---|---|
| Google | `#22d3ee` | cyan |
| Meta | `#60a5fa` | blue |
| Alibaba | `#a78bfa` | violet |
| DeepSeek | `#818cf8` | indigo |
| NVIDIA | `#a3e635` | lime |
| Stability AI | `#f472b6` | pink |
| Black Forest Labs | `#fbbf24` | amber |
| Lightricks | `#fb923c` | orange |
| OpenAI | `#34d399` | emerald |
| Nomic AI | `#2dd4bf` | teal |
| Community / unknown | `#94a3b8` (`PROVIDER_FALLBACK`) | slate |

### 2.2 Family -> publisher (`FAMILY_TO_PUBLISHER`)

Covers every `family` currently in [catalog.json](../../../../core/registry/catalog.json). An unseen family resolves to **Community** (the neutral fallback).

| Family | Publisher | | Family | Publisher |
|---|---|---|---|---|
| `gemma4` | Google | | `sd1` | Stability AI |
| `llama` | Meta | | `svd` | Stability AI |
| `musicgen` | Meta | | `stable-audio` | Stability AI |
| `qwen` | Alibaba | | `flux` | Black Forest Labs |
| `wan` | Alibaba | | `sana` | NVIDIA |
| `deepseek` | DeepSeek | | `ltx` | Lightricks |
| `nomic` | Nomic AI | | `whisper` | OpenAI |
| `sdxl` | Stability AI | | `kokoro` / `piper` | Community |

### 2.3 Resolvers + rules

- `publisher_for_family(family) -> str` and `provider_color(family) -> str` live in `constants.py`; Phase 6 calls `provider_color()` for the card border/accent, the checkbox checked-fill, and the size/why lines (replacing `SECTION_ACCENTS.get(...)`).
- **Neutral tabs**: Phase 6 restyles the catalog tab bar to a single neutral accent (the lead `ACCENT` cyan for the active tab, `TEXT_SECONDARY` for inactive) instead of the per-section accent, so tab color never competes with the per-provider card color.
- **Legend (T025)**: show a compact per-provider legend only when more than one distinct provider is present in the visible list; skip it gracefully for a single-provider view.
- Colors are chosen to stay distinguishable on the dark theme; where two publishers are close (Meta blue / DeepSeek indigo), the family-key difference still guarantees a stable per-model color.

---

## 3. Aurora + shimmer animation spec (T003)

The contract Phase 8 implements as the `GenerationCanvas` React component, shown inside the **Image Studio** and **Video Lab** rounded preview boxes while a job runs. Inspiration: Gemini's pulsing gradient loader + ChatGPT's shimmer placeholder, adapted to the Nexus aurora palette. **Uses only existing app tokens** (no new color token required).

### 3.1 Tokens reused (all already in `tokens.css`)

| Token | Value | Role in the aurora |
|---|---|---|
| `--glow-cyan` | `#38bdf8` | Primary aurora layer |
| `--glow-cyan-node` | `#7dd3fc` | Sky highlight layer |
| `--grad-signature` | `linear-gradient(100deg,#3b82f6,#38bdf8,#22d3ee)` | Shimmer bar fill |
| `--grad-signature-soft` | soft blue wash | Reduced-motion static glow |
| `--accent-chatbot` | `#22d3ee` | Cyan depth stop |
| `--accent-image` | `#f97316` | Optional Image-Studio warm tint |
| `--accent-video` | `#22c55e` | Optional Video-Lab tint |
| `--glow-lg` | `0 0 24px rgba(56,189,248,.5)` | Box edge glow |

The base blue `#3b82f6` is taken from `--grad-signature`'s first stop. A violet layer is **optional**; if Phase 8 wants one it introduces a scoped `--aurora-violet` in `globals.css` (suggested `#a78bfa`, matching the Alibaba provider hue) -- it is **not** required by this spec, which is self-contained on the tokens above.

### 3.2 Technique (grounded in Section 1.7)

- **Container**: rounded box (`border-radius: var(--radius-lg)`, `overflow: hidden`, `position: relative`) sized to the existing preview box; edge glow via `box-shadow: var(--glow-lg)`.
- **Aurora layers**: 3 oversized radial-gradient layers, each `position: absolute; inset: -35%; filter: blur(24-28px); mix-blend-mode: screen`. Layer hues: `--glow-cyan`, `--accent-chatbot`, `--glow-cyan-node` (optionally a 4th per-pillar tint: `--accent-image` in Image Studio, `--accent-video` in Video Lab).
- **Motion = transform, not gradient stops**: animate each layer with `transform: translate3d(...) scale(...)` on **staggered 9-11s** ease-in-out loops (e.g. 9s / 10s / 11s), so the GPU compositor does the work. Never animate `background-position` of the radial layers.
- **Shimmer bar**: one thin diagonal highlight (`--grad-signature`, low opacity) sweeping across via `background-position: -200% -> 200%` (or a `translateX` of an oversized element) on a ~2.2s loop.
- **Progress coupling (T030)**: drive overall opacity/intensity (and, optionally, a thin progress ring) from the existing drain-poll progress value (0->1), so the box visibly "warms up" as the job advances. When a live latent-preview image exists, render it above the aurora at partial opacity so the result reads as "materializing"; hand off to the final `<img>` / `TimelinePreviewer` on completion.
- **Perf bound**: `will-change: transform` on the moving layers only; no layout thrash; must stay smooth alongside the constellation backdrop.

### 3.3 Reduced motion

`@media (prefers-reduced-motion: reduce)` disables all motion (aurora drift + shimmer) and shows a **soft static glow** (a single `--grad-signature-soft` radial fill at rest) with the same edge glow, so the box still reads as "working" without animation.

---

## 4. Plain-language model-copy template (T004)

The contract Phase 2 applies when rewriting every `description` in [catalog.json](../../../../core/registry/catalog.json). Goal: a card reads like a plain product blurb, not a release note. Keep tech detail out of the headline.

### 4.1 Template

- **Sentence 1 (what it is)**: `"{Publisher}'s {DisplayName} is a {size/kind} {modality} model from {country}."`
  - `{Publisher}` = `publisher_for_family(family)` (Section 2.2).
  - `{DisplayName}` = the model's `displayName`.
  - `{size/kind}` = a plain size/tier word grounded in `sizeGB` + params (e.g. "compact", "mid-size", "large"); optionally the param count if it is in `displayName`.
  - `{modality}` = a plain kind from `type`/`task` ("chat", "coding", "text-to-image", "text-to-video", "speech-to-text", "text-to-speech", "embedding").
  - `{country}` = the `origin` field verbatim.
- **Sentence 2 (what it's good at)**: a plain "best at" sentence, drawn from `strengths[]`, in everyday language. No jargon, no benchmark names.
- **Tech detail stays out of the headline**: quant ladders (GGUF / IQ2_M / Q4_K_XL), MoE, context-window internals, and run commands move to the `differentiators` line (a de-emphasized detail row), never sentence 1-2.
- **No invented facts**: publisher, country, kind, and size must be consistent with `family`/`origin`/`type`/`sizeGB`. If a fact is unknown, omit it rather than guess.
- **Preserve all non-copy fields byte-for-byte** (Phase 2 rewrites `description`, may relocate jargon into `differentiators`; `strengths[]`, `sizeGB`, `vramGB`, `license`, `agentic`, etc. are untouched).

### 4.2 Worked example (real catalog entry)

`gemma-4-12b-it-gguf` (family `gemma4` -> Google; origin USA; sizeGB 7.37; multimodal chat):

**Before** (the screenshot's worst offender):
> Unsloth Dynamic-2.0 GGUF quant ladder of Gemma 4 12B instruction-tuned (IQ2_M / Q3_K / Q4_K_XL / Q5_K / Q6_K / BF16). Native text/image/audio multimodal input, 256K context. Run via `ollama run hf.co/unsloth/gemma-4-12b-it-GGUF:<QUANT>`. Per-quant disk/VRAM sizing ... Q4_K_XL is the recommended default quant.

**After** (`description`):
> Google's Gemma 4 12B is a mid-size chat model from the USA that also understands images and audio. Best for everyday chat, longer documents, and questions that mix text with a picture or a clip.

**Relocated to `differentiators`** (detail row, de-emphasized):
> Native image + audio input with a 256K context; ships as Unsloth Dynamic-2.0 GGUF quants (Q4_K_XL default) that stay close to full quality at about half the size.

`gemma4:e2b` already reads to template ("Google Gemma 4 2B-parameter instruct model. The smallest chat tier: stays responsive on 4 GB VRAM or even CPU-only machines.") and needs only light polish -- it is the target other entries move toward.

### 4.3 Phase-2 verification hooks

- `catalog.ts` `validateSpec` passes for every entry.
- The Python loader `load_catalog_models()` parses all models with no exception.
- `npm run typecheck` in `desktop/` is clean.
- Spot-check 3 rewritten cards read as plain language (one chat, one image, one audio).
