"""Custom-painted per-model selection checkbox (v1.9.0 T021).

A text-less ``QCheckBox`` drawn as a rounded box that fills with an accent color
and shows a crisp painted checkmark when checked. The accent is configurable --
the Models page passes the per-provider color in Phase 6 -- and the
unchecked / hover / checked / checked-hover / focus / disabled / locked
(checked + disabled) states are all distinct. The glyph is painted rather than
loaded via a QSS ``image: url(...)`` so it always resolves, including inside the
frozen PyInstaller onefile bundle.
"""

from __future__ import annotations

from PyQt5.QtCore import QRectF, Qt
from PyQt5.QtGui import QColor, QPainter, QPainterPath, QPen
from PyQt5.QtWidgets import QCheckBox, QWidget

from nexus_installer.constants import (
    ACCENT,
    ACCENT_BRIGHT,
    ACCENT_DIM,
    BG_CARD,
    BG_INPUT,
    BG_WINDOW,
    BORDER_STRONG,
)

_BOX = 20
_PAD = 3
_RADIUS = 6


class ModelCheckBox(QCheckBox):
    """Rounded, glyph-painted model selector with a configurable accent color."""

    def __init__(self, *, accent: str = ACCENT, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._accent = accent
        self.setFixedSize(_BOX + 2 * _PAD, _BOX + 2 * _PAD)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setAttribute(Qt.WidgetAttribute.WA_Hover, True)

    @property
    def accent(self) -> str:
        return self._accent

    def set_accent(self, accent: str) -> None:
        """Recolor the checked fill (e.g. the per-provider color, Phase 6)."""
        self._accent = accent
        self.update()

    def paintEvent(self, _event: object) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        rect = QRectF(_PAD, _PAD, _BOX, _BOX)
        enabled = self.isEnabled()
        checked = self.isChecked()
        hovered = self.underMouse() and enabled

        if checked:
            if not enabled:
                fill = QColor(ACCENT_DIM)  # locked-on (e.g. Required embed model)
            elif hovered:
                fill = QColor(ACCENT_BRIGHT)
            else:
                fill = QColor(self._accent)
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(fill)
            painter.drawRoundedRect(rect, _RADIUS, _RADIUS)
            self._draw_check(painter, rect)
        else:
            border = QColor(self._accent if hovered else BORDER_STRONG)
            painter.setPen(QPen(border, 2))
            painter.setBrush(QColor(BG_INPUT if enabled else BG_CARD))
            painter.drawRoundedRect(rect.adjusted(1, 1, -1, -1), _RADIUS, _RADIUS)

        if self.hasFocus() and enabled:
            painter.setPen(QPen(QColor(ACCENT_BRIGHT), 1))
            painter.setBrush(Qt.BrushStyle.NoBrush)
            painter.drawRoundedRect(
                rect.adjusted(-2, -2, 2, 2), _RADIUS + 2, _RADIUS + 2
            )
        painter.end()

    @staticmethod
    def _draw_check(painter: QPainter, rect: QRectF) -> None:
        """Draw a crisp dark checkmark centered in the filled box."""
        painter.setPen(
            QPen(
                QColor(BG_WINDOW),
                2.4,
                Qt.PenStyle.SolidLine,
                Qt.PenCapStyle.RoundCap,
                Qt.PenJoinStyle.RoundJoin,
            )
        )
        cx = rect.center().x()
        cy = rect.center().y()
        s = rect.width() * 0.28
        path = QPainterPath()
        path.moveTo(cx - s, cy)
        path.lineTo(cx - s * 0.25, cy + s * 0.7)
        path.lineTo(cx + s, cy - s * 0.6)
        painter.drawPath(path)

    def enterEvent(self, event: object) -> None:  # noqa: N802
        super().enterEvent(event)  # type: ignore[arg-type]
        self.update()

    def leaveEvent(self, event: object) -> None:  # noqa: N802
        super().leaveEvent(event)  # type: ignore[arg-type]
        self.update()
