# v1.9.0 Phase 4 -- Model selector redesign + metadata + Gemma-4-agentic + audio pillar

**Date**: 2026-07-04
**Plan**: [installer-and-app-experience-overhaul.md](../../plans/installer-and-app-experience-overhaul.md) (Phase 4, T401-T407)
**Scope**: make the installer catalog scannable and complete -- richer per-model metadata (origin, guardrails, agentic capability), a redesigned card, Gemma-4-first agentic ranking, and a full audio pillar (speech + generation).

## Summary

The installer's model picker went from a text-dense list to a scannable, metadata-rich catalog. Every user-facing entry now carries a country of `origin` and a coarse `guardrails` label; agentic-capable chat models (the Gemma 4 family) are flagged and surface in the renamed **Agentic** tab ranked ahead of the coding specialists; the cards render a compact chip row with a single status badge, a prominent disk-size accent, larger cyan selection boxes, and a locked-on **Required** state for the embedding model. The **Audio** pillar is populated for the first time (speech + generation), the legacy unwired selection pages are removed, and the tier-default matrix is reworked so a fitting Gemma 4 variant covers both chat and agentic per tier.

## What changed

### Schema (T401)
- `core/registry/catalog.ts`: added `"audio"` to `ModelType`; added optional `origin`, `agentic`, and `guardrails` fields to `ModelSpec`; `validateSpec` now accepts `type: "audio"`. `uncensored`-requires-`provenance` is unchanged.
- `typed_catalog.py` `CatalogModel`: parses `origin` / `agentic` / `guardrails`; derives `guardrails_label` (Uncensored / Safety-tuned / N/A) and `is_required` (task `embed`).
- Downstream consumers of the schema followed the `"audio"` addition: `core/registry/ModelStorage.ts` (`ModelManifest` `type` + `runtime` unions) and `NexusModelRegistry.ts` (`makeHttpManifest` maps `audio` -> `"audio"` runtime instead of falling through to `"video"`).

### Metadata population (T402)
- `origin` + `agentic` written to all 34 user-facing entries via a text-insertion pass (kept the inline `source` objects unreflowed). `agentic: true` on the Gemma 4 family (`gemma4:e2b/e4b/26b/31b`, `gemma-4-12b-it-gguf`) and the coders (`qwen2.5-coder:7b/14b`, `deepseek-coder-v2:16b`).

### Card redesign (T403)
- `_ModelCard` rebuilt: title row (checkbox + name + release + status badge + disk accent), a metadata chip row (`_pill` helper), an incompatibility note when a model does not fit, description, and the "Why this one" line for recommended entries.
- Status badge priority: **Required** (embed) > incompatibility warning > **Recommended** > **Compatible** (`_card_status`).
- Larger cyan selection boxes (20px indicator, section accent). The `nomic-embed-text` card is locked on (checked + disabled) while selected.
- Page footer: **Refresh Models** button (resets to the recommended set for the detected hardware) + a reassurance note. The wizard's global Next button serves as Continue (a page-local duplicate was intentionally omitted).
- Cross-tab checkbox sync: a Gemma 4 variant appears in both Chat and Agentic; `_update_selection_state` syncs every card for an id to the shared selection.

### Agentic tab + tier matrix (T404)
- Tab renamed "Agentic Coding" -> **Agentic**; `_models_for_section("agentic")` includes `task == "agentic"` (coders) OR `agentic == true` (Gemma family).
- `_sorted_section_models` ranks the recommended default first, then the agentic-capable Gemma variants (biggest first), then the coders.
- `recommended.json`: each tier's `agentic` list is `[<fitting Gemma 4 variant>, <coder fallback>]`.
- `tier_defaults.default_selection`: chat/agentic are now single-pick sections; `_qualifies` treats an agentic-capable chat model as covering the agentic section, so the Gemma chat pick also covers agentic (no redundant coder is pre-selected). The coder is the in-list fallback taken only when no Gemma variant fits VRAM.

