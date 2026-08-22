"""Tests for the dark-title-bar helper + app-wide filter (v2.x)."""

from __future__ import annotations

from PyQt5.QtCore import QEvent
from PyQt5.QtWidgets import QWidget

from nexus_installer.widgets.win_titlebar import (
    DarkTitleBarFilter,
    apply_dark_titlebar,
    apply_windows_taskbar_identity,
    build_window_icon,
)


class TestDarkTitleBar:
    def test_apply_does_not_crash(self, qt_app: object) -> None:
        # No-op off Windows; must never raise on any OS.
        apply_dark_titlebar(QWidget())

    def test_taskbar_identity_does_not_crash(self, qt_app: object) -> None:
        apply_windows_taskbar_identity(QWidget())

    def test_build_window_icon_from_repo_assets(self, qt_app: object) -> None:
        icon = build_window_icon()
        assert icon is not None
        assert not icon.isNull()

    def test_filter_passes_show_event_through(self, qt_app: object) -> None:
        f = DarkTitleBarFilter()
        result = f.eventFilter(QWidget(), QEvent(QEvent.Type.Show))
        assert result is False

    def test_filter_tolerates_none(self, qt_app: object) -> None:
        f = DarkTitleBarFilter()
        assert f.eventFilter(None, None) is False
