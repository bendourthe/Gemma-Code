"""Prerequisites check page: detect VS Code, Python, Ollama, and disk space."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from typing import TYPE_CHECKING

from PyQt5.QtCore import QThread, pyqtSignal
from PyQt5.QtWidgets import QHBoxLayout, QLabel, QVBoxLayout, QWidget

from nexus_installer.constants import (
    BG_CARD,
    BORDER,
    ERROR,
    FS_BODY,
    FS_CAPTION,
    SUCCESS,
    TEXT_SECONDARY,
    WARNING,
)
from nexus_installer.engine.platform_utils import no_window_kwargs
from nexus_installer.widgets.secondary_button import SecondaryButton

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState

DETECTION_TIMEOUT = 5


# ---------------------------------------------------------------------------
# Detection functions (platform-aware)
# ---------------------------------------------------------------------------


def find_vscode() -> str:
    """Return path to VS Code CLI binary, or empty string if not found."""
    if sys.platform == "win32":
        return _find_vscode_windows()
    if sys.platform == "darwin":
        mac_path = (
            "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
        )
        if os.path.isfile(mac_path):
            return mac_path
        path = shutil.which("code")
        return path or ""
    # Linux
    for cmd in ("code", "codium"):
        path = shutil.which(cmd)
        if path:
            return path
    # Snap / Flatpak
    for p in ("/snap/bin/code", "/var/lib/flatpak/exports/bin/com.visualstudio.code"):
        if os.path.isfile(p):
            return p
    return ""


def _find_vscode_windows() -> str:
    """Windows-specific VS Code detection: registry, well-known paths, PATH."""
    try:
        import winreg

        for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
            try:
                key = winreg.OpenKey(
                    hive,
                    r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Code.exe",
                )
                exe_path, _ = winreg.QueryValueEx(key, "")
                winreg.CloseKey(key)
                parent = os.path.dirname(str(exe_path))
                code_cmd = os.path.join(parent, "bin", "code.cmd")
                if os.path.isfile(code_cmd):
                    return code_cmd
            except OSError:
                continue
    except ImportError:
        pass

    # Well-known paths
    localappdata = os.environ.get("LOCALAPPDATA", "")
    candidates = [
        os.path.join(localappdata, "Programs", "Microsoft VS Code", "bin", "code.cmd"),
        os.path.join(
            os.environ.get("PROGRAMFILES", ""), "Microsoft VS Code", "bin", "code.cmd"
        ),
    ]
    for c in candidates:
        if c and os.path.isfile(c):
            return c

    # PATH fallback
    path = shutil.which("code.cmd") or shutil.which("code")
    return path or ""


def find_python() -> tuple[str, str]:
    """Return (path, version_string) for Python 3.11+, or ('', '') if not found."""
    for cmd in ("python", "python3", "py"):
        path = shutil.which(cmd)
        if path is None:
            continue
        if "WindowsApps" in path:
            continue
        try:
            result = subprocess.run(
                [
                    path,
                    "-c",
                    "import sys; "
                    "print(f'{sys.version_info.major}."
                    "{sys.version_info.minor}.{sys.version_info.micro}')",
                ],
                capture_output=True,
                text=True,
                timeout=DETECTION_TIMEOUT,
                **no_window_kwargs(),
            )
            version = result.stdout.strip()
            parts = version.split(".")
            if len(parts) >= 2 and int(parts[0]) >= 3 and int(parts[1]) >= 11:
                return path, version
        except (subprocess.TimeoutExpired, ValueError, OSError):
            continue
    return "", ""


def find_ollama() -> tuple[bool, str]:
    """Return (installed, version_or_info)."""
    path = shutil.which("ollama")
    if path is None and sys.platform == "win32":
        localappdata = os.environ.get("LOCALAPPDATA", "")
        candidate = os.path.join(localappdata, "Programs", "Ollama", "ollama.exe")
        if os.path.isfile(candidate):
            path = candidate
    if path is None:
        return False, ""
    try:
        result = subprocess.run(
            [path, "--version"],
            capture_output=True,
            text=True,
            timeout=DETECTION_TIMEOUT,
            **no_window_kwargs(),
        )
        return True, result.stdout.strip()
    except (subprocess.TimeoutExpired, OSError):
        return True, "installed (version unknown)"


def check_disk_space(path: str) -> float:
    """Return free disk space in GB for the drive containing `path`."""
    try:
        target = path if os.path.exists(path) else os.path.splitdrive(path)[0] or "/"
        usage = shutil.disk_usage(target)
        return round(usage.free / (1024**3), 1)
    except OSError:
        return 0.0


# ---------------------------------------------------------------------------
# Background detection thread
# ---------------------------------------------------------------------------


class _DetectionWorker(QThread):
    """Runs all prerequisite checks in a background thread."""

    vscode_result = pyqtSignal(str)  # path or ""
    python_result = pyqtSignal(str, str)  # path, version
    ollama_result = pyqtSignal(bool, str)  # installed, version
    disk_result = pyqtSignal(float)  # gb_free

    def __init__(self, install_path: str) -> None:
        super().__init__()
        self._install_path = install_path

    def run(self) -> None:
        self.vscode_result.emit(find_vscode())
        path, version = find_python()
        self.python_result.emit(path, version)
        installed, version_info = find_ollama()
        self.ollama_result.emit(installed, version_info)
        self.disk_result.emit(check_disk_space(self._install_path))


# ---------------------------------------------------------------------------
# Status row widget
# ---------------------------------------------------------------------------


class _PrereqRow(QWidget):
    """Single prerequisite row with status icon, name, and detail."""

    def __init__(self, name: str, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        layout = QHBoxLayout(self)
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(12)

        self._icon = QLabel("\u25cf")
        self._icon.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_BODY}px; background: transparent;"
        )
        self._icon.setFixedWidth(18)
        layout.addWidget(self._icon)

        info_layout = QVBoxLayout()
        info_layout.setSpacing(2)

        self._name = QLabel(name)
        self._name.setStyleSheet(
            f"font-size: {FS_BODY}px; font-weight: bold; background: transparent;"
        )
        info_layout.addWidget(self._name)

        self._detail = QLabel("Checking...")
        self._detail.setObjectName("secondaryLabel")
        self._detail.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            f"background: transparent;"
        )
        info_layout.addWidget(self._detail)

        layout.addLayout(info_layout, stretch=1)

    def set_found(self, detail: str) -> None:
        self._icon.setStyleSheet(
            f"color: {SUCCESS}; font-size: {FS_BODY}px; background: transparent;"
        )
        self._detail.setText(detail)

    def set_missing(self, detail: str) -> None:
        self._icon.setStyleSheet(
            f"color: {ERROR}; font-size: {FS_BODY}px; background: transparent;"
        )
        self._detail.setText(detail)

    def set_warning(self, detail: str) -> None:
        self._icon.setStyleSheet(
            f"color: {WARNING}; font-size: {FS_BODY}px; background: transparent;"
        )
        self._detail.setText(detail)


# ---------------------------------------------------------------------------
# Page widget
# ---------------------------------------------------------------------------


class PrerequisitesPage(QWidget):
    """Prerequisite check page with live status rows."""

    def __init__(self, state: InstallerState, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._state = state
        self._vscode_found = False
        self._disk_ok = False

        layout = QVBoxLayout(self)
        layout.setSpacing(16)

        title = QLabel("Prerequisites Check")
        title.setObjectName("pageTitle")
        layout.addWidget(title)

        # Card container
        card = QWidget()
        card.setStyleSheet(
            f"background-color: {BG_CARD}; border: 1px solid {BORDER}; "
            f"border-radius: 8px;"
        )
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(0, 8, 0, 8)
        card_layout.setSpacing(0)

        self._vscode_row = _PrereqRow("Visual Studio Code")
        self._python_row = _PrereqRow("Python 3.11+")
        self._disk_row = _PrereqRow("Disk Space")
        self._ollama_row = _PrereqRow("Ollama")

        card_layout.addWidget(self._vscode_row)
        card_layout.addWidget(self._python_row)
        card_layout.addWidget(self._disk_row)
        card_layout.addWidget(self._ollama_row)

        layout.addWidget(card)

        # Re-check button
        recheck_btn = SecondaryButton("Re-check")
        recheck_btn.clicked.connect(self._run_detection)
        layout.addWidget(recheck_btn)

        layout.addStretch()

        # Run initial detection
        self._worker: _DetectionWorker | None = None
        self._run_detection()

    def _run_detection(self) -> None:
        self._worker = _DetectionWorker(self._state.install_path)
        self._worker.vscode_result.connect(self._on_vscode)
        self._worker.python_result.connect(self._on_python)
        self._worker.ollama_result.connect(self._on_ollama)
        self._worker.disk_result.connect(self._on_disk)
        self._worker.start()

    def _on_vscode(self, path: str) -> None:
        if path:
            self._vscode_found = True
            self._state.vscode_path = path
            self._vscode_row.set_found(path)
        else:
            self._vscode_found = False
            self._vscode_row.set_missing(
                "Not found -- install from https://code.visualstudio.com"
            )

    def _on_python(self, path: str, version: str) -> None:
        if path:
            self._state.python_path = path
            self._python_row.set_found(f"Python {version} at {path}")
        else:
            self._python_row.set_warning("Not found -- will be installed automatically")

    def _on_ollama(self, installed: bool, version: str) -> None:
        self._state.ollama_installed = installed
        if installed:
            self._ollama_row.set_found(version)
        else:
            self._ollama_row.set_warning("Will be installed automatically")

    def _on_disk(self, gb_free: float) -> None:
        self._state.apply_disk_free_gb(gb_free)
        if gb_free >= 10.0:
            self._disk_ok = True
            self._disk_row.set_found(f"{gb_free} GB available")
        elif gb_free >= 5.0:
            self._disk_ok = False
            self._disk_row.set_warning(f"{gb_free} GB available (10 GB recommended)")
        else:
            self._disk_ok = False
            self._disk_row.set_missing(f"{gb_free} GB available (need at least 10 GB)")

    def validate(self) -> tuple[bool, str]:
        """Next is enabled only when VS Code is found and disk space >= 10 GB."""
        if not self._vscode_found:
            return False, "Visual Studio Code must be installed to continue."
        if not self._disk_ok:
            return False, "At least 10 GB of free disk space is required."
        return True, ""
