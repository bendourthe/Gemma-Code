"""Tests for theme generation and constants completeness."""

from __future__ import annotations

from gemma_installer import constants
from gemma_installer.theme import generate_stylesheet


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
            "BORDER",
            "ACCENT",
            "ACCENT_DIM",
            "ACCENT_FOCUS",
            "TEXT_PRIMARY",
            "TEXT_SECONDARY",
            "TEXT_MUTED",
            "SUCCESS",
            "ERROR",
            "WARNING",
        ]
        for name in required:
            assert hasattr(constants, name), f"Missing constant: {name}"
            value = getattr(constants, name)
            assert isinstance(value, str)
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
