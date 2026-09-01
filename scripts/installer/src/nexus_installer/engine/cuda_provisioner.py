"""CUDA 12.1 runtime provisioner (Phase 9.2).

Copies the pre-bundled CUDA runtime libraries from `payload/cuda-12.1-runtime/`
into the per-user runtime tree at `%LOCALAPPDATA%\\Nexus\\runtime\\cuda\\` (or
the platform equivalent). Detects the host NVIDIA driver version and decides
whether the runtime is usable; if not, the caller can fall back to CPU-only
mode.

CUDA 12.1 requires NVIDIA driver >= 530.x. See the matrix at
https://docs.nvidia.com/cuda/cuda-toolkit-release-notes/index.html.
"""

from __future__ import annotations

import os
import re
import shutil
from collections.abc import Callable
from pathlib import Path

from nexus_installer.engine.platform_utils import (
    is_macos,
    is_windows,
    run_command,
)

# CUDA 12.1 minimum driver: 530.30.02 (Linux) / 531.14 (Windows). Both >= 530
# major; we use the major version as the gate.
MIN_CUDA_12_1_DRIVER_MAJOR = 530

LogFn = Callable[[str, str], None]


def _runtime_root() -> Path:
    """The on-disk root where the CUDA runtime libraries are deployed."""
    if is_windows():
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return Path(base) / "Nexus" / "runtime" / "cuda"
    if is_macos():
        return (
            Path.home()
            / "Library"
            / "Application Support"
            / "Nexus"
            / "runtime"
            / "cuda"
        )
    return Path.home() / ".local" / "share" / "nexus" / "runtime" / "cuda"


def detect_driver_version() -> tuple[int, int, str]:
    """Return (major, minor, raw) of the installed NVIDIA driver, or (0, 0, '').

    Probes `nvidia-smi` and parses the `driver_version` column. Returns zeros
    on a CPU-only host or when nvidia-smi is missing / unresponsive.
    """
    args = [
        "nvidia-smi",
        "--query-gpu=driver_version",
        "--format=csv,noheader",
    ]
    code, stdout, _ = run_command(args, timeout=5)
    if code != 0:
        # Try the canonical Windows install path explicitly.
        if is_windows():
            code, stdout, _ = run_command(
                [r"C:\Windows\System32\nvidia-smi.exe", *args[1:]],
                timeout=5,
            )
            if code != 0:
                return 0, 0, ""
        else:
            return 0, 0, ""

    # nvidia-smi can return multiple GPUs; first line is enough.
    raw = stdout.strip().splitlines()[0].strip() if stdout.strip() else ""
    match = re.match(r"^(\d+)(?:\.(\d+))?", raw)
    if not match:
        return 0, 0, raw
    major = int(match.group(1))
    minor = int(match.group(2) or 0)
    return major, minor, raw


def is_cuda_12_1_supported(driver_major: int) -> bool:
    """Return True if the host driver supports CUDA 12.1 runtime."""
    return driver_major >= MIN_CUDA_12_1_DRIVER_MAJOR


class CudaProvisioner:
    """Copy bundled CUDA runtime libraries into the per-user runtime tree."""

    def __init__(self, payload_dir: Path) -> None:
        self._payload = payload_dir / "cuda-12.1-runtime"

    @property
    def target_dir(self) -> Path:
        return _runtime_root()

    def payload_exists(self) -> bool:
        return self._payload.exists() and self._payload.is_dir()

    def install(self, log: LogFn) -> bool:
        """Copy the bundled CUDA runtime into `target_dir`. Returns success."""
        if not self.payload_exists():
            log(f"CUDA payload not found at {self._payload}", "warn")
            return False

        target = self.target_dir
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                log(f"CUDA target {target} exists; replacing", "info")
                shutil.rmtree(target)
            shutil.copytree(self._payload, target)
        except OSError as exc:
            log(f"CUDA copy failed: {exc}", "error")
            return False

        log(f"CUDA runtime installed at {target}", "success")
        return True

    @staticmethod
    def shell_env_update_hint() -> str:
        """Return a one-line PATH / LD_LIBRARY_PATH hint for the caller to log."""
        target = _runtime_root()
        if is_windows():
            return f"set PATH={target};%PATH%"
        return f"export LD_LIBRARY_PATH={target}:$LD_LIBRARY_PATH"


def decide_install_mode(driver_major: int, has_payload: bool) -> str:
    """Return one of `"gpu"`, `"cpu-fallback"`, `"missing-payload"`.

    - `"gpu"`: driver supports CUDA 12.1 + payload is present.
    - `"cpu-fallback"`: no GPU / outdated driver; offer CPU-only mode.
    - `"missing-payload"`: payload absent (dev build); skip CUDA copy.
    """
    if not has_payload:
        return "missing-payload"
    if is_cuda_12_1_supported(driver_major):
        return "gpu"
    return "cpu-fallback"


def cpu_fallback_dialog_text() -> str:
    """Return the user-facing copy for the CPU-only fallback dialog."""
    return (
        "No CUDA-capable GPU detected (or driver is below 530.x). "
        "Install in CPU-only mode? Image and Video generation will be slow "
        "or disabled."
    )
