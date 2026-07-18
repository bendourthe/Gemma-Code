# Session History - v1.13.0 Phase 4: Welcome disk-check + Models tab-walk + VRAM sort/disable

**Date**: 2026-07-17
**Plan**: [../../plans/installer-reliability-and-ux.md](../../plans/installer-reliability-and-ux.md) - Phase 4
**Branch**: `feat/v1.13.0-installer-reliability`

## Subtasks

- **4.1 - Disk-check fix + dynamic requirement.** `pages/welcome.py`: `_QuickCheckWorker` now probes an existing anchor via `_existing_anchor` (the install dir, e.g. `C:\Program Files\NexusAI`, does not exist yet, so `shutil.disk_usage` raised `FileNotFoundError` and the check wrongly reported 0 GB -> amber even with 484 GB free). The flat `10.0` threshold is replaced by `BASE_INSTALL_GB` (15, new constant) + `state.selected_models_gb`; the label reads "At least 15 GB free for the base install (model downloads need more)". The precise per-selection check still lives on the picker footer.
- **4.2 - Models-page tab-walk Next.** New `TypedCatalogPage.try_advance_tab()` advances the `QTabWidget` one tab right and returns whether it consumed the click; `window.py._go_next` calls it first on the Models page, so Next walks Chat -> Agentic -> Image -> Video -> Audio and only leaves for Configuration from the last tab (then the existing `validate()` gate runs).
- **4.3 - VRAM-ascending sort + over-budget disable.** `_sorted_section_models` now sorts every tab by `(_is_over_budget, required_vram_gb, display_name)` -- lightest first, over-budget last (replacing the old Gemma-first agentic ordering). A card whose model needs more VRAM than the detected GPU (`not card.fits`) is marked `over_budget`, rendered with a dashed muted border + muted size label, and its checkbox is disabled in `_update_selection_state`; the requirement note ("Requires N GB VRAM (you have M)") stays readable.

## Tests

`test_pages_qt.py`: `TestWelcomeDiskCheck` (anchor walks up to an existing dir; the worker reports sufficient for 484 GB free against a non-existent install path). `test_typed_catalog.py`: tab-walk (advances through every tab then returns False on the last), over-budget disable (`gemma4:26b` @ 18 GB on an 8 GB GPU is `over_budget` + disabled), and two rewritten ordering tests now assert VRAM-ascending. Full installer suite green; ruff clean (also wrapped a pre-existing over-length docstring surfaced by linting `typed_catalog.py`).

## Deviations

- The old agentic "Gemma-first" ordering was replaced by uniform VRAM-ascending per the user's explicit request; the two tests asserting it were updated.
- `BASE_INSTALL_GB = 15` is an estimate (IR.P4.A) - the precise disk check is the picker footer's job.

## CI/CD

No new CI: the installer pytest job already covers these files.

## Next steps

Phase 5: the Installing-page mockup redesign (uniform bars, iconed tiles, status glyphs, auto-expand/collapse, pill buttons + log panel). Gaps in [../../known-gaps.md](../../known-gaps.md).
