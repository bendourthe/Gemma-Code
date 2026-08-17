# Nexus v1.17.0 - Motion design tokens

> Source of truth: `desktop/src/styles/tokens.css`. Additive on the v1.9.0 glow layer ([v1.9 design tokens](../v1.9/design-tokens.md)). No new palettes. State-accent aliases point at the locked `--accent-*` and `--grad-signature` tokens.

Phase 1 of the [ui-motion-identity plan](plans/v1.17.0-adoption-ui-motion-identity.md) lands the shared motion vocabulary that later phases consume (orbs, beam, metal).

## 1. Durations and easings

| Token | Value | Use |
|---|---|---|
| `--motion-duration-fast` | `150ms` | Micro-interactions (hover, recede snap under reduced-motion). |
| `--motion-duration-base` | `280ms` | Default interaction and ambient recede opacity transition. |
| `--motion-duration-slow` | `500ms` | Deliberate emphasis. |
| `--motion-ease-standard` | `cubic-bezier(0.22, 1, 0.36, 1)` | Default ease-out. |
| `--motion-ease-emphasized` | `cubic-bezier(0.16, 1, 0.3, 1)` | Stronger deceleration. |
| `--motion-ease-in-out` | `cubic-bezier(0.45, 0, 0.55, 1)` | Symmetric loops. |

Existing character animations (constellation drift, `nexus-float` 7s, aurora 9-11s) keep their authored durations. This scale is for interaction motion, not ambient loops.

## 2. State-accent aliases

| Token | Resolves to |
|---|---|
| `--motion-accent-coding` | `var(--accent-coding)` |
| `--motion-accent-chatbot` | `var(--accent-chatbot)` |
| `--motion-accent-image` | `var(--accent-image)` |
| `--motion-accent-video` | `var(--accent-video)` |
| `--motion-accent-signature` | `var(--grad-signature)` |

## 3. Recede opacities

When a surface registers an active orb / beam / metal effect, the ambient layer steps back. Opacity only; no layout shift.

| Token | Value | Use |
|---|---|---|
| `--motion-recede-opacity` | `0.18` | Constellation canvas while receded. |
| `--motion-recede-backdrop` | `0.4` | `.nexus-app-backdrop` radial-glow while receded. |

## 4. Tailwind `@theme inline` bridge

The same file maps durations, easings, and accent aliases under `@theme inline` (`--duration-motion-*`, `--ease-motion-*`, `--color-motion-*`) so a future Tailwind v4 pipeline can emit utilities without a second palette. Until that pipeline lands, the shell consumes the `:root` custom properties directly (see known-gaps DF-1).

## 5. Reduced motion

One `@media (prefers-reduced-motion: reduce)` block in `desktop/src/styles/globals.css` halts CSS animations (floating logo, aurora, surface beam, metal canvas overlay). JS-driven loops (constellation, agent-state orbs, metal WebGL) read `useReducedMotion` from `desktop/src/motion/`. Outcome is unchanged: motion fully pauses, it is not merely slowed.

## 6. Agent-state mapping (Phase 2)

Surfaces pass an `AgentActivity`; `desktop/src/components/agentState/mapping.ts` returns the state, locked accent token, and hex fallback (Canvas cannot rely on jsdom `getComputedStyle`). Accents are aliases of the v1.0 palette only.

| Activity | State | Accent |
|---|---|---|
| `idle` | idle | `--fg-muted` |
| `coding-tool-use` / `model-loading` / `model-inference` | working | `--accent-coding` |
| `coding-solving` | solving | `--accent-coding` |
| `memory-retrieval` | searching | `--accent-coding` |
| `web-search` / `document-parse` | searching | `--accent-chatbot` |
| `chat-streaming` | composing | `--accent-chatbot` |
| `asr-capture` | listening | `--accent-chatbot` |
| `image-generation` | shaping | `--accent-image` |
| `video-generation` | shaping | `--accent-video` |

Hero size is 64px; inline size is 20px. Device-pixel-ratio is capped at 2.

## 7. Surface-liveness beam (Phase 3)

`AccentBeam` paints a 1px conic accent on a surface's border box. Color is a locked `--accent-*` token. `--nexus-beam-angle` is a CSS `@property` so the traveling mode can animate the gradient origin. Strength is opacity (`--nexus-beam-strength`). Radius comes from `--radius-*`. Play/pause is opacity only (no layout shift). Reduced-motion replaces the animation with a static accent border.

## 8. Hero-action metal (Phase 4)

`MetalAccent` paints a liquid-metal ring on hero controls only (coding Send, chat Send, Image/Video Generate, Coding New session). Tint is a locked `--accent-*` token (linear RGB fallbacks in `metalGl.ts`). Strength is a shader alpha. A shared registry caps simultaneously animating WebGL instances at 3. Offscreen pause uses IntersectionObserver (missing IO is treated as visible). Reduced-motion and missing WebGL both use a static accent edge (`.nexus-metal-fallback`); they never throw. Recede-when-active registers only while the GPU loop is actually running.
