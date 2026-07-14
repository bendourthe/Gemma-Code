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
        """Install the VSIX. Returns True on success (or a clean skip)."""
        vscode = state.vscode_path
        if not vscode:
            # v1.11.0 Phase 3 (T302): a machine without VS Code is a normal
            # user machine, not an error condition -- skip with guidance.
            state.record_skipped_step("extension")
            log(
                "Skipped: VS Code was not found on this computer. Install VS "
                "Code from code.visualstudio.com and re-run this installer, "
                "or add the Nexus extension later from within VS Code.",
                "warn",
            )
            return True

        vsix_path = self._find_vsix()
        if not vsix_path:
            state.record_step_failure(
                "extension",
                "The VS Code extension package was missing from the installer bundle.",
                "Re-download the installer; if it keeps failing, report this "
                "with the saved log.",
            )
            log("VSIX file not found. Skipping extension installation.", "error")
            return False

        log(f"Installing extension from {vsix_path}...", "info")
        code, stdout, stderr = run_command(
            [vscode, "--install-extension", vsix_path, "--force"],
            timeout=120,
        )
        if code != 0:
            state.record_step_failure(
                "extension",
                "The VS Code extension could not be installed.",
                "Open VS Code and install the extension manually (Extensions "
                "panel -> ... -> Install from VSIX), or re-run the installer.",
            )
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
            ),  # src/
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
