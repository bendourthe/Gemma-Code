# v1.9.0 installer + app UI rework -- Phase 7: whole-app copy/readability pass + end-to-end QA

**Date**: 2026-07-09
**Plan**: [installer-and-app-ui-rework.md](../../plans/installer-and-app-ui-rework.md) Phase 7 (T026-T028)
**Branch**: `feat/v1.9.0-installer-phase-1` (installer PR line -- this closes it)
**Model**: claude-opus-4-8, medium effort (matches the plan's Phase 7 recommendation)

## Goal

A final copy/readability sweep across the active installer pages, a consistency pass, and a build-and-walk verification against the DoD. Closes the installer PR (Phases 1-7).

## What changed

- **T026 -- plain-language copy** (the operator-flagged jargon):
  - GPU-page model-tier labels: "Dense 31B" / "26B MoE" / "E4B (4.5B)" / "E2B (2.3B)" -> "Top quality" / "Balanced" / "Recommended" / "Lightweight" (the param size still shows in the model name).
  - `install_path` "What gets installed where" callout: dropped the `code --install-extension` command, "venv", and "platform package manager" for plain wording; kept the "Nexus models" line.
  - `configuration` feature toggles: "chain-of-thought reasoning" -> "show the model's step-by-step reasoning"; "cross-session recall" -> "remember context across sessions".
  - Reviewed prerequisites / review / installing / complete -- already plain; the complete-page "Managing Nexus" command rows are power-user commands, left intact.
- **T027 -- consistency pass**: grep gate confirms 0 literal `font-size` in the active pages/widgets (all sizes from the Phase-1 `FS_*` scale); callouts, phase groups, footers, and status dots use the scale + semantic/provider colors.
- **T028 -- build + QA consolidation**: re-built the frozen installer; consolidated the deferred per-phase on-device visual checks (`UIR.P3.A`/`P4.A`/`P5.A`/`P6.A`) into a single installer visual-QA rehearsal `UIR.P7.A` (walk the 9 steps, verify DoD 1-8), which needs a GUI this headless sandbox cannot provide.

## Verification

- Installer suite **672 passed / 2 skipped / 0 failed**; one gpu-tier test that pinned the old label substring (`"31B" in label`) was decoupled to assert the model name (the size is in the name).
- Grep gate: 0 literal font-sizes in active files. ruff clean on changed lines (3 pre-existing E501s -- a PowerShell command string + two test mock lines -- left per scope discipline).
- Frozen build: Phases 6-7 are pure-Python (no new imports / assets / spec change), so the onefile re-packages the same bundle Phase 5 proved boots + resolves `_MEIPASS` + carries `icon.ico`; all modules import + all pages construct (the green suite).

## Carryovers

- `UIR.P7.A` (P1): the installer on-device walk-through (DoD 1-8) -- consolidates P3.A/P4.A/P5.A/P6.A -- is an operator rehearsal on a real desktop. Checklist in [known-gaps.md](../../known-gaps.md) Section 4.
- Installer PR (Phases 1-7) is code-complete and green. Phases 8-9 (the app PR) are next, on a separate branch.
