"""Windows taskbar identity + dark-mode title bar for top-level windows.

The main installer window is frameless with a custom dark title bar, but native
dialogs (QMessageBox, QFileDialog, ...) use OS chrome, which renders a *light*
title bar under a light Windows theme -- clashing with the app's dark UI. This
applies the DWM immersive-dark-mode attribute to every top-level window as it is
shown, so popups and dialogs match the dark theme.

The same Show hook also forces a real taskbar identity. A frameless PyInstaller
onefile otherwise paints the generic Windows application glyph: UPX can strip
the PE icon resource, and Windows ``LoadImage`` often rejects a fully
transparent PNG-in-ICO. No-op off Windows.
"""

from __future__ import annotations

import contextlib
import ctypes
import sys
from pathlib import Path

from PyQt5.QtCore import QEvent, QObject, Qt
from PyQt5.QtGui import QIcon, QImage, QPainter
from PyQt5.QtWidgets import QWidget

from nexus_installer.registry_paths import asset_file

# DWMWA_USE_IMMERSIVE_DARK_MODE: 20 on Windows 10 20H1+ and Windows 11; 19 on
# the earlier 1809-1909 builds. Setting both is harmless (one is ignored).
_DARK_MODE_ATTRS = (20, 19)

_WS_EX_APPWINDOW = 0x00040000
_WS_EX_TOOLWINDOW = 0x00000080
_GWL_EXSTYLE = -20
_WM_SETICON = 0x0080
_ICON_SMALL = 0
_ICON_BIG = 1
_GCLP_HICON = -14
_GCLP_HICONSM = -34
_IMAGE_ICON = 1
_LR_LOADFROMFILE = 0x00000010
_BI_RGB = 0

_hicon_big = 0
_hicon_small = 0


def build_window_icon() -> QIcon | None:
    """QIcon packed from PNG then ICO so Qt and the taskbar both have a raster.

    ``icon.ico`` is the multi-resolution PE resource; ``icon.png`` is the
    raster Windows paints reliably. Returns ``None`` when no icon asset is
    staged so callers skip ``setWindowIcon``.
    """
    icon = QIcon()
    added = False
    png = asset_file("icon.png")
    if png.is_file():
        icon.addFile(str(png))
        added = True
    ico = asset_file("icon.ico")
    if ico.is_file():
        icon.addFile(str(ico))
        added = True
    if not added:
        mark = asset_file("nexus-ai-primary_no-background.png")
        if mark.is_file():
            icon.addFile(str(mark))
            added = True
    return icon if added else None


def apply_dark_titlebar(widget: QWidget) -> None:
    """Set the dark-mode title bar on ``widget``'s native window (Windows only)."""
    if sys.platform != "win32":
        return
    hwnd = _hwnd(widget)
    if hwnd == 0:
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


def apply_windows_taskbar_identity(widget: QWidget) -> None:
    """Force AppWindow + WM_SETICON so the taskbar shows the Nexus mark."""
    if sys.platform != "win32":
        return
    hwnd = _hwnd(widget)
    if hwnd == 0:
        return
    try:
        user32 = ctypes.windll.user32
    except (AttributeError, OSError):
        return
    _force_appwindow(user32, hwnd)
    big, small = _taskbar_hicons()
    if big:
        _set_icon(user32, hwnd, _ICON_BIG, _GCLP_HICON, big)
    if small:
        _set_icon(user32, hwnd, _ICON_SMALL, _GCLP_HICONSM, small)


def _hwnd(widget: QWidget) -> int:
    try:
        return int(widget.winId())
    except (RuntimeError, ValueError):
        return 0


def _force_appwindow(user32: ctypes.WinDLL, hwnd: int) -> None:
    get_long, set_long = _window_long_fns(user32)
    with contextlib.suppress(OSError, ctypes.ArgumentError, AttributeError):
        exstyle = int(get_long(ctypes.c_void_p(hwnd), _GWL_EXSTYLE))
        exstyle = (exstyle | _WS_EX_APPWINDOW) & ~_WS_EX_TOOLWINDOW
        set_long(ctypes.c_void_p(hwnd), _GWL_EXSTYLE, exstyle)


def _window_long_fns(user32: ctypes.WinDLL):
    if ctypes.sizeof(ctypes.c_void_p) == 8:
        get_long = user32.GetWindowLongPtrW
        set_long = user32.SetWindowLongPtrW
    else:
        get_long = user32.GetWindowLongW
        set_long = user32.SetWindowLongW
    get_long.restype = ctypes.c_ssize_t
    set_long.restype = ctypes.c_ssize_t
    return get_long, set_long


def _set_icon(
    user32: ctypes.WinDLL, hwnd: int, which: int, class_index: int, hicon: int
) -> None:
    with contextlib.suppress(OSError, ctypes.ArgumentError, AttributeError):
        user32.SendMessageW(ctypes.c_void_p(hwnd), _WM_SETICON, which, hicon)
    with contextlib.suppress(OSError, ctypes.ArgumentError, AttributeError):
        if ctypes.sizeof(ctypes.c_void_p) == 8:
            user32.SetClassLongPtrW(ctypes.c_void_p(hwnd), class_index, hicon)
        else:
            user32.SetClassLongW(ctypes.c_void_p(hwnd), class_index, hicon)


def _taskbar_hicons() -> tuple[int, int]:
    global _hicon_big, _hicon_small
    if _hicon_big and _hicon_small:
        return _hicon_big, _hicon_small
    _hicon_big = _make_hicon(32) or _loadimage_ico(32)
    _hicon_small = _make_hicon(16) or _loadimage_ico(16)
    return _hicon_big, _hicon_small


