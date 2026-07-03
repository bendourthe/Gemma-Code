"""64px header band: logo area, title, and step counter."""

from __future__ import annotations

from pathlib import Path

from PyQt5.QtCore import Qt
from PyQt5.QtGui import QPixmap
from PyQt5.QtWidgets import QHBoxLayout, QLabel, QWidget

from nexus_installer.constants import HEADER_HEIGHT, TEXT_SECONDARY


def _find_brand_mark() -> Path:
    """Locate `assets/icon.png` by walking up from this module.

    Works from the source tree (repo root `assets/`) and from a frozen
    bundle (the PyInstaller spec stages the icon under `assets/` at the
    bundle root). The previous fixed-depth resolution landed on
    `scripts/assets/`, which does not exist, so the mark never rendered.
    """
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "assets" / "icon.png"
        if candidate.is_file():
            return candidate
    return Path("assets") / "icon.png"


_BRAND_MARK = _find_brand_mark()


class Header(QWidget):
    """Fixed-height header with brand mark, title, and step counter."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("headerBand")
        self.setFixedHeight(HEADER_HEIGHT)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(24, 0, 24, 0)
        layout.setSpacing(12)

        if _BRAND_MARK.exists():
            mark = QLabel()
            pixmap = QPixmap(str(_BRAND_MARK))
            mark.setPixmap(
                pixmap.scaled(
                    36,
                    36,
                    Qt.AspectRatioMode.KeepAspectRatio,
                    Qt.TransformationMode.SmoothTransformation,
                )
            )
            mark.setStyleSheet("background: transparent;")
            layout.addWidget(mark, alignment=Qt.AlignmentFlag.AlignVCenter)

        self._title = QLabel("Nexus")
        self._title.setStyleSheet(
            "font-size: 18px; font-weight: bold; background: transparent;"
        )
        layout.addWidget(self._title, alignment=Qt.AlignmentFlag.AlignVCenter)

        layout.addStretch()

        self._step_counter = QLabel("")
        self._step_counter.setObjectName("secondaryLabel")
        self._step_counter.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: 12px; background: transparent;"
        )
        layout.addWidget(self._step_counter, alignment=Qt.AlignmentFlag.AlignVCenter)

    def set_step_text(self, text: str) -> None:
        """Update the step counter display (e.g., 'Step 1 of 9')."""
        self._step_counter.setText(text)
