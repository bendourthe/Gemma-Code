"""Welcome page: hero title, intro, and 'before you begin' live checks."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING

from PyQt5.QtCore import Qt, QThread, pyqtSignal
from PyQt5.QtWidgets import QHBoxLayout, QLabel, QVBoxLayout, QWidget

from nexus_installer.constants import (
    ACCENT_CHAT,
    ACCENT_CODING,
    ACCENT_IMAGE,
    ACCENT_VIDEO,
    BASE_INSTALL_GB,
    FS_BODY,
    FS_CAPTION,
    FS_DISPLAY,
    SUCCESS,
    TEXT_BODY,
    TEXT_SECONDARY,
    WARNING,
)
from nexus_installer.engine.platform_utils import no_window_kwargs
from nexus_installer.widgets.callout_box import CalloutBox
from nexus_installer.widgets.gradient_wordmark import GradientWordmark

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState

DETECTION_TIMEOUT = 5

# (label, module accent) -- the desktop app's four pillars.
_PILLARS: tuple[tuple[str, str], ...] = (
    ("Chat", ACCENT_CHAT),
    ("Agentic Coding", ACCENT_CODING),
    ("Image", ACCENT_IMAGE),
    ("Video", ACCENT_VIDEO),
)


def _existing_anchor(path: str) -> str:
    """Nearest existing directory on the install path's volume.

    The install path (e.g. C:\\Program Files\\NexusAI) does not exist yet on the
    Welcome page, so probing it directly raised FileNotFoundError and the check
    wrongly reported 0 GB free (the amber-dot-with-ample-space bug). Walk up to
    the deepest existing parent, falling back to the home directory.
    """
    candidate = Path(path)
    while not candidate.exists() and candidate != candidate.parent:
        candidate = candidate.parent
    return str(candidate) if candidate.exists() else os.path.expanduser("~")


class _QuickCheckWorker(QThread):
    """Runs lightweight checks in the background."""

    vscode_found = pyqtSignal(bool, str)  # (found, path)
    python_found = pyqtSignal(bool, str)  # (found, version)
    disk_ok = pyqtSignal(bool, float)  # (sufficient, gb_free)

    def __init__(self, install_path: str, required_gb: float) -> None:
        super().__init__()
        self._install_path = install_path
        self._required_gb = required_gb

    def run(self) -> None:
        # VS Code
        vscode = shutil.which("code")
        if vscode is None and sys.platform == "win32":
            vscode = shutil.which("code.cmd")
        self.vscode_found.emit(vscode is not None, vscode or "")

        # Python 3.11+
        py_path, py_ok = self._find_python()
        self.python_found.emit(py_ok, py_path)

        # Disk space: probe an existing anchor on the target volume (the install
        # dir does not exist yet) against the base-install requirement.
        try:
            usage = shutil.disk_usage(_existing_anchor(self._install_path))
            gb_free = usage.free / (1024**3)
            self.disk_ok.emit(gb_free >= self._required_gb, round(gb_free, 1))
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
                    **no_window_kwargs(),
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
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            f"background: transparent;"
        )
        self._dot.setFixedWidth(14)
        layout.addWidget(self._dot)

        self._label = QLabel(text)
        self._label.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            f"background: transparent;"
        )
        layout.addWidget(self._label, stretch=1)

    def set_ok(self, ok: bool) -> None:
        color = SUCCESS if ok else WARNING
        self._dot.setStyleSheet(
            f"color: {color}; font-size: {FS_CAPTION}px; background: transparent;"
        )


class WelcomePage(QWidget):
    """First wizard page with intro text and live prerequisite dots."""

    def __init__(self, state: InstallerState, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._state = state

        layout = QVBoxLayout(self)
        layout.setSpacing(16)

        # Hero title. The floating-logo lockup is retired (T013): no logo beside
        # the title, no bob animation -- just the wordmark-scale hero heading.
        title = GradientWordmark(
            "Welcome to Nexus",
            " AI Studio",
            FS_DISPLAY,
            align=Qt.AlignmentFlag.AlignLeft,
        )
        layout.addWidget(title)

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
            f"color: {TEXT_BODY}; font-size: {FS_BODY}px; background: transparent;"
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
                f"border-radius: 10px; padding: 2px 10px; font-size: {FS_CAPTION}px; "
                f"background: transparent;"
            )
            chips.addWidget(chip)
        chips.addStretch()
        layout.addLayout(chips)

        # Before-you-begin callout. The disk requirement is the base install
        # (plus any already-selected models); the precise per-selection check
        # lives on the Models picker footer.
        required_gb = BASE_INSTALL_GB + getattr(state, "selected_models_gb", 0.0)
        self._callout = CalloutBox(title="Before you begin")
        self._vscode_dot = _StatusDot("Visual Studio Code installed")
        self._python_dot = _StatusDot("Python 3.11 or newer")
        self._disk_dot = _StatusDot(
            f"At least {int(required_gb)} GB free for the base install "
            "(model downloads need more)"
        )
        self._inet_dot = _StatusDot("Internet connection for downloading components")
        self._inet_dot.set_ok(True)  # Assumed OK

        self._callout.add_item(self._vscode_dot)
        self._callout.add_item(self._python_dot)
        self._callout.add_item(self._disk_dot)
        self._callout.add_item(self._inet_dot)
        layout.addWidget(self._callout)

        layout.addStretch()

        # Run detection in background
        self._worker = _QuickCheckWorker(state.install_path, required_gb)
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
