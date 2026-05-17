# Nexus v1.0.0 - Design Tokens

> Source of truth: `desktop/src/styles/tokens.css`. Update both files together when revising the palette.

The Nexus desktop shell uses a strict, dark-only design system in v1.0.0. Light theme is explicitly out-of-scope per `docs/v1.0.0/plans/v1.0.0-cycle.md` "Items explicitly NOT in scope for v1.0.0". Every token below is exposed as a CSS custom property on `:root` and consumed via Tailwind v4 (`@theme inline`) in later phases.

## 1. Surfaces (dark base)

| Token | Hex | Use |
|---|---|---|
| `--bg-0` | `#0a0d14` | App backdrop, behind the sidebar and main viewport. |
| `--bg-1` | `#11151f` | Sidebar, dashboard cards. |
| `--bg-2` | `#181d2a` | Hovered rows, sub-section panels. |
| `--bg-elevated` | `#20263a` | Floating dropdowns, popovers, the `Local Model Status` widget. |

## 2. Foreground

| Token | Hex | Use |
|---|---|---|
| `--fg-0` | `#f5f7fb` | Primary text, headings. |
| `--fg-1` | `#d6dbe7` | Body text. |
| `--fg-muted` | `#8a92a6` | Secondary labels, meta info, timestamps. |
| `--fg-disabled` | `#5a6075` | Disabled controls. |

## 3. Borders

| Token | Value | Use |
|---|---|---|
| `--border-subtle` | `rgba(255,255,255,0.06)` | Card borders, dividers. |
| `--border-strong` | `rgba(255,255,255,0.12)` | Input borders, focus rings. |

## 4. Module accents

Each pillar owns one accent color. The active sidebar entry, the matching dashboard card border, and any module-internal highlight (button, progress bar) consume these tokens.

| Pillar | Token | Hex | Soft variant |
|---|---|---|---|
| Local Chatbot | `--accent-chatbot` | `#22d3ee` (cyan-400) | `--accent-chatbot-soft` |
| Agentic AI Coding | `--accent-coding` | `#ec4899` (pink-500) | `--accent-coding-soft` |
| Image Studio | `--accent-image` | `#f97316` (orange-500) | `--accent-image-soft` |
| Video Lab | `--accent-video` | `#22c55e` (green-500) | `--accent-video-soft` |

Soft variants are the same hue at 16% opacity for hover-fill / accent-tint use cases. Never blend two accent colors in the same card.

## 5. Semantic colors

| Token | Hex | Use |
|---|---|---|
| `--status-ok` | `#22c55e` | Healthy GPU, completed job. |
| `--status-warn` | `#f59e0b` | VRAM > 80%, slow telemetry tick. |
| `--status-err` | `#ef4444` | Crashed job, dropped IPC. |
| `--status-info` | `#38bdf8` | Informational banner. |

## 6. Typography

| Token | Value |
|---|---|
| `--font-sans` | `"Inter", "Segoe UI", system-ui, -apple-system, sans-serif` |
| `--font-mono` | `"JetBrains Mono", "SF Mono", Consolas, monospace` |
| `--text-xs` | `0.75rem` (12 px) |
| `--text-sm` | `0.875rem` (14 px) |
| `--text-base` | `1rem` (16 px) |
| `--text-md` | `1.125rem` (18 px) |
| `--text-lg` | `1.25rem` (20 px) |
| `--text-xl` | `1.5rem` (24 px) |
| `--text-2xl` | `2rem` (32 px) |

Body copy is `--text-sm` on dashboard cards and `--text-base` in modules. Headings step up in `--text-md` / `--text-lg` / `--text-xl` / `--text-2xl`. Code-rendered text uses `--font-mono` exclusively.

## 7. Spacing (4 px base)

| Token | Value |
|---|---|
| `--space-1` | `0.25rem` (4 px) |
| `--space-2` | `0.5rem` (8 px) |
| `--space-3` | `0.75rem` (12 px) |
| `--space-4` | `1rem` (16 px) |
| `--space-5` | `1.5rem` (24 px) |
| `--space-6` | `2rem` (32 px) |
| `--space-7` | `2.5rem` (40 px) |
| `--space-8` | `3rem` (48 px) |
| `--space-9` | `4rem` (64 px) |
| `--space-10` | `5rem` (80 px) |

## 8. Radius

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | `4px` | Buttons, small badges. |
| `--radius-md` | `8px` | Inputs, list items. |
| `--radius-lg` | `12px` | Cards. |
| `--radius-xl` | `20px` | The sparkle / help FAB. |

## 9. Shadows

| Token | Value | Use |
|---|---|---|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.35)` | Default card. |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.45)` | Hovered card, popover. |
| `--shadow-lg` | `0 12px 32px rgba(0,0,0,0.55)` | Modal. |

## 10. Inspection

Open the dev build and navigate to `/_styleguide`. The page renders every token visually for review.

## 11. Change log

| Version | Note |
|---|---|
| v1.0.0 Phase 1 | Initial codification of the 4-module accent palette + dark-base tokens. |
