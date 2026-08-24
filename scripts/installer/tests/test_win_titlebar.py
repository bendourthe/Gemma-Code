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


def _write_png(path, rgba: tuple[int, int, int, int]) -> None:
    from PyQt5.QtGui import QColor, QImage

    img = QImage(4, 4, QImage.Format_ARGB32)
    img.fill(QColor(*rgba))
    assert img.save(str(path))


class TestTaskbarTile:
    """v2.2.3 Phase 7 (7.2): transparent ARGB canvas + PNG preference order."""

    def test_prefers_no_background_mark_over_icon_png(
        self, qt_app: object, tmp_path, monkeypatch
    ) -> None:
        from nexus_installer.widgets import win_titlebar

        _write_png(tmp_path / "icon.png", (255, 0, 0, 255))
        _write_png(tmp_path / "nexus-ai-primary_no-background.png", (0, 255, 0, 255))
        monkeypatch.setattr(win_titlebar, "asset_file", lambda name: tmp_path / name)
        tile = win_titlebar._render_taskbar_tile(32)
        assert tile is not None
        center = tile.pixelColor(16, 16)
        assert (center.red(), center.green()) == (0, 255)

    def test_canvas_is_alpha_zero_not_navy(
        self, qt_app: object, tmp_path, monkeypatch
    ) -> None:
        # A fully transparent source must yield a fully transparent tile:
        # the old navy _TASKBAR_TILE_BG fill is gone.
        from nexus_installer.widgets import win_titlebar

        _write_png(tmp_path / "nexus-ai-primary_no-background.png", (0, 0, 0, 0))
        monkeypatch.setattr(win_titlebar, "asset_file", lambda name: tmp_path / name)
        tile = win_titlebar._render_taskbar_tile(32)
        assert tile is not None
        assert tile.pixelColor(0, 0).alpha() == 0
        assert tile.pixelColor(16, 16).alpha() == 0

    def test_falls_back_to_icon_png_on_alpha_canvas(
        self, qt_app: object, tmp_path, monkeypatch
    ) -> None:
        from nexus_installer.widgets import win_titlebar

        _write_png(tmp_path / "icon.png", (255, 0, 0, 255))
        monkeypatch.setattr(win_titlebar, "asset_file", lambda name: tmp_path / name)
        tile = win_titlebar._render_taskbar_tile(32)
        assert tile is not None
        assert tile.pixelColor(16, 16).red() == 255
