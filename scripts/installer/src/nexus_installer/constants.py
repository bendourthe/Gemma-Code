"""Design tokens: colors, dimensions, fonts, and layout constants.

v1.8.0 Phase 5: the palette is a direct port of the Nexus desktop app's
design tokens (`desktop/src/styles/tokens.css`) so the installer and the
product it installs read as one family. This module is the single palette
source for the wizard; pages and widgets must not hardcode hex values.
"""

from __future__ import annotations

import sys

# ---------------------------------------------------------------------------
# Background surfaces (tokens.css --bg-0 / --bg-1 / --bg-2 / --bg-elevated)
# ---------------------------------------------------------------------------
BG_WINDOW = "#0a0d14"
BG_HEADER = "#11151f"
BG_CARD = "#181d2a"
BG_INPUT = "#11151f"
BG_ELEVATED = "#20263a"

# ---------------------------------------------------------------------------
# Borders. tokens.css uses white-alpha borders (rgba 6% / 12%); QSS + QColor
# consumers need solid colors, so these are the alpha values composited on
# --bg-0.
# ---------------------------------------------------------------------------
BORDER = "#191c22"
BORDER_STRONG = "#272a30"

# ---------------------------------------------------------------------------
# Accents. The lead accent is the desktop's chatbot cyan (--accent-chatbot);
# the per-module accents drive the catalog section styling.
# ---------------------------------------------------------------------------
ACCENT = "#22d3ee"
ACCENT_BRIGHT = "#67e8f9"
ACCENT_DIM = "#0891b2"
ACCENT_FOCUS = "#22d3ee88"

ACCENT_CHAT = "#22d3ee"  # --accent-chatbot
ACCENT_CODING = "#ec4899"  # --accent-coding
ACCENT_IMAGE = "#f97316"  # --accent-image
ACCENT_VIDEO = "#22c55e"  # --accent-video

# Two-tone header wordmark (v1.9.0 T015), matching the interactive guide's
# "Nexus AI Studio" treatment: bright near-white "Nexus" + muted slate-teal
# " AI Studio".
WORDMARK_PRIMARY = "#eaf6f8"  # "Nexus" (weight 700)
WORDMARK_SECONDARY = "#6f8990"  # " AI Studio" (weight 600)

# Catalog section key -> accent. Audio has no dedicated module accent in the
# desktop tokens yet; the info blue stands in until one exists.
SECTION_ACCENTS: dict[str, str] = {
    "chat": ACCENT_CHAT,
    "agentic": ACCENT_CODING,
    "image": ACCENT_IMAGE,
    "video": ACCENT_VIDEO,
    "audio": "#38bdf8",
}

# ---------------------------------------------------------------------------
# Provider (publisher) palette (v1.9.0 T002).
#
# The Models page colors each model by its PUBLISHER, not by the tab it appears
# under, so a model listed in both Chat and Agentic shows one consistent color
# (DoD #7). The catalog has no `publisher` field (its `origin` is a country), so
# the publisher -- and thus the color -- is derived from the existing `family`
# field via FAMILY_TO_PUBLISHER + PROVIDER_COLORS. Tabs render neutral so the
# provider color is the only card color signal. Hues stay distinguishable on the
# dark theme, brand-adjacent where a publisher has a known brand color; unknown
# / community publishers fall back to a neutral slate.
# See docs/v1/v1.9/ui-rework-design.md.
# ---------------------------------------------------------------------------
PROVIDER_FALLBACK = "#94a3b8"  # slate -- community / unknown publisher

PROVIDER_COLORS: dict[str, str] = {
    "Google": "#22d3ee",  # cyan
    "Meta": "#60a5fa",  # blue
    "Alibaba": "#a78bfa",  # violet
    "DeepSeek": "#818cf8",  # indigo
    "NVIDIA": "#a3e635",  # lime
    "Stability AI": "#f472b6",  # pink
    "Black Forest Labs": "#fbbf24",  # amber
    "Lightricks": "#fb923c",  # orange
    "OpenAI": "#34d399",  # emerald
    "Nomic AI": "#2dd4bf",  # teal
    "Liquid AI": "#38bdf8",  # sky
    "Community": PROVIDER_FALLBACK,  # slate (fallback)
}

