"""Tests for the FloatingLogo primitive (T204)."""

from __future__ import annotations

from nexus_installer.widgets.float_logo import FLOAT_AMPLITUDE, FloatingLogo


class TestFloatingLogo:
    def test_default_logo_loads(self, qt_app: object) -> None:
        logo = FloatingLogo(reduced_motion=False)
        # The transparent brand mark ships in the repo, so it resolves.
        assert logo.has_pixmap is True

    def test_missing_path_does_not_crash(self, qt_app: object) -> None:
        logo = FloatingLogo("does/not/exist.png", reduced_motion=False)
        assert logo.has_pixmap is False

    def test_start_stop_toggles_animation(self, qt_app: object) -> None:
        logo = FloatingLogo(reduced_motion=False)
        assert logo.is_animating() is False
        logo.start()
        assert logo.is_animating() is True
        logo.stop()
        assert logo.is_animating() is False

    def test_reduced_motion_never_animates(self, qt_app: object) -> None:
        logo = FloatingLogo(reduced_motion=True)
        logo.start()
        assert logo.is_animating() is False

    def test_float_offset_moves_label_up(self, qt_app: object) -> None:
        logo = FloatingLogo(reduced_motion=False, size=112)
        logo.floatOffset = 0.0
        baseline_y = logo._label.pos().y()
        assert baseline_y == FLOAT_AMPLITUDE
        logo.floatOffset = float(FLOAT_AMPLITUDE)
        assert logo._label.pos().y() == 0

    def test_stop_resets_to_baseline(self, qt_app: object) -> None:
        logo = FloatingLogo(reduced_motion=False)
        logo.floatOffset = float(FLOAT_AMPLITUDE)
        logo.stop()
        assert logo.floatOffset == 0.0

    def test_show_hide_events(self, qt_app: object) -> None:
        from PyQt5.QtGui import QHideEvent, QShowEvent

        logo = FloatingLogo(reduced_motion=False)
        logo.showEvent(QShowEvent())
        assert logo.is_animating() is True
        logo.hideEvent(QHideEvent())
        assert logo.is_animating() is False
