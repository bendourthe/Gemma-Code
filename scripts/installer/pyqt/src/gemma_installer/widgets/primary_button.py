"""Cyan gradient primary action button."""

from __future__ import annotations

from PyQt5.QtWidgets import QPushButton, QWidget


class PrimaryButton(QPushButton):
    """QPushButton styled as a cyan-gradient primary action button."""

    def __init__(self, text: str = "", parent: QWidget | None = None) -> None:
        super().__init__(text, parent)
        self.setObjectName("primaryButton")
        self.setCursor(self.cursor())
