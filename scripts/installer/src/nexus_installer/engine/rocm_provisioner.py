"""v1.1.0 Phase 14.4 -- AMD ROCm provisioner.

Installs the bundled `torch-rocm` wheels (`payload/python/wheels-rocm/`) when
the host has an AMD GPU + a working `rocm-smi`. The provisioner is a no-op on
hosts without ROCm; callers should fall back to `CpuOnlyProvisioner`.
"""

from __future__ import annotations

import shutil
import subprocess
from collections.abc import Callable
from pathlib import Path

from nexus_installer.engine.platform_utils import is_linux

LogFn = Callable[[str, str], None]


class RocmProvisioner:
    """Install ROCm PyTorch wheels offline from the bundled payload."""

    name = "rocm"
    estimated_time_s = 90

    def __init__(self, payload_dir: Path) -> None:
        self._payload = payload_dir
        self._wheels = payload_dir / "python" / "wheels-rocm"
        self._requirements = payload_dir / "python" / "requirements-rocm.txt"

    def payload_exists(self) -> bool:
        return self._wheels.exists() and self._requirements.exists()

    def rocm_runtime_present(self) -> bool:
        return shutil.which("rocm-smi") is not None

    def install(self, log: LogFn, python_executable: str | None = None) -> bool:
        if not is_linux():
            log("ROCm provisioner skipped on non-Linux host", "info")
            return True
        if not self.rocm_runtime_present():
            log("rocm-smi not detected; deferring to CPU-only fallback", "warn")
            return False
        if not self.payload_exists():
            log(
                f"ROCm payload missing at {self._wheels} / {self._requirements}",
                "warn",
            )
            return False
        python = python_executable or "python3"
        cmd = [
            python,
            "-m",
            "pip",
            "install",
            "--no-index",
            "--find-links",
            str(self._wheels),
            "--requirement",
            str(self._requirements),
            "--disable-pip-version-check",
        ]
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=1800, check=False
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            log(f"ROCm wheel install crashed: {exc}", "error")
            return False
        if result.returncode != 0:
            log(f"ROCm wheel install failed: {result.stderr.strip()[:400]}", "error")
            return False
        log("ROCm PyTorch wheels installed", "success")
        return True

    def verify(self, log: LogFn) -> bool:
        del log
        return True
