"""GPU detection page: probe system GPUs and recommend a model tier."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from typing import TYPE_CHECKING

from PyQt5.QtCore import QThread, pyqtSignal
from PyQt5.QtWidgets import QLabel, QVBoxLayout, QWidget

from nexus_installer.constants import (
    ACCENT,
    BG_CARD,
    BORDER,
    FS_BODY,
    FS_CAPTION,
    FS_H2,
    FS_H3,
    SUCCESS,
    TEXT_SECONDARY,
    WARNING,
)
from nexus_installer.engine.host_detect import detect_total_ram_gb
from nexus_installer.engine.platform_utils import no_window_kwargs
from nexus_installer.widgets.callout_box import CalloutBox

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState

DETECTION_TIMEOUT = 5

# ---------------------------------------------------------------------------
# Model recommendation thresholds (mirrors HardwareTier.ts)
# ---------------------------------------------------------------------------
MODEL_TIERS: list[tuple[int, str, str, str]] = [
    # (min_vram_mb, model_name, label, description) -- plain-language labels
    # (v1.9.0 T026): no "MoE"/"Dense"/param jargon in the user-facing copy.
    (20480, "gemma4:31b", "Top quality", "Best answers; needs a high-VRAM GPU"),
    (8192, "gemma4:26b", "Balanced", "Excellent quality and speed"),
    (6144, "gemma4:e4b", "Recommended", "The best fit for most GPUs"),
    (4096, "gemma4:e2b", "Lightweight", "Fast responses on modest GPUs"),
]


def recommend_model(vram_mb: int) -> tuple[str, str, str]:
    """Return (model_name, label, description) for the given VRAM."""
    for min_vram, name, label, desc in MODEL_TIERS:
        if vram_mb >= min_vram:
            return name, label, desc
    return "gemma4:e2b", "Lightweight", "Runs on CPU; responses may be slow"


# ---------------------------------------------------------------------------
# GPU detection functions (ported from GpuDetector.ts)
# ---------------------------------------------------------------------------


def _run_cmd(cmd: list[str], timeout: int = DETECTION_TIMEOUT) -> str | None:
    """Run a command, return stdout or None on failure."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            **no_window_kwargs(),
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        pass
    return None


def detect_nvidia() -> tuple[str, int, str]:
    """Detect NVIDIA GPU via nvidia-smi. Returns (name, vram_mb, driver)."""
    args = [
        "--query-gpu=name,memory.total,memory.free,driver_version",
        "--format=csv,noheader,nounits",
    ]
    output = _run_cmd(["nvidia-smi", *args])
    if output is None and sys.platform == "win32":
        output = _run_cmd([r"C:\Windows\System32\nvidia-smi.exe", *args])
    if output is None:
        return "", 0, ""

    for line in output.split("\n"):
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 4:
            name = parts[0]
            try:
                vram = int(parts[1])
            except ValueError:
                continue
            driver = parts[3]
            if name and vram > 0:
                return name, vram, driver
    return "", 0, ""


def detect_amd_linux() -> tuple[str, int]:
    """Detect AMD GPU via rocm-smi on Linux. Returns (name, vram_mb)."""
    output = _run_cmd(["rocm-smi", "--showmeminfo", "vram", "--csv"])
    if output is None:
        return "", 0
    lines = output.split("\n")
    for line in lines[1:]:
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 2:
            try:
                total_bytes = int(parts[1])
                return f"AMD GPU {parts[0]}", total_bytes // (1024 * 1024)
            except ValueError:
                continue
    return "", 0


def detect_amd_windows() -> tuple[str, int]:
    """Detect AMD GPU via PowerShell on Windows. Returns (name, vram_mb)."""
    output = _run_cmd(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            "Get-CimInstance -ClassName Win32_VideoController | "
            "Select-Object Name,AdapterRAM | ConvertTo-Csv -NoTypeInformation",
        ]
    )
    if output is None:
        return "", 0
    for line in output.split("\n")[1:]:
        # Parse quoted CSV
        line = line.strip().strip('"')
        parts = line.split('","')
        if len(parts) >= 2:
            name = parts[0]
            if "amd" in name.lower() or "radeon" in name.lower():
                try:
                    adapter_ram = int(parts[1].strip('"'))
                    return name, adapter_ram // (1024 * 1024)
                except ValueError:
                    continue
    return "", 0


