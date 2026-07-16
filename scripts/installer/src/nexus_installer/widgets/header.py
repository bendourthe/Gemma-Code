"""Sidebar brand block: static glowing mark, two-tone wordmark, subtitle.

v1.11.0 Phase 6 (T604): the header is no longer a full-width top band -- the
mockup moves the brand into the left sidebar. This widget is the brand block
mounted at the top of :class:`~nexus_installer.widgets.sidebar.Sidebar`: a still
:class:`StaticLogo` above the two-tone "Nexus AI Studio" wordmark and a
"Setup Wizard" subtitle.

The wordmark size is set through the widget stylesheet (QSS), NOT
``QFont.setPixelSize``. Root cause of the prior "renders tiny" bug: the global
``QMainWindow, QWidget {{ font-size }}`` rule in ``theme.py`` applies to every
``QLabel`` and, per Qt's cascade, a stylesheet font-size overrides ``setFont``.
The step counter always looked right because it set its size via an inline
stylesheet; the wordmark used ``setFont`` and got overridden to the 16px body
size. Both the wordmark and subtitle now carry their size in the stylesheet, so
one mechanism governs header text.
"""

from __future__ import annotations

from PyQt5.QtCore import Qt
from PyQt5.QtGui import QFont
from PyQt5.QtWidgets import QLabel, QVBoxLayout, QWidget

from nexus_installer.constants import (
    GLOW_BLUR_MEDIUM,
    TEXT_SECONDARY,
    WORDMARK_PRIMARY,
    WORDMARK_SECONDARY,
)
from nexus_installer.widgets.static_logo import StaticLogo

# v1.11.0 Phase 6 (T604): the brand mark is trimmed 30% (120 -> 84) to sit in
# the narrower sidebar column, and the wordmark renders at a prominent hero size
# via QSS -- larger than the "Step X of Y" counter (HEADER_STEP_PX = 24), as the
# mockup draws it. The subtitle is a muted caption.
HEADER_LOGO_SIZE = 84
HEADER_WORDMARK_PX = 28
HEADER_SUBTITLE_PX = 14
# Retained for the content-area step counter (relocated out of the header to the
# top-right of the content column in window.py).
HEADER_STEP_PX = 24


class Header(QWidget):
    """Sidebar brand block: mark, two-tone wordmark, and 'Setup Wizard'."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("brandBlock")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 22, 20, 18)
        layout.setSpacing(6)

        # Static glowing transparent mark (no animation -> no lag; T012).
        self._logo = StaticLogo(size=HEADER_LOGO_SIZE, glow_blur=GLOW_BLUR_MEDIUM)
        layout.addWidget(self._logo, alignment=Qt.AlignmentFlag.AlignHCenter)

        # Two-tone wordmark (T015): bright "Nexus" + muted " AI Studio". Size is
        # set in the stylesheet (see module docstring); letter-spacing stays on
        # the QFont (QSS cannot express it and does not override it).
        self._title = QLabel(
            f'<span style="color: {WORDMARK_PRIMARY}; font-weight: 700;">Nexus</span>'
            f'<span style="color: {WORDMARK_SECONDARY}; font-weight: 600;">'
            f" AI Studio</span>"
        )
        self._title.setStyleSheet(
            f"font-size: {HEADER_WORDMARK_PX}px; background: transparent;"
        )
        title_font = self._title.font()
        title_font.setLetterSpacing(QFont.SpacingType.AbsoluteSpacing, 0.3)
        self._title.setFont(title_font)
        layout.addWidget(self._title, alignment=Qt.AlignmentFlag.AlignHCenter)

        subtitle = QLabel("Setup Wizard")
        subtitle.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {HEADER_SUBTITLE_PX}px; "
            "background: transparent;"
        )
        layout.addWidget(subtitle, alignment=Qt.AlignmentFlag.AlignHCenter)

    @property
    def wordmark_px(self) -> int:
        """The wordmark's effective pixel size (from the stylesheet)."""
        return HEADER_WORDMARK_PX
