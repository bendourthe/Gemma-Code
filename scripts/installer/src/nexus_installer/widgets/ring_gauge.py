"""Ring gauge: a thin circular arc that fills clockwise with value / total.

Used by the Review page's model summary (Selected / Ready / To download). Pure
QPainter so the arc color, track, and fraction are exact at any DPI.
"""

from __future__ import annotations

from PyQt5.QtCore import QRectF, Qt
from PyQt5.QtGui import QColor, QPainter, QPen
from PyQt5.QtWidgets import QWidget

from nexus_installer.constants import BORDER_STRONG

#: Degrees in Qt's 1/16th-degree arc units.
_FULL_TURN = 360 * 16
_TOP = 90 * 16


class RingGauge(QWidget):
    """Circular progress ring showing `value` out of `total`."""

    def __init__(
        self,
        *,
        color: str,
        size: int = 44,
        thickness: int = 5,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._color = color
        self._thickness = thickness
        self._value = 0
        self._total = 0
        self.setFixedSize(size, size)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)

    @property
    def value(self) -> int:
        return self._value

    @property
    def total(self) -> int:
        return self._total

    @property
    def color(self) -> str:
        return self._color

    @property
    def fraction(self) -> float:
        """Filled share of the ring, clamped to [0, 1]; 0 when total is 0."""
        if self._total <= 0:
            return 0.0
        return max(0.0, min(1.0, self._value / self._total))

    def set_color(self, color: str) -> None:
        self._color = color
        self.update()

    def set_value(self, value: int, total: int) -> None:
        self._value = max(0, int(value))
        self._total = max(0, int(total))
        self.update()

    def paintEvent(self, _event: object) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        inset = self._thickness / 2 + 1
        rect = QRectF(inset, inset, self.width() - 2 * inset, self.height() - 2 * inset)
        # Track.
        painter.setPen(QPen(QColor(BORDER_STRONG), self._thickness))
        painter.setBrush(Qt.BrushStyle.NoBrush)
        painter.drawEllipse(rect)
        # Filled arc, clockwise from the top.
        span = int(self.fraction * _FULL_TURN)
        if span > 0:
            pen = QPen(QColor(self._color), self._thickness)
            pen.setCapStyle(Qt.PenCapStyle.RoundCap)
            painter.setPen(pen)
            painter.drawArc(rect, _TOP, -span)
        painter.end()