# Catalog `family` -> publisher. Every family currently present in
# core/registry/catalog.json maps here; an unseen family resolves to
# "Community" (the neutral fallback) via publisher_for_family().
FAMILY_TO_PUBLISHER: dict[str, str] = {
    "gemma4": "Google",
    "llama": "Meta",
    "musicgen": "Meta",
    "qwen": "Alibaba",
    "wan": "Alibaba",
    "deepseek": "DeepSeek",
    "nomic": "Nomic AI",
    "sdxl": "Stability AI",
    "sd1": "Stability AI",
    "svd": "Stability AI",
    "stable-audio": "Stability AI",
    "flux": "Black Forest Labs",
    "sana": "NVIDIA",
    "ltx": "Lightricks",
    "whisper": "OpenAI",
    "kokoro": "Community",
    "piper": "Community",
    "lfm2.5": "Liquid AI",
}


def publisher_for_family(family: str) -> str:
    """Resolve a catalog `family` to its publisher name (fallback: Community)."""
    return FAMILY_TO_PUBLISHER.get(family, "Community")


def provider_color(family: str) -> str:
    """Resolve a catalog `family` to its provider (publisher) color.

    Keyed to the publisher so a model shows one color across every tab it
    appears in. Unknown families / publishers fall back to the neutral slate.
    """
    return PROVIDER_COLORS.get(publisher_for_family(family), PROVIDER_FALLBACK)


# ---------------------------------------------------------------------------
# Text colors (tokens.css --fg-0 / --fg-1 / --fg-muted / --fg-disabled)
# ---------------------------------------------------------------------------
TEXT_PRIMARY = "#f5f7fb"
TEXT_BODY = "#d6dbe7"
TEXT_SECONDARY = "#8a92a6"
TEXT_MUTED = "#5a6075"

# ---------------------------------------------------------------------------
# Semantic colors (tokens.css --status-ok / --status-err / --status-warn /
# --status-info)
# ---------------------------------------------------------------------------
SUCCESS = "#22c55e"
ERROR = "#ef4444"
WARNING = "#f59e0b"
INFO = "#38bdf8"

# ---------------------------------------------------------------------------
# Glow layer (v1.9.0 T202). Port of the guide's cyan/blue glow, signature
# gradient, and radial-glow background (guides/interactive-guide/
# nexus-ai-guide.html), mirroring tokens.css so the installer and the app
# share one look. Consumed by the constellation background + floating-glow
# logo primitives (T203). See docs/v1/v1.9/design-tokens.md.
# ---------------------------------------------------------------------------
# Deepest gradient stop for the radial-glow body treatment (--bg-deep).
BG_DEEP = "#010608"

# Constellation node/link colors (--glow-cyan / --glow-cyan-node).
CONSTELLATION_LINK = "#38bdf8"
CONSTELLATION_NODE = "#7dd3fc"

# Floating-mark glow. QGraphicsDropShadowEffect takes a QColor + blur radius;
# the base color is the guide's rgba(56,189,248,*) cyan. GLOW_RGBA is the
# (r, g, b, a) tuple at the hero mark's .5 alpha (128/255).
GLOW_RGBA = (56, 189, 248, 128)
GLOW_BLUR_SMALL = 8
GLOW_BLUR_MEDIUM = 16
GLOW_BLUR_LARGE = 24

# Signature accent gradient stops (position, color) for QLinearGradient.
SIGNATURE_GRADIENT_STOPS: list[tuple[float, str]] = [
    (0.0, "#3b82f6"),
    (0.5, "#38bdf8"),
    (1.0, "#22d3ee"),
]

# Radial-glow background pools: (color rgba, alpha 0-1) painted over BG_WINDOW.
# The PyQt ConstellationBackground / installer body use these to reproduce the
# guide's two cyan/blue radial pools.
RADIAL_GLOW_POOLS: list[tuple[tuple[int, int, int], float]] = [
    ((59, 130, 246), 0.12),
    ((56, 189, 248), 0.12),
]

# ---------------------------------------------------------------------------
# Platform-aware font families
# ---------------------------------------------------------------------------
if sys.platform == "darwin":
    FONT_PRIMARY = "SF Pro Display"
    FONT_MONO = "SF Mono"
elif sys.platform == "win32":
    FONT_PRIMARY = "Segoe UI"
    FONT_MONO = "Consolas"
