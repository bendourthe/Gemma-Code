"""Python virtual environment creation and backend dependency installation."""

from __future__ import annotations

import os
from collections.abc import Callable

from gemma_installer.engine.platform_utils import is_windows, run_command
from gemma_installer.installer_state import InstallerState


class VenvInstaller:
    """Creates a Python venv and installs backend dependencies."""

    def install(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> bool:
        """Create venv and install deps. Returns True on success."""
        python = state.python_path
        if not python:
            log("Python not found. Cannot create virtual environment.", "error")
            return False

        venv_path = os.path.join(state.install_path, "venv")
        log(f"Creating virtual environment at {venv_path}...", "info")

        # Ensure parent directory exists
        os.makedirs(state.install_path, exist_ok=True)

        code, _, stderr = run_command(
            [python, "-m", "venv", venv_path],
            timeout=120,
        )
        if code != 0:
            log(f"venv creation failed: {stderr}", "error")
            return False

        # Determine pip path inside venv
        if is_windows():
            pip_path = os.path.join(venv_path, "Scripts", "pip.exe")
            venv_python = os.path.join(venv_path, "Scripts", "python.exe")
        else:
            pip_path = os.path.join(venv_path, "bin", "pip")
            venv_python = os.path.join(venv_path, "bin", "python")

        if not os.path.isfile(venv_python):
            log(f"venv python not found at {venv_python}", "error")
            return False

        # Install backend dependencies
        req_path = self._find_requirements()
        if req_path:
            log("Installing backend dependencies...", "info")
            code, _, stderr = run_command(
                [pip_path, "install", "-r", req_path, "--quiet"],
                timeout=300,
            )
            if code != 0:
                log(f"Dependency install failed: {stderr}", "error")
                return False
            log("Backend dependencies installed.", "success")
        else:
            log("No requirements file found. Skipping dependency install.", "warn")

        # Verify
        code, stdout, _ = run_command(
            [venv_python, "-c", "import fastapi; print('ok')"],
            timeout=15,
        )
        if code == 0 and "ok" in stdout:
            log("Virtual environment verified.", "success")
        else:
            log("venv created but FastAPI import failed.", "warn")

        return True

    @staticmethod
    def _find_requirements() -> str | None:
        """Locate backend-requirements.txt."""
        search_dirs = [
            os.path.dirname(os.path.abspath(__file__)),
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."),
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."),
            os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."
            ),
        ]
        for d in search_dirs:
            candidate = os.path.join(os.path.normpath(d), "backend-requirements.txt")
            if os.path.isfile(candidate):
                return candidate
        return None