def detect_apple() -> tuple[str, int]:
    """Detect Apple GPU via system_profiler. Returns (name, vram_mb)."""
    if sys.platform != "darwin":
        return "", 0
    output = _run_cmd(["system_profiler", "SPDisplaysDataType", "-json"])
    if output is None:
        return "", 0
    try:
        data = json.loads(output)
        displays = data.get("SPDisplaysDataType", [])
        for display in displays:
            name = display.get("sppci_model", "Apple GPU")
            vram_str = display.get("spdisplays_vram", "")
            if vram_str and vram_str != "System":
                import re

                match = re.search(r"(\d+)", vram_str)
                if match:
                    return name, int(match.group(1))
            else:
                # Apple Silicon: 75% of system RAM
                total_ram_mb = (
                    os.sysconf("SC_PAGE_SIZE")
                    * os.sysconf("SC_PHYS_PAGES")
                    // (1024 * 1024)
                )
                return name, int(total_ram_mb * 0.75)
    except (json.JSONDecodeError, KeyError, OSError):
        pass
    return "", 0


def detect_fallback_windows() -> tuple[str, str, int]:
    """Fallback: WMI via wmic. Returns (name, vendor, vram_mb)."""
    output = _run_cmd(
        [
            "wmic",
            "path",
            "win32_VideoController",
            "get",
            "Name,AdapterRAM",
            "/format:csv",
        ]
    )
    if output is None:
        return "", "", 0
    for line in output.split("\n"):
        line = line.strip()
        if not line or line.startswith("Node"):
            continue
        parts = line.split(",")
        if len(parts) >= 3:
            try:
                adapter_ram = int(parts[1])
            except ValueError:
                continue
            name = parts[2].strip()
            if name and adapter_ram > 0:
                vendor = (
                    "nvidia"
                    if "nvidia" in name.lower()
                    else (
                        "amd"
                        if ("amd" in name.lower() or "radeon" in name.lower())
                        else ("intel" if "intel" in name.lower() else "unknown")
                    )
                )
                return name, vendor, adapter_ram // (1024 * 1024)
    return "", "", 0


def detect_fallback_linux() -> tuple[str, str]:
    """Fallback: lspci. Returns (name, vendor). No VRAM available."""
    output = _run_cmd(["lspci"])
    if output is None:
        return "", ""
    for line in output.split("\n"):
        if "VGA" in line or "3D controller" in line or "Display controller" in line:
            name = line.split(" ", 1)[1].strip() if " " in line else line
            vendor = (
                "nvidia"
                if "nvidia" in name.lower()
                else (
                    "amd"
                    if ("amd" in name.lower() or "radeon" in name.lower())
                    else ("intel" if "intel" in name.lower() else "unknown")
                )
            )
            return name, vendor
    return "", ""


def detect_gpu() -> tuple[str, str, int]:
    """Full detection pipeline. Returns (gpu_name, vendor, vram_mb)."""
    # NVIDIA
    name, vram, _ = detect_nvidia()
    if name:
        return name, "nvidia", vram

    # AMD
    if sys.platform == "linux":
        name, vram = detect_amd_linux()
    elif sys.platform == "win32":
        name, vram = detect_amd_windows()
    else:
        name, vram = "", 0
    if name:
        return name, "amd", vram

    # Apple
    name, vram = detect_apple()
    if name:
        return name, "apple", vram

    # Fallback
    if sys.platform == "win32":
        name, vendor, vram = detect_fallback_windows()
        if name:
            return name, vendor, vram
    elif sys.platform == "linux":
        name, vendor = detect_fallback_linux()
        if name:
            return name, vendor, 0

    return "", "none", 0


