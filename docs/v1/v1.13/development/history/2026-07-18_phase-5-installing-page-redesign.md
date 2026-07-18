# Session History - v1.13.0 Phase 5: Installing-page mockup redesign

**Date**: 2026-07-18
**Plan**: [../../plans/installer-reliability-and-ux.md](../../plans/installer-reliability-and-ux.md) - Phase 5
**Branch**: `feat/v1.13.0-installer-reliability`

## Goal

Bring the Installing page to the supplied mockup: uniform-width per-model progress bars, iconed section tiles, auto-expanding/collapsing details for the running section, and a modern pill button system (View Logs / View Details + log Copy / Save).

## Subtasks

- **5.1 - Uniform-width bars.** The ragged per-model bars came from `_ProgressRow` being a self-contained `QHBoxLayout` whose `detail` label sized to content, so each bar took a different leftover. Refactored `_ProgressRow` to expose its four cells (name / bar / detail / status) and place them (`add_to_grid`) into a SHARED `QGridLayout` (`_make_row_grid`) per group, with the bar column stretched and the name / metrics / status columns fixed. Every row's bar now shares one stretched column -> identical widths. Both the per-step rows (Dependencies) and the per-model rows (Models) use the shared grid.
- **5.2 - Auto-expand/collapse.** `_apply_state` now expands the details on `STATE_ACTIVE`, collapses them on `STATE_DONE`, and (as before) keeps them expanded on `STATE_FAILED` -- so the running section is always the one in focus and finished sections tuck away.
- **5.3 - Design system.** Each section header gained a per-section icon in a rounded tile (`PhaseGroup(icon=...)`, glyphs passed from the installing page's `PHASE_GROUPS`); the run status + its glyph moved to the right-hand status label. `_toggle_style` (View Logs / View Details) and `_icon_button` (log Copy / Save) were restyled to a modern pill (radius 12, subtle fill, hover / pressed / checked states) -- the user's explicit ask to modernize the copy/download buttons to match View Logs. The Install (filled-gradient) / Cancel (outlined) buttons already matched the mockup's rounded style (`theme.py`), so they were left unchanged.

## Tests

`test_phase_group.py` gains `TestAutoExpandCollapse` (active -> expand, done -> collapse, failed -> stay) and `TestSectionIconAndGrid` (icon tile text; model rows share one stretching grid). All existing phase-group + page tests still pass unchanged (they assert `.status`/`.detail`/`_title`/state, none of which the refactor changed). Full installer suite green; ruff clean.

## Deviations

- Section icons are cross-platform font glyphs (gear / `</>` / diamond / rectangle), not the mockup's exact logos; the active "spinner" is a static filled circle; the "Need help?" circular icon was not added (IR.P5.A - pure polish).
- Install/Cancel unchanged: `theme.py`'s primary (gradient) / secondary (outlined) already match the mockup.

## CI/CD

No new CI: the installer pytest job already covers `phase_group.py` + `installing.py`.

## Next steps

Phase 6 (terminal): architecture refactor + known-gaps reconciliation + CI/CD, then the release-readiness handoff to `/update release`. Gaps in [../../known-gaps.md](../../known-gaps.md).
