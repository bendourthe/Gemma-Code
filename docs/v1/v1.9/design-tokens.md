# Nexus v1.9.0 - Design Tokens (glow layer)

> Sources of truth: `desktop/src/styles/tokens.css` (app) and `scripts/installer/pyqt/src/nexus_installer/constants.py` (installer). Update both files together when revising the palette. This doc records the **glow layer** added in v1.9.0 Phase 2 (T202); the base dark palette + module accents are unchanged from [v1.0.0 design-tokens](../v1.0/design-tokens.md) and re-summarized here for convenience.

The v1.9.0 overhaul brings the installer and the desktop app to visual parity with the north-star reference, [guides/interactive-guide/nexus-ai-guide.html](../../../guides/interactive-guide/nexus-ai-guide.html): a dark near-black theme, an animated cyan/blue constellation background, a floating glowing Nexus mark, and cyan-blue glow accents. The tokens below are ported verbatim from that guide so both stacks read as one product.

## 1. Base palette (unchanged, for reference)

| Token (CSS) | Constant (py) | Value | Use |
|---|---|---|---|
| `--bg-0` | `BG_WINDOW` | `#0a0d14` | App/installer backdrop. |
| `--bg-1` | `BG_HEADER` | `#11151f` | Header band, cards, mid gradient stop. |
| `--bg-2` | `BG_CARD` | `#181d2a` | Model cards, hovered rows. |
| `--bg-elevated` | `BG_ELEVATED` | `#20263a` | Popovers, floating docks. |
| `--fg-0` | `TEXT_PRIMARY` | `#f5f7fb` | Headings, primary text. |
| `--fg-1` | `TEXT_BODY` | `#d6dbe7` | Body text. |
| `--fg-muted` | `TEXT_SECONDARY` | `#8a92a6` | Meta, labels. |
| `--accent-chatbot` | `ACCENT` / `ACCENT_CHAT` | `#22d3ee` | Lead accent (cyan). |
| `--accent-coding` | `ACCENT_CODING` | `#ec4899` | Agentic pillar. |
| `--accent-image` | `ACCENT_IMAGE` | `#f97316` | Image pillar. |
| `--accent-video` | `ACCENT_VIDEO` | `#22c55e` | Video pillar. |

## 2. Glow layer (new in v1.9.0)

### 2.1 Radial-glow background

The guide's body treatment: two cyan/blue radial pools over a dark vertical gradient. Mount behind content (installer wizard body, app shell) at ~0.55 opacity so text/cards stay readable.

| Token (CSS) | Constant (py) | Value |
|---|---|---|
| `--bg-deep` | `BG_DEEP` | `#010608` (deepest gradient stop) |
| `--bg-radial-glow` | `RADIAL_GLOW_POOLS` | two `radial-gradient` pools (`rgba(59,130,246,.12)` at `80% -10%`, `rgba(56,189,248,.12)` at `-10% 0%`) over `linear-gradient(180deg, --bg-0 0%, --bg-1 65%, --bg-deep 100%)` |

The Python `RADIAL_GLOW_POOLS` is `[( (59,130,246), 0.12 ), ( (56,189,248), 0.12 )]` -- the PyQt background paints these as radial `QRadialGradient` pools over `BG_WINDOW`.

### 2.2 Signature gradient

| Token (CSS) | Constant (py) | Value |
|---|---|---|
| `--grad-signature` | `SIGNATURE_GRADIENT_STOPS` | `linear-gradient(100deg, #3b82f6 0%, #38bdf8 50%, #22d3ee 100%)` |
| `--grad-signature-soft` | -- | `linear-gradient(100deg, rgba(59,130,246,.16), rgba(56,189,248,.16))` |

`SIGNATURE_GRADIENT_STOPS = [(0.0, "#3b82f6"), (0.5, "#38bdf8"), (1.0, "#22d3ee")]` feeds a PyQt `QLinearGradient`.

### 2.3 Floating-mark glow (drop shadow)

| Token (CSS) | Constant (py) | Value | Use |
|---|---|---|---|
| `--glow-sm` | `GLOW_BLUR_SMALL` = 8 | `0 0 8px rgba(56,189,248,.45)` | Small header mark. |
| `--glow-md` | `GLOW_BLUR_MEDIUM` = 16 | `0 0 16px rgba(56,189,248,.45)` | Mid mark. |
| `--glow-lg` | `GLOW_BLUR_LARGE` = 24 | `0 0 24px rgba(56,189,248,.5)` | Hero mark. |
| -- | `GLOW_RGBA` | -- | `(56,189,248,128)` base glow color for `QGraphicsDropShadowEffect`. |

### 2.4 Constellation colors

| Token (CSS) | Constant (py) | Value | Use |
|---|---|---|---|
| `--glow-cyan` | `CONSTELLATION_LINK` | `#38bdf8` | Link (line) color. |
| `--glow-cyan-node` | `CONSTELLATION_NODE` | `#7dd3fc` | Node (dot) color. |

## 3. Constellation spec (T203 primitive)

Both the PyQt `ConstellationBackground(QWidget)` and the React `<ConstellationBackground/>` implement the guide's canvas routine identically:

- **Node count**: `max(18, min(46, floor(width / 34)))` -- ~40 nodes at a typical window width, hard-capped at 46 for perf.
- **Nodes**: filled circles, radius `1.5 * dpr`, color `--glow-cyan-node` (`#7dd3fc`), drawn at global alpha `0.85`.
- **Links**: drawn between node pairs closer than `maxd = 150 * dpr`, color `--glow-cyan` (`#38bdf8`), width `0.6 * dpr`, alpha `(1 - d / maxd) * 0.45` (fades with distance).
- **Motion**: each node drifts at `(rand - 0.5) * 0.16 * dpr` px/frame and bounces off the edges; ~60fps.
- **DPR cap**: device pixel ratio clamped to `2` (the guide's cap) to bound fill cost on hi-DPI displays.
- **Reduced motion**: when the platform requests reduced motion, render a single static frame and never start the animation loop.
- **Pause when hidden**: stop the animation timer / `requestAnimationFrame` loop when the widget/canvas is hidden or the window is minimized, and resume on show.

## 4. Floating-glow logo spec (T203 primitive)

- Fed the **transparent** mark (`assets/nexus-ai-primary_no-background.png` / `desktop/src-tauri/icons/window-icon.png`), never an opaque icon.
- **Glow**: a cyan drop shadow -- CSS `filter: drop-shadow(--glow-lg)` (React) / `QGraphicsDropShadowEffect` blur `GLOW_BLUR_LARGE` (24), color `GLOW_RGBA`, zero offset (PyQt).
- **Float**: vertical bob of +/-9px over 7s on an ease-in-out (`InOutSine`) loop -- CSS `@keyframes nexus-float` (React) / `QPropertyAnimation` on a float-offset property (PyQt).
- **Reduced motion**: no bob; the mark rests at its baseline with the glow intact.

## 5. Typography

| Role | App (CSS) | Installer (py) |
|---|---|---|
| Sans | `--font-sans`: `"Inter", "Segoe UI", system-ui, ...` | `FONT_PRIMARY`: `Segoe UI` (win) / `SF Pro Display` (mac) / `Cantarell` (linux) |
| Mono | `--font-mono`: `"JetBrains Mono", "SF Mono", Consolas, ...` | `FONT_MONO`: `Consolas` (win) / `SF Mono` (mac) / `Ubuntu Mono` (linux) |

Inter + JetBrains Mono are bundled into the frozen installer in Phase 3 (T306) for typography parity; until then the platform fallbacks above apply.
