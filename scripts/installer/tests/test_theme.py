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

    def test_type_scale_classes_use_tokens(self) -> None:
        """v1.9.0 T008: the scale object-name classes drive the hierarchy."""
        sheet = generate_stylesheet()
        assert "QLabel#pageTitle" in sheet
        assert "QLabel#sectionHead" in sheet
        # Sizes come from the Phase-1 tokens and are fully interpolated (a
        # leaked "{FS_...}" / "{FW_...}" would mean a missed f-string prefix).
        assert f"font-size: {constants.FS_H1}px" in sheet  # pageTitle
        assert f"font-size: {constants.FS_H2}px" in sheet  # sectionHead
        assert f"font-size: {constants.FS_CAPTION}px" in sheet  # secondary/caption
        assert "{FS_" not in sheet
        assert "{FW_" not in sheet

    def test_global_qwidget_does_not_paint_bg_window(self) -> None:
        """v2.3.1 Phase 3: only the main window uses BG_WINDOW as a fill."""
        sheet = generate_stylesheet()
        assert "QMainWindow, QWidget" not in sheet
        main_block = _qss_block(sheet, "QMainWindow")
        assert f"background-color: {constants.BG_WINDOW}" in main_block
        widget_block = _qss_block(sheet, "QWidget")
        assert constants.BG_WINDOW not in widget_block
        assert "background: transparent" in widget_block

    def test_card_header_and_details_are_transparent(self) -> None:
        sheet = generate_stylesheet()
        header = _qss_block(sheet, "QWidget#cardHeaderRow")
        assert "background: transparent" in header
        assert constants.BG_WINDOW not in header
        details = _qss_block(sheet, "QWidget#phaseGroupDetails")
        assert "background: transparent" in details
        assert constants.BG_WINDOW not in details
        nested = _qss_block(sheet, "QWidget#modelCard QWidget")
        assert "background: transparent" in nested
        assert constants.BG_WINDOW not in nested

    def test_log_and_disabled_controls_keep_tokens(self) -> None:
        sheet = generate_stylesheet()
        text_edit = _qss_block(sheet, "QTextEdit")
        assert f"background-color: {constants.BG_INPUT}" in text_edit
        disabled = _qss_block(sheet, "QCheckBox::indicator:disabled")
        assert f"background-color: {constants.BG_INPUT}" in disabled
        assert "border-color:" in disabled


def _qss_block(sheet: str, selector: str) -> str:
    """Return the first `{...}` body whose rule starts with `selector`."""
    needle = f"{selector} {{"
    idx = sheet.find(needle)
    if idx < 0:
        raise AssertionError(f"Missing selector {selector!r}")
    start = sheet.find("{", idx)
    end = sheet.find("}", start)
    return sheet[start : end + 1]


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
        assert len(constants.STEP_NAMES) == 10
        assert constants.STEP_NAMES[0] == "Welcome"
        assert constants.STEP_NAMES[-1] == "Complete"
