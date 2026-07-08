"""Static, glowing Nexus mark (v1.9.0 T012).

A non-animated transparent brand mark with a cyan glow (``QGraphicsDropShadowEffect``).
Replaces the retired :class:`FloatingLogo` bob so the header shows a still,
lag-free brand anchor. Fed the transparent source only, never an opaque icon,
so it never reads as a black box.
"""

from __future__ import annotations

import os
from pathlib import Path

from PyQt5.QtCore import Qt
from PyQt5.QtGui import QColor, QPixmap
from PyQt5.QtWidgets import QGraphicsDropShadowEffect, QLabel, QWidget

from nexus_installer.constants import GLOW_BLUR_MEDIUM, GLOW_RGBA


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


class StaticLogo(QLabel):
    """Transparent Nexus mark with a cyan glow and no animation."""

    def __init__(
        self,
        pixmap_path: str | os.PathLike[str] | None = None,
        *,
        size: int = 40,
        glow_blur: int = GLOW_BLUR_MEDIUM,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._size = size
        self.setFixedSize(size, size)
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        self.setStyleSheet("background: transparent;")

        path = Path(pixmap_path) if pixmap_path is not None else _default_logo_path()
        self._has_pixmap = path.is_file()
        if self._has_pixmap:
            pixmap = QPixmap(str(path)).scaled(
                size,
                size,
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            self.setPixmap(pixmap)

        glow = QGraphicsDropShadowEffect(self)
        glow.setBlurRadius(glow_blur)
        glow.setColor(QColor(*GLOW_RGBA))
        glow.setOffset(0, 0)
        self.setGraphicsEffect(glow)

    @property
    def has_pixmap(self) -> bool:
        return self._has_pixmap
