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
# Layout dimensions (pixels)
# ---------------------------------------------------------------------------
HEADER_HEIGHT = 64
STEP_BAR_HEIGHT = 88
FOOTER_HEIGHT = 56

SIDE_MARGIN = 32
VERTICAL_MARGIN = 28

BUTTON_HEIGHT = 38
BUTTON_RADIUS = 7

WINDOW_DEFAULT_WIDTH = 912
WINDOW_DEFAULT_HEIGHT = 768
WINDOW_MIN_WIDTH = 840
WINDOW_MIN_HEIGHT = 672

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