# ---------------------------------------------------------------------------
# Background thread
# ---------------------------------------------------------------------------


class _GpuDetectionWorker(QThread):
    """Runs GPU detection in a background thread."""

    finished = pyqtSignal(str, str, int)  # gpu_name, vendor, vram_mb

    def run(self) -> None:
        name, vendor, vram = detect_gpu()
        self.finished.emit(name, vendor, vram)


# ---------------------------------------------------------------------------
# Page widget
# ---------------------------------------------------------------------------


class GpuDetectionPage(QWidget):
    """GPU detection page with detection results and model recommendation."""

    def __init__(self, state: InstallerState, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._state = state

        layout = QVBoxLayout(self)
        layout.setSpacing(16)

        title = QLabel("GPU Detection")
        title.setObjectName("pageTitle")
        layout.addWidget(title)

        self._status_label = QLabel("Detecting GPU...")
        self._status_label.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_BODY}px; background: transparent;"
        )
        layout.addWidget(self._status_label)

        # GPU info card
        self._gpu_card = QWidget()
        self._gpu_card.setStyleSheet(
            f"background-color: {BG_CARD}; border: 1px solid {BORDER}; "
            f"border-radius: 8px; padding: 16px;"
        )
        gpu_card_layout = QVBoxLayout(self._gpu_card)

        self._gpu_name_label = QLabel("")
        self._gpu_name_label.setStyleSheet(
            f"font-size: {FS_H2}px; font-weight: bold; background: transparent;"
        )
        gpu_card_layout.addWidget(self._gpu_name_label)

        self._gpu_detail_label = QLabel("")
        self._gpu_detail_label.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            f"background: transparent;"
        )
        gpu_card_layout.addWidget(self._gpu_detail_label)

        self._gpu_card.setVisible(False)
        layout.addWidget(self._gpu_card)

        # Model recommendation callout
        self._rec_callout = CalloutBox(title="Recommended Model")
        self._rec_model_label = QLabel("")
        self._rec_model_label.setStyleSheet(
            f"color: {ACCENT}; font-size: {FS_H3}px; font-weight: bold; "
            f"background: transparent;"
        )
        self._rec_callout.add_item(self._rec_model_label)

        self._rec_desc_label = QLabel("")
        self._rec_desc_label.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            f"background: transparent;"
        )
        self._rec_callout.add_item(self._rec_desc_label)

        self._rec_callout.setVisible(False)
        layout.addWidget(self._rec_callout)

        layout.addStretch()

        # Start detection
        self._worker = _GpuDetectionWorker()
        self._worker.finished.connect(self._on_detection_complete)
        self._worker.start()

    def _on_detection_complete(self, name: str, vendor: str, vram_mb: int) -> None:
        self._state.gpu_vendor = vendor
        self._state.gpu_name = name
        self._state.vram_mb = vram_mb
        self._state.apply_total_ram_gb(detect_total_ram_gb())

        if name:
            self._status_label.setText("GPU detected successfully.")
            self._status_label.setStyleSheet(
                f"color: {SUCCESS}; font-size: {FS_BODY}px; background: transparent;"
            )

            self._gpu_name_label.setText(name)
            vram_text = f"{vram_mb} MB VRAM" if vram_mb > 0 else "VRAM not available"
            self._gpu_detail_label.setText(
                f"Vendor: {vendor.capitalize()}  |  {vram_text}"
            )
            self._gpu_card.setVisible(True)
        else:
            self._status_label.setText(
                "No dedicated GPU detected. CPU-only mode will be used."
            )
            self._status_label.setStyleSheet(
                f"color: {WARNING}; font-size: {FS_BODY}px; background: transparent;"
            )

        # Model recommendation
        model_name, model_label, model_desc = recommend_model(vram_mb)
        self._state.recommended_model = model_name
        self._state.selected_model = model_name

        self._rec_model_label.setText(f"{model_name}  ({model_label})")
        self._rec_desc_label.setText(model_desc)
        self._rec_callout.setVisible(True)
