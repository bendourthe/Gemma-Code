"""Info callout widget with a 3px left accent stripe."""

from __future__ import annotations

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QFrame, QLabel, QVBoxLayout, QWidget

from gemma_installer.constants import TEXT_SECONDARY


class CalloutBox(QFrame):
    """Card with a 3px cyan left border, optional title, and body text."""

    def __init__(
        self,
        title: str = "",
        body: str = "",
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.setObjectName("calloutBox")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 10, 12, 10)
        layout.setSpacing(6)

        if title:
            self._title = QLabel(title)
            self._title.setStyleSheet(
                "font-weight: bold; font-size: 13px; background: transparent;"
            )
            self._title.setWordWrap(True)
            layout.addWidget(self._title)
        else:
            self._title = None

        self._body_label = QLabel(body)
        self._body_label.setObjectName("secondaryLabel")
        self._body_label.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: 12px; background: transparent;"
        )
        self._body_label.setWordWrap(True)
        self._body_label.setTextFormat(Qt.TextFormat.RichText)
        layout.addWidget(self._body_label)

        self._item_layout = QVBoxLayout()
        self._item_layout.setSpacing(4)
        layout.addLayout(self._item_layout)

    def set_body(self, text: str) -> None:
        self._body_label.setText(text)

    def add_item(self, widget: QWidget) -> None:
        """Add a child widget (e.g., a status row) inside the callout."""
        self._item_layout.addWidget(widget)
