# Session History - v1.14.0 Phase 4: Installing-page polish

**Date**: 2026-07-19
**Plan**: [../../plans/installer-catalog-curation-and-reliability.md](../../plans/installer-catalog-curation-and-reliability.md)
**Phase**: 4 of 5 - "Installing-page polish: uniform dependency rows, button margins, footer Cancel"
**Outcome**: Complete. GO/NO-GO gate passed (0 test failures, 0 lint errors; footer 98% / phase_group 94% / window 84% covered; `installing.py` 79% with the phase delta covered; no TS changed so build unaffected).

## Goal

Fix the three installing-page defects from the v2.3.0 test screenshots: dependency-bar dead space, the View Logs button touching the section outline, and the stray grayed Cancel button lingering after completion.

## What was done

### 4.1 - Uniform dependency rows (`phase_group.py`)

- `_ProgressRow.add_to_grid` gained a `bar_spans_metric` flag; step rows (Dependencies) have no size/speed metric, so their bar now spans the metric column (columns 1-2) instead of leaving a ~200px empty gap before the status. Per-model rows keep the bar in column 1 with the metric in column 2 (unchanged).

### 4.2 - View Logs button inset (`phase_group.py`)

- The View Logs toggle is wrapped in an HBox with left + bottom margins so its edges do not touch the section (PhaseGroup) outline.

### 4.3 - Footer Cancel (`footer.py`, `window.py`, `installing.py`)

- Added a Cancel button + `cancel_clicked` signal + `set_cancel_visible` to the `Footer`; it is hidden by default.
- `window._refresh_footer` shows Cancel only while the install is active-and-not-finished and hides it otherwise (removed on completion). `window._on_footer_cancel` routes the click to the installing page's `request_cancel`.
- Removed the page-level Cancel button from `InstallingPage`; renamed `_on_cancel` to the public `request_cancel` (confirm-then-cancel) the footer targets. `cancel_install` (used by the background controller + the close-during-install path) is unchanged apart from dropping the removed button reference. Removed the now-unused `SecondaryButton` / `QHBoxLayout` imports.

### 4.4 - Tests

- `TestFooter`: cancel hidden by default, toggles with `set_cancel_visible`, emits `cancel_clicked`.
- `TestPhase4Layout`: dependency-row bar spans the metric column; per-model bar does not; View Logs button row has left + bottom margins.
- `test_phase6_shell`: footer Cancel hidden before install, shown during, removed on finish.
- `test_pages_qt`: `request_cancel` confirms (mocked Yes) then aborts the engine and emits `finished(False)`.

## Test results

- Full installer pytest: green (0 failures).
- Coverage: footer 98%, phase_group 94%, window 84%; `installing.py` 79% (the phase's changed lines are covered; the remainder is pre-existing untested `start_installation` + model-telemetry handlers).

## Deviations

- None.

## Known gaps

`docs/v1/v1.14/known-gaps.md`: ICR.P4.A (on-device visual QA of the installing-page polish).

## Next

Phase 5 (final) - Architecture refactor + known-gaps reconciliation + CI/CD, then hand off to `/update release`.
