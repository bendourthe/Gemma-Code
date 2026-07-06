"""88px custom-painted step progress indicator with connected dots."""

from __future__ import annotations

from PyQt5.QtCore import QPointF, QRectF, Qt
from PyQt5.QtGui import QColor, QFont, QPainter, QPainterPath, QPen
from PyQt5.QtWidgets import QWidget

from nexus_installer.constants import (
    ACCENT,
    BG_WINDOW,
    BORDER_STRONG,
    FONT_PRIMARY,
    STEP_BAR_HEIGHT,
    TEXT_SECONDARY,
)


class StepIndicator(QWidget):
    """Horizontal dot-based step indicator with connectors and labels."""

    DOT_RADIUS = 13
    CONNECTOR_Y_OFFSET = 0
    LABEL_Y_OFFSET = 22

    def __init__(self, steps: list[str], parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._steps = steps
        self._current_step = 0
        self.setFixedHeight(STEP_BAR_HEIGHT)

    @property
    def current_step(self) -> int:
        return self._current_step

    def set_current(self, index: int) -> None:
        """Set the active step index and repaint."""
        self._current_step = max(0, min(index, len(self._steps) - 1))
        self.update()

    def paintEvent(self, _event: object) -> None:  # noqa: N802
        if not self._steps:
            return

        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        w = self.width()
        n = len(self._steps)
        margin = 60
        available = w - 2 * margin
        spacing = available / max(n - 1, 1)

        center_y = (self.height() - self.LABEL_Y_OFFSET) / 2
        r = self.DOT_RADIUS

        positions: list[float] = []
        for i in range(n):
            x = margin + i * spacing
            positions.append(x)

        # Draw connectors
        for i in range(n - 1):
            x1 = positions[i] + r
            x2 = positions[i + 1] - r
            if i < self._current_step:
                pen_color = QColor(ACCENT)
            else:
                pen_color = QColor(BORDER_STRONG)
            painter.setPen(QPen(pen_color, 2))
            painter.drawLine(
                QPointF(x1, center_y),
                QPointF(x2, center_y),
            )

        # Draw dots
        label_font = QFont(FONT_PRIMARY, 8)
        painter.setFont(label_font)

        for i, name in enumerate(self._steps):
            cx = positions[i]
            rect = QRectF(cx - r, center_y - r, 2 * r, 2 * r)

            if i < self._current_step:
                # Completed: glowing filled accent dot with a checkmark (T303).
                self._draw_glow(painter, cx, center_y, r)
                painter.setPen(Qt.PenStyle.NoPen)
                painter.setBrush(QColor(ACCENT))
                painter.drawEllipse(rect)
                self._draw_checkmark(painter, cx, center_y, r)
            elif i == self._current_step:
                # Active: glowing highlighted ring with a soft accent fill.
                self._draw_glow(painter, cx, center_y, r)
                fill = QColor(ACCENT)
                fill.setAlphaF(0.18)
                painter.setPen(QPen(QColor(ACCENT), 2))
                painter.setBrush(fill)
                painter.drawEllipse(rect)
            else:
                # Future: hollow border color
                painter.setPen(QPen(QColor(BORDER_STRONG), 2))
                painter.setBrush(Qt.BrushStyle.NoBrush)
                painter.drawEllipse(rect)

            # Label below dot
            painter.setPen(QColor(TEXT_SECONDARY))
            label_rect = QRectF(
                cx - spacing / 2,
                center_y + r + 6,
                spacing,
                self.LABEL_Y_OFFSET,
            )
            painter.drawText(
                label_rect,
                Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignTop,
                name,
            )

        painter.end()

    @staticmethod
    def _draw_glow(painter: QPainter, cx: float, cy: float, r: int) -> None:
        """Draw a soft cyan halo behind a completed / active step dot (T303)."""
        painter.setPen(Qt.PenStyle.NoPen)
        for scale, alpha in ((2.0, 0.10), (1.55, 0.16), (1.2, 0.22)):
            glow = QColor(ACCENT)
            glow.setAlphaF(alpha)
            painter.setBrush(glow)
            gr = r * scale
            painter.drawEllipse(QPointF(cx, cy), gr, gr)

    @staticmethod
    def _draw_checkmark(painter: QPainter, cx: float, cy: float, r: int) -> None:
        """Draw a dark checkmark inside a completed accent dot."""
        painter.setPen(
            QPen(
                QColor(BG_WINDOW),
                2,
                Qt.PenStyle.SolidLine,
                Qt.PenCapStyle.RoundCap,
                Qt.PenJoinStyle.RoundJoin,
            )
        )
        path = QPainterPath()
        scale = r * 0.45
        path.moveTo(cx - scale * 0.6, cy)
        path.lineTo(cx - scale * 0.1, cy + scale * 0.5)
        path.lineTo(cx + scale * 0.7, cy - scale * 0.4)
        painter.drawPath(path)
