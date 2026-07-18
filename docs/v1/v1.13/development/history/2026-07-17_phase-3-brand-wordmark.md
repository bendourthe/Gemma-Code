# Session History - v1.13.0 Phase 3: Brand wordmark (gradient "AI Studio" + truncation fix)

**Date**: 2026-07-17
**Plan**: [../../plans/installer-reliability-and-ux.md](../../plans/installer-reliability-and-ux.md) - Phase 3
**Branch**: `feat/v1.13.0-installer-reliability`

## Goal

Render "Nexus AI Studio" in full (no clipped "o") with the brand blue-cyan gradient on "AI Studio" (matching `assets/nexus-ai-banner.png`) in the installer sidebar + welcome hero AND in the desktop app.

## Subtasks

- **3.1 - Installer gradient wordmark + truncation fix.** New reusable `widgets/gradient_wordmark.py` `GradientWordmark(QWidget)`: paints a solid `primary` run + an accent run filled with a `QLinearGradient` built from `SIGNATURE_GRADIENT_STOPS` (via `QPainter` + `QPen(QBrush(gradient))`). It auto-fits the font down to `min_px` so the full wordmark never clips the fixed 244px sidebar, and painting sidesteps the global QSS `font-size` rule that overrode the old `setFont` label. Wired into `header.py` (center-aligned "Nexus" + " AI Studio") and the `welcome.py` hero (left-aligned "Welcome to Nexus" + " AI Studio").
- **3.2 - Desktop app gradient wordmark.** `Sidebar.tsx` wordmark split so "Nexus " is solid (`var(--fg-0)`) and only "AI Studio" carries `.nexus-gradient-text`. The gradient token `--grad-signature` (tokens.css) is `linear-gradient(100deg, #3b82f6, #38bdf8, #22d3ee)` - already identical to the installer `SIGNATURE_GRADIENT_STOPS` and the banner, so no gradient-value change was needed. Dashboard's `h1` gradient (a page title, not the wordmark) was left as-is.

## Tests

- Installer: `tests/test_gradient_wordmark.py` (full-text join, base/fitted px, auto-shrink for a narrow column + min_px floor, sizeHint, offscreen `.grab()` at wide + narrow widths, Header builds with the wordmark). Updated `test_pages_qt.py` (hero is now a `GradientWordmark`, not a `QLabel`) and `test_phase6_shell.py` (wordmark size carried by custom paint, not QSS - a stronger regression guard). Full installer suite green; ruff clean.
- Desktop: `Sidebar.test.tsx` gains a test that `.nexus-gradient-text` wraps "AI Studio" and not "Nexus"; existing brand-lockup test still passes (space-joined text content unchanged). `tsc --noEmit` clean.

## Deviations

- Kept `header.wordmark_px` property (still returns `HEADER_WORDMARK_PX`) for callers/tests.
- Did not change `--grad-signature` (already matches the banner) or Dashboard's page-title gradient (out of scope).

## CI/CD

No new CI: the desktop `shell-build.yml` already runs vitest + tsc; the installer pytest job already covers the new widget tests.

## Next steps

Phase 4: Welcome disk-check fix + Models-page tab-walk Next + VRAM-ascending sort with over-budget disable. On-device visual confirmation of the wordmark is IR.P3.A (cosmetic, deferred to an on-device QA pass). Gaps in [../../known-gaps.md](../../known-gaps.md).
