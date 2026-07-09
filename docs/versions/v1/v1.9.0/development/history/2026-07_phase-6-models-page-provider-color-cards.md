# v1.9.0 installer + app UI rework -- Phase 6: Models page (per-provider color + plain-language cards + intro copy)

**Date**: 2026-07-09
**Plan**: [installer-and-app-ui-rework.md](../../plans/installer-and-app-ui-rework.md) Phase 6 (T022-T025)
**Branch**: `feat/v1.9.0-installer-phase-1` (installer PR line)
**Model**: claude-opus-4-8, high effort (matches the plan's Phase 6 recommendation)

## Goal

Recolor the Models page by provider (not by tab), rebuild the card so the plain-language description + a readable "Best for" line replace the cramped truncated pill, and simplify the intro/total copy.

## What changed (all in [typed_catalog.py](../../../../../scripts/installer/src/nexus_installer/pages/typed_catalog.py))

- **T022 -- per-provider color**: `CatalogModel` gains a `family` field; each card's accent = `provider_color(model.family)` (the Phase-1 resolver) instead of the per-section `SECTION_ACCENTS`. The per-tab section rule is a single neutral lead accent. A model in both Chat and Agentic (the Gemma 4 family) now shows **one** color (DoD #7). The size label, `ModelCheckBox` fill, "Best for" label, and "why this one" line all key off it.
- **T023 -- card rebuild**: leads with the plain-language `description` (`FS_BODY`), then a full-width **"Best for"** line from all of `strengths[]` (no truncation), then a compact fact-pill row (Origin, Agentic, Context, Multimodal, license) + an **Uncensored** flag only when applicable (the always-on Guardrails pill and the truncated "Best at" pill are retired).
- **T024 -- copy**: shorter subtitle (notes cards are colored by maker); totals line "N models selected -- X.X GB total download"; the footer button renamed "Reset to recommended".
- **T025 -- legend**: a compact per-provider color legend (rich-text swatches + publisher names) under the subtitle, shown only when >1 provider is present (bundled catalog spans 11), hidden otherwise.

## Verification

- Installer suite: **672 passed / 2 skipped / 0 failed** (+2).
- Offscreen Models-page smoke (real catalog): no model shows >1 color; `gemma4:e4b` is one Google cyan in both Chat + Agentic; `qwen`->violet, `sdxl`->pink; legend lists 11 providers.
- +2 regression guards in `test_typed_catalog.py` (`test_cards_colored_by_provider_not_tab`, `test_provider_legend_lists_multiple_providers`). ruff clean.

## Carryovers

- `UIR.P6.A` (P2): card-color readability + Models-page layout at default width need a running GUI -> Phase 7 visual QA (DoD 7 + 8).
- Consumes Phase 1 `provider_color()`, Phase 2 catalog copy, Phase 5 `ModelCheckBox`. No baseline-file entanglement.
- See [known-gaps.md](../../known-gaps.md) Section 4.
