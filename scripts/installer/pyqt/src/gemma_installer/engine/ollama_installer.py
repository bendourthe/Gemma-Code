"""Platform-specific Ollama installation."""

from __future__ import annotations

import os
import tempfile
import time
from collections.abc import Callable

import httpx

from gemma_installer.engine.platform_utils import (
    is_linux,
    is_macos,
    is_windows,
    run_command,
    run_command_streaming,
)
from gemma_installer.installer_state import InstallerState

OLLAMA_WINDOWS_URL = (
    "https://github.com/ollama/ollama/releases/latest/download/OllamaSetup.exe"
)
OLLAMA_HEALTH_TIMEOUT = 30


class OllamaInstaller:
    """Handles Ollama installation on all platforms."""

    def install(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> bool:
        """Install Ollama. Returns True on success."""
        if state.ollama_installed:
            log("Ollama is already installed, skipping.", "info")
            return True

        if is_windows():
            return self._install_windows(state, log)
        if is_macos():
            return self._install_macos(state, log)
        if is_linux():
            return self._install_linux(state, log)

        log("Unsupported platform for Ollama installation.", "error")
        return False

    def _install_windows(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> bool:
        log("Downloading Ollama for Windows...", "info")
        try:
            with tempfile.NamedTemporaryFile(suffix=".exe", delete=False) as f:
                tmp_path = f.name
            with httpx.stream(
                "GET", OLLAMA_WINDOWS_URL, follow_redirects=True, timeout=300
            ) as resp:
                resp.raise_for_status()
                with open(tmp_path, "wb") as f:
                    for chunk in resp.iter_bytes(8192):
                        f.write(chunk)
            log("Installing Ollama silently...", "info")
            code, _, stderr = run_command(
                [tmp_path, "/SILENT", "/AUTOSTART=0"], timeout=120
            )
            os.unlink(tmp_path)
            if code != 0:
                log(f"Ollama installer exited with code {code}: {stderr}", "error")
                return False
        except (httpx.HTTPError, OSError) as e:
            log(f"Failed to download Ollama: {e}", "error")
            return False
        return self._verify_ollama(state, log)

    def _install_macos(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> bool:
        log("Installing Ollama via Homebrew...", "info")
        code, _, stderr = run_command(["brew", "install", "ollama"], timeout=300)
        if code != 0:
            log(f"Homebrew install failed: {stderr}. Trying direct download...", "warn")
            log(
                "Please install Ollama manually from https://ollama.com/download",
                "warn",
            )
            return False
        return self._verify_ollama(state, log)

    def _install_linux(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> bool:
        log("Installing Ollama via official script...", "info")
        code = run_command_streaming(
            ["bash", "-c", "curl -fsSL https://ollama.com/install.sh | sh"],
            lambda line: log(line, "info"),
            timeout=300,
        )
        if code != 0:
            log("Ollama installation script failed.", "error")
            return False
        return self._verify_ollama(state, log)

    def _verify_ollama(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> bool:
        log("Verifying Ollama connectivity...", "info")
        # Start ollama serve if not running
        run_command(["ollama", "serve"], timeout=3)
        deadline = time.monotonic() + OLLAMA_HEALTH_TIMEOUT
        while time.monotonic() < deadline:
            try:
                resp = httpx.get(f"{state.ollama_url}/api/tags", timeout=5)
                if resp.status_code == 200:
                    log("Ollama is running and reachable.", "success")
                    state.ollama_installed = True
                    return True
            except httpx.HTTPError:
                pass
            time.sleep(2)
        log("Ollama did not respond within 30 seconds.", "error")
        return False
