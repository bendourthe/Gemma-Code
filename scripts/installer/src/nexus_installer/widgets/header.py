"""Header band: static glowing brand mark, two-tone wordmark, and step counter.

v1.9.0 Phase 4 (T012/T015/T016): the header shows a still :class:`StaticLogo`
(no bob -- the animated FloatingLogo is retired to kill the lag) beside the
guide's two-tone "Nexus AI Studio" wordmark, with an enlarged step counter.
Fed the transparent brand mark, so it never reads as a black square.
"""

from __future__ import annotations

from PyQt5.QtCore import Qt
from PyQt5.QtGui import QFont
from PyQt5.QtWidgets import QHBoxLayout, QLabel, QWidget

from nexus_installer.constants import (
    FS_BODY,
    FS_H2,
    GLOW_BLUR_MEDIUM,
    HEADER_HEIGHT,
    TEXT_SECONDARY,
    WORDMARK_PRIMARY,
    WORDMARK_SECONDARY,
)
from nexus_installer.widgets.static_logo import StaticLogo


class Header(QWidget):
    """Fixed-height header with a static brand mark, wordmark, and step counter."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("headerBand")
        self.setFixedHeight(HEADER_HEIGHT)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(24, 0, 24, 0)
        layout.setSpacing(12)

        # Static glowing transparent mark (no animation -> no lag; T012).
        self._logo = StaticLogo(size=40, glow_blur=GLOW_BLUR_MEDIUM)
        layout.addWidget(self._logo, alignment=Qt.AlignmentFlag.AlignVCenter)

        # Two-tone wordmark matching the interactive guide (T015): bright
        # "Nexus" + muted " AI Studio". Colors/weights via rich-text spans;
        # size + letter-spacing via the widget font.
        self._title = QLabel(
            f'<span style="color: {WORDMARK_PRIMARY}; font-weight: 700;">Nexus</span>'
            f'<span style="color: {WORDMARK_SECONDARY}; font-weight: 600;">'
            f" AI Studio</span>"
        )
        self._title.setStyleSheet("background: transparent;")
        title_font = self._title.font()
        title_font.setPixelSize(FS_H2)
        title_font.setLetterSpacing(QFont.SpacingType.AbsoluteSpacing, 0.3)
        self._title.setFont(title_font)
        layout.addWidget(self._title, alignment=Qt.AlignmentFlag.AlignVCenter)

        layout.addStretch()

        self._step_counter = QLabel("")
        self._step_counter.setObjectName("secondaryLabel")
        self._step_counter.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_BODY}px; background: transparent;"
        )
        layout.addWidget(self._step_counter, alignment=Qt.AlignmentFlag.AlignVCenter)

    def set_step_text(self, text: str) -> None:
        """Update the step counter display (e.g., 'Step 1 of 9')."""
        self._step_counter.setText(text)
