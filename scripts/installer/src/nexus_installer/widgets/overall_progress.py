"""Prominent animated overall installer progress widget."""

from __future__ import annotations

import math

from PyQt5.QtCore import QRectF, QSize, Qt, QTimer
from PyQt5.QtGui import QColor, QGradient, QLinearGradient, QPainter, QPainterPath, QPen
from PyQt5.QtWidgets import QProgressBar, QWidget

from nexus_installer.constants import (
    ACCENT,
    ACCENT_BRIGHT,
    ACCENT_DIM,
    BG_CARD,
    BORDER,
    TEXT_PRIMARY,
)
from nexus_installer.widgets.background import resolve_reduced_motion

OVERALL_PROGRESS_HEIGHT = 30
FRAME_INTERVAL_MS = 40


class OverallProgressBar(QProgressBar):
    """A determinate percentage bar with a moving signature gradient."""

    def __init__(
        self,
        parent: QWidget | None = None,
        *,
        reduced_motion: bool | None = None,
    ) -> None:
        super().__init__(parent)
        self.setObjectName("overallProgress")
        self.setFixedHeight(OVERALL_PROGRESS_HEIGHT)
        self.setTextVisible(True)
        self.setFormat("%p%")
        self.setAccessibleName("Overall installation progress")
        self._reduced_motion = (
            resolve_reduced_motion() if reduced_motion is None else reduced_motion
        )
        self._active = False
        self._phase = 0.0
        self._last_fraction = 0.0
        self._timer = QTimer(self)
        self._timer.setInterval(FRAME_INTERVAL_MS)
        self._timer.timeout.connect(self._advance_gradient)
        self.reset_for_run()

    @property
    def reduced_motion(self) -> bool:
        return self._reduced_motion

    @property
    def animation_phase(self) -> float:
        return self._phase

    def is_animation_running(self) -> bool:
        return self._timer.isActive()

    def sizeHint(self) -> QSize:  # noqa: N802
        hint = super().sizeHint()
        return QSize(max(320, hint.width()), OVERALL_PROGRESS_HEIGHT)

    def reset_for_run(self) -> None:
        self._last_fraction = 0.0
        self._phase = 0.0
        self.setRange(0, 0)
        self.setAccessibleDescription("Installation is preparing progress details.")
        self.set_running(True)
        self.update()

    def set_fraction(self, fraction: float) -> None:
        if not math.isfinite(float(fraction)):
            return
        self._last_fraction = max(
            self._last_fraction, max(0.0, min(1.0, float(fraction)))
        )
        if self.maximum() == 0:
            self.setRange(0, 1000)
        self.setValue(round(self._last_fraction * 1000))
        percent = round(self._last_fraction * 100)
        self.setAccessibleDescription(f"Installation is {percent}% complete.")
        self.update()

    def complete(self) -> None:
        self.set_fraction(1.0)
        self.set_running(False)

    def cancel(self) -> None:
        self.set_running(False)

    def set_running(self, running: bool) -> None:
        self._active = bool(running)
        self._sync_timer()

    def _sync_timer(self) -> None:
        should_run = self._active and self.isVisible() and not self._reduced_motion
        if should_run and not self._timer.isActive():
            self._timer.start()
        elif not should_run and self._timer.isActive():
            self._timer.stop()

    def _advance_gradient(self) -> None:
        self._phase = (self._phase + 0.035) % 1.0
        self.update()

    def showEvent(self, event: object) -> None:  # noqa: N802
        super().showEvent(event)  # type: ignore[arg-type]
        self._sync_timer()

    def hideEvent(self, event: object) -> None:  # noqa: N802
        super().hideEvent(event)  # type: ignore[arg-type]
        self._timer.stop()

    def paintEvent(self, _event: object) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        rect = QRectF(self.rect().adjusted(0, 0, -1, -1))
        radius = rect.height() / 2.0

        track_path = QPainterPath()
        track_path.addRoundedRect(rect, radius, radius)
        painter.fillPath(track_path, QColor(BG_CARD))
        painter.setPen(QPen(QColor(BORDER), 1.0))
        painter.drawPath(track_path)

        if self.maximum() == 0:
            segment = max(36.0, rect.width() * 0.28)
            travel = rect.width() + segment
            left = (self._phase * travel) - segment
            fill_width = segment
        else:
            denominator = max(1, self.maximum() - self.minimum())
            fraction = (self.value() - self.minimum()) / denominator
            left = 0.0
            fill_width = rect.width() * max(0.0, min(1.0, fraction))

        if fill_width > 0:
            painter.save()
            painter.setClipPath(track_path)
            fill_rect = rect.adjusted(left, 0.0, 0.0, 0.0)
            fill_rect.setWidth(max(1.0, fill_width))
            band = max(56.0, min(150.0, fill_width * 0.8))
            offset = (self._phase * band) if not self._reduced_motion else 0.0
            gradient = QLinearGradient(
                offset - band,
                rect.top(),
                offset,
                rect.bottom(),
            )
            gradient.setSpread(QGradient.Spread.RepeatSpread)
            gradient.setColorAt(0.0, QColor(ACCENT_DIM))
            gradient.setColorAt(0.28, QColor(ACCENT))
            gradient.setColorAt(0.5, QColor(ACCENT_BRIGHT))
            gradient.setColorAt(0.72, QColor(ACCENT))
            gradient.setColorAt(1.0, QColor(ACCENT_DIM))
            painter.fillRect(fill_rect, gradient)
            painter.restore()

        if self.maximum() != 0:
            font = painter.font()
            font.setBold(True)
            font.setPixelSize(14)
            painter.setFont(font)
            percent = round(self._last_fraction * 100)
            text = f"{percent}%"
            metrics = painter.fontMetrics()
            badge_width = metrics.horizontalAdvance(text) + 20
            badge_height = min(24.0, rect.height() - 4.0)
            badge = QRectF(
                rect.center().x() - badge_width / 2.0,
                rect.center().y() - badge_height / 2.0,
                badge_width,
                badge_height,
            )
            badge_color = QColor(BG_CARD)
            badge_color.setAlpha(230)
            painter.setPen(QPen(QColor(BORDER), 1.0))
            painter.setBrush(badge_color)
            painter.drawRoundedRect(badge, badge_height / 2.0, badge_height / 2.0)
            painter.setPen(QColor(TEXT_PRIMARY))
            painter.drawText(badge, Qt.AlignmentFlag.AlignCenter, text)


__all__ = ["FRAME_INTERVAL_MS", "OVERALL_PROGRESS_HEIGHT", "OverallProgressBar"]
