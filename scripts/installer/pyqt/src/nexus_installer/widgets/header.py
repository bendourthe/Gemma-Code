"""64px header band: floating-glow brand lockup, title, and step counter.

v1.9.0 Phase 3 (T303): the black-box ``assets/icon.png`` QLabel is replaced by
the Phase 2 :class:`FloatingLogo` primitive fed the transparent brand mark, so
the header reads as one family with the guide and never renders a black square.
The title is the product name "Nexus AI Studio" (T304).
"""

from __future__ import annotations

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QHBoxLayout, QLabel, QWidget

from nexus_installer.constants import GLOW_BLUR_MEDIUM, HEADER_HEIGHT, TEXT_SECONDARY
from nexus_installer.widgets.background import resolve_reduced_motion
from nexus_installer.widgets.float_logo import FloatingLogo


class Header(QWidget):
    """Fixed-height header with a floating-glow brand mark, title, and counter."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("headerBand")
        self.setFixedHeight(HEADER_HEIGHT)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(24, 0, 24, 0)
        layout.setSpacing(12)

        # Floating, glowing transparent mark (fixes the black-box logo, T303).
        self._logo = FloatingLogo(
            size=30,
            glow_blur=GLOW_BLUR_MEDIUM,
            reduced_motion=resolve_reduced_motion(),
        )
        layout.addWidget(self._logo, alignment=Qt.AlignmentFlag.AlignVCenter)

        self._title = QLabel("Nexus AI Studio")
        self._title.setStyleSheet(
            "font-size: 18px; font-weight: bold; background: transparent;"
        )
        layout.addWidget(self._title, alignment=Qt.AlignmentFlag.AlignVCenter)

        layout.addStretch()

        self._step_counter = QLabel("")
        self._step_counter.setObjectName("secondaryLabel")
        self._step_counter.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: 12px; background: transparent;"
        )
        layout.addWidget(self._step_counter, alignment=Qt.AlignmentFlag.AlignVCenter)

    def set_step_text(self, text: str) -> None:
        """Update the step counter display (e.g., 'Step 1 of 9')."""
        self._step_counter.setText(text)
