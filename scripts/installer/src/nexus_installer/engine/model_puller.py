"""Ollama model pull with progress parsing."""

from __future__ import annotations

import queue
import re
import subprocess
import threading
import time
from collections.abc import Callable

from nexus_installer.engine.platform_utils import is_windows
from nexus_installer.installer_state import InstallerState

_PROGRESS_RE = re.compile(r"(\d+)%")

# Terminate a pull that produces no output for this long while its process is
# still alive (a genuinely stuck download), so the step can never hang forever.
_IDLE_TIMEOUT_S = 1800

# On Windows the windowed (no-console) installer must not pop a console for the
# `ollama` child (see platform_utils.run_command for the 0xC000013A rationale).
_CREATIONFLAGS = subprocess.CREATE_NO_WINDOW if is_windows() else 0

# Sentinel queued by the reader thread when the child's stdout closes.
_STDOUT_CLOSED = object()


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
        return self.pull_model(model, log, progress)

    def pull_model(
        self,
        model: str,
        log: Callable[[str, str], None],
        progress: Callable[[float], None],
    ) -> bool:
        """Pull one named model via `ollama pull`. Returns True on success.

        v1.8.0 Phase 3: split out of `pull` so the protocol router can pull
        each ollama-sourced model of a multi-selection individually.

        The read loop must stop when the `ollama pull` *process* exits, NOT when
        its stdout hits EOF: `ollama pull` auto-starts the persistent Ollama
        server, which inherits this stdout pipe and never closes it, so a plain
        `for line in stdout` would block forever after the pull already
        finished (or failed). A reader thread drains stdout for live progress
        while the main loop watches `poll()` and an idle-timeout backstop.
        """
        log(f"Pulling model {model}... This may take several minutes.", "info")

        try:
            self._process = subprocess.Popen(
                ["ollama", "pull", model],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                creationflags=_CREATIONFLAGS,
            )
        except FileNotFoundError:
            log("ollama command not found. Ensure Ollama is installed.", "error")
            return False
        except OSError as e:
            log(f"Error pulling model: {e}", "error")
            return False

        proc = self._process
        assert proc.stdout is not None
        lines: queue.Queue[object] = queue.Queue()

        def _reader(stream: object) -> None:
            try:
                for raw in stream:  # type: ignore[attr-defined]
                    lines.put(raw.rstrip("\n"))
            except (OSError, ValueError):
                pass
            finally:
                lines.put(_STDOUT_CLOSED)

        threading.Thread(target=_reader, args=(proc.stdout,), daemon=True).start()

        last_output = time.monotonic()
        while True:
            if self._cancelled:
                proc.terminate()
                log("Model pull cancelled by user.", "warn")
                return False
            try:
                item = lines.get(timeout=0.5)
            except queue.Empty:
                # No output right now. Stop once the pull process has exited
                # (its server keeps the pipe open, so we never see stdout EOF),
                # and give up if it stalls with no output for too long.
                if proc.poll() is not None:
                    break
                if time.monotonic() - last_output > _IDLE_TIMEOUT_S:
                    proc.terminate()
                    log("Model pull stalled (no output); aborting.", "error")
                    return False
                continue
            if item is _STDOUT_CLOSED:
                break
            line = str(item)
            last_output = time.monotonic()
            log(line, "info")
            match = _PROGRESS_RE.search(line)
            if match:
                progress(int(match.group(1)) / 100.0)

        exit_code = proc.returncode
        if exit_code is None:
            try:
                exit_code = proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.terminate()
                exit_code = -1

        if exit_code == 0:
            log(f"Model {model} pulled successfully.", "success")
            progress(1.0)
            return True
        log(f"Model pull failed (exit code {exit_code}).", "error")
        return False

    def cancel(self) -> None:
        """Request cancellation of the current pull."""
        self._cancelled = True
        if self._process:
            self._process.terminate()
