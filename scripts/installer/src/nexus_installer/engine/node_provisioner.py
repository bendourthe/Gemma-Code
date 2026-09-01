"""Node 22 portable provisioner (Phase 9.4).

Copies the bundled Node 22 portable distribution from `payload/node/` into the
per-user runtime tree at `%LOCALAPPDATA%\\Nexus\\runtime\\node\\`. Optionally
prepends that directory to the user PATH so power users can invoke
`nexus-check` from any shell.

The Nexus sidecar always runs against the bundled Node, never the system
Node, to avoid version conflicts (the user may already have a different Node
major installed).
"""

from __future__ import annotations

import os
import shutil
import sys
from collections.abc import Callable
from pathlib import Path

from nexus_installer.engine.platform_utils import (
    is_macos,
    is_windows,
    run_command,
)

if sys.platform == "win32":
    import winreg
else:  # pragma: no cover - non-Windows hosts cannot import winreg
    winreg = None  # type: ignore[assignment]

LogFn = Callable[[str, str], None]


def runtime_root() -> Path:
    if is_windows():
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return Path(base) / "Nexus" / "runtime" / "node"
    if is_macos():
        return (
            Path.home()
            / "Library"
            / "Application Support"
            / "Nexus"
            / "runtime"
            / "node"
        )
    return Path.home() / ".local" / "share" / "nexus" / "runtime" / "node"


def node_executable(runtime: Path) -> Path:
    return runtime / ("node.exe" if is_windows() else "bin/node")


class NodeProvisioner:
    """Copy the bundled Node 22 into the per-user runtime tree."""

    def __init__(self, payload_dir: Path) -> None:
        self._payload = payload_dir / "node"

    def payload_exists(self) -> bool:
        return self._payload.exists() and self._payload.is_dir()

    def install(self, log: LogFn) -> bool:
        if not self.payload_exists():
            log(f"Node payload not found at {self._payload}", "warn")
            return False
        target = runtime_root()
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                log(f"Node target {target} exists; replacing", "info")
                shutil.rmtree(target)
            shutil.copytree(self._payload, target)
        except OSError as exc:
            log(f"Node copy failed: {exc}", "error")
            return False
        log(f"Node 22 installed at {target}", "success")
        return True

    def verify(self, log: LogFn) -> bool:
        exe = node_executable(runtime_root())
        if not exe.exists():
            log(f"Node executable missing at {exe}", "error")
            return False
        code, stdout, stderr = run_command([str(exe), "--version"], timeout=10)
        if code != 0:
            log(f"node --version failed: {stderr.strip()}", "error")
            return False
        log(f"Node {stdout.strip()} ready", "success")
        return True


def add_to_user_path_windows(directory: Path, log: LogFn) -> bool:
    """Prepend `directory` to the per-user PATH via HKCU\\Environment.

    Reads-then-writes the current value so we are non-destructive: existing
    entries are preserved. The change is broadcast via `setx PATH` so a fresh
    shell picks it up; existing shells need to be reopened.

    Returns True on success, False if anything in the round-trip fails.
    """
    if not is_windows():
        log("PATH registration skipped on non-Windows host", "info")
        return True

    target = str(directory)
    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            "Environment",
            0,
            winreg.KEY_READ | winreg.KEY_SET_VALUE,
        ) as key:
            try:
                current, _ = winreg.QueryValueEx(key, "Path")
            except FileNotFoundError:
                current = ""
            entries = [e for e in (current or "").split(os.pathsep) if e.strip()]
            if target in entries:
                log(f"{target} already on user PATH", "info")
                return True
            entries.insert(0, target)
            new_value = os.pathsep.join(entries)
            winreg.SetValueEx(key, "Path", 0, winreg.REG_EXPAND_SZ, new_value)
    except OSError as exc:
        log(f"PATH registration failed: {exc}", "error")
        return False
    log(f"{target} added to user PATH", "success")
    return True


# ---------------------------------------------------------------------------
# Ollama service helper (Phase 9.4): the Windows service check
# ---------------------------------------------------------------------------


def ollama_service_running_windows() -> bool:
    """Return True when `sc query Ollama` reports STATE: RUNNING."""
    if not is_windows():
        return False
    code, stdout, _ = run_command(["sc", "query", "Ollama"], timeout=10)
    if code != 0:
        return False
    return "RUNNING" in stdout.upper()


def offline_ollama_installer_path(payload_dir: Path) -> Path:
    """Return the bundled OllamaSetup.exe path inside the payload tree."""
    return payload_dir / "ollama" / "OllamaSetup.exe"


def run_bundled_ollama_setup(payload_dir: Path, log: LogFn) -> bool:
    """Run `payload/ollama/OllamaSetup.exe /S` silently. Windows only."""
    if not is_windows():
        log("Bundled Ollama setup is Windows-only", "info")
        return False
    setup = offline_ollama_installer_path(payload_dir)
    if not setup.exists():
        log(f"Bundled Ollama setup missing at {setup}", "error")
        return False
    code, _, stderr = run_command([str(setup), "/S"], timeout=300)
    if code != 0:
        log(f"OllamaSetup.exe failed ({code}): {stderr.strip()}", "error")
        return False
    log("Ollama installed silently", "success")
    return True
