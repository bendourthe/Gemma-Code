"""Python virtual environment stub.

The Python FastAPI backend was removed in v0.4.0 (ADR-0001). The installer no
longer creates a venv or installs backend dependencies; the extension talks
directly to Ollama. This stub is retained so existing install pipelines that
reference VenvInstaller continue to import cleanly and report success.
"""

from __future__ import annotations

from collections.abc import Callable

from nexus_installer.installer_state import InstallerState


class VenvInstaller:
    """No-op: the Python backend was removed in v0.4.0."""

    def install(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> bool:
        del state
        log(
            "Python backend is no longer bundled (removed in v0.4.0). "
            "Skipping virtual environment creation.",
            "info",
        )
        return True
