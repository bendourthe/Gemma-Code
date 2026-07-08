# v1.9.0 installer + app UI rework -- Phase 1: shared design foundations

**Date**: 2026-07-07
**Plan**: [installer-and-app-ui-rework.md](../../plans/installer-and-app-ui-rework.md) Phase 1 (T001-T004)
**Branch**: `feat/v1.9.0-installer-phase-1` (installer PR line)
**Model**: claude-opus-4-8, high effort (matches the plan's Phase 1 recommendation; no re-route needed)

## Goal

Decide, once, the four design primitives every later phase consumes -- the installer type scale (T001), the per-provider color palette (T002), the aurora/shimmer animation spec (T003), and the plain-language model-copy template (T004) -- and land the installer-side tokens plus a ratified spec doc. Foundations only: no page/widget wiring (Phases 3/6/8), no catalog copy rewrite (Phase 2), no aurora component (Phase 8).

## Operator decisions (2026-07-07)

Batched at the start of the phase (the plan flagged the scale + palette as "operator to confirm"):

1. **Type scale**: confirmed the proposed values -- Display 34 / H1 28 / H2 20 / H3 17 / Body 16 / Body-strong 16 / Caption 14 (px), hard 14px floor.
2. **Provider color source**: **derive the publisher from the existing `family` field** (the catalog's `origin` is a country, not a publisher). No `publisher` field, no catalog-schema change -- avoids the plan's top risk (shared-reader churn). The app can re-derive later if it wants parity.
3. **Provider palette**: confirmed the proposed 11-publisher palette with a neutral slate fallback.

## What changed

- **[constants.py](../../../../../scripts/installer/src/nexus_installer/constants.py) -- type scale (T001)**: `FS_DISPLAY 34 / FS_H1 28 / FS_H2 20 / FS_H3 17 / FS_BODY 16 / FS_BODY_STRONG 16 / FS_CAPTION 14`, a `TYPE_SCALE = (34,28,20,17,16,14)` tuple (excludes `FS_BODY_STRONG`, which equals `FS_BODY` -- emphasis is a weight), and weight tokens `FW_REGULAR/MEDIUM/SEMIBOLD/BOLD`.
- **[constants.py](../../../../../scripts/installer/src/nexus_installer/constants.py) -- provider palette (T002)**: `PROVIDER_COLORS` (Google cyan / Meta blue / Alibaba violet / DeepSeek indigo / NVIDIA lime / Stability AI pink / Black Forest Labs amber / Lightricks orange / OpenAI emerald / Nomic AI teal / Community slate), `PROVIDER_FALLBACK = #94a3b8`, `FAMILY_TO_PUBLISHER` (all 17 catalog families), and pure resolvers `publisher_for_family()` / `provider_color()`.
- **[ui-rework-design.md](../../ui-rework-design.md) -- aurora spec (T003) + copy template (T004)**: the transform-driven aurora + shimmer contract for Phase 8 (oversized blurred radial layers on staggered 9-11s loops, `mix-blend-mode: screen`, a signature-gradient shimmer bar, progress coupling, reduced-motion static-glow fallback) built only on existing `tokens.css` tokens; and the plain-language copy template for Phase 2 (sentence 1 = "{Publisher}'s {model} is a {size/kind} {modality} model from {country}", sentence 2 = plain "best at", jargon relocated to `differentiators`) with a real before/after worked from `gemma-4-12b-it-gguf`.
- **[test_brand_tokens.py](../../../../../scripts/installer/tests/test_brand_tokens.py)**: +6 regression tests (scale descent + 14px floor, named-token match, weight ordering, palette fallback, every-catalog-family->color coverage against the real catalog, unknown-family fallback).

## Verification

- `python -c "import nexus_installer.constants"` clean.
- Programmatic self-consistency: `TYPE_SCALE` strictly descending, floored at 14; all 17 catalog families -> 11 publishers -> valid 7-char hex, unknown family -> Community slate; aurora-spec tokens all present in `tokens.css`/`globals.css` (grep), `--aurora-violet` correctly not yet defined.
- Installer suite: **657 passed / 2 skipped / 0 failed** (+6 from the 651 baseline).
- ruff check + format clean on the two changed files.
- No TS/desktop code touched.

## Notes / carryovers

- `UIR.P1.A` (P1): the working tree's manual inline-size/header/height/icon edits from the planning session are the plan's assumed baseline, **not** Phase 1 -- Phase 3 (typography) replaces the inline sizes with scale-classes, Phase 4 owns the header/stepper, Phase 5 owns the icon staging.
- `UIR.P1.B` (P3): neutral tabs (Phase 6, T022) and the optional `--aurora-violet` token (Phase 8, T029) are decided but not built here.
- See [known-gaps.md](../../known-gaps.md) Section 4.
