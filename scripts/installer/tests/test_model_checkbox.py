"""Tests for the custom-painted per-model checkbox (v1.9.0 T021)."""

from __future__ import annotations

from nexus_installer.constants import ACCENT
from nexus_installer.widgets.model_checkbox import ModelCheckBox


class TestModelCheckBox:
    def test_default_accent(self, qt_app: object) -> None:
        cb = ModelCheckBox()
        assert cb.accent == ACCENT
        assert cb.isChecked() is False

    def test_custom_accent(self, qt_app: object) -> None:
        cb = ModelCheckBox(accent="#a78bfa")
        assert cb.accent == "#a78bfa"

    def test_set_accent_recolors(self, qt_app: object) -> None:
        cb = ModelCheckBox()
        cb.set_accent("#22d3ee")
        assert cb.accent == "#22d3ee"

    def test_is_a_qcheckbox_that_toggles(self, qt_app: object) -> None:
        from PyQt5.QtWidgets import QCheckBox

        cb = ModelCheckBox()
        assert isinstance(cb, QCheckBox)  # preserves the standard API
        cb.setChecked(True)
        assert cb.isChecked() is True

    def test_is_square_and_fixed_size(self, qt_app: object) -> None:
        cb = ModelCheckBox()
        assert cb.width() == cb.height()
        assert cb.width() > 0

    def test_paints_in_every_state(self, qt_app: object) -> None:
        """paintEvent must not raise for unchecked/checked x enabled/disabled
        (the last combination is the locked-on 'Required' model state)."""
        from PyQt5.QtGui import QPixmap

        for checked in (False, True):
            for enabled in (True, False):
                cb = ModelCheckBox(accent="#f472b6")
                cb.setChecked(checked)
                cb.setEnabled(enabled)
                cb.render(QPixmap(cb.size()))
