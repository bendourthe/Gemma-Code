# v1.9.0 installer + app UI rework -- Phase 2: shared catalog.json plain-language copy rewrite

**Date**: 2026-07-07
**Plan**: [installer-and-app-ui-rework.md](../../plans/installer-and-app-ui-rework.md) Phase 2 (T005-T007)
**Branch**: `feat/v1.9.0-installer-phase-1` (installer PR line)
**Model**: claude-opus-4-8, high effort (matches the plan's Phase 2 recommendation; no re-route)

## Goal

Rewrite the model copy in the shared [catalog.json](../../../../../core/registry/catalog.json) so descriptions read as plain language per the Phase-1 [T004 template](../../ui-rework-design.md), without breaking any of the three readers (TS validator, Python installer loader, app Settings->Models).

## What changed

- **T005 (no schema change)**: Phase 1's derive-from-`family` decision means no `publisher` field is needed -- `catalog.ts`, the Python `CatalogModel` loader, and `modelsTypes.ts` are untouched. The plan's top risk (shared-reader churn) is avoided entirely.
- **T006 (copy rewrite)**: all **34 user-facing** models (non-null `task`) get a plain-language `description` on the T004 template -- sentence 1 = maker + kind/size + origin country; sentence 2 = plain positioning. Use-cases stay in `strengths[]` (the card's separate "Best for" line, Phase 6). The `gemma-4-12b-it-gguf` over-technical headline ("Unsloth Dynamic-2.0 GGUF quant ladder / IQ2_M / Q4_K_XL ...") moved into its `differentiators` detail line; headline jargon (MoE / DiT / rectified-flow / adversarial-distilled / linear-attention / CTranslate2 / SVDQuant / Wan2.2-VAE) dropped elsewhere. The 4 `task: null` components (1 VAE + 3 ControlNets) were left unchanged (`UIR.P2.A`).
- **T007 (accuracy)**: facts grounded in the existing curated copy + `origin`; no invented facts. Fine-tune makers credited correctly (Juggernaut XL -> KandooAI/RunDiffusion, RealVis -> SG161222, SD1.5 left unattributed), since `provider_color` keys off `family` (SDXL lineage) for coloring only.
- **Mechanism**: byte-preserving JSON-value-precise string replacement (not `json.dump`), so only the 34 `description` + 1 `differentiators` values change and CRLF / key order / non-copy fields are preserved. `git diff`: 35 insertions / 35 deletions, all on `description`/`differentiators` lines.

## Verification

- Reader 1 (TS `validateSpec`): `tests/unit/core/registry/*` -- 32 passed (incl. new guard).
- Reader 2 (Python loader): `test_typed_catalog.py` -- 46 passed.
- Reader 3 (app): desktop `tsc --noEmit` -- clean.
- Accuracy: every rewritten description names its origin country, carries no headline jargon, and is concise.
- Spot-check: Gemma 4 12B, Juggernaut XL v9, Kokoro 82M read as plain language.
- Test augmentation: +1 stable regression guard in [catalog.test.ts](../../../../../tests/unit/core/registry/catalog.test.ts) (every user-facing description non-empty + names its origin -- the DoD #8 contract). No brittle jargon-blocklist test. No test pinned the old prose.
- No installer/app code changed.

## Notes / carryovers

- `UIR.P2.A` (P3): the 4 `task: null` component entries keep their technical descriptions (never shown as cards).
- The pre-existing inline-size / header / icon baseline edits stay uncommitted for Phases 3/4/5 (`UIR.P1.A`).
- See [known-gaps.md](../../known-gaps.md) Section 4.
