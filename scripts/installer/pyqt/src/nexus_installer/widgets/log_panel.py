"""Scrollable log panel with color-coded output levels."""

from __future__ import annotations

from PyQt5.QtGui import QColor, QTextCharFormat, QTextCursor
from PyQt5.QtWidgets import QTextEdit, QWidget

from nexus_installer.constants import ERROR, SUCCESS, WARNING

_LEVEL_COLORS: dict[str, str] = {
    "info": "#8bb4cc",
    "success": SUCCESS,
    "error": ERROR,
    "warn": WARNING,
    "warning": WARNING,
}


class LogPanel(QTextEdit):
    """Read-only log panel with auto-scroll and color-coded levels."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setReadOnly(True)
        self.setLineWrapMode(QTextEdit.LineWrapMode.WidgetWidth)

    def append_log(self, text: str, level: str = "info") -> None:
        """Append a line of text with color based on level."""
        color = _LEVEL_COLORS.get(level, _LEVEL_COLORS["info"])

        fmt = QTextCharFormat()
        fmt.setForeground(QColor(color))

        cursor = self.textCursor()
        cursor.movePosition(QTextCursor.MoveOperation.End)
        cursor.insertText(text + "\n", fmt)

        # Auto-scroll to bottom
        scrollbar = self.verticalScrollBar()
        if scrollbar is not None:
            scrollbar.setValue(scrollbar.maximum())

    def get_full_log(self) -> str:
        """Return the complete log content as plain text."""
        return self.toPlainText()
