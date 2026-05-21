"""v1.1.0 Phase 14.4 -- Linux CUDA 12.1 provisioner.

Mirrors `CudaProvisioner` (the Windows path) but writes into
`~/.local/share/nexus/runtime/cuda/` and emits an LD_LIBRARY_PATH hint that
the launch shim adds to the per-user environment.
"""

from __future__ import annotations

import shutil
from collections.abc import Callable
from pathlib import Path

from nexus_installer.engine.cuda_provisioner import (
    MIN_CUDA_12_1_DRIVER_MAJOR,
    detect_driver_version,
)
from nexus_installer.engine.platform_utils import is_linux

LogFn = Callable[[str, str], None]


def linux_cuda_root() -> Path:
    return Path.home() / ".local" / "share" / "nexus" / "runtime" / "cuda"


class CudaLinuxProvisioner:
    """Copy bundled CUDA libs to `~/.local/share/nexus/runtime/cuda/`."""

    name = "cuda-linux"
    estimated_time_s = 120

    def __init__(self, payload_dir: Path) -> None:
        self._payload = payload_dir / "cuda-12.1-runtime-linux"

    @property
    def target_dir(self) -> Path:
        return linux_cuda_root()

    def payload_exists(self) -> bool:
        return self._payload.exists() and self._payload.is_dir()

    def is_driver_compatible(self) -> bool:
        major, _, _ = detect_driver_version()
        return major >= MIN_CUDA_12_1_DRIVER_MAJOR

    def install(self, log: LogFn) -> bool:
        if not is_linux():
            log("Linux CUDA provisioner skipped on non-Linux host", "info")
            return True
        if not self.payload_exists():
            log(f"CUDA payload missing at {self._payload}", "warn")
            return False
        target = self.target_dir
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(self._payload, target)
        except OSError as exc:
            log(f"CUDA copy failed: {exc}", "error")
            return False
        log(f"CUDA 12.1 runtime installed at {target}", "success")
        return True

    def verify(self, log: LogFn) -> bool:
        if not self.target_dir.exists():
            log("CUDA runtime directory missing after install", "error")
            return False
        return True

    @staticmethod
    def shell_env_update_hint() -> str:
        return f"export LD_LIBRARY_PATH={linux_cuda_root()}:$LD_LIBRARY_PATH"
