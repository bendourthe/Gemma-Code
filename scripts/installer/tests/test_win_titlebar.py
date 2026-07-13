"""Tests for the dark-title-bar helper + app-wide filter (v2.x)."""

from __future__ import annotations

from PyQt5.QtCore import QEvent
from PyQt5.QtWidgets import QWidget

from nexus_installer.widgets.win_titlebar import (
    DarkTitleBarFilter,
    apply_dark_titlebar,
)


class TestDarkTitleBar:
    def test_apply_does_not_crash(self, qt_app: object) -> None:
        # No-op off Windows; must never raise on any OS.
        apply_dark_titlebar(QWidget())

    def test_filter_passes_show_event_through(self, qt_app: object) -> None:
        f = DarkTitleBarFilter()
        result = f.eventFilter(QWidget(), QEvent(QEvent.Type.Show))
        assert result is False

    def test_filter_tolerates_none(self, qt_app: object) -> None:
        f = DarkTitleBarFilter()
        assert f.eventFilter(None, None) is False
