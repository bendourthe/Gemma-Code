# v1.9.0 installer + app UI rework -- Phase 8: app generation animation (aurora in Image Studio + Video Lab)

**Date**: 2026-07-09
**Plan**: [installer-and-app-ui-rework.md](../../plans/installer-and-app-ui-rework.md) Phase 8 (T029-T032)
**Branch**: `feat/v1.9.0-installer-phase-1` (operator kept the app phases on the same branch)
**Model**: claude-opus-4-8 (plan recommended workhorse/sonnet high; ran on the current stronger model for the React/CSS component + integration)

## Goal

Build a reusable on-brand aurora "generating" component and mount it in the Image Studio + Video Lab preview boxes while a job runs, replacing the bare placeholder text. First phase of the app PR (`desktop/`).

## What changed

- **T029 -- `GenerationCanvas`** ([components/GenerationCanvas.tsx](../../../../desktop/src/components/GenerationCanvas.tsx)): a rounded, overflow-hidden box with three oversized (`inset: -35%`) blurred (`blur(26px)`) radial-gradient layers drifting via `transform` on staggered 9/10/11s ease-in-out loops (`mix-blend-mode: screen`, `will-change: transform`) + a sweeping shimmer bar. Keyframes/classes in [globals.css](../../../../desktop/src/styles/globals.css) on existing glow tokens + a new scoped `--aurora-violet`; a per-pillar tint recolors the third layer. All motion gated behind `@media (prefers-reduced-motion: reduce)` (soft static cyan glow fallback).
- **T030 -- progress coupling**: an optional live latent preview is overlaid and fades in with `progress` (opacity 0.35 -> 1.0) so the result "materializes"; `children` overlay arbitrary content.
- **T031 -- Image Studio**: the txt2img preview shows the aurora (tint `image`) while generating, overlaying the live latent; idle shows a calm placeholder; the final output lands in the gallery.
- **T032 -- Video Lab**: the aurora (tint `video`) backs the per-second thumbnail strip while generating (the strip is extracted to a `thumbnailStrip` const rendered in every state -- plain card when idle / after a run); the completed clip hands off to the `TimelinePreviewer`.

## Verification

- Desktop suite **520 passed / 0 failed** (+5 `GenerationCanvas` tests). `tsc --noEmit` + eslint clean.
- The two `VideoLabPage` tests that asserted the always-present strip were reconciled (the strip renders in every state; the aurora only wraps it during generation).

## Carryovers

- `UIR.P8.A` (P1): the actual aurora render / drift / shimmer / materializing preview / reduced-motion static-glow fallback / perf need a running app (`tauri dev`) -> operator rehearsal, folded into the Phase 9 app end-to-end QA.
- See [known-gaps.md](../../known-gaps.md) Section 4.
