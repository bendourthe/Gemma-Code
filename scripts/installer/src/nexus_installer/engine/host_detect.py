"""v1.1.0 Phase 14.1 -- Cross-platform host detection.

Builds a `HostProfile` describing OS, architecture, CPU, GPU vendor + model,
RAM, VRAM, driver version, free disk space, and the canonical install path.
Every probe is fault-tolerant: missing tools yield `null` / `0` / `"unknown"`
rather than raising, so the wizard can keep running and fall back to CPU-only
provisioning when nothing better is available.
"""

from __future__ import annotations

import json
import os
import platform
import re
import shutil
import subprocess
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from nexus_installer.engine.platform_utils import (
    is_linux,
    is_macos,
    is_windows,
    no_window_kwargs,
)

DETECTION_TIMEOUT_S = 6

# CUDA 12.1 minimum NVIDIA driver major version. Matches CudaProvisioner.
MIN_CUDA_DRIVER_MAJOR = 530


@dataclass(frozen=True)
class HostProfile:
    """Snapshot of the host machine used by the wizard's provisioner dispatch."""

    os_family: str = "unknown"
    os_version: str = "unknown"
    arch: str = "unknown"
    cpu_model: str = "unknown"
    total_ram_gb: int = 0
    gpu_vendor: str = "none"
    gpu_model: str = "unknown"
    total_vram_gb: int = 0
    driver_version: str = ""
    cuda_compatible: bool = False
    metal_compatible: bool = False
    rocm_compatible: bool = False
    free_disk_gb: int = 0
    target_install_path: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _run(cmd: list[str], timeout: int = DETECTION_TIMEOUT_S) -> str | None:
    """Run a command. Return stdout (stripped) or None on any failure."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            **no_window_kwargs(),
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    output = (result.stdout or "").strip()
    return output if output else None


def _normalize_arch(value: str) -> str:
    v = value.lower()
    if v in {"x86_64", "amd64", "x64"}:
        return "x86_64"
    if v in {"arm64", "aarch64"}:
        return "arm64"
    return v or "unknown"


def _normalize_os_family() -> str:
    if is_windows():
        return "windows"
    if is_macos():
        return "macos"
    if is_linux():
        return "linux"
    return "unknown"


def _safe_disk_free_gb(path: str) -> int:
    try:
        usage = shutil.disk_usage(path)
    except OSError:
        return 0
    return int(usage.free // (1024**3))


# ---------------------------------------------------------------------------
# Windows
# ---------------------------------------------------------------------------


def _detect_windows_os_version() -> str:
    output = _run(["wmic", "os", "get", "caption,version", "/value"])
    if output:
        caption = ""
        version = ""
        for line in output.splitlines():
            line = line.strip()
            if line.startswith("Caption="):
                caption = line.split("=", 1)[1].strip()
            elif line.startswith("Version="):
                version = line.split("=", 1)[1].strip()
        if caption:
            return f"{caption} {version}".strip()
    ps_cmd = (
        "(Get-CimInstance Win32_OperatingSystem).Caption + ' ' + "
        "(Get-CimInstance Win32_OperatingSystem).Version"
    )
    output = _run(["powershell", "-NoProfile", "-Command", ps_cmd])
    if output:
        return output.strip()
    return platform.platform()


def _detect_windows_cpu_model() -> str:
    output = _run(["wmic", "cpu", "get", "name", "/value"])
    if output:
        for line in output.splitlines():
            if line.startswith("Name="):
                value = line.split("=", 1)[1].strip()
                if value:
                    return value
    output = _run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            "(Get-CimInstance Win32_Processor).Name",
        ]
    )
    if output:
        return output.strip().splitlines()[0]
    return "unknown"


def _detect_windows_total_ram_gb() -> int:
    ps_cmd = (
        "[math]::Round((Get-CimInstance Win32_ComputerSystem)"
        ".TotalPhysicalMemory / 1GB)"
    )
    output = _run(["powershell", "-NoProfile", "-Command", ps_cmd])
    if output:
        try:
            return int(float(output.strip()))
        except ValueError:
            pass
    return 0


# ---------------------------------------------------------------------------
# macOS
# ---------------------------------------------------------------------------


def _detect_macos_os_version() -> str:
    product = _run(["sw_vers", "-productName"]) or "macOS"
    version = _run(["sw_vers", "-productVersion"]) or ""
    return f"{product} {version}".strip()


def _detect_macos_cpu_model() -> str:
    output = _run(["sysctl", "-n", "machdep.cpu.brand_string"])
    if output:
        return output.strip()
    return platform.processor() or "Apple Silicon"


def _detect_macos_total_ram_gb() -> int:
    output = _run(["sysctl", "-n", "hw.memsize"])
    if output:
        try:
            return int(int(output.strip()) / (1024**3))
        except ValueError:
            pass
    return 0


# ---------------------------------------------------------------------------
# Linux
# ---------------------------------------------------------------------------


def _detect_linux_os_version() -> str:
    try:
        with open("/etc/os-release", encoding="utf-8") as f:
            data = dict(
                line.strip().split("=", 1)
                for line in f
                if "=" in line and not line.startswith("#")
            )
        pretty = data.get("PRETTY_NAME", "").strip('"')
        if pretty:
            return pretty
    except OSError:
        pass
    return platform.platform()


def _detect_linux_cpu_model() -> str:
    try:
        with open("/proc/cpuinfo", encoding="utf-8") as f:
            for line in f:
                if line.startswith("model name"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        pass
    output = _run(["lscpu"])
    if output:
        for line in output.splitlines():
            if "Model name" in line:
                return line.split(":", 1)[1].strip()
    return "unknown"


def _detect_linux_total_ram_gb() -> int:
    try:
        with open("/proc/meminfo", encoding="utf-8") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    parts = line.split()
                    if len(parts) >= 2:
                        kb = int(parts[1])
                        return int(kb / (1024 * 1024))
    except (OSError, ValueError):
        pass
    return 0


# ---------------------------------------------------------------------------
# GPU detection (returns vendor, model, vram_gb, driver_version)
# ---------------------------------------------------------------------------


def _probe_nvidia() -> tuple[str, int, str] | None:
    """Return (model, vram_gb, driver) when nvidia-smi reports a GPU."""
    args = [
        "--query-gpu=name,memory.total,driver_version",
        "--format=csv,noheader,nounits",
    ]
    output = _run(["nvidia-smi", *args])
    if output is None and is_windows():
        output = _run([r"C:\Windows\System32\nvidia-smi.exe", *args])
    if not output:
        return None
    for line in output.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 3:
            name = parts[0]
            try:
                vram_mb = int(parts[1])
            except ValueError:
                continue
            driver = parts[2]
            if name:
                return name, max(0, vram_mb // 1024), driver
    return None


def _probe_rocm() -> tuple[str, int, str] | None:
    """Return (model, vram_gb, driver) when rocm-smi reports an AMD GPU."""
    output = _run(["rocm-smi", "--showproductname", "--csv"])
    name = ""
    if output:
        for line in output.splitlines()[1:]:
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 2 and parts[1]:
                name = parts[1]
                break
    vram_output = _run(["rocm-smi", "--showmeminfo", "vram", "--csv"])
    vram_gb = 0
    if vram_output:
        for line in vram_output.splitlines()[1:]:
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 2:
                try:
                    vram_gb = int(int(parts[1]) // (1024**3))
                    break
                except ValueError:
                    continue
    driver_output = _run(["rocm-smi", "--showdriverversion"]) or ""
    driver = ""
    match = re.search(r"(\d+\.\d+(\.\d+)?)", driver_output)
    if match:
        driver = match.group(1)
    if name or vram_gb:
        return name or "AMD GPU", vram_gb, driver
    return None


def _probe_apple_gpu() -> tuple[str, int, str] | None:
    """Apple Silicon: use system_profiler. VRAM is unified memory (~75% of RAM)."""
    if not is_macos():
        return None
    output = _run(["system_profiler", "SPDisplaysDataType", "-json"])
    if not output:
        return None
    try:
        data = json.loads(output)
    except (json.JSONDecodeError, ValueError):
        return None
    displays = data.get("SPDisplaysDataType", []) or []
    for entry in displays:
        name = entry.get("sppci_model") or entry.get("_name") or "Apple GPU"
        # Apple Silicon reports `spdisplays_vram="System"`; estimate VRAM as
        # 75% of total RAM (the Metal allocator can grow that high in
        # practice on M-series chips).
        vram_raw = entry.get("spdisplays_vram") or ""
        vram_gb = 0
        if isinstance(vram_raw, str) and vram_raw and vram_raw.lower() != "system":
            match = re.search(r"(\d+)", vram_raw)
            if match:
                try:
                    vram_gb = int(match.group(1))
                except ValueError:
                    vram_gb = 0
        if vram_gb == 0:
            total_ram_gb = _detect_macos_total_ram_gb()
            vram_gb = int(total_ram_gb * 0.75)
        metal_version = entry.get("spdisplays_metal", "")
        return name, vram_gb, str(metal_version)
    return None


def _probe_windows_amd() -> tuple[str, int] | None:
    ps_cmd = (
        "Get-CimInstance Win32_VideoController | "
        "Select-Object Name,AdapterRAM | ConvertTo-Csv -NoTypeInformation"
    )
    output = _run(["powershell", "-NoProfile", "-Command", ps_cmd])
    if not output:
        return None
    for raw in output.splitlines()[1:]:
        line = raw.strip().strip('"')
        parts = line.split('","')
        if len(parts) >= 2:
            name = parts[0].strip().strip('"')
            if not name:
                continue
            lname = name.lower()
            if "amd" in lname or "radeon" in lname:
                try:
                    adapter_ram = int(parts[1].strip().strip('"'))
                except ValueError:
                    continue
                return name, max(0, adapter_ram // (1024**3))
    return None


def _probe_linux_pci_amd() -> tuple[str, int] | None:
    output = _run(["lspci"])
    if not output:
        return None
    for line in output.splitlines():
        if any(tag in line for tag in ("VGA", "3D controller", "Display controller")):
            lower = line.lower()
            if "amd" in lower or "radeon" in lower or "advanced micro" in lower:
                _, _, rest = line.partition(":")
                name = rest.strip() if rest else line.strip()
                return name, 0
    return None


def _probe_intel_gpu() -> tuple[str, int] | None:
    if is_windows():
        ps_cmd = (
            "Get-CimInstance Win32_VideoController | "
            "Where-Object {$_.Name -match 'Intel'} | "
            "Select-Object -First 1 -ExpandProperty Name"
        )
        output = _run(["powershell", "-NoProfile", "-Command", ps_cmd])
        if output:
            return output.strip().splitlines()[0], 0
    elif is_linux():
        output = _run(["lspci"])
        if output:
            for line in output.splitlines():
                if "VGA" in line and "intel" in line.lower():
                    _, _, rest = line.partition(":")
                    return rest.strip() if rest else line.strip(), 0
    return None


def detect_gpu() -> tuple[str, str, int, str]:
    """Detect GPU. Returns (vendor, model, vram_gb, driver_version)."""
    nvidia = _probe_nvidia()
    if nvidia:
        name, vram_gb, driver = nvidia
        return "nvidia", name, vram_gb, driver
    if is_macos():
        apple = _probe_apple_gpu()
        if apple:
            name, vram_gb, metal = apple
            return "apple", name, vram_gb, metal
    if is_linux():
        rocm = _probe_rocm()
        if rocm:
            name, vram_gb, driver = rocm
            return "amd", name, vram_gb, driver
        pci_amd = _probe_linux_pci_amd()
        if pci_amd:
            name, vram_gb = pci_amd
            return "amd", name, vram_gb, ""
    if is_windows():
        win_amd = _probe_windows_amd()
        if win_amd:
            name, vram_gb = win_amd
            return "amd", name, vram_gb, ""
    intel = _probe_intel_gpu()
    if intel:
        name, vram_gb = intel
        return "intel", name, vram_gb, ""
    return "none", "unknown", 0, ""


# ---------------------------------------------------------------------------
# Capability gates
# ---------------------------------------------------------------------------


def _driver_major(driver: str) -> int:
    match = re.match(r"^(\d+)", driver or "")
    return int(match.group(1)) if match else 0


def _is_cuda_compatible(vendor: str, driver: str) -> bool:
    return vendor == "nvidia" and _driver_major(driver) >= MIN_CUDA_DRIVER_MAJOR


def _is_metal_compatible(os_family: str, arch: str) -> bool:
    return os_family == "macos" and arch == "arm64"


def _is_rocm_compatible(os_family: str, vendor: str) -> bool:
    if os_family != "linux" or vendor != "amd":
        return False
    return shutil.which("rocm-smi") is not None


# ---------------------------------------------------------------------------
# Default install path
# ---------------------------------------------------------------------------


def default_install_path(os_family: str) -> str:
    if os_family == "windows":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return str(Path(base) / "Nexus")
    if os_family == "macos":
        return str(Path.home() / "Applications" / "Nexus.app")
    return str(Path.home() / ".local" / "share" / "nexus")


def _disk_probe_path(install_path: str) -> str:
    """Return an existing directory on the same volume as the install path."""
    candidate = Path(install_path)
    while not candidate.exists() and candidate != candidate.parent:
        candidate = candidate.parent
    if candidate.exists():
        return str(candidate)
    return os.path.expanduser("~")


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def detect_host(
    *,
    install_path_override: str | None = None,
    free_disk_probe: Callable[[str], int] = _safe_disk_free_gb,
) -> HostProfile:
    """Build a HostProfile for the current machine.

    Every probe is best-effort: failures collapse to safe defaults. The
    `install_path_override` and `free_disk_probe` arguments exist so the
    pytest matrix can drive the function deterministically.
    """
    os_family = _normalize_os_family()
    arch = _normalize_arch(platform.machine() or "")

    if os_family == "windows":
        os_version = _detect_windows_os_version()
        cpu_model = _detect_windows_cpu_model()
        total_ram_gb = _detect_windows_total_ram_gb()
    elif os_family == "macos":
        os_version = _detect_macos_os_version()
        cpu_model = _detect_macos_cpu_model()
        total_ram_gb = _detect_macos_total_ram_gb()
    elif os_family == "linux":
        os_version = _detect_linux_os_version()
        cpu_model = _detect_linux_cpu_model()
        total_ram_gb = _detect_linux_total_ram_gb()
    else:
        os_version = platform.platform()
        cpu_model = platform.processor() or "unknown"
        total_ram_gb = 0

    gpu_vendor, gpu_model, vram_gb, driver_version = detect_gpu()

    install_path = install_path_override or default_install_path(os_family)
    free_disk_gb = free_disk_probe(_disk_probe_path(install_path))

    return HostProfile(
        os_family=os_family,
        os_version=os_version,
        arch=arch,
        cpu_model=cpu_model,
        total_ram_gb=total_ram_gb,
        gpu_vendor=gpu_vendor,
        gpu_model=gpu_model,
        total_vram_gb=vram_gb,
        driver_version=driver_version,
        cuda_compatible=_is_cuda_compatible(gpu_vendor, driver_version),
        metal_compatible=_is_metal_compatible(os_family, arch),
        rocm_compatible=_is_rocm_compatible(os_family, gpu_vendor),
        free_disk_gb=free_disk_gb,
        target_install_path=install_path,
    )