else:
    FONT_PRIMARY = "Cantarell"
    FONT_MONO = "Ubuntu Mono"

# ---------------------------------------------------------------------------
# Type scale (v1.9.0 T001).
#
# One coherent, strictly-descending pixel scale with a logical hierarchy
# (Display > H1 > H2 > H3 > Body > Caption) and a hard 14px floor. It retires
# the ~90 ad-hoc inline `font-size` strings and the 8pt/11pt lows scattered
# across the pages/widgets (Phase 3 wires these into scale-classes in theme.py
# and every page/widget label). The QSS base stays 15px. FS_BODY_STRONG shares
# FS_BODY's size -- emphasis comes from FW_SEMIBOLD, not a larger size. Sizes
# are px ints; QSS consumers format as f"{FS_H1}px".
# See docs/v1/v1.9/ui-rework-design.md.
# ---------------------------------------------------------------------------
FS_DISPLAY = 34  # page hero / welcome title
FS_H1 = 28  # page titles
FS_H2 = 20  # section heads
FS_H3 = 17  # sub-heads / card titles
FS_BODY = 16  # paragraph / descriptions
FS_BODY_STRONG = 16  # emphasized body (pair with FW_SEMIBOLD)
FS_CAPTION = 14  # pills, meta, step labels -- hard floor

# Ordered largest -> smallest (FS_BODY_STRONG omitted: it equals FS_BODY). The
# Phase 1 verification asserts this is strictly descending and floored at 14.
TYPE_SCALE: tuple[int, ...] = (
    FS_DISPLAY,
    FS_H1,
    FS_H2,
    FS_H3,
    FS_BODY,
    FS_CAPTION,
)

# Font weights (QFont weights / QSS font-weight values).
FW_REGULAR = 400
FW_MEDIUM = 500
FW_SEMIBOLD = 600
FW_BOLD = 700

# ---------------------------------------------------------------------------
# Layout dimensions (pixels)
# ---------------------------------------------------------------------------
# v1.9.0 Phase 3 (T301): the custom frameless title bar replaces the native OS
# chrome, so its height is a first-class layout dimension.
TITLE_BAR_HEIGHT = 44
# v2.x: enlarged ~3x (was 74) to seat the bigger brand mark + wordmark so the
# header reads as the product banner (see widgets/header.py HEADER_* sizes).
HEADER_HEIGHT = 160
# v1.9.0 Phase 4 (T017): raised from 88 so the enlarged (>=14px) step labels sit
# clearly below the dots with no overlap, at min and default window widths.
STEP_BAR_HEIGHT = 112
FOOTER_HEIGHT = 62

SIDE_MARGIN = 32
VERTICAL_MARGIN = 28

# v1.11.0 Phase 6 (T601): the mockup moves brand + navigation into a fixed-width
# left sidebar. The brand block (Header) sits at the top, the section nav in the
# middle, and the "Need help?" block at the bottom.
SIDEBAR_WIDTH = 244
SIDEBAR_NAV_ROW_HEIGHT = 40

BUTTON_HEIGHT = 38
BUTTON_RADIUS = 7

# Approximate free space the base install needs BEFORE any model downloads
# (Ollama runtime + the Python/torch venvs + the desktop app + the VS Code
# extension). The Welcome disk check uses this as its floor; the per-selection
# requirement (base + the chosen models) is enforced on the Models picker
# footer, which knows the actual selection. v1.13.0 Phase 4.
BASE_INSTALL_GB = 15

WINDOW_DEFAULT_WIDTH = 912
WINDOW_DEFAULT_HEIGHT = 768
WINDOW_MIN_WIDTH = 840
WINDOW_MIN_HEIGHT = 672

# ---------------------------------------------------------------------------
# External links
# ---------------------------------------------------------------------------
# v1.11.0 Phase 6 (T601): the sidebar "Need help?" block links here. The
# installer never opens a browser as part of the install flow (self-sufficiency
# goal); this is a user-initiated help affordance only.
DOCS_URL = "https://github.com/bendourthe/Nexus-AI"

# ---------------------------------------------------------------------------
# Step names
# ---------------------------------------------------------------------------
STEP_NAMES: list[str] = [
    "Welcome",
    "Prerequisites",
    "GPU Detection",
    "Install Path",
    "Models",
    "Configuration",
    "Review",
    "Installing",
    "Complete",
]
