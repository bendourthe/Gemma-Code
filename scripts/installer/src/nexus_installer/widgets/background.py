"""Radial-glow body treatment + constellation host (v1.9.0 T302).

Mounts the Phase 2 ``ConstellationBackground`` behind the wizard's content
band over the guide's radial-glow + dark-gradient body treatment (the two
cyan/blue radial pools from ``RADIAL_GLOW_POOLS`` fading into ``BG_DEEP``).
The constellation is drawn at a reduced opacity so page text and cards stay
readable; the consuming window keeps its chrome bands (title bar, header,
footer) opaque so the animation only shows through the transparent content
region.

Phase 2 left the PyQt reduced-motion signal env-var-only (``IAE.P2.A``). This
module closes that: ``resolve_reduced_motion()`` reads the env var *and* asks
Windows via ``SystemParametersInfo(SPI_GETCLIENTAREAANIMATION)`` whether the
user disabled window animations, so the installer honours the real OS setting
on the primary platform (macOS/Linux fall back to the env var until Qt exposes
a cross-platform query).
"""

from __future__ import annotations

import random
import sys

from PyQt5.QtCore import Qt
from PyQt5.QtGui import QBrush, QColor, QLinearGradient, QPainter, QRadialGradient
from PyQt5.QtWidgets import QGraphicsOpacityEffect, QVBoxLayout, QWidget

from nexus_installer.constants import BG_DEEP, BG_WINDOW, RADIAL_GLOW_POOLS
from nexus_installer.widgets.constellation import (
    ConstellationBackground,
    prefers_reduced_motion,
)

#: Constellation opacity behind content (guide parity; keeps text readable).
CONSTELLATION_OPACITY = 0.55

#: Win32 SystemParametersInfo action: query client-area (in-window) animations.
_SPI_GETCLIENTAREAANIMATION = 0x1042


def _windows_animations_disabled() -> bool:
    """True when Windows in-window animations are off. Best-effort; False on any
    error or non-Windows host (the caller gates on the platform)."""
    try:
        import ctypes

        enabled = ctypes.c_int(1)
        ok = ctypes.windll.user32.SystemParametersInfoW(  # type: ignore[attr-defined]
            _SPI_GETCLIENTAREAANIMATION, 0, ctypes.byref(enabled), 0
        )
        return bool(ok) and enabled.value == 0
    except Exception:  # noqa: BLE001 -- OS probe is best-effort
        return False


def resolve_reduced_motion() -> bool:
    """Best-effort reduced-motion signal for the installer (T302 / IAE.P2.A).

    True when ``NEXUS_REDUCED_MOTION`` is set, or (Windows only) when the user
    has disabled in-window animations. Any probe failure degrades to motion-on.
    """
    if prefers_reduced_motion():
        return True
    if sys.platform == "win32" and _windows_animations_disabled():
        return True
    return False


class BackgroundWidget(QWidget):
    """Paints the radial-glow body and hosts a dimmed constellation."""

    def __init__(
        self,
        parent: QWidget | None = None,
        *,
        reduced_motion: bool | None = None,
        rng: random.Random | None = None,
    ) -> None:
        super().__init__(parent)
        self.setObjectName("backgroundHost")
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        self._reduced_motion = (
            resolve_reduced_motion() if reduced_motion is None else reduced_motion
        )
        self._constellation = ConstellationBackground(
            self, reduced_motion=self._reduced_motion, rng=rng
        )
        opacity = QGraphicsOpacityEffect(self._constellation)
        opacity.setOpacity(CONSTELLATION_OPACITY)
        self._constellation.setGraphicsEffect(opacity)

        # A zero-margin layout keeps the constellation filling the host (and so
        # the whole content band) as the window resizes -- Qt re-lays it out
        # automatically, no manual geometry bookkeeping. The radial glow is
        # painted by this widget's paintEvent, behind the child.
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self._constellation)

    # -- public API ---------------------------------------------------------
    @property
    def constellation(self) -> ConstellationBackground:
        return self._constellation

    @property
    def reduced_motion(self) -> bool:
        return self._reduced_motion

    # -- Qt events ----------------------------------------------------------
    def paintEvent(self, _event: object) -> None:  # noqa: N802
        painter = QPainter(self)
        rect = self.rect()

        # Dark vertical gradient: window base at the top fading to BG_DEEP.
        gradient = QLinearGradient(0.0, 0.0, 0.0, float(self.height()))
        gradient.setColorAt(0.0, QColor(BG_WINDOW))
        gradient.setColorAt(1.0, QColor(BG_DEEP))
        painter.fillRect(rect, QBrush(gradient))

        # Two cyan/blue radial glow pools (top-left, bottom-right), fading out.
        w = float(self.width())
        h = float(self.height())
        centers = ((0.18 * w, 0.12 * h), (0.85 * w, 0.9 * h))
        radius = max(w, h) * 0.65
        for (cx, cy), (rgb, alpha) in zip(centers, RADIAL_GLOW_POOLS, strict=False):
            pool = QRadialGradient(cx, cy, radius)
            inner = QColor(rgb[0], rgb[1], rgb[2])
            inner.setAlphaF(alpha)
            outer = QColor(rgb[0], rgb[1], rgb[2])
            outer.setAlphaF(0.0)
            pool.setColorAt(0.0, inner)
            pool.setColorAt(1.0, outer)
            painter.fillRect(rect, QBrush(pool))

        painter.end()
