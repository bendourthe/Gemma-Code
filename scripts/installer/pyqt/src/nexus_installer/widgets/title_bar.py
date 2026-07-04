"""Custom frameless dark title bar (v1.9.0 T301).

Replaces the native OS title bar on the installer window. It carries the
transparent brand mark + "Nexus AI Studio" wordmark and the window controls
(minimize / maximize-restore / close), and provides frameless behaviour:
drag-to-move (native ``startSystemMove`` where available, with a manual
delta-move fallback) and double-click-to-maximize.

The mark is fed the transparent (now squircle-rounded, Phase 2) ``assets/
icon.png`` and given a small static cyan glow. Chrome does not bob -- the
animated floating-glow logo lives in the header and welcome hero (T303) so a
window title bar never draws attention with motion.
"""

from __future__ import annotations

import os
from pathlib import Path

from PyQt5.QtCore import QPoint, Qt, pyqtSignal
from PyQt5.QtGui import QColor, QPixmap
from PyQt5.QtWidgets import (
    QGraphicsDropShadowEffect,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QWidget,
)

from nexus_installer.constants import GLOW_BLUR_SMALL, GLOW_RGBA, TITLE_BAR_HEIGHT

#: Control-button glyphs (unicode escapes keep the source ASCII-clean).
_GLYPH_MINIMIZE = "–"  # en dash
_GLYPH_MAXIMIZE = "□"  # white square
_GLYPH_RESTORE = "❐"  # upper-right shadowed white square
_GLYPH_CLOSE = "✕"  # multiplication x


def _find_brand_mark() -> Path:
    """Locate the transparent ``assets/icon.png`` by walking up from here.

    Mirrors the header/welcome resolvers: works from the source tree and the
    frozen bundle (the PyInstaller spec stages ``assets/`` at the bundle root).
    """
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "assets" / "icon.png"
        if candidate.is_file():
            return candidate
    return Path("assets") / "icon.png"


class TitleBar(QWidget):
    """Custom dark title bar for the frameless installer window."""

    minimize_requested = pyqtSignal()
    maximize_toggle_requested = pyqtSignal()
    close_requested = pyqtSignal()

    def __init__(
        self,
        title: str = "Nexus AI Studio",
        *,
        mark_path: str | os.PathLike[str] | None = None,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.setObjectName("titleBar")
        self.setFixedHeight(TITLE_BAR_HEIGHT)
        self._drag_offset: QPoint | None = None

        layout = QHBoxLayout(self)
        layout.setContentsMargins(12, 0, 6, 0)
        layout.setSpacing(9)

        resolved = Path(mark_path) if mark_path is not None else _find_brand_mark()
        self._has_mark = resolved.is_file()
        if self._has_mark:
            mark = QLabel()
            pixmap = QPixmap(str(resolved)).scaled(
                22,
                22,
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            mark.setPixmap(pixmap)
            mark.setStyleSheet("background: transparent;")
            glow = QGraphicsDropShadowEffect(self)
            glow.setBlurRadius(GLOW_BLUR_SMALL)
            glow.setColor(QColor(*GLOW_RGBA))
            glow.setOffset(0, 0)
            mark.setGraphicsEffect(glow)
            self._mark = mark
            layout.addWidget(mark, alignment=Qt.AlignmentFlag.AlignVCenter)

        self._title = QLabel(title)
        self._title.setObjectName("titleBarTitle")
        layout.addWidget(self._title, alignment=Qt.AlignmentFlag.AlignVCenter)

        layout.addStretch()

        self._min_btn = self._make_control(_GLYPH_MINIMIZE, "titleBarButton")
        self._min_btn.clicked.connect(self.minimize_requested.emit)
        layout.addWidget(self._min_btn)

        self._max_btn = self._make_control(_GLYPH_MAXIMIZE, "titleBarButton")
        self._max_btn.clicked.connect(self.maximize_toggle_requested.emit)
        layout.addWidget(self._max_btn)

        self._close_btn = self._make_control(_GLYPH_CLOSE, "titleBarCloseButton")
        self._close_btn.clicked.connect(self.close_requested.emit)
        layout.addWidget(self._close_btn)

    # -- construction helpers ----------------------------------------------
    @staticmethod
    def _make_control(glyph: str, object_name: str) -> QPushButton:
        btn = QPushButton(glyph)
        btn.setObjectName(object_name)
        btn.setFixedSize(38, TITLE_BAR_HEIGHT - 8)
        btn.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        return btn

    # -- public API ---------------------------------------------------------
    @property
    def minimize_button(self) -> QPushButton:
        return self._min_btn

    @property
    def maximize_button(self) -> QPushButton:
        return self._max_btn

    @property
    def close_button(self) -> QPushButton:
        return self._close_btn

    @property
    def has_mark(self) -> bool:
        return self._has_mark

    def title(self) -> str:
        return self._title.text()

    def set_title(self, text: str) -> None:
        self._title.setText(text)

    def set_maximized(self, maximized: bool) -> None:
        """Swap the maximize button glyph to reflect the window state."""
        self._max_btn.setText(_GLYPH_RESTORE if maximized else _GLYPH_MAXIMIZE)

    # -- drag-move math (pure, unit-testable) -------------------------------
    def _begin_drag(self, global_pos: QPoint, window_top_left: QPoint) -> None:
        self._drag_offset = global_pos - window_top_left

    def _drag_target(self, global_pos: QPoint) -> QPoint | None:
        if self._drag_offset is None:
            return None
        return global_pos - self._drag_offset

    def _try_system_move(self) -> bool:
        """Ask the platform to run a native move loop. Best-effort."""
        window = self.window()
        handle = window.windowHandle() if window is not None else None
        if handle is None:
            return False
        start = getattr(handle, "startSystemMove", None)
        if start is None:
            return False
        try:
            result = start()
        except Exception:  # noqa: BLE001 -- native move is best-effort
            return False
        # Some Qt bindings return None on success; treat non-False as started.
        return result is not False

    # -- Qt events ----------------------------------------------------------
    def mousePressEvent(self, event: object) -> None:  # noqa: N802
        if event.button() != Qt.MouseButton.LeftButton:  # type: ignore[attr-defined]
            super().mousePressEvent(event)  # type: ignore[arg-type]
            return
        if self._try_system_move():
            event.accept()  # type: ignore[attr-defined]
            return
        window = self.window()
        if window is not None:
            self._begin_drag(
                event.globalPos(),  # type: ignore[attr-defined]
                window.frameGeometry().topLeft(),
            )
        event.accept()  # type: ignore[attr-defined]

    def mouseMoveEvent(self, event: object) -> None:  # noqa: N802
        if not (event.buttons() & Qt.MouseButton.LeftButton):  # type: ignore[attr-defined]
            return
        target = self._drag_target(event.globalPos())  # type: ignore[attr-defined]
        window = self.window()
        if target is not None and window is not None:
            window.move(target)
            event.accept()  # type: ignore[attr-defined]

    def mouseReleaseEvent(self, event: object) -> None:  # noqa: N802
        self._drag_offset = None

    def mouseDoubleClickEvent(self, event: object) -> None:  # noqa: N802
        if event.button() == Qt.MouseButton.LeftButton:  # type: ignore[attr-defined]
            self.maximize_toggle_requested.emit()
            event.accept()  # type: ignore[attr-defined]
