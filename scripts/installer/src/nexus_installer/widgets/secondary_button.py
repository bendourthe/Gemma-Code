"""Transparent border secondary action button."""

from __future__ import annotations

from PyQt5.QtWidgets import QPushButton, QWidget


class SecondaryButton(QPushButton):
    """QPushButton styled as a transparent-background secondary button."""

    def __init__(self, text: str = "", parent: QWidget | None = None) -> None:
        super().__init__(text, parent)
        self.setObjectName("secondaryButton")
