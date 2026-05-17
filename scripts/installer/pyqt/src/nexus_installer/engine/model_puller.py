"""Ollama model pull with progress parsing."""

from __future__ import annotations

import re
import subprocess
from collections.abc import Callable

from nexus_installer.installer_state import InstallerState

_PROGRESS_RE = re.compile(r"(\d+)%")


class ModelPuller:
    """Pulls a Gemma model via `ollama pull` with progress reporting."""

    def __init__(self) -> None:
        self._process: subprocess.Popen[str] | None = None
        self._cancelled = False

    def pull(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
        progress: Callable[[float], None],
    ) -> bool:
        """Pull the selected model. Returns True on success."""
        model = state.selected_model
        if not model:
            log("No model selected. Skipping model pull.", "warn")
            return True

        log(f"Pulling model {model}... This may take several minutes.", "info")

        try:
            self._process = subprocess.Popen(
                ["ollama", "pull", model],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            assert self._process.stdout is not None

            for line in self._process.stdout:
                if self._cancelled:
                    self._process.terminate()
                    log("Model pull cancelled by user.", "warn")
                    return False

                line = line.rstrip("\n")
                log(line, "info")

                # Parse progress percentage
                match = _PROGRESS_RE.search(line)
                if match:
                    pct = int(match.group(1))
                    progress(pct / 100.0)

            self._process.wait(timeout=10)
            exit_code = self._process.returncode

            if exit_code == 0:
                log(f"Model {model} pulled successfully.", "success")
                progress(1.0)
                return True
            log(f"Model pull exited with code {exit_code}.", "error")
            return False

        except FileNotFoundError:
            log("ollama command not found. Ensure Ollama is installed.", "error")
            return False
        except OSError as e:
            log(f"Error pulling model: {e}", "error")
            return False

    def cancel(self) -> None:
        """Request cancellation of the current pull."""
        self._cancelled = True
        if self._process:
            self._process.terminate()
