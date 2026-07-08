# v1.9.0 installer + app UI rework -- Phase 4: logo de-lag + two-tone wordmark + stepper legibility

**Date**: 2026-07-07
**Plan**: [installer-and-app-ui-rework.md](../../plans/installer-and-app-ui-rework.md) Phase 4 (T012-T017)
**Branch**: `feat/v1.9.0-installer-phase-1` (installer PR line)
**Model**: claude-opus-4-8 (plan recommended workhorse/sonnet high; ran on the current stronger model -- custom-paint geometry benefits, no downshift)

## Goal

Kill the laggy floating logo, match the interactive guide's two-tone wordmark, and make the step indicator readable and non-overlapping.

## What changed

- **T012 + T014 -- de-lag**: retired the animated `FloatingLogo` entirely (deleted `widgets/float_logo.py` + `tests/test_float_logo.py`); added [StaticLogo](../../../../../scripts/installer/src/nexus_installer/widgets/static_logo.py) -- a still `QLabel` with the transparent mark + cyan glow and no `QPropertyAnimation`. Header uses `StaticLogo(size=40)`. `widgets/__init__.py` swaps the export; `test_pages_qt` hero assertion -> `test_hero_has_no_logo`.
- **T013 -- Welcome hero**: removed the logo lockup beside the title (operator decision); the FS_DISPLAY title is added directly.
- **T015 -- two-tone wordmark**: header title = guide treatment via rich-text spans ("Nexus" `#eaf6f8`/700 + " AI Studio" `#6f8990`/600) + a `QFont` carrying size (FS_H2) and letter-spacing. New `WORDMARK_PRIMARY`/`WORDMARK_SECONDARY` constants.
- **T016 -- step counter**: "Step X of Y" caption -> `FS_BODY` (16).
- **T017 -- stepper**: label font 8pt -> 14px (`FS_CAPTION`); `LABEL_GAP = 14` (>= dot radius, clears the glow halo); `LABEL_Y_OFFSET` 22 -> 36 (two wrapped lines); `STEP_BAR_HEIGHT` 96 -> 112; `drawText` gains `TextWordWrap`.

## Verification

- Installer suite: **656 passed / 2 skipped / 0 failed** (-7 float-logo, +5 static-logo, reworked Welcome test).
- `grep`: no `QPropertyAnimation`/bob in the installer source.
- Offscreen smoke: header carries a `StaticLogo` (no animation API) + two-tone wordmark (plain "Nexus AI Studio", both hex tones present) + 16px counter; window builds with `STEP_BAR_HEIGHT=112`; stepper geometry clears the dots and fits the band at min (840) + default (912) widths.
- ruff clean on changed files.

## Carryovers

- `UIR.P4.A` (P1): real per-label horizontal fit at min width + wordmark render are **not** verifiable headless (the offscreen platform resolves no font -> meaningless metrics). Deferred to the Phase 7 frozen-build visual QA (DoD 2 + 5).
- The `nexus-installer.spec` staging comment still names `FloatingLogo`; the asset it stages is now used by `StaticLogo` (same path). Cosmetic; fixed in Phase 5 (spec owner).
- See [known-gaps.md](../../known-gaps.md) Section 4.
