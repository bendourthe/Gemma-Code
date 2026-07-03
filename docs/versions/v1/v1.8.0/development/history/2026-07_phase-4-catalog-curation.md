# v1.8.0 Phase 4 -- Catalog curation + selection UX: chat/agentic split, rich copy, uncensored defaults (T401-T404)

**Date**: 2026-07-03
**Branch**: `feat/v1.8.0-installer-phase-4` (stacked on `feat/v1.8.0-installer-phase-3`)
**Plan**: [../../plans/one-shot-installer.md](../../plans/one-shot-installer.md) (Phase 4 of 6, closes gap G3)
**Constraints honored**: GitHub Actions freeze ($0 until 2026-08-01) -- all proofs local. The dev sandbox still has **no Hugging Face egress**, but general web search worked, so the T403 curation was verified against the HF model cards / trees via search (license, publisher, file names, sizes); digest pins stay placeholders and the runtime-load leg is an operator action (`OSI004.P4.A/B`).

## Why this phase exists (G3)

Before this phase the catalog UX contradicted the product vision three ways: one undifferentiated Text tab (no chat vs agentic-coding split), thin per-model copy (a one-line description with no "what it's good at / why recommended"), and **zero uncensored image/video entries** despite the product decision that uncensored image + video are the defaults where hardware fits. On top of that, the typed catalog page itself was tested-but-unwired -- the shipping wizard still used the v1.0.0 four-radio Gemma page, and the Phase 3 multi-select surface (`selected_model_ids`) had no producer (`OSI003.P3.D`).

## What shipped

### T401 -- schema + section split + card copy

- [catalog.json](../../../../../core/registry/catalog.json): every user-facing entry gains `task` (`chat` | `agentic` | `image` | `video` | `audio` | `embed`), `strengths[]`, `differentiators`, and (on tier defaults) `whyRecommended`; curated entries add `provenance`. Support types (vae, controlnet) carry no task and stay hidden.
- [catalog.ts](../../../../../core/registry/catalog.ts): `ModelTask` type + optional `task` / `strengths` / `whyRecommended` / `differentiators` / `provenance` on `ModelSpec`; `validateSpec` rejects invalid tasks and enforces the curation policy fail-loud: **`uncensored: true` without `provenance` throws**.
- [typed_catalog.py](../../../../../scripts/installer/pyqt/src/nexus_installer/pages/typed_catalog.py): `TYPE_TABS` becomes **Chat / Agentic Coding / Image / Video / Audio**; mapping is task-driven (`TASK_TO_TAB`) with the old type-based mapping retained as fallback for task-less entries; embed models render under Chat (memory-layer support). Cards render the new copy -- a "Why this one" accent line on defaults, "Good at: ..." strengths, an italic differentiators line -- plus a Recommended pill, alongside the existing compatibility badge / context window / multimodal / uncensored / license metadata.

### T402 -- text-side curation

All 13 text-side entries carry authored copy. The chat ladder: `gemma4:e2b` (CPU-only reach) -> `gemma4:e4b` (the mainstream default) -> `gemma-4-12b-it-gguf` (multimodal + 256K at 11 GB) -> `gemma4:26b` -> `gemma4:31b` (the 24 GB flagship), with llama3.1 and qwen2.5 as alternatives. The agentic ladder: `qwen2.5-coder:7b` -> `qwen2.5-coder:14b` -> `deepseek-coder-v2:16b` (MoE, top of catalog). `nomic-embed-text` is copy-documented as the memory layer's always-on support model.

### T403 -- uncensored image/video curation + tier defaults

Research ran through live web search against the HF model cards (2026-07-03); each entry records license + provenance verbatim in the catalog:

| Entry | Lineage / publisher | License | Tier defaults |
|---|---|---|---|
| `juggernaut-xl-v9` | SDXL 1.0 fine-tune, KandooAI x RunDiffusion | CreativeML Open RAIL-M (+ no-paid-API rider) | image @ 8 / 12 GB |
| `realvisxl-v5` | SDXL 1.0 fine-tune, SG161222 | OpenRAIL++ | image @ 16 / 24 GB |
| `wan2.1-t2v-1.3b` | Alibaba Wan-AI original | Apache-2.0 | video @ 8 / 12 / 16 GB |
| `wan2.2-ti2v-5b` | Alibaba Wan-AI original (720p24 on a 4090) | Apache-2.0 | video @ 24 GB |

- All four are `uncensored: true` with the basis recorded in `provenance` (no weights-level content filter; photoreal training data for the SDXL fine-tunes). Censored alternatives (SANA family, SDXL base/turbo, FLUX-schnell, LTX-Video, SVD) stay listed un-ticked.
- Weights manifests follow the Phase 3 primary-blobs + placeholder-pins convention (file names verified against the HF trees via search; the Wan 2.2 transformer is 3 shards). Full-tree enumeration + pin rotation remain the `OSI004.P4.A` operator action; the diffusion-runtime load verification is `OSI004.P4.B`.
- [recommended.json](../../../../../core/registry/recommended.json) rewritten to **schema v2**: a `tiers` matrix (`cpu` / `8` / `12` / `16` / `24`) mapping each tier to per-section default ids -- one chat + one agentic + the embed model on every tier, uncensored image + video on every GPU tier, nothing GPU-bound on `cpu`.
- New pure [tier_defaults.py](../../../../../scripts/installer/pyqt/src/nexus_installer/tier_defaults.py): `resolve_tier` (vendor/VRAM -> tier; sub-8 GB GPUs use the `8` matrix), `load_tier_matrix` (tolerant), and `default_selection` -- fit-gates every matrix id against detected VRAM and cumulative free-disk-minus-reserve; **chat and agentic are guaranteed** (largest-fitting substitute, then smallest-of-task as the RAM-offload floor), image/video are fit-gated with **no substitution** (uncensored-by-default only where hardware fits), `cpu` never selects image/video.

