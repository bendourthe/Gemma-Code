"""Welcome page: project intro and 'before you begin' callout with live detection."""

from __future__ import annotations

import shutil
import subprocess
import sys
from typing import TYPE_CHECKING

from PyQt5.QtCore import QThread, pyqtSignal
from PyQt5.QtWidgets import QHBoxLayout, QLabel, QVBoxLayout, QWidget

from nexus_installer.constants import SUCCESS, TEXT_SECONDARY, WARNING
from nexus_installer.widgets.callout_box import CalloutBox

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState

DETECTION_TIMEOUT = 5


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

        title = QLabel("Welcome")
        title.setStyleSheet(
            "font-size: 24px; font-weight: bold; background: transparent;"
        )
        layout.addWidget(title)

        subtitle = QLabel(
            "This wizard will install Gemma Code, a fully offline agentic coding "
            "assistant powered by Gemma 4 via Ollama. The process takes approximately "
            "5-15 minutes depending on your internet connection."
        )
        subtitle.setObjectName("secondaryLabel")
        subtitle.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: 13px; background: transparent;"
        )
        subtitle.setWordWrap(True)
        layout.addWidget(subtitle)

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
