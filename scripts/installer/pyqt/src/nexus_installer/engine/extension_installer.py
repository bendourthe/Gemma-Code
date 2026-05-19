"""VS Code extension installation via the code CLI."""

from __future__ import annotations

import glob
import os
from collections.abc import Callable

from nexus_installer.engine.platform_utils import run_command
from nexus_installer.installer_state import InstallerState

EXTENSION_ID = "nexus-coding.nexus-coding"
LEGACY_EXTENSION_ID = "gemma-code.gemma-code"


class ExtensionInstaller:
    """Installs the Nexus Coding VS Code extension from a VSIX file."""

    def install(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> bool:
        """Install the VSIX. Returns True on success."""
        vscode = state.vscode_path
        if not vscode:
            log("VS Code CLI not found. Cannot install extension.", "error")
            return False

        vsix_path = self._find_vsix()
        if not vsix_path:
            log("VSIX file not found. Skipping extension installation.", "error")
            return False

        log(f"Installing extension from {vsix_path}...", "info")
        code, stdout, stderr = run_command(
            [vscode, "--install-extension", vsix_path, "--force"],
            timeout=120,
        )
        if code != 0:
            log(f"Extension install failed (code {code}): {stderr}", "error")
            return False

        log("Verifying extension installation...", "info")
        code, stdout, _ = run_command([vscode, "--list-extensions"], timeout=30)
        if code == 0 and EXTENSION_ID in stdout:
            log("Extension installed successfully.", "success")
            return True

        log("Extension installed but verification failed.", "warn")
        return True  # Treat as success; listing may not reflect immediately

    @staticmethod
    def _find_vsix() -> str | None:
        """Locate the VSIX file relative to the installer."""
        # Check common locations
        search_dirs = [
            os.path.dirname(os.path.abspath(__file__)),  # engine/
            os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "..", ".."
            ),  # pyqt/
            os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."
            ),  # installer/
            os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."
            ),  # scripts/
            os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", ".."
            ),  # repo root
        ]
        for d in search_dirs:
            d = os.path.normpath(d)
            # v1.1.0 rename: prefer the new `nexus-coding-*.vsix` name; fall
            # back to the legacy `gemma-code-*.vsix` until the build pipeline
            # produces the renamed artifact in all paths.
            matches = glob.glob(os.path.join(d, "nexus-coding-*.vsix"))
            if not matches:
                matches = glob.glob(os.path.join(d, "gemma-code-*.vsix"))
            if matches:
                return matches[0]
        return None
