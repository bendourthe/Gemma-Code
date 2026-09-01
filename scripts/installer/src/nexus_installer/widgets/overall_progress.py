"""Prominent animated overall installer progress widget."""

from __future__ import annotations

import math

from PyQt5.QtCore import QRectF, QSize, Qt, QTimer
from PyQt5.QtGui import QColor, QLinearGradient, QPainter, QPainterPath, QPen
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
ANIMATION_CYCLE_MS = 12_000
BAR_INSET = 2.0


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
        self.setRange(0, 1000)
        self.setValue(0)
        self.setAccessibleDescription("Installation is preparing progress details.")
        self.set_running(True)
        self.update()

    def set_fraction(self, fraction: float) -> None:
        if not math.isfinite(float(fraction)):
            return
        self._last_fraction = max(
            self._last_fraction, max(0.0, min(1.0, float(fraction)))
        )
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
        self._phase = (self._phase + (FRAME_INTERVAL_MS / ANIMATION_CYCLE_MS)) % 1.0
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

        denominator = max(1, self.maximum() - self.minimum())
        fraction = (self.value() - self.minimum()) / denominator
        fill_width = (rect.width() - (BAR_INSET * 2.0)) * max(0.0, min(1.0, fraction))

        if fill_width > 0:
            fill_rect = QRectF(
                rect.left() + BAR_INSET,
                rect.top() + BAR_INSET,
                max(1.0, fill_width),
                rect.height() - (BAR_INSET * 2.0),
            )
            fill_radius = min(fill_rect.height(), fill_rect.width()) / 2.0
            fill_path = QPainterPath()
            fill_path.addRoundedRect(fill_rect, fill_radius, fill_radius)

            painter.save()
            base = QLinearGradient(fill_rect.left(), 0.0, fill_rect.right(), 0.0)
            base.setColorAt(0.0, QColor(ACCENT_DIM))
            base.setColorAt(0.45, QColor(ACCENT))
            base.setColorAt(1.0, QColor(ACCENT_DIM))
            painter.fillPath(fill_path, base)

            painter.setClipPath(fill_path)
            sheen_width = max(80.0, min(220.0, fill_rect.width() * 0.42))
            phase = 0.5 if self._reduced_motion else self._phase
            sheen_center = (
                fill_rect.left()
                - sheen_width
                + phase * (fill_rect.width() + (sheen_width * 2.0))
            )
            sheen = QLinearGradient(
                sheen_center - sheen_width,
                fill_rect.top(),
                sheen_center + sheen_width,
                fill_rect.bottom(),
            )
            transparent = QColor(ACCENT_BRIGHT)
            transparent.setAlpha(0)
            soft = QColor(ACCENT_BRIGHT)
            soft.setAlpha(72)
            glass = QColor("#e8fbff")
            glass.setAlpha(145)
            sheen.setColorAt(0.0, transparent)
            sheen.setColorAt(0.32, soft)
            sheen.setColorAt(0.5, glass)
            sheen.setColorAt(0.68, soft)
            sheen.setColorAt(1.0, transparent)
            painter.fillRect(fill_rect, sheen)

            top_glass = QLinearGradient(0.0, fill_rect.top(), 0.0, fill_rect.bottom())
            top = QColor("#ffffff")
            top.setAlpha(70)
            bottom = QColor("#03131c")
            bottom.setAlpha(45)
            clear = QColor("#ffffff")
            clear.setAlpha(0)
            top_glass.setColorAt(0.0, top)
            top_glass.setColorAt(0.38, clear)
            top_glass.setColorAt(1.0, bottom)
            painter.fillRect(fill_rect, top_glass)
            painter.restore()

            outline = QColor(ACCENT_BRIGHT)
            outline.setAlpha(105)
            painter.setPen(QPen(outline, 1.0))
            painter.setBrush(Qt.BrushStyle.NoBrush)
            painter.drawPath(fill_path)

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


__all__ = [
    "ANIMATION_CYCLE_MS",
    "FRAME_INTERVAL_MS",
    "OVERALL_PROGRESS_HEIGHT",
    "OverallProgressBar",
]