### Wizard wiring (closes `OSI003.P3.D`)

- [main.py](../../../../../scripts/installer/pyqt/src/nexus_installer/main.py): `TypedCatalogPage` replaces `ModelSelectionPage` at step 4 (STEP_NAMES: "Model Selection" -> "Models"; the install-guard bounce target is unchanged at index 4). A `--model` override seeds both `selected_model` and `selected_model_ids`, and the page treats a pre-seeded selection as user intent.
- The page recomputes tier defaults on `showEvent` until the user touches a checkbox -- necessary because all pages are constructed before the GPU-detection worker finishes (the old page had this staleness latently).
- Every selection change writes the section-ordered `selected_model_ids` (unknown ids preserved and sorted last -- they route to `ollama pull` verbatim), keeps the legacy `selected_model` on the chat pick (config-write + review fallback consumers), and updates `selected_models_gb` for the disk-aware guard.
- [review.py](../../../../../scripts/installer/pyqt/src/nexus_installer/pages/review.py): renders the multi-selection ("N selected (~X GB)" + per-id lines) with the legacy single-model line as fallback.
- **Bug found by the end-to-end smoke and fixed**: the page's `_repo_root()` used `parents[5]`, which resolves to `scripts/` -- the default catalog/recommended paths had *never* worked (latent while the page was unwired; every test injected explicit paths). Replaced with the same walk-up used by `engine/model_router.py`. Packaging note: the PyInstaller bundle still does not ship the two registry files -- recorded as `OSI004.P4.C` for Phase 6 / T601.

### T404 -- hardware-tier default matrix tests

- New [test_tier_defaults.py](../../../../../scripts/installer/pyqt/tests/test_tier_defaults.py) (29 tests): tier resolution (13 cases), and the REAL catalog + matrix per simulated tier -- every default exists, fits the tier's VRAM, disk stays over the reserve, composition is one-chat + one-agentic + embed + (GPU tiers) uncensored image + video; sub-tier degradation (6 GB GPU), cpu-tier exclusions, matrix-id downloadability (HF entries must carry weights manifests), section/task consistency; synthetic suites for the fallback ladder, disk-gating order, unknown-disk permissiveness, and wrong-task rejection.
- [test_typed_catalog.py](../../../../../scripts/installer/pyqt/tests/test_typed_catalog.py) rewritten for the sectioned page (32 tests): five tabs, task-driven mapping + type fallback, copy parsing, tier pre-ticks per hardware, cpu exclusions, `selected_model_ids` / `selected_model` / `selected_models_gb` write-back, seeded-selection precedence incl. unknown-id survival, refresh-until-touched semantics, user-toggle stickiness, disk-gated defaults.
- [test_review.py](../../../../../scripts/installer/pyqt/tests/test_review.py): multi-selection + legacy fallback rendering. [catalog.test.ts](../../../../../tests/unit/core/registry/catalog.test.ts): invalid-task rejection, uncensored-requires-provenance, the four curated entries (type/license/provenance/weights), and task + copy coverage across all user-facing bundled entries.
- Offscreen end-to-end smoke against the real registry files, all five tiers (24/16/12/8/CPU), matched the designed matrix exactly (67.8 / 41.0 / 40.3 / 31.9 / 6.3 GB selections).

## Quality gates

| Gate | Result |
|---|---|
| Installer pytest suite | **538 passed / 2 skipped / 0 failed** (540 collected, +46; both skips are the pre-existing env-gated integration legs) |
| Changed-module coverage | `tier_defaults.py` 94% lines; `typed_catalog.py` 93%; `review.py` 91% |
| Ruff (changed files) | 0 new findings (2 pre-existing E501s on untouched lines) |
| `tsc -b` | clean |
| Root Vitest suite (`npm test`) | **4569 passed / 6 skipped / 0 failed** (+4 new catalog schema tests) |
| End-to-end smoke | 5/5 hardware tiers produce the designed default matrix from the real registry files |

## Decisions

- **Explicit tier matrix over computed preference scoring**: the defaults are a curation artifact (license + provenance judgments), so they live as reviewable data in recommended.json; the code only resolves + fit-gates. A newly curated entry becomes a default by editing data, not logic.
- **Embed models render under Chat**: `nomic-embed-text` is infrastructure the memory layer needs, so it ships in every tier default and displays inside the Chat section rather than a sixth tab.
- **Chat/agentic guaranteed, image/video fit-gated without substitution**: swapping a censored image model in when the uncensored default does not fit would contradict the product decision; users can still opt in from the listed alternatives.
- **`uncensored` requires `provenance` at the validator level**: turns the curation policy (license + provenance per uncensored entry, plan risk table) into a fail-loud schema rule instead of a review convention.
- **`ModelSelectionPage` retained unwired** (`OSI004.P4.D`): deleting the module + its passing tests was out of phase scope; removal is queued for a hygiene pass.

## Operator actions carried

- `OSI004.P4.A` (with `OSI003.P3.A/B`): rotate pins + enumerate full repo file lists for the 20 HF entries from an unproxied network (`pin-hf-weights.py`).
- `OSI004.P4.B` (with `OSI003.P3.C`): GPU-box load verification of the four uncensored defaults via the diffusion runtime; true-up `sizeGB`/`requiredVramGB` (`OSI004.P4.E`) and demote any entry that fails to load.
