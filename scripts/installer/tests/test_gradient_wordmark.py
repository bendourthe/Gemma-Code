"""Tests for the gradient wordmark widget (v1.13.0 Phase 3)."""

from __future__ import annotations

from PyQt5.QtCore import Qt

from nexus_installer.constants import FS_DISPLAY
from nexus_installer.widgets.gradient_wordmark import GradientWordmark
from nexus_installer.widgets.header import HEADER_WORDMARK_PX


class TestGradientWordmark:
    def test_full_text_joins_runs(self, qt_app: object) -> None:
        w = GradientWordmark("Nexus", " AI Studio", HEADER_WORDMARK_PX)
        assert w.full_text() == "Nexus AI Studio"

    def test_base_px_exposed(self, qt_app: object) -> None:
        w = GradientWordmark("Nexus", " AI Studio", HEADER_WORDMARK_PX)
        assert w.base_px == HEADER_WORDMARK_PX

    def test_fitted_px_uses_base_when_wide(self, qt_app: object) -> None:
        w = GradientWordmark("Nexus", " AI Studio", HEADER_WORDMARK_PX)
        assert w.fitted_px(10_000) == HEADER_WORDMARK_PX

    def test_fitted_px_shrinks_when_narrow(self, qt_app: object) -> None:
        # The truncation root cause: the full wordmark exceeds the fixed
        # sidebar column, so the font must shrink rather than clip.
        w = GradientWordmark("Nexus", " AI Studio", HEADER_WORDMARK_PX)
        narrow = w.fitted_px(60)
        assert narrow < HEADER_WORDMARK_PX
        assert narrow >= 14

    def test_fitted_px_never_below_min(self, qt_app: object) -> None:
        w = GradientWordmark("Nexus", " AI Studio", HEADER_WORDMARK_PX, min_px=16)
        assert w.fitted_px(1) == 16

    def test_size_hint_positive(self, qt_app: object) -> None:
        hint = GradientWordmark("Nexus", " AI Studio", HEADER_WORDMARK_PX).sizeHint()
        assert hint.width() > 0
        assert hint.height() > 0

    def test_render_left_aligned_does_not_crash(self, qt_app: object) -> None:
        w = GradientWordmark(
            "Welcome to Nexus",
            " AI Studio",
            FS_DISPLAY,
            align=Qt.AlignmentFlag.AlignLeft,
        )
        w.resize(600, 48)
        assert w.grab().width() > 0

    def test_render_narrow_centered_does_not_crash(self, qt_app: object) -> None:
        # A fixed narrow sidebar column: must paint the full wordmark, shrunk.
        w = GradientWordmark(
            "Nexus",
            " AI Studio",
            HEADER_WORDMARK_PX,
            align=Qt.AlignmentFlag.AlignHCenter,
        )
        w.resize(120, 40)
        assert w.grab().width() > 0


class TestHeaderUsesGradientWordmark:
    def test_header_builds_with_full_wordmark(self, qt_app: object) -> None:
        from nexus_installer.widgets.header import Header

        header = Header()
        assert isinstance(header._title, GradientWordmark)
        assert header._title.full_text() == "Nexus AI Studio"
        header.resize(244, 160)
        assert header.grab().width() > 0
