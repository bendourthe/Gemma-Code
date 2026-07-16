"""Left navigation sidebar (v1.11.0 Phase 6, T601).

The mockup's primary navigation surface: a fixed-width column with the brand
block (:class:`Header`) on top, one clickable row per wizard section in the
middle (with a state icon -- done / current / pending / locked), a stretch, and
a "Need help?" block pinned to the bottom.

Two orthogonal signals drive a row's look:

* **selected** -- which section is currently shown in the content area (the row
  gets a left accent bar). Set via :meth:`set_selected`.
* **navState** -- the section's progression / lock state, an independent icon +
  color. Set via :meth:`set_states`.

Clicking a row emits :data:`section_clicked` with the section index; the window
decides whether/how to honor it (free navigation during install, T602).
"""

from __future__ import annotations

from PyQt5.QtCore import Qt, QUrl, pyqtSignal
from PyQt5.QtGui import QDesktopServices, QMouseEvent
from PyQt5.QtWidgets import (
    QFrame,
    QLabel,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from nexus_installer.constants import (
    ACCENT,
    DOCS_URL,
    FS_BODY,
    FS_CAPTION,
    SIDEBAR_NAV_ROW_HEIGHT,
    SIDEBAR_WIDTH,
)
from nexus_installer.widgets.header import Header

# State-icon glyphs (ASCII-safe source via escapes; the project convention). A
# section's icon reflects its progression, not a per-section pictogram.
_ICON_DONE = "\u2713"  # check
_ICON_CURRENT = "\u25cf"  # filled circle
_ICON_PENDING = "\u25cb"  # hollow circle
_ICON_LOCKED = "\U0001f512"  # padlock

_STATE_ICONS = {
    "done": _ICON_DONE,
    "current": _ICON_CURRENT,
    "pending": _ICON_PENDING,
    "locked": _ICON_LOCKED,
}


class _NavRow(QPushButton):
    """One clickable navigation row: [state icon] section name."""

    def __init__(self, index: int, name: str, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._index = index
        self._name = name
        self.setObjectName("sidebarNavRow")
        self.setFlat(True)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setMinimumHeight(SIDEBAR_NAV_ROW_HEIGHT)
        self.setProperty("navState", "pending")
        self.setProperty("selected", False)
        self._state = "pending"
        self._render()

    @property
    def index(self) -> int:
        return self._index

    @property
    def nav_state(self) -> str:
        return self._state

    def set_nav_state(self, state: str) -> None:
        self._state = state
        self.setProperty("navState", state)
        self._render()
        self._repolish()

    def set_selected(self, selected: bool) -> None:
        self.setProperty("selected", selected)
        self._repolish()

    def _render(self) -> None:
        icon = _STATE_ICONS.get(self._state, _ICON_PENDING)
        # A fixed-width icon slot keeps the names left-aligned across states.
        self.setText(f"  {icon}   {self._name}")

    def _repolish(self) -> None:
        style = self.style()
        if style is not None:
            style.unpolish(self)
            style.polish(self)


class _HelpBox(QFrame):
    """Bottom-of-sidebar "Need help?" block; the whole box opens the docs."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("helpBox")
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        inner = QVBoxLayout(self)
        inner.setContentsMargins(14, 12, 14, 12)
        inner.setSpacing(2)

        title = QLabel("Need help?")
        title.setStyleSheet(
            f"font-size: {FS_BODY}px; font-weight: 600; background: transparent;"
        )
        inner.addWidget(title)

        link = QLabel("Visit our documentation")
        link.setStyleSheet(
            f"color: {ACCENT}; font-size: {FS_CAPTION}px; background: transparent;"
        )
        inner.addWidget(link)

    def mousePressEvent(self, a0: QMouseEvent | None) -> None:  # noqa: N802
        # User-initiated help; not part of the (browser-free) install flow.
        QDesktopServices.openUrl(QUrl(DOCS_URL))
        super().mousePressEvent(a0)


class Sidebar(QWidget):
    """Fixed-width nav column: brand block, section rows, help block."""

    section_clicked = pyqtSignal(int)

    def __init__(self, steps: list[str], parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("sidebar")
        self.setFixedWidth(SIDEBAR_WIDTH)
        self._steps = list(steps)
        self._selected_index = -1

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Brand block (T604): logo + wordmark + "Setup Wizard".
        self._brand = Header()
        layout.addWidget(self._brand)

        # Section rows.
        nav_container = QWidget()
        nav_layout = QVBoxLayout(nav_container)
        nav_layout.setContentsMargins(8, 8, 8, 8)
        nav_layout.setSpacing(2)
        self._rows: list[_NavRow] = []
        for i, name in enumerate(self._steps):
            row = _NavRow(i, name)
            row.clicked.connect(
                lambda _checked=False, idx=i: self.section_clicked.emit(idx)
            )
            nav_layout.addWidget(row)
            self._rows.append(row)
        layout.addWidget(nav_container)

        layout.addStretch(1)

        # "Need help?" block pinned to the bottom.
        layout.addWidget(self._build_help_block())

    @property
    def brand(self) -> Header:
        return self._brand

    @property
    def rows(self) -> list[_NavRow]:
        return list(self._rows)

    def _build_help_block(self) -> QFrame:
        return _HelpBox()

    # -- state ------------------------------------------------------------

    def set_selected(self, index: int) -> None:
        """Mark which section is currently shown (the left-accent highlight)."""
        self._selected_index = index
        for row in self._rows:
            row.set_selected(row.index == index)

    def set_states(self, states: list[str]) -> None:
        """Apply a per-row progression/lock state (done/current/pending/locked)."""
        for row, state in zip(self._rows, states, strict=False):
            row.set_nav_state(state)

    def set_row_label(self, index: int, name: str) -> None:
        """Override a row's display name (e.g. Models category progress)."""
        if 0 <= index < len(self._rows):
            self._rows[index]._name = name
            self._rows[index]._render()

    def set_row_tooltip(self, index: int, tooltip: str) -> None:
        if 0 <= index < len(self._rows):
            self._rows[index].setToolTip(tooltip)
