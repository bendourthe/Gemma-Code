"""Animated constellation background (v1.9.0 T203).

A reusable, transparent QWidget that paints the guide's animated network:
slowly drifting cyan nodes joined by distance-faded links. It is the PyQt
twin of the desktop `<ConstellationBackground/>` (both port
guides/interactive-guide/nexus-ai-guide.html), so the installer and the app
share one look. See docs/v1/v1.9/design-tokens.md.

The widget paints only the constellation on a translucent background; the
consumer (Phase 3) mounts it over the radial-glow body treatment. It:

- honors reduced motion (a single static frame, no timer),
- pauses the timer when hidden/minimized and resumes on show,
- perf-caps the node count (<= 46) per the guide.

Reduced motion has no cross-platform Qt signal, so it is read from the
``NEXUS_REDUCED_MOTION`` environment variable (``1``/``true``/``yes``), with
an explicit ``reduced_motion=`` override for tests and callers.
"""

from __future__ import annotations

import math
import os
import random
from dataclasses import dataclass

from PyQt5.QtCore import QPointF, Qt, QTimer
from PyQt5.QtGui import QColor, QPainter, QPen
from PyQt5.QtWidgets import QWidget

from nexus_installer.constants import CONSTELLATION_LINK, CONSTELLATION_NODE

#: Link fade distance in logical pixels (guide's 150px; Qt scales for DPR).
LINK_MAX_DISTANCE = 150.0
#: Node radius in logical pixels.
NODE_RADIUS = 1.5
#: Animation cadence (~60fps).
FRAME_INTERVAL_MS = 16


def prefers_reduced_motion() -> bool:
    """True when ``NEXUS_REDUCED_MOTION`` is set to a truthy value."""
    return os.environ.get("NEXUS_REDUCED_MOTION", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def compute_node_count(width: int) -> int:
    """~40 nodes at a typical width, floored at 18, capped at 46 (guide parity)."""
    return max(18, min(46, int(width) // 34))


@dataclass
class _Node:
    x: float
    y: float
    vx: float
    vy: float


class ConstellationBackground(QWidget):
    """Transparent animated constellation background widget."""

    def __init__(
        self,
        parent: QWidget | None = None,
        *,
        reduced_motion: bool | None = None,
        rng: random.Random | None = None,
    ) -> None:
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        self.setAttribute(Qt.WidgetAttribute.WA_NoSystemBackground, True)
        self._reduced_motion = (
            prefers_reduced_motion() if reduced_motion is None else reduced_motion
        )
        self._rng = rng or random.Random()
        self._nodes: list[_Node] = []
        self._built_size: tuple[int, int] = (0, 0)
        self._running = False
        self._timer = QTimer(self)
        self._timer.setInterval(FRAME_INTERVAL_MS)
        self._timer.timeout.connect(self._advance)
        self._rebuild_nodes()

    # -- public API ---------------------------------------------------------
    @property
    def reduced_motion(self) -> bool:
        return self._reduced_motion

    def node_count(self) -> int:
        """Current node population."""
        return len(self._nodes)

    def is_running(self) -> bool:
        """True while the animation timer is active."""
        return self._running

    def start(self) -> None:
        """Begin animating, or paint a single static frame under reduced motion.

        Rebuilds the node field first only if the widget has been resized since
        it was last built, so a visibility-driven resume never resets positions
        (no visual jump) while a from-scratch start always matches the size.
        """
        self._ensure_nodes_for_size()
        if self._reduced_motion:
            self.update()
            return
        if not self._running:
            self._running = True
            self._timer.start()

    def stop(self) -> None:
        """Pause the animation timer."""
        self._running = False
        self._timer.stop()

    # -- Qt events ----------------------------------------------------------
    def showEvent(self, event: object) -> None:  # noqa: N802
        super().showEvent(event)  # type: ignore[arg-type]
        self.start()

    def hideEvent(self, event: object) -> None:  # noqa: N802
        super().hideEvent(event)  # type: ignore[arg-type]
        self.stop()

    def resizeEvent(self, event: object) -> None:  # noqa: N802
        super().resizeEvent(event)  # type: ignore[arg-type]
        self._rebuild_nodes()

    def paintEvent(self, _event: object) -> None:  # noqa: N802
        if not self._nodes:
            return
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        maxd = LINK_MAX_DISTANCE

        # Distance-faded links.
        link = QColor(CONSTELLATION_LINK)
        for i, n in enumerate(self._nodes):
            for m in self._nodes[i + 1 :]:
                dx = n.x - m.x
                dy = n.y - m.y
                d = math.hypot(dx, dy)
                if d < maxd:
                    link.setAlphaF((1.0 - d / maxd) * 0.45)
                    painter.setPen(QPen(link, 0.6))
                    painter.drawLine(QPointF(n.x, n.y), QPointF(m.x, m.y))

        # Nodes.
        node = QColor(CONSTELLATION_NODE)
        node.setAlphaF(0.85)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(node)
        for n in self._nodes:
            painter.drawEllipse(QPointF(n.x, n.y), NODE_RADIUS, NODE_RADIUS)

        painter.end()

    # -- internals ----------------------------------------------------------
    def _ensure_nodes_for_size(self) -> None:
        """Rebuild the node field if the widget size changed since last build."""
        if (max(1, self.width()), max(1, self.height())) != self._built_size:
            self._rebuild_nodes()

    def _rebuild_nodes(self) -> None:
        w = max(1, self.width())
        h = max(1, self.height())
        count = compute_node_count(w)
        self._nodes = [
            _Node(
                x=self._rng.random() * w,
                y=self._rng.random() * h,
                vx=(self._rng.random() - 0.5) * 0.16,
                vy=(self._rng.random() - 0.5) * 0.16,
            )
            for _ in range(count)
        ]
        self._built_size = (w, h)

    def _advance(self) -> None:
        w = max(1, self.width())
        h = max(1, self.height())
        for n in self._nodes:
            n.x += n.vx
            n.y += n.vy
            if n.x < 0 or n.x > w:
                n.vx *= -1
            if n.y < 0 or n.y > h:
                n.vy *= -1
        self.update()
