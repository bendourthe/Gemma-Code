"""56px footer band with hint text and Back/Next navigation buttons."""

from __future__ import annotations

from PyQt5.QtCore import Qt, pyqtSignal
from PyQt5.QtWidgets import QHBoxLayout, QLabel, QWidget

from gemma_installer.constants import FOOTER_HEIGHT, TEXT_MUTED
from gemma_installer.widgets.primary_button import PrimaryButton
from gemma_installer.widgets.secondary_button import SecondaryButton


class Footer(QWidget):
    """Fixed-height footer with hint label and Back / Next buttons."""

    back_clicked = pyqtSignal()
    next_clicked = pyqtSignal()

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setFixedHeight(FOOTER_HEIGHT)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(24, 0, 24, 0)

        self._hint = QLabel("")
        self._hint.setStyleSheet(
            f"color: {TEXT_MUTED}; font-size: 11px; background: transparent;"
        )
        layout.addWidget(self._hint, alignment=Qt.AlignmentFlag.AlignVCenter)

        layout.addStretch()

        self._back_btn = SecondaryButton("Back")
        self._back_btn.clicked.connect(self.back_clicked.emit)
        layout.addWidget(self._back_btn, alignment=Qt.AlignmentFlag.AlignVCenter)

        self._next_btn = PrimaryButton("Next")
        self._next_btn.clicked.connect(self.next_clicked.emit)
        layout.addWidget(self._next_btn, alignment=Qt.AlignmentFlag.AlignVCenter)

    @property
    def back_button(self) -> SecondaryButton:
        return self._back_btn

    @property
    def next_button(self) -> PrimaryButton:
        return self._next_btn

    def set_hint(self, text: str) -> None:
        self._hint.setText(text)

    def set_next_text(self, text: str) -> None:
        self._next_btn.setText(text)

    def set_back_enabled(self, enabled: bool) -> None:
        self._back_btn.setEnabled(enabled)
        self._back_btn.setVisible(enabled)

    def set_next_enabled(self, enabled: bool) -> None:
        self._next_btn.setEnabled(enabled)
