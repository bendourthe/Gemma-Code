"""Tests for theme generation and constants completeness."""

from __future__ import annotations

from nexus_installer import constants
from nexus_installer.theme import generate_stylesheet


class TestGenerateStylesheet:
    def test_returns_nonempty_string(self) -> None:
        sheet = generate_stylesheet()
        assert isinstance(sheet, str)
        assert len(sheet) > 100

    def test_contains_key_selectors(self) -> None:
        sheet = generate_stylesheet()
        for selector in [
            "QPushButton#primaryButton",
            "QPushButton#secondaryButton",
            "QLineEdit",
            "QTextEdit",
            "QProgressBar",
            "QProgressBar::chunk",
            "QLabel",
            "QScrollBar",
            "QCheckBox",
            "QFrame#calloutBox",
            "QFrame#card",
            "QTabWidget::pane",
            "QTabBar::tab",
        ]:
            assert selector in sheet, f"Missing selector: {selector}"

    def test_contains_color_values(self) -> None:
        sheet = generate_stylesheet()
        assert constants.BG_WINDOW in sheet
        assert constants.ACCENT in sheet
        assert constants.TEXT_PRIMARY in sheet


class TestConstants:
    def test_required_colors_exist(self) -> None:
        required = [
            "BG_WINDOW",
            "BG_HEADER",
            "BG_CARD",
            "BG_INPUT",
            "BG_ELEVATED",
            "BORDER",
            "BORDER_STRONG",
            "ACCENT",
            "ACCENT_BRIGHT",
            "ACCENT_DIM",
            "ACCENT_FOCUS",
            "ACCENT_CHAT",
            "ACCENT_CODING",
            "ACCENT_IMAGE",
            "ACCENT_VIDEO",
            "TEXT_PRIMARY",
            "TEXT_BODY",
            "TEXT_SECONDARY",
            "TEXT_MUTED",
            "SUCCESS",
            "ERROR",
            "WARNING",
            "INFO",
        ]
        for name in required:
            assert hasattr(constants, name), f"Missing constant: {name}"
            value = getattr(constants, name)
            assert isinstance(value, str)
            assert value.startswith("#")

    def test_palette_matches_desktop_tokens(self) -> None:
        """v1.8.0 Phase 5 -- the installer palette is the desktop token port."""
        assert constants.BG_WINDOW == "#0a0d14"  # --bg-0
        assert constants.BG_HEADER == "#11151f"  # --bg-1
        assert constants.BG_CARD == "#181d2a"  # --bg-2
        assert constants.TEXT_PRIMARY == "#f5f7fb"  # --fg-0
        assert constants.TEXT_BODY == "#d6dbe7"  # --fg-1
        assert constants.ACCENT_CHAT == "#22d3ee"  # --accent-chatbot
        assert constants.ACCENT_CODING == "#ec4899"  # --accent-coding
        assert constants.ACCENT_IMAGE == "#f97316"  # --accent-image
        assert constants.ACCENT_VIDEO == "#22c55e"  # --accent-video

    def test_section_accents_cover_all_catalog_tabs(self) -> None:
        assert set(constants.SECTION_ACCENTS) == {
            "chat",
            "agentic",
            "image",
            "video",
            "audio",
        }
        for value in constants.SECTION_ACCENTS.values():
            assert value.startswith("#")

    def test_required_dimensions_exist(self) -> None:
        required = [
            "HEADER_HEIGHT",
            "STEP_BAR_HEIGHT",
            "FOOTER_HEIGHT",
            "SIDE_MARGIN",
            "VERTICAL_MARGIN",
            "BUTTON_HEIGHT",
            "BUTTON_RADIUS",
            "WINDOW_DEFAULT_WIDTH",
            "WINDOW_DEFAULT_HEIGHT",
            "WINDOW_MIN_WIDTH",
            "WINDOW_MIN_HEIGHT",
        ]
        for name in required:
            assert hasattr(constants, name), f"Missing dimension: {name}"
            value = getattr(constants, name)
            assert isinstance(value, int)
            assert value > 0

    def test_font_families_are_strings(self) -> None:
        assert isinstance(constants.FONT_PRIMARY, str)
        assert isinstance(constants.FONT_MONO, str)
        assert len(constants.FONT_PRIMARY) > 0
        assert len(constants.FONT_MONO) > 0

    def test_step_names_count(self) -> None:
        assert len(constants.STEP_NAMES) == 9
        assert constants.STEP_NAMES[0] == "Welcome"
        assert constants.STEP_NAMES[-1] == "Complete"
