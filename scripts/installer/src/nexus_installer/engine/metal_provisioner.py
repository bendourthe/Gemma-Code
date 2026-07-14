"""v1.1.0 Phase 14.3 -- macOS Metal Performance Shaders provisioner.

Metal itself ships as part of macOS so there's nothing to install for the
backend. The provisioner installs the `torch-mps` variant of PyTorch from the
bundled wheels (`payload/python/wheels-mac/`). On Intel Macs we transparently
fall back to the CPU-only wheel set.
"""

from __future__ import annotations

import platform
import subprocess
from collections.abc import Callable
from pathlib import Path

from nexus_installer.engine.platform_utils import is_macos, no_window_kwargs

LogFn = Callable[[str, str], None]


class MetalProvisioner:
    """Install the MPS PyTorch wheels on Apple Silicon; CPU-only on Intel."""

    name = "metal"
    estimated_time_s = 60

    def __init__(self, payload_dir: Path) -> None:
        self._payload = payload_dir
        self._wheels_mac = payload_dir / "python" / "wheels-mac"
        self._wheels_cpu = payload_dir / "python" / "wheels-cpu"
        self._requirements_mac = payload_dir / "python" / "requirements-mac.txt"
        self._requirements_cpu = payload_dir / "python" / "requirements-cpu.txt"

    @property
    def is_apple_silicon(self) -> bool:
        return is_macos() and platform.machine().lower() in {"arm64", "aarch64"}

    def _wheel_dir(self) -> Path:
        return self._wheels_mac if self.is_apple_silicon else self._wheels_cpu

    def _requirements(self) -> Path:
        return (
            self._requirements_mac if self.is_apple_silicon else self._requirements_cpu
        )

    def payload_exists(self) -> bool:
        return self._wheel_dir().exists() and self._requirements().exists()

    def install(self, log: LogFn, python_executable: str | None = None) -> bool:
        if not is_macos():
            log("Metal provisioner skipped on non-macOS host", "info")
            return True
        if not self.payload_exists():
            missing = f"{self._wheel_dir()} / {self._requirements()}"
            log(f"Metal payload missing at {missing}", "warn")
            return False
        python = python_executable or "python3"
        cmd = [
            python,
            "-m",
            "pip",
            "install",
            "--no-index",
            "--find-links",
            str(self._wheel_dir()),
            "--requirement",
            str(self._requirements()),
            "--disable-pip-version-check",
        ]
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=1800,
                check=False,
                **no_window_kwargs(),
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            log(f"Metal wheel install crashed: {exc}", "error")
            return False
        if result.returncode != 0:
            log(f"Metal wheel install failed: {result.stderr.strip()[:400]}", "error")
            return False
        backend = "MPS (Apple Silicon)" if self.is_apple_silicon else "CPU-only (Intel)"
        log(f"PyTorch installed for {backend}", "success")
        return True

    def verify(self, log: LogFn) -> bool:
        del log
        return True
