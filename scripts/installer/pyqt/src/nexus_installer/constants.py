"""Design tokens: colors, dimensions, fonts, and layout constants."""

from __future__ import annotations

import sys

# ---------------------------------------------------------------------------
# Background colors
# ---------------------------------------------------------------------------
BG_WINDOW = "#0f1318"
BG_HEADER = "#161c24"
BG_CARD = "#1c2433"
BG_INPUT = "#111820"

# ---------------------------------------------------------------------------
# Border and accent
# ---------------------------------------------------------------------------
BORDER = "#1e2d3d"
ACCENT = "#0ABFBF"
ACCENT_DIM = "#0a8f8f"
ACCENT_FOCUS = "#0ABFBF88"

# ---------------------------------------------------------------------------
# Text colors
# ---------------------------------------------------------------------------
TEXT_PRIMARY = "#e8edf2"
TEXT_SECONDARY = "#6b7f96"
TEXT_MUTED = "#3d5066"

# ---------------------------------------------------------------------------
# Semantic colors
# ---------------------------------------------------------------------------
SUCCESS = "#22c55e"
ERROR = "#ef4444"
WARNING = "#f59e0b"

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
