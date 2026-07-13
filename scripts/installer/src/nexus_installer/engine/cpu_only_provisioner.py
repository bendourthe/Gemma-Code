"""v1.1.0 Phase 14.4 -- CPU-only PyTorch provisioner.

Used on every OS when no compatible GPU is available. Installs the CPU
PyTorch wheel set from `payload/python/wheels-cpu/`. The caller surfaces the
"Heavy GPU workloads disabled" dialog (`cpu_fallback_message()`).
"""

from __future__ import annotations

import subprocess
from collections.abc import Callable
from pathlib import Path

from nexus_installer.engine.platform_utils import no_window_kwargs

LogFn = Callable[[str, str], None]


class CpuOnlyProvisioner:
    """Install the CPU-only PyTorch wheel set offline."""

    name = "cpu-only"
    estimated_time_s = 60

    def __init__(self, payload_dir: Path) -> None:
        self._payload = payload_dir
        self._wheels = payload_dir / "python" / "wheels-cpu"
        self._requirements = payload_dir / "python" / "requirements-cpu.txt"

    def payload_exists(self) -> bool:
        return self._wheels.exists() and self._requirements.exists()

    def install(self, log: LogFn, python_executable: str | None = None) -> bool:
        if not self.payload_exists():
            log(
                f"CPU-only payload missing at {self._wheels} / {self._requirements}",
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
                cmd,
                capture_output=True,
                text=True,
                timeout=1800,
                check=False,
                **no_window_kwargs(),
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            log(f"CPU-only wheel install crashed: {exc}", "error")
            return False
        if result.returncode != 0:
            log(
                f"CPU-only wheel install failed: {result.stderr.strip()[:400]}",
                "error",
            )
            return False
        log("CPU-only PyTorch wheels installed", "success")
        return True

    def verify(self, log: LogFn) -> bool:
        del log
        return True


def cpu_fallback_message() -> str:
    """User-facing copy shown when only CPU-only mode is available."""
    return (
        "Heavy GPU workloads disabled (no GPU detected). Text models work; "
        "image and video generation may be slow or limited."
    )
