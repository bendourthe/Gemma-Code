"""Diffusion-stack Python venv provisioner (Phase 9.3).

Creates a Python 3.11 venv under `%LOCALAPPDATA%\\Nexus\\python\\venv\\`
(or the platform equivalent) and installs the bundled diffusion wheels from
`payload/python/wheels/`. The installer runs `pip install --no-index` so the
flow is fully offline: zero network calls during install.

The wheel manifest lives in `requirements.txt` next to the wheels directory.
Both are produced by the CI installer-build job (see
`scripts/installer/build/windows-pipeline.md`).
"""

from __future__ import annotations

import os
import subprocess
import sys
import venv
from collections.abc import Callable
from pathlib import Path

from nexus_installer.engine.platform_utils import is_macos, is_windows

LogFn = Callable[[str, str], None]


# Wheels that v1.0.0 expects to find in the bundled wheels directory. The
# payload-fetching script in CI is the source of truth -- this list mirrors
# the same set so we can fail fast if a wheel is missing before pip runs.
REQUIRED_WHEEL_PREFIXES: tuple[str, ...] = (
    "torch",
    "torchvision",
    "torchaudio",
    "diffusers",
    "transformers",
    "accelerate",
    "safetensors",
    "xformers",
    "Pillow",
    "imageio",
    "controlnet_aux",
    "opencv_python_headless",
    # v1.1.0 Phase 12.4 -- SVDQuant INT4 runtime (Apache-2.0).
    "nunchaku",
)


def _python_root() -> Path:
    """The on-disk root where the Python venv is provisioned."""
    if is_windows():
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return Path(base) / "Nexus" / "python"
    if is_macos():
        return Path.home() / "Library" / "Application Support" / "Nexus" / "python"
    return Path.home() / ".local" / "share" / "nexus" / "python"


def venv_dir() -> Path:
    return _python_root() / "venv"


def venv_python(venv_path: Path) -> Path:
    if is_windows():
        return venv_path / "Scripts" / "python.exe"
    return venv_path / "bin" / "python"


def find_missing_wheels(wheels_dir: Path) -> list[str]:
    """Return prefixes from REQUIRED_WHEEL_PREFIXES with no matching wheel."""
    if not wheels_dir.exists():
        return list(REQUIRED_WHEEL_PREFIXES)
    present = {p.name for p in wheels_dir.glob("*.whl")}
    missing: list[str] = []
    for prefix in REQUIRED_WHEEL_PREFIXES:
        normalized = prefix.replace("-", "_")
        # Match the exact distribution name (delimited by `-`) to avoid the
        # `torch` prefix shadowing `torchvision`, `torchaudio`, etc.
        if not any(name.startswith(f"{normalized}-") for name in present):
            missing.append(prefix)
    return missing


class DiffusionVenvProvisioner:
    """Create the diffusion venv and pip-install the bundled wheels."""

    def __init__(
        self,
        payload_dir: Path,
        python_executable: str | None = None,
    ) -> None:
        self._wheels = payload_dir / "python" / "wheels"
        self._requirements = payload_dir / "python" / "requirements.txt"
        # Default to the embeddable Python shipped in the payload; fall back to
        # the system interpreter for local dev where the payload is absent.
        self._python = python_executable or self._resolve_bundled_python(payload_dir)

    @staticmethod
    def _resolve_bundled_python(payload_dir: Path) -> str:
        bundled = payload_dir / "python" / ("python.exe" if is_windows() else "python")
        if bundled.exists():
            return str(bundled)
        return sys.executable

    @property
    def wheels_dir(self) -> Path:
        return self._wheels

    @property
    def requirements_file(self) -> Path:
        return self._requirements

    @property
    def target_venv(self) -> Path:
        return venv_dir()

    def preflight(self) -> tuple[bool, str]:
        """Quick check before the heavy install. Returns (ok, message)."""
        if not self._wheels.exists():
            return False, f"wheels directory missing: {self._wheels}"
        missing = find_missing_wheels(self._wheels)
        if missing:
            return False, f"required wheels missing: {', '.join(missing)}"
        if not self._requirements.exists():
            return False, f"requirements.txt missing: {self._requirements}"
        return True, "ok"

    def create_venv(self, log: LogFn) -> bool:
        target = self.target_venv
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            # Use the venv module via a subprocess call against the bundled
            # python rather than this process's `venv.create` so the embedded
            # interpreter is the source of truth for the new env.
            result = subprocess.run(
                [self._python, "-m", "venv", str(target)],
                capture_output=True,
                text=True,
                timeout=120,
            )
            if result.returncode != 0:
                log(f"venv creation failed: {result.stderr.strip()}", "error")
                return False
        except (subprocess.TimeoutExpired, OSError) as exc:
            log(f"venv creation crashed: {exc}", "error")
            return False
        log(f"venv created at {target}", "success")
        return True

    def install_wheels(self, log: LogFn) -> bool:
        """Run `pip install --no-index --find-links wheels -r requirements.txt`."""
        pip_python = venv_python(self.target_venv)
        if not pip_python.exists():
            log(f"venv python not found at {pip_python}", "error")
            return False

        cmd = [
            str(pip_python),
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
            )
        except (subprocess.TimeoutExpired, OSError) as exc:
            log(f"pip install crashed: {exc}", "error")
            return False

        if result.returncode != 0:
            log(f"pip install failed: {result.stderr.strip()[:400]}", "error")
            return False
        log("diffusion wheels installed offline", "success")
        return True

    def install(self, log: LogFn) -> bool:
        ok, msg = self.preflight()
        if not ok:
            log(f"diffusion venv preflight failed: {msg}", "warn")
            return False
        if not self.create_venv(log):
            return False
        return self.install_wheels(log)


def cuda_smoke_test_command(venv_path: Path) -> list[str]:
    """Return the argv that prints `True` when CUDA is wired up correctly."""
    return [
        str(venv_python(venv_path)),
        "-c",
        "import torch; print(torch.cuda.is_available())",
    ]
