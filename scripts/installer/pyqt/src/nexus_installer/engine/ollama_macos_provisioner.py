"""v1.1.0 Phase 14.3 -- macOS Ollama provisioner.

Runs the bundled Ollama macOS application (`payload/ollama/Ollama.app`) so the
first-launch flow is fully offline and matches the Windows / Linux paths in
shape. Optionally registers a launchd agent so `ollama serve` starts at
login.
"""

from __future__ import annotations

import shutil
import subprocess
from collections.abc import Callable
from pathlib import Path

from nexus_installer.engine.platform_utils import is_macos

LogFn = Callable[[str, str], None]


class OllamaMacosProvisioner:
    """Copy `Ollama.app` into `/Applications/` and launch it once."""

    name = "ollama-macos"
    estimated_time_s = 45

    def __init__(self, payload_dir: Path, install_root: Path | None = None) -> None:
        self._payload = payload_dir / "ollama" / "Ollama.app"
        self._target_root = install_root or Path("/Applications")

    @property
    def target_app(self) -> Path:
        return self._target_root / "Ollama.app"

    def payload_exists(self) -> bool:
        return self._payload.exists() and self._payload.is_dir()

    def install(self, log: LogFn) -> bool:
        if not is_macos():
            log("Ollama macOS provisioner skipped on non-macOS host", "info")
            return True
        if not self.payload_exists():
            log(f"Ollama.app payload missing at {self._payload}", "warn")
            return False
        target = self.target_app
        try:
            self._target_root.mkdir(parents=True, exist_ok=True)
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(self._payload, target, symlinks=True)
        except OSError as exc:
            log(f"Ollama.app copy failed: {exc}", "error")
            return False
        # Best-effort launch; failure here is fine because the user can start
        # Ollama from Launchpad later.
        try:
            subprocess.run(
                ["open", "-a", str(target)],
                capture_output=True,
                timeout=15,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            log(f"Ollama.app open command failed: {exc}", "warn")
        log(f"Ollama.app installed at {target}", "success")
        return True

    def verify(self, log: LogFn) -> bool:
        if not self.target_app.exists():
            log(f"Ollama.app missing at {self.target_app}", "error")
            return False
        return True
