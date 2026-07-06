"""Floating, glowing Nexus mark (v1.9.0 T203).

The PyQt twin of the desktop `<FloatingLogo/>`: the transparent brand mark
with a cyan glow (``QGraphicsDropShadowEffect``) that bobs +/-9px over 7s on an
ease-in-out loop (``QPropertyAnimation``). Motion is disabled under reduced
motion, leaving a static glowing mark. Fed the transparent source only, never
an opaque icon, so it never reads as a black box. See
docs/versions/v1/v1.9.0/design-tokens.md.
"""

from __future__ import annotations

import os
from pathlib import Path

from PyQt5.QtCore import (
    QAbstractAnimation,
    QEasingCurve,
    QPropertyAnimation,
    Qt,
    pyqtProperty,
)
from PyQt5.QtGui import QColor, QPixmap
from PyQt5.QtWidgets import QGraphicsDropShadowEffect, QLabel, QWidget

from nexus_installer.constants import GLOW_BLUR_LARGE, GLOW_RGBA
from nexus_installer.widgets.constellation import prefers_reduced_motion

#: Vertical bob amplitude in pixels (guide's translateY(-9px)).
FLOAT_AMPLITUDE = 9
#: Bob period in milliseconds (guide's 7s float).
FLOAT_DURATION_MS = 7000


def _default_logo_path() -> Path:
    """Locate the transparent brand mark by walking up from this module.

    Works from the source tree (repo-root ``assets/``) and a frozen bundle
    (the PyInstaller spec stages ``assets/`` at the bundle root).
    """
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "assets" / "nexus-ai-primary_no-background.png"
        if candidate.is_file():
            return candidate
    return Path("assets") / "nexus-ai-primary_no-background.png"


class FloatingLogo(QWidget):
    """Transparent Nexus mark with a cyan glow and a slow vertical bob."""

    def __init__(
        self,
        pixmap_path: str | os.PathLike[str] | None = None,
        *,
        size: int = 112,
        glow_blur: int = GLOW_BLUR_LARGE,
        reduced_motion: bool | None = None,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._size = size
        self._offset = 0.0
        self._reduced_motion = (
            prefers_reduced_motion() if reduced_motion is None else reduced_motion
        )

        # Reserve room above/below the mark so the bob is never clipped.
        self.setFixedSize(size, size + 2 * FLOAT_AMPLITUDE)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)

        self._label = QLabel(self)
        self._label.setFixedSize(size, size)
        self._label.setStyleSheet("background: transparent;")
        self._label.move((self.width() - size) // 2, FLOAT_AMPLITUDE)

        path = Path(pixmap_path) if pixmap_path is not None else _default_logo_path()
        self._has_pixmap = path.is_file()
        if self._has_pixmap:
            pixmap = QPixmap(str(path)).scaled(
                size,
                size,
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            self._label.setPixmap(pixmap)

        glow = QGraphicsDropShadowEffect(self)
        glow.setBlurRadius(glow_blur)
        glow.setColor(QColor(*GLOW_RGBA))
        glow.setOffset(0, 0)
        self._label.setGraphicsEffect(glow)

        self._anim = QPropertyAnimation(self, b"floatOffset", self)
        self._anim.setDuration(FLOAT_DURATION_MS)
        self._anim.setStartValue(0.0)
        self._anim.setKeyValueAt(0.5, float(FLOAT_AMPLITUDE))
        self._anim.setEndValue(0.0)
        self._anim.setEasingCurve(QEasingCurve.Type.InOutSine)
        self._anim.setLoopCount(-1)

    # -- float-offset property (animated) -----------------------------------
    def _get_offset(self) -> float:
        return self._offset

    def _set_offset(self, value: float) -> None:
        self._offset = value
        # Bob upward: offset 0 -> baseline, offset AMPLITUDE -> top.
        self._label.move((self.width() - self._size) // 2, int(FLOAT_AMPLITUDE - value))

    floatOffset = pyqtProperty(float, fget=_get_offset, fset=_set_offset)

    # -- public API ---------------------------------------------------------
    @property
    def reduced_motion(self) -> bool:
        return self._reduced_motion

    @property
    def has_pixmap(self) -> bool:
        return self._has_pixmap

    def start(self) -> None:
        """Start the bob, unless reduced motion is requested."""
        if self._reduced_motion:
            return
        self._anim.start()

    def stop(self) -> None:
        """Stop the bob and reset to the baseline."""
        self._anim.stop()
        self._set_offset(0.0)

    def is_animating(self) -> bool:
        return self._anim.state() == QAbstractAnimation.State.Running

    # -- Qt events ----------------------------------------------------------
    def showEvent(self, event: object) -> None:  # noqa: N802
        super().showEvent(event)  # type: ignore[arg-type]
        self.start()

    def hideEvent(self, event: object) -> None:  # noqa: N802
        super().hideEvent(event)  # type: ignore[arg-type]
        self.stop()
