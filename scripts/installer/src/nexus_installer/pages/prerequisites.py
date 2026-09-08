"""Prerequisites panel: VS Code, Python, disk space, Ollama, and the GPU.

Hosted on the Welcome page (the former "Setup" step folded into it). The GPU
probe is a prerequisite row like the others: it writes the hardware fields the
Models page's tier defaults read, so Next stays blocked until it has finished.
"""

from __future__ import annotations

import contextlib
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING

from PyQt5.QtCore import Qt, QThread, pyqtBoundSignal, pyqtSignal
from PyQt5.QtWidgets import (
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QToolButton,
    QVBoxLayout,
    QWidget,
)

from nexus_installer.constants import (
    ACCENT,
    ACCENT_VIDEO,
    BASE_INSTALL_GB,
    BG_WINDOW,
    BORDER_STRONG,
    ERROR,
    FS_BODY,
    FS_CAPTION,
    FW_BOLD,
    INFO,
    SUCCESS,
    TEXT_SECONDARY,
    WARNING,
    rgba_css,
)
from nexus_installer.engine.host_detect import detect_total_ram_gb
from nexus_installer.engine.platform_utils import no_window_kwargs
from nexus_installer.pages.gpu_detection import _GpuDetectionWorker, recommend_model
from nexus_installer.vram_display import display_vram_gb

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState

DETECTION_TIMEOUT = 5

#: Below this width the five rows stack in one column.
_TWO_COLUMN_MIN_PX = 520
#: Icon tile and status badge sizes on a prerequisite card.
_TILE_PX = 44
_BADGE_PX = 24


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


def _existing_anchor(path: str) -> str:
    """Nearest existing directory on the install path's volume.

    The install path (e.g. C:\\Program Files\\NexusAI) does not exist yet when
    the checks run, so probing it directly raised FileNotFoundError and the
    check wrongly reported 0 GB free. Walk up to the deepest existing parent,
    falling back to the home directory.
    """
    candidate = Path(path)
    while not candidate.exists() and candidate != candidate.parent:
        candidate = candidate.parent
    return str(candidate) if candidate.exists() else os.path.expanduser("~")


def check_disk_space(path: str) -> float:
    """Return free disk space in GB for the volume that will hold `path`."""
    try:
        usage = shutil.disk_usage(_existing_anchor(path))
        return round(usage.free / (1024**3), 1)
    except OSError:
        return 0.0


# ---------------------------------------------------------------------------
# Background detection thread
# ---------------------------------------------------------------------------


class _DetectionWorker(QThread):
    """Runs the software prerequisite checks in a background thread."""

    python_result = pyqtSignal(str, str)  # path, version
    ollama_result = pyqtSignal(bool, str)  # installed, version
    disk_result = pyqtSignal(float)  # gb_free

    def __init__(self, install_path: str) -> None:
        super().__init__()
        self._install_path = install_path

    def run(self) -> None:
        path, version = find_python()
        self.python_result.emit(path, version)
        installed, version_info = find_ollama()
        self.ollama_result.emit(installed, version_info)
        self.disk_result.emit(check_disk_space(self._install_path))


# ---------------------------------------------------------------------------
# Status row widget
# ---------------------------------------------------------------------------


