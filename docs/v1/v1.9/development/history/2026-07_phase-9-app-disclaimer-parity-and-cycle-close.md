# v1.9.0 installer + app UI rework -- Phase 9 FINAL: app chat disclaimer + logo/icon parity + end-to-end QA

**Date**: 2026-07-09
**Plan**: [installer-and-app-ui-rework.md](../../plans/installer-and-app-ui-rework.md) Phase 9 (T033-T036) -- the plan's final phase
**Branch**: `feat/v1.9.0-installer-phase-1`
**Model**: claude-opus-4-8 (plan recommended workhorse/sonnet medium; ran on the current stronger model)

## Goal

Add the accuracy disclaimer under the composer, confirm the app does not reproduce the installer's icon/logo issues, and verify the app DoD. Closes the `installer-and-app-ui-rework` cycle (all 9 phases).

## What changed

- **T033 -- chat disclaimer** ([ChatInput.tsx](../../../../desktop/src/shared/chat/ChatInput.tsx)): a subtle, centered, caption-size disclaimer -- "Nexus runs locally and can make mistakes. Verify important information." -- under the shared composer, so it appears under both the chat and coding composers (coding wraps `ChatInput`).
- **T034 -- icon parity** ([generate-icons.py](../../../../scripts/desktop/generate-icons.py)): `desktop/src-tauri/icons/window-icon.png` (the Tauri runtime window icon via `lib.rs include_bytes!`, and the `FloatingLogo` default source) is now emitted from the transparent source by the generator (256x256, verified) rather than hand-committed -- so a rebrand no longer leaves it stale. No binary churn (the edit makes it regenerable on the next run).
- **T035 -- logo-lag parity**: confirmed the Dashboard `FloatingLogo` bob (`nexus-float`) animates `transform: translateY` only (GPU-compositable, reduced-motion-gated) -- it does not reproduce the installer's retired Qt `QPropertyAnimation` lag, so no swap to a static mark is needed.
- **T036 -- app QA**: consolidated the app on-device visual checks (disclaimer, both aurora animations, taskbar/window icon, Dashboard logo) into `UIR.P9.A`.

## Verification

- Desktop suite **521 passed / 0 failed** (+1: disclaimer renders under the composer with the accuracy copy). `tsc --noEmit` + eslint clean.
- `generate-icons.py` verified to emit `window-icon.png` (256x256 RGBA) from the source.

## Whole-cycle close

All 9 phases code-complete + green (installer 672 / desktop 521 / `tsc`/eslint/ruff clean; frozen exe re-builds + boots). Open work: operator on-device visual QA (`UIR.P7.A` installer DoD 1-8, `UIR.P8.A`/`UIR.P9.A` app DoD 9-11) and the merge-to-`main` release (version + CHANGELOG + tag are semantic-release-owned, cut on merge). See [known-gaps.md](../../known-gaps.md) Section 5.
