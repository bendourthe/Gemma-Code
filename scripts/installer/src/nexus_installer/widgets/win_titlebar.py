"""Apply the Windows dark-mode title bar to top-level windows.

The main installer window is frameless with a custom dark title bar, but native
dialogs (QMessageBox, QFileDialog, ...) use OS chrome, which renders a *light*
title bar under a light Windows theme -- clashing with the app's dark UI. This
applies the DWM immersive-dark-mode attribute to every top-level window as it is
shown, so popups and dialogs match the dark theme. No-op off Windows.
"""

from __future__ import annotations

import contextlib
import ctypes
import sys

from PyQt5.QtCore import QEvent, QObject
from PyQt5.QtWidgets import QWidget

# DWMWA_USE_IMMERSIVE_DARK_MODE: 20 on Windows 10 20H1+ and Windows 11; 19 on
# the earlier 1809-1909 builds. Setting both is harmless (one is ignored).
_DARK_MODE_ATTRS = (20, 19)


def apply_dark_titlebar(widget: QWidget) -> None:
    """Set the dark-mode title bar on ``widget``'s native window (Windows only)."""
    if sys.platform != "win32":
        return
    try:
        hwnd = int(widget.winId())
    except (RuntimeError, ValueError):
        return
    try:
        dwm = ctypes.windll.dwmapi
    except (AttributeError, OSError):
        return
    value = ctypes.c_int(1)
    for attr in _DARK_MODE_ATTRS:
        with contextlib.suppress(OSError, ctypes.ArgumentError):
            dwm.DwmSetWindowAttribute(
                ctypes.c_void_p(hwnd),
                ctypes.c_int(attr),
                ctypes.byref(value),
                ctypes.sizeof(value),
            )


class DarkTitleBarFilter(QObject):
    """App-wide filter that darkens each top-level window's title bar on show."""

    def eventFilter(self, a0: QObject | None, a1: QEvent | None) -> bool:
        if (
            a0 is not None
            and a1 is not None
            and a1.type() == QEvent.Type.Show
            and isinstance(a0, QWidget)
            and a0.isWindow()
        ):
            apply_dark_titlebar(a0)
        return super().eventFilter(a0, a1)
