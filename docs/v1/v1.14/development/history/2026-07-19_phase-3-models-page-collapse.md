# Session History - v1.14.0 Phase 3: Models-page collapse, sort, disable, release-date pill

**Date**: 2026-07-19
**Plan**: [../../plans/installer-catalog-curation-and-reliability.md](../../plans/installer-catalog-curation-and-reliability.md)
**Phase**: 3 of 5 - "Models-page collapse, sort, disable, and release-date pill"
**Outcome**: Complete. GO/NO-GO gate passed (0 test failures, 0 lint errors, `typed_catalog.py` 97% covered, no TS changed so build unaffected).

## Goal

Fix the "too many models / unclear which to pick" clutter: show one best-fitting model per family, recommended first, incompatible tiers grayed at the bottom, and the release date as a pill.

## What was done (all in `pages/typed_catalog.py`)

### 3.1 - VRAM-aware best-of-family collapse

- Rewrote `_sorted_section_models` (supersedes the v1.13 flat VRAM-ascending sort): group the section's models by `family`; for each family, if any variant fits the GPU, show one best-fit -- the family's tier default when it fits, else the highest-VRAM fitting variant -- hide the other fitting variants, and add every over-budget variant to a grayed group; a family with no fitting variant contributes its smallest variant, grayed. Preferring the tier default keeps the recommended pick pre-selected.

### 3.2 - Sort + divider + disabled styling

- Ordering: enabled best-fits first (recommended before the rest via `id in defaults`, then most-capable first), then the grayed over-budget rows.
- `_build_tab` inserts a "Needs more VRAM than this GPU" divider before the first over-budget card.
- `_ModelCard` computes compatibility up front and dims the title + description (not just the size) when the model does not fit, alongside the existing dashed border and "Requires N GB VRAM (you have M)" note.

### 3.3 - Release-date pill

- Removed the inline `released <date>` suffix from the card title; added a compact "Released YYYY-MM" pill to the fact-pill row.

### 3.4 - Tests

- Updated 3 v1.13 tests that assumed the flat VRAM-ascending order / that `gemma4:e4b` renders in both tabs, to the collapse model (`test_agentic_collapse_fitting_before_over_budget`, `test_agentic_tab_collapses_to_best_fit_per_family`, and the provider-color test now checks the 24 GB best-fit `gemma4:31b`).
- Added `TestPhase3Collapse`: release-pill-not-in-title, low-VRAM collapse to the small tier, no-fit family shows one smallest, divider rendered when over budget.

## Test results

- Full installer pytest: green (0 failures).
- Coverage: `typed_catalog.py` 97%.

## Deviations

- None.

## Known gaps

`docs/v1/v1.14/known-gaps.md`: ICR.P3.A (on-device picker QA), ICR.P3.B (no in-installer show-all-variants toggle -- deliberate per the "best fit + bigger disabled" choice; the desktop model manager installs any catalog model post-install).

## Next

Phase 4 - Installing-page polish: uniform dependency-row grid (remove the right-side dead space), View Logs button margins, and the footer Cancel that disappears on completion.