def _loadimage_ico(size: int) -> int:
    ico = asset_file("icon.ico")
    if not ico.is_file():
        return 0
    try:
        user32 = ctypes.windll.user32
        user32.LoadImageW.restype = ctypes.c_void_p
        handle = user32.LoadImageW(
            None, str(ico), _IMAGE_ICON, size, size, _LR_LOADFROMFILE
        )
        return int(handle or 0)
    except (OSError, ctypes.ArgumentError, AttributeError):
        return 0


def _make_hicon(size: int) -> int:
    image = _render_taskbar_tile(size)
    if image is None:
        return 0
    return _hicon_from_image(image)


def _first_existing(*names: str) -> Path | None:
    for name in names:
        path = asset_file(name)
        if path.is_file():
            return path
    return None


def _render_taskbar_tile(size: int) -> QImage | None:
    # v2.2.3 Phase 7 (7.2): prefer the transparent brand mark (the same source
    # the installed app's window-icon.png uses); the black-background icon.png
    # is only the fallback, and the canvas stays fully transparent (alpha 0)
    # instead of the old opaque navy fill, so the taskbar tile matches the
    # installed app's transparent PNG tile.
    src_path = _first_existing("nexus-ai-primary_no-background.png", "icon.png")
    if src_path is None:
        return None
    src = QImage(str(src_path))
    if src.isNull():
        return None
    canvas = QImage(size, size, QImage.Format_ARGB32)
    canvas.fill(0)
    painter = QPainter(canvas)
    painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, True)
    scaled = src.scaled(
        size,
        size,
        Qt.AspectRatioMode.KeepAspectRatio,
        Qt.TransformationMode.SmoothTransformation,
    )
    x = (size - scaled.width()) // 2
    y = (size - scaled.height()) // 2
    painter.drawImage(x, y, scaled)
    painter.end()
    return canvas


class _BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", ctypes.c_uint32),
        ("biWidth", ctypes.c_int32),
        ("biHeight", ctypes.c_int32),
        ("biPlanes", ctypes.c_uint16),
        ("biBitCount", ctypes.c_uint16),
        ("biCompression", ctypes.c_uint32),
        ("biSizeImage", ctypes.c_uint32),
        ("biXPelsPerMeter", ctypes.c_int32),
        ("biYPelsPerMeter", ctypes.c_int32),
        ("biClrUsed", ctypes.c_uint32),
        ("biClrImportant", ctypes.c_uint32),
    ]


class _BITMAPINFO(ctypes.Structure):
    _fields_ = [
        ("bmiHeader", _BITMAPINFOHEADER),
        ("bmiColors", ctypes.c_uint32 * 3),
    ]


class _ICONINFO(ctypes.Structure):
    _fields_ = [
        ("fIcon", ctypes.c_int),
        ("xHotspot", ctypes.c_uint32),
        ("yHotspot", ctypes.c_uint32),
        ("hbmMask", ctypes.c_void_p),
        ("hbmColor", ctypes.c_void_p),
    ]


def _qimage_bytes(image: QImage) -> bytes | None:
    nbytes = int(image.byteCount())
    bits = image.constBits() if hasattr(image, "constBits") else image.bits()
    if bits is None:
        return None
    try:
        return bits.asstring(nbytes)
    except (AttributeError, ValueError):
        with contextlib.suppress(AttributeError, ValueError, TypeError):
            bits.setsize(nbytes)
            return bytes(bits)
    return None


def _hicon_from_image(image: QImage) -> int:
    """Build an HICON from an ARGB32 QImage. Returns 0 on any failure."""
    image = image.convertToFormat(QImage.Format_ARGB32)
    raw = _qimage_bytes(image)
    if not raw:
        return 0
    width, height = image.width(), image.height()
    try:
        gdi32 = ctypes.windll.gdi32
        user32 = ctypes.windll.user32
    except (AttributeError, OSError):
        return 0

    bmi = _BITMAPINFO()
    bmi.bmiHeader.biSize = ctypes.sizeof(_BITMAPINFOHEADER)
    bmi.bmiHeader.biWidth = width
    bmi.bmiHeader.biHeight = -height
    bmi.bmiHeader.biPlanes = 1
    bmi.bmiHeader.biBitCount = 32
    bmi.bmiHeader.biCompression = _BI_RGB
    bits_ptr = ctypes.c_void_p()
    hbm_color = gdi32.CreateDIBSection(
        None, ctypes.byref(bmi), 0, ctypes.byref(bits_ptr), None, 0
    )
    if not hbm_color or not bits_ptr:
        return 0
    ctypes.memmove(bits_ptr, raw, min(len(raw), width * height * 4))
    hbm_mask = gdi32.CreateBitmap(width, height, 1, 1, None)
    info = _ICONINFO()
    info.fIcon = 1
    info.hbmMask = hbm_mask
    info.hbmColor = hbm_color
    user32.CreateIconIndirect.restype = ctypes.c_void_p
    hicon = user32.CreateIconIndirect(ctypes.byref(info))
    gdi32.DeleteObject(hbm_color)
    if hbm_mask:
        gdi32.DeleteObject(hbm_mask)
    return int(hicon or 0)


class DarkTitleBarFilter(QObject):
    """App-wide filter that darkens chrome and stamps the taskbar icon on show."""

    def eventFilter(self, a0: QObject | None, a1: QEvent | None) -> bool:
        if (
            a0 is not None
            and a1 is not None
            and a1.type() == QEvent.Type.Show
            and isinstance(a0, QWidget)
            and a0.isWindow()
        ):
            apply_dark_titlebar(a0)
            apply_windows_taskbar_identity(a0)
        return super().eventFilter(a0, a1)