class _PrereqRow(QFrame):
    """One prerequisite card: icon tile, name, detail, and a status badge."""

    def __init__(
        self,
        name: str,
        *,
        glyph: str,
        accent: str,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.setObjectName("prereqCard")
        layout = QHBoxLayout(self)
        layout.setContentsMargins(14, 12, 14, 12)
        layout.setSpacing(14)

        # Tinted rounded tile carrying a short glyph for the product.
        self._icon = QLabel(glyph)
        self._icon.setObjectName("prereqIcon")
        self._icon.setFixedSize(_TILE_PX, _TILE_PX)
        self._icon.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._icon.setStyleSheet(
            f"color: {accent}; background-color: {rgba_css(accent, 0.18)}; "
            f"border: 1px solid {rgba_css(accent, 0.45)}; border-radius: 10px; "
            f"font-size: {FS_CAPTION}px; font-weight: {FW_BOLD};"
        )
        layout.addWidget(self._icon, alignment=Qt.AlignmentFlag.AlignVCenter)

        info_layout = QVBoxLayout()
        info_layout.setSpacing(2)

        self._name = QLabel(name)
        self._name.setStyleSheet(
            f"font-size: {FS_BODY}px; font-weight: bold; background: transparent;"
        )
        info_layout.addWidget(self._name)

        self._detail = QLabel("Checking...")
        self._detail.setObjectName("secondaryLabel")
        self._detail.setWordWrap(True)
        self._style_detail(found=False)
        info_layout.addWidget(self._detail)

        layout.addLayout(info_layout, stretch=1)

        # Status badge on the right: hollow while checking, filled on result.
        self._status = QLabel("")
        self._status.setObjectName("prereqStatus")
        self._status.setFixedSize(_BADGE_PX, _BADGE_PX)
        self._status.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._set_status(None)
        layout.addWidget(self._status, alignment=Qt.AlignmentFlag.AlignVCenter)

    @property
    def detail_text(self) -> str:
        return self._detail.text()

    def _style_detail(self, *, found: bool) -> None:
        self._detail.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            "background: transparent;"
        )

    def _set_status(self, color: str | None) -> None:
        if color is None:
            self._status.setText("")
            self._status.setStyleSheet(
                f"border: 2px solid {BORDER_STRONG}; "
                f"border-radius: {_BADGE_PX // 2}px; background: transparent;"
            )
            return
        glyph = {SUCCESS: "✓", WARNING: "!", ERROR: "✕"}[color]
        self._status.setText(glyph)
        self._status.setStyleSheet(
            f"color: {BG_WINDOW}; background-color: {color}; border: none; "
            f"border-radius: {_BADGE_PX // 2}px; font-size: {FS_CAPTION}px; "
            f"font-weight: {FW_BOLD};"
        )

    def set_found(self, detail: str) -> None:
        self._set_status(SUCCESS)
        self._style_detail(found=True)
        self._detail.setText(detail)

    def set_missing(self, detail: str) -> None:
        self._set_status(ERROR)
        self._style_detail(found=False)
        self._detail.setText(detail)

    def set_warning(self, detail: str) -> None:
        self._set_status(WARNING)
        self._style_detail(found=False)
        self._detail.setText(detail)


# ---------------------------------------------------------------------------
# Panel widget
# ---------------------------------------------------------------------------


