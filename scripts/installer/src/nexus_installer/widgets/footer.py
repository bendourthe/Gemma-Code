"""Footer band with hint text and Back/Next navigation buttons."""

from __future__ import annotations

from PyQt5.QtCore import Qt, pyqtSignal
from PyQt5.QtWidgets import QHBoxLayout, QLabel, QWidget

from nexus_installer.constants import FOOTER_HEIGHT, FS_CAPTION, TEXT_MUTED
from nexus_installer.widgets.primary_button import PrimaryButton
from nexus_installer.widgets.secondary_button import SecondaryButton


class Footer(QWidget):
    """Fixed-height footer with hint label and Back / Next buttons."""

    back_clicked = pyqtSignal()
    next_clicked = pyqtSignal()
    cancel_clicked = pyqtSignal()

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setFixedHeight(FOOTER_HEIGHT)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(24, 0, 24, 0)

        self._hint = QLabel("")
        self._hint.setStyleSheet(
            f"color: {TEXT_MUTED}; font-size: {FS_CAPTION}px; background: transparent;"
        )
        layout.addWidget(self._hint, alignment=Qt.AlignmentFlag.AlignVCenter)

        layout.addStretch()

        self._back_btn = SecondaryButton("Back")
        self._back_btn.clicked.connect(self.back_clicked.emit)
        layout.addWidget(self._back_btn, alignment=Qt.AlignmentFlag.AlignVCenter)

        # v1.14.0 Phase 4: a Cancel button that lives on the footer row only
        # while an install is running, then is removed on completion (never a
        # lingering grayed button on the page).
        self._cancel_btn = SecondaryButton("Cancel")
        self._cancel_btn.clicked.connect(self.cancel_clicked.emit)
        self._cancel_btn.setVisible(False)
        layout.addWidget(self._cancel_btn, alignment=Qt.AlignmentFlag.AlignVCenter)

        self._next_btn = PrimaryButton("Next")
        self._next_btn.clicked.connect(self.next_clicked.emit)
        layout.addWidget(self._next_btn, alignment=Qt.AlignmentFlag.AlignVCenter)

    @property
    def back_button(self) -> SecondaryButton:
        return self._back_btn

    @property
    def next_button(self) -> PrimaryButton:
        return self._next_btn

    @property
    def cancel_button(self) -> SecondaryButton:
        return self._cancel_btn

    def set_cancel_visible(self, visible: bool) -> None:
        """Show/remove the footer Cancel button (v1.14.0 Phase 4)."""
        self._cancel_btn.setVisible(visible)
        self._cancel_btn.setEnabled(visible)

    def set_hint(self, text: str) -> None:
        self._hint.setText(text)

    def set_next_text(self, text: str) -> None:
        self._next_btn.setText(text)

    def set_back_enabled(self, enabled: bool) -> None:
        self._back_btn.setEnabled(enabled)
        self._back_btn.setVisible(enabled)

    def set_next_enabled(self, enabled: bool) -> None:
        self._next_btn.setEnabled(enabled)
