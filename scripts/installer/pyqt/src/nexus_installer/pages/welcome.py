"""Welcome page: product lockup, intro, and 'before you begin' live checks."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING

from PyQt5.QtCore import Qt, QThread, pyqtSignal
from PyQt5.QtGui import QPixmap
from PyQt5.QtWidgets import QHBoxLayout, QLabel, QVBoxLayout, QWidget

from nexus_installer.constants import (
    ACCENT_CHAT,
    ACCENT_CODING,
    ACCENT_IMAGE,
    ACCENT_VIDEO,
    SUCCESS,
    TEXT_BODY,
    TEXT_SECONDARY,
    WARNING,
)
from nexus_installer.widgets.callout_box import CalloutBox

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState

DETECTION_TIMEOUT = 5

# The desktop app's own icon (v1.8.0 Phase 5, T503): the installer shows the
# product it installs. Walk-up resolution mirrors the header brand mark; a
# frozen build without the repo tree falls back to the bundled assets icon,
# and no icon at all degrades to a text-only lockup.
def _find_desktop_icon() -> Path:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "desktop" / "src-tauri" / "icons" / "128x128.png"
        if candidate.is_file():
            return candidate
        fallback = parent / "assets" / "icon.png"
        if fallback.is_file():
            return fallback
    return Path("assets") / "icon.png"


_DESKTOP_ICON = _find_desktop_icon()

# (label, module accent) -- the desktop app's four pillars.
_PILLARS: tuple[tuple[str, str], ...] = (
    ("Chat", ACCENT_CHAT),
    ("Agentic Coding", ACCENT_CODING),
    ("Image", ACCENT_IMAGE),
    ("Video", ACCENT_VIDEO),
)


class _QuickCheckWorker(QThread):
    """Runs lightweight checks in the background."""

    vscode_found = pyqtSignal(bool, str)  # (found, path)
    python_found = pyqtSignal(bool, str)  # (found, version)
    disk_ok = pyqtSignal(bool, float)  # (sufficient, gb_free)

    def __init__(self, install_path: str) -> None:
        super().__init__()
        self._install_path = install_path

    def run(self) -> None:
        # VS Code
        vscode = shutil.which("code")
        if vscode is None and sys.platform == "win32":
            vscode = shutil.which("code.cmd")
        self.vscode_found.emit(vscode is not None, vscode or "")

        # Python 3.11+
        py_path, py_ok = self._find_python()
        self.python_found.emit(py_ok, py_path)

        # Disk space
        try:
            usage = shutil.disk_usage(self._install_path)
            gb_free = usage.free / (1024**3)
            self.disk_ok.emit(gb_free >= 10.0, round(gb_free, 1))
        except OSError:
            self.disk_ok.emit(False, 0.0)

    @staticmethod
    def _find_python() -> tuple[str, bool]:
        for cmd in ("python", "python3", "py"):
            path = shutil.which(cmd)
            if path is None:
                continue
            if "WindowsApps" in path:
                continue
            try:
                result = subprocess.run(
                    [path, "-c", "import sys; print(sys.version_info.minor)"],
                    capture_output=True,
                    text=True,
                    timeout=DETECTION_TIMEOUT,
                )
                minor = int(result.stdout.strip())
                if minor >= 11:
                    return path, True
            except (subprocess.TimeoutExpired, ValueError, OSError):
                continue
        return "", False


class _StatusDot(QWidget):
    """Small colored dot + label indicating a check result."""

    def __init__(self, text: str, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 2, 0, 2)
        layout.setSpacing(8)

        self._dot = QLabel("\u25cf")
        self._dot.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: 10px; background: transparent;"
        )
        self._dot.setFixedWidth(14)
        layout.addWidget(self._dot)

        self._label = QLabel(text)
        self._label.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: 12px; background: transparent;"
        )
        layout.addWidget(self._label, stretch=1)

    def set_ok(self, ok: bool) -> None:
        color = SUCCESS if ok else WARNING
        self._dot.setStyleSheet(
            f"color: {color}; font-size: 10px; background: transparent;"
        )


class WelcomePage(QWidget):
    """First wizard page with intro text and live prerequisite dots."""

    def __init__(self, state: InstallerState, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._state = state

        layout = QVBoxLayout(self)
        layout.setSpacing(16)

        # Product lockup: desktop app icon + title.
        lockup = QHBoxLayout()
        lockup.setSpacing(14)
        if _DESKTOP_ICON.exists():
            mark = QLabel()
            pixmap = QPixmap(str(_DESKTOP_ICON))
            mark.setPixmap(
                pixmap.scaled(
                    56,
                    56,
                    Qt.AspectRatioMode.KeepAspectRatio,
                    Qt.TransformationMode.SmoothTransformation,
                )
            )
            mark.setStyleSheet("background: transparent;")
            lockup.addWidget(mark, alignment=Qt.AlignmentFlag.AlignVCenter)

        title = QLabel("Welcome to Nexus")
        title.setStyleSheet(
            "font-size: 24px; font-weight: bold; background: transparent;"
        )
        lockup.addWidget(title, alignment=Qt.AlignmentFlag.AlignVCenter)
        lockup.addStretch()
        layout.addLayout(lockup)

        subtitle = QLabel(
            "Nexus is your fully local AI workstation: chat, agentic coding, "
            "and image and video generation, all running on your own hardware. "
            "This wizard installs everything for you -- the runtime, the models "
            "you pick, the VS Code extension, and the Nexus desktop app -- with "
            "no terminal required. Duration depends on your connection and the "
            "models you select."
        )
        subtitle.setObjectName("secondaryLabel")
        subtitle.setStyleSheet(
            f"color: {TEXT_BODY}; font-size: 13px; background: transparent;"
        )
        subtitle.setWordWrap(True)
        layout.addWidget(subtitle)

        # Pillar chips in the desktop app's module accents.
        chips = QHBoxLayout()
        chips.setSpacing(8)
        for pillar_name, pillar_accent in _PILLARS:
            chip = QLabel(pillar_name)
            chip.setStyleSheet(
                f"color: {pillar_accent}; border: 1px solid {pillar_accent}; "
                f"border-radius: 10px; padding: 2px 10px; font-size: 11px; "
                f"background: transparent;"
            )
            chips.addWidget(chip)
        chips.addStretch()
        layout.addLayout(chips)

        # Before-you-begin callout
        self._callout = CalloutBox(title="Before you begin")
        self._vscode_dot = _StatusDot("Visual Studio Code installed")
        self._python_dot = _StatusDot("Python 3.11 or newer")
        self._disk_dot = _StatusDot("At least 10 GB free disk space")
        self._inet_dot = _StatusDot("Internet connection for downloading components")
        self._inet_dot.set_ok(True)  # Assumed OK

        self._callout.add_item(self._vscode_dot)
        self._callout.add_item(self._python_dot)
        self._callout.add_item(self._disk_dot)
        self._callout.add_item(self._inet_dot)
        layout.addWidget(self._callout)

        layout.addStretch()

        # Run detection in background
        self._worker = _QuickCheckWorker(state.install_path)
        self._worker.vscode_found.connect(self._on_vscode)
        self._worker.python_found.connect(self._on_python)
        self._worker.disk_ok.connect(self._on_disk)
        self._worker.start()

    def _on_vscode(self, found: bool, path: str) -> None:
        self._vscode_dot.set_ok(found)
        if found:
            self._state.vscode_path = path

    def _on_python(self, found: bool, path: str) -> None:
        self._python_dot.set_ok(found)
        if found:
            self._state.python_path = path

    def _on_disk(self, sufficient: bool, gb_free: float) -> None:
        self._disk_dot.set_ok(sufficient)
        self._state.disk_space_gb = gb_free