class PrerequisitesPage(QWidget):
    """Prerequisites panel with live status rows, hosted on the Welcome page."""

    #: Emitted once the GPU probe has written its result into the state, so
    #: the configuration panel on the same page can re-evaluate host locks.
    gpu_detected = pyqtSignal()

    def __init__(self, state: InstallerState, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._state = state
        self._disk_ok = False
        self._gpu_done = False
        self._worker: _DetectionWorker | None = None
        self._gpu_worker: _GpuDetectionWorker | None = None
        self._two_columns = True

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)

        title_row = QHBoxLayout()
        title_row.setContentsMargins(0, 0, 0, 0)
        title = QLabel("Prerequisites")
        title.setObjectName("cardHead")
        title_row.addWidget(title, stretch=1)
        self._recheck_btn = QToolButton()
        self._recheck_btn.setObjectName("iconButton")
        self._recheck_btn.setText("\u21bb")
        self._recheck_btn.setAccessibleName("Re-check")
        self._recheck_btn.setToolTip("Re-check")
        self._recheck_btn.setAutoRaise(True)
        self._recheck_btn.clicked.connect(self._run_detection)
        title_row.addWidget(self._recheck_btn)
        layout.addLayout(title_row)

        # One card per prerequisite, laid straight on the page (the mockup).
        grid_host = QWidget()
        grid_host.setStyleSheet("background: transparent;")
        self._grid = QGridLayout(grid_host)
        self._grid.setContentsMargins(0, 0, 0, 0)
        self._grid.setHorizontalSpacing(12)
        self._grid.setVerticalSpacing(12)
        layout.addWidget(grid_host)

        # VS Code is not a prerequisite: the extension feature detects it and
        # disables itself when it is absent.
        self._disk_row = _PrereqRow("Disk Space", glyph="☰", accent=ACCENT)
        # The GPU is a prerequisite like the others: its result drives the
        # Models page's hardware-tier defaults and the Unsloth compatibility lock.
        self._gpu_row = _PrereqRow("GPU", glyph="GPU", accent=ACCENT_VIDEO)
        self._python_row = _PrereqRow("Python 3.11+", glyph="Py", accent=WARNING)
        self._ollama_row = _PrereqRow("Ollama", glyph=">_", accent=INFO)
        self._gpu_row.set_warning("Detecting GPU...")
        self._place_prereq_grid(two_columns=True)

        self._run_detection()

    @property
    def rows(self) -> list[_PrereqRow]:
        return [self._disk_row, self._gpu_row, self._python_row, self._ollama_row]

    def _place_prereq_grid(self, *, two_columns: bool) -> None:
        if self._grid is None:
            return
        while self._grid.count():
            item = self._grid.takeAt(0)
            widget = item.widget() if item is not None else None
            if widget is not None:
                widget.setParent(self._grid.parentWidget())
        if two_columns:
            self._grid.addWidget(self._disk_row, 0, 0)
            self._grid.addWidget(self._gpu_row, 0, 1)
            self._grid.addWidget(self._python_row, 1, 0)
            self._grid.addWidget(self._ollama_row, 1, 1)
        else:
            for index, row in enumerate(self.rows):
                self._grid.addWidget(row, index, 0)

    def resizeEvent(self, event: object) -> None:  # noqa: N802
        super().resizeEvent(event)  # type: ignore[arg-type]
        size = getattr(event, "size", None)
        width = size().width() if callable(size) else self.width()
        two_columns = width >= _TWO_COLUMN_MIN_PX
        if two_columns != self._two_columns:
            self._two_columns = two_columns
            self._place_prereq_grid(two_columns=two_columns)

    @staticmethod
    def _retire_worker(
        worker: QThread | None, signals: tuple[pyqtBoundSignal, ...]
    ) -> None:
        if worker is None:
            return
        for signal in signals:
            with contextlib.suppress(TypeError):
                signal.disconnect()
        worker.quit()
        worker.wait(1000)

    def _run_detection(self) -> None:
        previous = self._worker
        if previous is not None:
            self._retire_worker(
                previous,
                (
                    previous.python_result,
                    previous.ollama_result,
                    previous.disk_result,
                ),
            )
        self._worker = _DetectionWorker(self._state.install_path)
        self._worker.python_result.connect(self._on_python)
        self._worker.ollama_result.connect(self._on_ollama)
        self._worker.disk_result.connect(self._on_disk)
        self._worker.start()

        previous_gpu = self._gpu_worker
        if previous_gpu is not None:
            self._retire_worker(previous_gpu, (previous_gpu.finished,))
        self._gpu_worker = _GpuDetectionWorker()
        self._gpu_worker.finished.connect(self._on_gpu)
        self._gpu_worker.start()

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
        if gb_free >= BASE_INSTALL_GB:
            self._disk_ok = True
            self._disk_row.set_found(f"{gb_free} GB available")
            return
        self._disk_ok = False
        detail = (
            f"{gb_free} GB available (the base install needs at least "
            f"{BASE_INSTALL_GB} GB; model downloads need more)"
        )
        if gb_free >= 5.0:
            self._disk_row.set_warning(detail)
        else:
            self._disk_row.set_missing(detail)

    def _on_gpu(self, name: str, vendor: str, vram_mb: int) -> None:
        """Record the probe result; CPU-only is a result, not a failure."""
        self._gpu_done = True
        self._state.gpu_vendor = vendor
        self._state.gpu_name = name
        self._state.vram_mb = vram_mb
        self._state.apply_total_ram_gb(detect_total_ram_gb())

        model_name, _label, _desc = recommend_model(vram_mb)
        self._state.recommended_model = model_name
        self._state.selected_model = model_name

        if name:
            vram_txt = f" ({display_vram_gb(vram_mb)} GB VRAM)" if vram_mb > 0 else ""
            self._gpu_row.set_found(f"{name}{vram_txt}")
        else:
            self._gpu_row.set_warning(
                "No dedicated GPU detected. CPU-only mode will be used."
            )
        self.gpu_detected.emit()

    def validate(self) -> tuple[bool, str]:
        """Next needs enough disk for the base install and a finished GPU probe."""
        if not self._disk_ok:
            return (
                False,
                f"At least {BASE_INSTALL_GB} GB of free disk space is required.",
            )
        if not self._gpu_done:
            return False, "Still detecting GPU..."
        return True, ""
