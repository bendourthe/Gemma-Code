"""Filesystem locations for the installer's persistent background state (T701).

The plan pins the Windows location to ``%LOCALAPPDATA%/NexusInstaller``; the
other OSes use their conventional per-user state directory. A single env var
(:data:`STATE_DIR_ENV`) overrides the whole directory, which the test suite and
the sandbox scenario scripts use to keep runs isolated and inspectable.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

#: Per-user application directory name, on every OS.
APP_DIR_NAME = "NexusInstaller"

_STATE_FILE = "state.json"
_LOG_FILE = "install.log"
_LOCK_FILE = "instance.lock"

#: Single-instance IPC channel name (QLocalServer key / Windows named pipe).
#: Fixed so a second launch always finds the first (T703).
SINGLE_INSTANCE_KEY = "nexus-ai-studio-installer"

#: Env override for the whole state directory (tests + sandbox scenarios).
STATE_DIR_ENV = "NEXUS_INSTALLER_STATE_DIR"


def state_dir() -> Path:
    """Return the per-user directory holding the install-state file + log."""
    override = os.environ.get(STATE_DIR_ENV)
    if override:
        return Path(override)
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return Path(base) / APP_DIR_NAME
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_DIR_NAME
    base = os.environ.get("XDG_STATE_HOME") or os.path.join(
        os.path.expanduser("~"), ".local", "state"
    )
    return Path(base) / APP_DIR_NAME


def ensure_state_dir() -> Path:
    """Create and return the state directory (idempotent)."""
    directory = state_dir()
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def state_file() -> Path:
    return state_dir() / _STATE_FILE


def log_file() -> Path:
    return state_dir() / _LOG_FILE


def lock_file() -> Path:
    return state_dir() / _LOCK_FILE