### Audio pillar (T405)
- Five entries added: **faster-whisper-large-v3** (STT, MIT), **kokoro-82m** (TTS, Apache-2.0), **piper-en-us-lessac** (TTS, MIT), **musicgen-medium** (music gen, CC-BY-NC-4.0), **stable-audio-open-1.0** (sound/music gen, Stability AI Community License).
- Defaults: faster-whisper + Kokoro on every tier (permissive + `requiredVramGB: 0`, so CPU-capable and compatible everywhere). The non-commercial GPU-gated generation models are listed opt-in, never defaults.

### Legacy removal (T406)
- Deleted `pages/model_selection.py`, `pages/recommended_models.py`, `tests/test_model_selection.py`, `tests/test_recommended_models.py`, the `TestModelSelectionPage` case, and the review page's `_MODEL_SIZES` table (closes `OSI004.P4.D`). The review summary reads from `selected_model_ids` / `selected_models_gb`.

## Key decisions

- **One Gemma covers chat + agentic.** Because Gemma 4 is agentic-coding-capable and the fitting Gemma variant is both the chat and agentic default on every tier, the default selection pre-ticks it once and it serves both roles; the coders stay opt-in in the Agentic tab. This is leaner and matches the operator's "Gemma 4 first where hardware fits" decision.
- **Required is derived, not a schema field.** `is_required = (task == "embed")` -- the memory layer needs an embedding model and there is exactly one, so no new schema field was added.
- **Guardrails is a coarse 3-value label.** Uncensored / Safety-tuned / N/A, derived from `uncensored` with an optional `guardrails` override. Not a per-model policy audit.
- **Footer Continue omitted.** The wizard already has a prominent global Next; a page-local Continue would be a double-nav regression. The in-page footer carries only Refresh Models + the reassurance note.

## Origin sources (T402)

| Family / entries | Origin | Basis |
|---|---|---|
| Gemma 4 (`gemma4:*`, `gemma-4-12b-it-gguf`) | USA | Google |
| Llama 3.1 (`llama3.1:8b/70b`) | USA | Meta |
| Qwen 2.5 + Qwen-Coder | China | Alibaba |
| DeepSeek Coder V2 | China | DeepSeek |
| Nomic Embed | USA | Nomic AI |
| SDXL Turbo / SDXL Base / SD 1.5 / SVD | UK | Stability AI lineage (operator-verified grouping) |
| Juggernaut XL v9 | USA | RunDiffusion (SDXL fine-tune) |
| RealVisXL V5.0 | Community | SG161222 (individual fine-tuner, no clearly attributable country) |
| FLUX.1 Schnell | Germany | Black Forest Labs |
| LTX-Video | Israel | Lightricks |
| Wan 2.1 / 2.2 | China | Alibaba (Wan-AI) |
| SANA family + DC-AE + ControlNets | USA | NVIDIA (DC-AE: MIT HAN Lab) |
| Faster-Whisper | USA | OpenAI Whisper (Systran CTranslate2 conversion, MIT) |
| Kokoro / Piper | Community | hexgrad / Rhasspy open-weight TTS |
| MusicGen | USA | Meta |
| Stable Audio Open | UK | Stability AI |

## Quality gates

- Installer suite: **651 passed / 2 skipped / 0 failed**.
- Changed-module coverage: `typed_catalog` 96% / `tier_defaults` 94% / `review` 94% lines (all >= the 80% gate).
- Root Vitest: **4573 passed / 6 skipped / 0 failed** (+4 catalog tests).
- `tsc -b` clean; `eslint src modules` clean; `ruff check` + `ruff format` clean on all changed files.

## New gaps

- `IAE.P4.A` (P1): audio runtime not implemented -- the pillar is catalog + download only (parallels the image/video runtime stubs).
- `IAE.P4.B` (P2): the desktop `ListedModel` DTO mirror needs `"audio"` -> Phase 5.
- `IAE.P4.C` (P2): audio weights sha256 pins are placeholders -> rotate + verify the puller handles them in the Phase 6 rehearsal.

See [known-gaps.md](../../known-gaps.md).
