"""v1.13.0 Phase 3 -- brand wordmark with a gradient accent run.

Paints a solid-color primary run ("Nexus" / "Welcome to Nexus") followed by an
accent run (" AI Studio") filled with the brand signature gradient. Two reasons
it is custom-painted rather than a styled QLabel:

* Qt cannot gradient-fill text glyphs via a stylesheet -- a real gradient needs
  ``QPainter`` + ``QLinearGradient`` wrapped in a ``QBrush`` pen.
* Painting sidesteps the global QSS ``font-size`` rule that overrides
  ``QLabel.setFont`` (the "renders tiny" cascade documented in widgets/header.py).

The font auto-shrinks (down to ``min_px``) to the available width so the full
"Nexus AI Studio" never clips in the fixed-width sidebar -- the root cause of
the truncated "Nexus AI Studi" bug.
"""

from __future__ import annotations

from PyQt5.QtCore import QSize, Qt
from PyQt5.QtGui import (
    QBrush,
    QColor,
    QFont,
    QFontMetrics,
    QLinearGradient,
    QPainter,
    QPen,
)
from PyQt5.QtWidgets import QSizePolicy, QWidget

from nexus_installer.constants import (
    FONT_PRIMARY,
    SIGNATURE_GRADIENT_STOPS,
    WORDMARK_PRIMARY,
)

_HEIGHT_PADDING = 4


class GradientWordmark(QWidget):
    """A two-run wordmark: solid `primary` + gradient-filled `accent`."""

    def __init__(
        self,
        primary: str,
        accent: str,
        base_px: int,
        *,
        align: Qt.AlignmentFlag = Qt.AlignmentFlag.AlignLeft,
        bold: bool = True,
        letter_spacing: float = 0.3,
        min_px: int = 14,
        primary_color: str = WORDMARK_PRIMARY,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._primary = primary
        self._accent = accent
        self._base_px = base_px
        self._align = align
        self._bold = bold
        self._letter_spacing = letter_spacing
        self._min_px = max(1, min_px)
        self._primary_color = primary_color
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        self.setFixedHeight(
            QFontMetrics(self._font(base_px)).height() + _HEIGHT_PADDING
        )

    @property
    def base_px(self) -> int:
        """The unshrunk (base) pixel size, for tests and callers."""
        return self._base_px

    def full_text(self) -> str:
        """The complete wordmark string (both runs)."""
        return f"{self._primary}{self._accent}"

    def _font(self, px: int) -> QFont:
        font = QFont(FONT_PRIMARY)
        font.setPixelSize(px)
        font.setBold(self._bold)
        if self._letter_spacing:
            font.setLetterSpacing(
                QFont.SpacingType.AbsoluteSpacing, self._letter_spacing
            )
        return font

    def _full_width(self, px: int) -> int:
        return QFontMetrics(self._font(px)).horizontalAdvance(self.full_text())

    def fitted_px(self, width: int) -> int:
        """Largest pixel size <= base_px whose full text fits `width`."""
        px = self._base_px
        if width <= 0:
            return px
        while px > self._min_px and self._full_width(px) > width:
            px -= 1
        return px

    def sizeHint(self) -> QSize:
        fm = QFontMetrics(self._font(self._base_px))
        return QSize(self._full_width(self._base_px), fm.height() + _HEIGHT_PADDING)

    def minimumSizeHint(self) -> QSize:
        fm = QFontMetrics(self._font(self._min_px))
        return QSize(0, fm.height() + _HEIGHT_PADDING)

    def paintEvent(self, _event: object) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.TextAntialiasing, True)
        try:
            font = self._font(self.fitted_px(self.width()))
            painter.setFont(font)
            fm = QFontMetrics(font)
            primary_w = fm.horizontalAdvance(self._primary)
            accent_w = fm.horizontalAdvance(self._accent)
            total_w = primary_w + accent_w
            if self._align & Qt.AlignmentFlag.AlignHCenter:
                start_x = max(0, (self.width() - total_w) // 2)
            elif self._align & Qt.AlignmentFlag.AlignRight:
                start_x = max(0, self.width() - total_w)
            else:
                start_x = 0
            baseline = (self.height() + fm.ascent() - fm.descent()) // 2
            painter.setPen(QColor(self._primary_color))
            painter.drawText(start_x, baseline, self._primary)
            accent_x = start_x + primary_w
            gradient = QLinearGradient(
                float(accent_x), 0.0, float(accent_x + max(accent_w, 1)), 0.0
            )
            for pos, color in SIGNATURE_GRADIENT_STOPS:
                gradient.setColorAt(pos, QColor(color))
            painter.setPen(QPen(QBrush(gradient), 0))
            painter.drawText(accent_x, baseline, self._accent)
        finally:
            painter.end()
