"""Cross-platform subprocess helpers and platform detection."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from collections.abc import Callable
from typing import Any


def is_windows() -> bool:
    return sys.platform == "win32"


def is_macos() -> bool:
    return sys.platform == "darwin"


def is_linux() -> bool:
    return sys.platform.startswith("linux")


def no_window_kwargs() -> dict[str, Any]:
    """Subprocess kwargs that keep console children invisible and well-fed.

    The installer is a windowed (no-console) PyInstaller app. Spawning a
    console-subsystem child without CREATE_NO_WINDOW pops a transient console
    window (the "command prompts opening and closing" a real install run
    showed), and for `.cmd` wrappers like VS Code's `code` CLI the console
    teardown can surface as STATUS_CONTROL_C_EXIT (0xC000013A), turning a
    successful command into a spurious failure. stdin is nulled because a
    windowed parent has no console stdin to inherit (the child would get an
    invalid handle).

    v1.11.0 Phase 1 (T102): the ONE spawn discipline every installer
    subprocess call site routes through, so this bug class cannot recur
    per-call-site.
    """
    kwargs: dict[str, Any] = {"stdin": subprocess.DEVNULL}
    if is_windows():
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    return kwargs


def run_command(
    cmd: list[str],
    cwd: str | None = None,
    timeout: int = 300,
) -> tuple[int, str, str]:
    """Run a command and return (exit_code, stdout, stderr)."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=cwd,
            timeout=timeout,
            **no_window_kwargs(),
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return -1, "", f"Command timed out after {timeout}s: {' '.join(cmd)}"
    except FileNotFoundError:
        return -1, "", f"Command not found: {cmd[0]}"
    except OSError as e:
        return -1, "", str(e)


def run_command_streaming(
    cmd: list[str],
    callback: Callable[[str], None],
    cwd: str | None = None,
    timeout: int = 1800,
) -> int:
    """Run a command and call `callback` with each output line. Returns exit code."""
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=cwd,
            **no_window_kwargs(),
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            callback(line.rstrip("\n"))
        proc.wait(timeout=timeout)
        return proc.returncode or 0
    except subprocess.TimeoutExpired:
        proc.kill()
        callback(f"ERROR: Command timed out after {timeout}s")
        return -1
    except FileNotFoundError:
        callback(f"ERROR: Command not found: {cmd[0]}")
        return -1
    except OSError as e:
        callback(f"ERROR: {e}")
        return -1


def find_executable(name: str, extra_paths: list[str] | None = None) -> str | None:
    """Find an executable on PATH or in extra_paths."""
    path = shutil.which(name)
    if path:
        return path
    for p in extra_paths or []:
        candidate = os.path.join(p, name)
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
        # Try with .exe on Windows
        if is_windows():
            candidate_exe = candidate + ".exe"
            if os.path.isfile(candidate_exe):
                return candidate_exe
    return None
