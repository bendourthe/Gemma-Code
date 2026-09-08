"""GPU detection: probe system GPUs and recommend a model tier.

Detection functions plus the background worker. The result is shown as a
prerequisite row on the Welcome page (`pages.prerequisites`), which writes the
hardware fields into `InstallerState`.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

from PyQt5.QtCore import QThread, pyqtSignal

from nexus_installer.engine.platform_utils import no_window_kwargs

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
