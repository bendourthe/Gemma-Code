# v1.9.0 installer + app UI rework -- Phase 3: installer typography + hierarchy sweep

**Date**: 2026-07-07
**Plan**: [installer-and-app-ui-rework.md](../../plans/installer-and-app-ui-rework.md) Phase 3 (T008-T011)
**Branch**: `feat/v1.9.0-installer-phase-1` (installer PR line)
**Model**: claude-opus-4-8 (plan recommended workhorse/sonnet for this mechanical phase; ran on the current stronger model, no downshift -- no quality risk)

## Goal

Replace the ~90 ad-hoc inline `font-size` strings across the active installer pages/widgets with the Phase-1 scale tokens, giving every page a coherent hierarchy (Display > H1 > H2 > H3 > Body > Caption) with a hard 14px floor.

## What changed

- **T008 (theme.py)**: added `QLabel#pageTitle` (FS_H1/bold) + `QLabel#sectionHead` (FS_H2/semibold) object-name classes wired to the Phase-1 tokens; wired `secondaryLabel`/`mutedLabel` to `FS_CAPTION`; converted the base/control QSS sizes to tokens (15px -> FS_BODY, errorLabel 14px -> FS_CAPTION, log mono 11pt -> FS_CAPTION).
- **T009/T010 (sweep)**: all 9 active pages + 4 widgets (header, footer, phase_group, callout_box) consume the scale. Page titles -> `pageTitle` (Welcome hero -> `FS_DISPLAY`); section heads -> `sectionHead` (config x4, complete x2). Everything else -> inline `FS_*` tokens, colors preserved. One-offs: 19px GPU name -> FS_H2, 18px accents -> FS_H3, 13px dots/pills -> FS_CAPTION, 11pt/12pt mono -> px tokens. Applied via a reviewed script (objectName conversions + f-string token injection + import merge) plus an f-string line-wrapper; CRLF preserved.
- **T011 (heights)**: genericized the stale hardcoded heights in the header / step_indicator / footer docstrings and the 3 window.py comments (they disagreed with the current `HEADER_HEIGHT=74` / `STEP_BAR_HEIGHT=96` / `FOOTER_HEIGHT=62`); dropped the window error label's redundant inline font-size (the `QLabel#errorLabel` class owns it).

## Verification

- Grep gate: 0 literal `font-size: <digit>` in active files.
- QSS interpolation: pageTitle 28 / sectionHead 20 / body 16 / caption 14; no leaked `{FS_...}`/`{FW_...}`.
- Installer suite: **658 passed / 2 skipped / 0 failed** (+1 T008 guard in `test_theme.py`; no test pinned old style strings).
- Offscreen full-wizard composition smoke green; pageTitle/sectionHead object-name wiring asserted.
- ruff clean on changed lines (2 pre-existing E501s on untouched lines left per scope discipline).

## Scope + carryovers

- Out of scope (not swept): the unwired `storage.py` / `vscode_extension.py`, the unused `disk_aware_footer.py`, and the `step_indicator` label font (Phase 4 T017). Header two-tone wordmark + stepper legibility are Phase 4.
- `UIR.P1.A` resolved: the planning-session inline-size bumps on the active pages are superseded by the scale tokens.
- `UIR.P3.A` (P1): per-page visual hierarchy eyeball deferred to the Phase 7 frozen-build QA (no GUI here).
- `UIR.P3.B` (P3): a stray `ruff format` also touched 4 out-of-scope baseline files (main.py + the 3 unwired/unused); left unstaged, absorbed in their owning phases.
- See [known-gaps.md](../../known-gaps.md) Section 4.
