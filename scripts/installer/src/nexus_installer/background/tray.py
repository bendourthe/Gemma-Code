"""System-tray continuation controller (v1.11.0 Phase 7, T702).

When the user closes the window mid-install and chooses "Continue in
background", the install keeps running and its progress moves to a tray icon:
a live tooltip (percent), a menu (Open installer / Cancel install), and a
completion notification.

The controller takes an *injected* tray-icon object (duck-typed:
``setToolTip`` / ``show`` / ``hide`` / ``showMessage`` / ``setContextMenu``) so
the whole state machine is testable with a fake icon -- no real
``QSystemTrayIcon`` (which needs a live system tray) in the test suite. The pure
text helpers (:func:`tray_tooltip`, :func:`completion_message`) are tested
directly.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from PyQt5.QtCore import QObject, pyqtSignal
from PyQt5.QtWidgets import QMenu

if TYPE_CHECKING:
    from PyQt5.QtWidgets import QSystemTrayIcon, QWidget

#: Prefix for every tray string so the OS notification area names the product.
_BRAND = "Nexus AI Studio"


class _TrayIconLike(Protocol):
    """The subset of QSystemTrayIcon the controller drives."""

    def setToolTip(self, tip: str) -> None: ...  # noqa: N802
    def show(self) -> None: ...
    def hide(self) -> None: ...
    def setContextMenu(self, menu: QMenu) -> None: ...  # noqa: N802
    def showMessage(self, title: str, msg: str) -> None: ...  # noqa: N802


def tray_tooltip(status_text: str, fraction: float) -> str:
    """Format the tray tooltip, e.g. 'Nexus AI Studio - Installing... 42%'."""
    pct = max(0, min(100, round(fraction * 100)))
    return f"{_BRAND} - {status_text} {pct}%"


def completion_message(success: bool, failed_count: int = 0) -> tuple[str, str]:
    """Return (title, body) for the install-finished tray notification."""
    if success:
        return (
            "Installation complete",
            f"{_BRAND} is installed and ready. Click to open the installer.",
        )
    detail = (
        f"{failed_count} step(s) reported issues."
        if failed_count
        else "Some steps reported issues."
    )
    return (
        "Installation finished with warnings",
        f"{detail} Click to open the installer for details.",
    )


class TrayController(QObject):
    """Drives a tray icon's tooltip / menu / notifications for the install."""

    open_requested = pyqtSignal()
    cancel_requested = pyqtSignal()

    def __init__(
        self, icon: _TrayIconLike, parent: QObject | None = None
    ) -> None:
        super().__init__(parent)
        self._icon = icon
        self._visible = False
        self._tooltip = ""
        self._menu = QMenu()
        self._open_action = self._menu.addAction("Open installer")
        self._cancel_action = self._menu.addAction("Cancel install")
        if self._open_action is not None:
            self._open_action.triggered.connect(self.open_requested)
        if self._cancel_action is not None:
            self._cancel_action.triggered.connect(self.cancel_requested)
        self._icon.setContextMenu(self._menu)

    @property
    def visible(self) -> bool:
        return self._visible

    @property
    def tooltip(self) -> str:
        return self._tooltip

    def update(self, fraction: float, status_text: str = "Installing...") -> None:
        """Refresh the tooltip from the current progress."""
        self._tooltip = tray_tooltip(status_text, fraction)
        self._icon.setToolTip(self._tooltip)

    def show(self) -> None:
        self._icon.show()
        self._visible = True

    def hide(self) -> None:
        self._icon.hide()
        self._visible = False

    def notify_complete(self, success: bool, failed_count: int = 0) -> None:
        """Raise the completion notification and pin a terminal tooltip."""
        title, body = completion_message(success, failed_count)
        self._icon.showMessage(title, body)
        status = "Complete" if success else "Finished with warnings"
        self._tooltip = f"{_BRAND} - {status}"
        self._icon.setToolTip(self._tooltip)


def is_tray_available() -> bool:
    """True when the OS exposes a system tray (guards tray-mode wiring)."""
    from PyQt5.QtWidgets import QSystemTrayIcon

    return bool(QSystemTrayIcon.isSystemTrayAvailable())


def create_tray_icon(parent: QWidget) -> QSystemTrayIcon:
    """Build the real tray icon (used by the GUI entry point, not tests)."""
    from PyQt5.QtGui import QIcon
    from PyQt5.QtWidgets import QSystemTrayIcon

    from nexus_installer.registry_paths import resolve_window_icon

    tray = QSystemTrayIcon(parent)
    icon_path = resolve_window_icon()
    if icon_path is not None:
        tray.setIcon(QIcon(str(icon_path)))
    return tray
