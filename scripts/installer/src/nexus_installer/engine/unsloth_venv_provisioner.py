"""v2.1.0 Phase 5 -- opt-in Unsloth Core venv provisioner.

Installs Apache-2.0 ``unsloth`` plus its required LGPL ``unsloth-zoo`` pin
into a dedicated venv. Never installs the AGPL ``[studio]`` extra or CLI.
"""

from __future__ import annotations

import json
import os
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import Any

from nexus_installer.engine.host_detect import HostProfile
from nexus_installer.engine.platform_utils import is_windows

LogFn = Callable[[str, str], None]
Runner = Callable[[list[str]], subprocess.CompletedProcess[str]]

MIN_VRAM_GB = 16
FORBIDDEN = ("[studio]", "unsloth-cli", "unsloth_cli")


def _pins_path() -> Path:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "core" / "tuning" / "unsloth-pins.json"
        if candidate.is_file():
            return candidate
    return Path("core") / "tuning" / "unsloth-pins.json"


def load_pins() -> dict[str, Any]:
    path = _pins_path()
    return json.loads(path.read_text(encoding="utf-8"))


def pip_args(pins: dict[str, Any] | None = None) -> list[str]:
    data = pins or load_pins()
    args: list[str] = []
    for pkg in data.get("provisioned") or []:
        name = str(pkg.get("name") or "")
        version = str(pkg.get("version") or "")
        if name and version:
            args.append(f"{name}=={version}")
    return args


def argv_is_forbidden(argv: list[str], pins: dict[str, Any] | None = None) -> bool:
    blob = " ".join(argv).lower()
    tokens = list(FORBIDDEN)
    data = pins or {}
    tokens.extend(str(t) for t in (data.get("forbiddenArgSubstrings") or []))
    return any(token.lower() in blob for token in tokens)


def training_supported(profile: HostProfile) -> tuple[bool, str]:
    if profile.total_vram_gb < MIN_VRAM_GB:
        return False, (
            f"Fine-tuning needs at least {MIN_VRAM_GB} GB VRAM "
            f"(this host reports {profile.total_vram_gb} GB)."
        )
    vendor = (profile.gpu_vendor or "").lower()
    if vendor == "nvidia":
        return True, "NVIDIA GPU with enough VRAM."
    if vendor == "amd" and profile.os_family == "linux":
        return True, "AMD GPU on Linux with enough VRAM."
    if vendor == "amd":
        return False, "AMD fine-tuning is Linux-only in this cycle."
    if vendor == "apple":
        return False, "Apple / Metal training is not provisioned in this cycle."
    return False, f"GPU vendor '{profile.gpu_vendor}' is not in the training allowlist."


def _tuning_root() -> Path:
    """Same tree as TypeScript ``nexusHome()/tuning`` (`~/.nexus/tuning`)."""
    override = os.environ.get("NEXUS_HOME")
    if override:
        return Path(override) / "tuning"
    return Path.home() / ".nexus" / "tuning"


def venv_dir(root: Path | None = None) -> Path:
    return (root or _tuning_root()) / "venv"


def state_path(root: Path | None = None) -> Path:
    return (root or _tuning_root()) / "provision.json"


def venv_python(venv: Path) -> Path:
    if is_windows():
        return venv / "Scripts" / "python.exe"
    return venv / "bin" / "python"


class UnslothVenvProvisioner:
    """Opt-in Unsloth Core env. Failure leaves a resumable failed state."""

    def __init__(
        self,
        *,
        root: Path | None = None,
        runner: Runner | None = None,
        opt_in: bool = False,
    ) -> None:
        self.root = root or _tuning_root()
        self.opt_in = opt_in
        self._runner = runner or self._default_runner

    @staticmethod
    def _default_runner(argv: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            argv,
            capture_output=True,
            text=True,
            check=False,
        )

    def _write_state(self, payload: dict[str, Any]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        state_path(self.root).write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def state(self) -> dict[str, Any]:
        path = state_path(self.root)
        if not path.is_file():
            return {"status": "pending"}
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {"status": "failed", "error": "corrupt provision.json"}

    def install(self, profile: HostProfile, log: LogFn) -> bool:
        if not self.opt_in:
            log("Unsloth Core skipped (opt-in off).", "info")
            return True
        ok, reason = training_supported(profile)
        if not ok:
            log(reason, "warn")
            self._write_state({"status": "unsupported", "error": reason})
            return True
        pins = load_pins()
        args = pip_args(pins)
        self.root.mkdir(parents=True, exist_ok=True)
        venv = venv_dir(self.root)
        py = venv_python(venv)
        if not py.exists():
            venv_result = self._runner(["uv", "venv", str(venv)])
            if venv_result.returncode != 0:
                err = (venv_result.stderr or venv_result.stdout or "uv venv failed").strip()
                log(err, "error")
                self._write_state({"status": "failed", "error": err})
                return False
        argv = ["uv", "pip", "install", "--python", str(py), *args]
        if argv_is_forbidden(argv, pins):
            self._write_state({"status": "failed", "error": "refusing AGPL studio/cli extra"})
            return False
        self._write_state({"status": "pending"})
        result = self._runner(argv)
        if result.returncode != 0:
            err = (result.stderr or result.stdout or "uv pip install failed").strip()
            log(err, "error")
            self._write_state({"status": "failed", "error": err})
            return False
        self._write_state({"status": "ready", "packages": args})
        log("Unsloth Core venv ready.", "info")
        return True

    def preflight(self) -> tuple[bool, str]:
        py = venv_python(venv_dir(self.root))
        if not py.exists():
            return False, "tuning venv python is missing; re-provision from Settings."
        result = self._runner([str(py), "-c", "import unsloth; print('ok')"])
        if result.returncode != 0:
            return False, (result.stderr or result.stdout or "import unsloth failed").strip()
        return True, "ok"


__all__ = [
    "UnslothVenvProvisioner",
    "argv_is_forbidden",
    "load_pins",
    "pip_args",
    "training_supported",
]
