"""Runtime wiring provisioner (v2.2.0 Phase 1, sub-task 1.3).

Guarantees the three runtime facts the desktop shell depends on and records
them in the installer/app contract file ``~/.nexus/runtime.json``:

1. A Node runtime at the per-user runtime tree (``node_provisioner.runtime_root``)
   so the Tauri shell never depends on a system ``node`` on PATH. Sources, in
   order: an already-provisioned Node, the offline installer payload, or a
   pinned + sha256-verified download from nodejs.org.
2. The diffusion runtime Python sources (``runtimes/``) copied out of the
   frozen installer bundle so ``python -m runtimes.diffusion.main`` is
   importable on the installed machine.
3. ``runtime.json`` itself, written atomically, recording ``nodePath``,
   ``diffusionPython``, ``diffusionCwd``, ``modelsRoot``, and Ollama info.
   The Rust shell reads ``nodePath``; the Node sidecar reads the diffusion
   and models fields at boot.

Every step is best-effort per-fact: a missing diffusion venv does not block
recording a working nodePath. ``install`` returns False only when NO usable
Node could be provisioned (the sidecar cannot run without one).
"""

from __future__ import annotations

import hashlib
import json
import os
import platform as _platform
import shutil
import sys
import tarfile
import tempfile
import zipfile
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import httpx

from nexus_installer.engine.diffusion_venv_provisioner import (
    DiffusionProvisionResult,
    DiffusionVenvProvisioner,
    venv_dir,
    venv_python,
)
from nexus_installer.engine.node_provisioner import (
    NodeProvisioner,
    node_executable,
    runtime_root,
)
from nexus_installer.engine.platform_utils import is_macos, is_windows
from nexus_installer.installer_state import InstallerState

LogFn = Callable[[str, str], None]

RUNTIME_CONFIG_SCHEMA_VERSION = 3

# Pinned Node runtime downloads (nodejs.org SHASUMS256.txt for v22.11.0),
# matching the version pinned in build/versions.lock.json. Used only when
# neither an existing provisioned Node nor the offline payload is available.
NODE_VERSION = "22.11.0"
NODE_DOWNLOADS: dict[str, dict[str, str]] = {
    "win-x64": {
        "url": f"https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-win-x64.zip",
        "sha256": "905373a059aecaf7f48c1ce10ffbd5334457ca00f678747f19db5ea7d256c236",
    },
    "darwin-arm64": {
        "url": f"https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-darwin-arm64.tar.gz",
        "sha256": "2e89afe6f4e3aa6c7e21c560d8a0453d84807e97850bbb819b998531a22bdfde",
    },
    "darwin-x64": {
        "url": f"https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-darwin-x64.tar.gz",
        "sha256": "668d30b9512137b5f5baeef6c1bb4c46efff9a761ba990a034fb6b28b9da2465",
    },
    "linux-x64": {
        "url": f"https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-linux-x64.tar.xz",
        "sha256": "83bf07dd343002a26211cf1fcd46a9d9534219aad42ee02847816940bf610a72",
    },
}


def runtime_config_path() -> Path:
    """``~/.nexus/runtime.json`` -- shared contract with the desktop shell."""
    return Path.home() / ".nexus" / "runtime.json"


def runtimes_sources_root() -> Path:
    """Where the diffusion/audio/ocr runtime Python sources are installed."""
    if is_windows():
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return Path(base) / "Nexus" / "runtimes"
    if is_macos():
        return Path.home() / "Library" / "Application Support" / "Nexus" / "runtimes"
    return Path.home() / ".local" / "share" / "nexus" / "runtimes"


def _node_download_key() -> str | None:
    machine = _platform.machine().lower()
    if is_windows():
        return "win-x64" if machine in ("amd64", "x86_64") else None
    if is_macos():
        return "darwin-arm64" if machine in ("arm64", "aarch64") else "darwin-x64"
    if machine in ("x86_64", "amd64"):
        return "linux-x64"
    return None


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _extract_flattened(archive: Path, dest: Path, log: LogFn) -> bool:
    """Extract a Node dist archive, flattening the single top-level dir."""
    staging = Path(tempfile.mkdtemp(prefix="nexus-node-"))
    try:
        if archive.suffix == ".zip":
            with zipfile.ZipFile(archive) as zf:
                zf.extractall(staging)
        else:
            # .tar.gz / .tar.xz -- filter guards against path traversal.
            with tarfile.open(archive) as tf:
                tf.extractall(staging, filter="data")
        entries = [p for p in staging.iterdir() if p.is_dir()]
        source = entries[0] if len(entries) == 1 else staging
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        shutil.copytree(source, dest)
        return True
    except (OSError, zipfile.BadZipFile, tarfile.TarError) as e:
        log(f"Node archive extraction failed: {e}", "error")
        return False
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def provision_node(payload_dir: Path | None, log: LogFn) -> Path | None:
    """Ensure a Node runtime exists at ``runtime_root``; return its exe path.

    Order: existing install -> offline payload -> pinned download. Returns
    None when every source fails (network down AND no payload AND nothing
    already provisioned).
    """
    root = runtime_root()
    exe = node_executable(root)
    if exe.is_file():
        log(f"Node runtime already provisioned at {exe}", "info")
        return exe

    if payload_dir is not None:
        provisioner = NodeProvisioner(payload_dir)
        if provisioner.payload_exists():
            log("Provisioning Node from the offline installer payload...", "info")
            if provisioner.install(log) and exe.is_file():
                return exe
            log("Payload Node provisioning failed; trying download.", "warn")

    key = _node_download_key()
    if key is None:
        log("No pinned Node build for this OS/architecture.", "error")
        return None
    pin = NODE_DOWNLOADS[key]
    suffix = (
        ".zip"
        if pin["url"].endswith(".zip")
        else ".tar" + pin["url"].rsplit(".tar", 1)[-1]
    )
    log(f"Downloading Node {NODE_VERSION} ({key})...", "info")
    tmp = Path(tempfile.mkstemp(prefix="nexus-node-", suffix=suffix)[1])
    try:
        with httpx.stream("GET", pin["url"], follow_redirects=True, timeout=60) as resp:
            resp.raise_for_status()
            with tmp.open("wb") as fh:
                for chunk in resp.iter_bytes():
                    fh.write(chunk)
        actual = _sha256_file(tmp)
        if actual != pin["sha256"]:
            log(
                "Downloaded Node archive failed checksum verification "
                f"(expected {pin['sha256'][:12]}..., got {actual[:12]}...).",
                "error",
            )
            return None
        if not _extract_flattened(tmp, root, log):
            return None
    except (httpx.HTTPError, OSError) as e:
        log(f"Node download failed: {e}", "error")
        return None
    finally:
        tmp.unlink(missing_ok=True)

    if exe.is_file():
        log(f"Node {NODE_VERSION} provisioned at {exe}", "success")
        return exe
    log(f"Node extraction completed but {exe} is missing.", "error")
    return None


def _bundled_runtimes_source() -> Path | None:
    """Locate the ``runtimes/`` Python sources shipped with the installer."""
    if getattr(sys, "frozen", False):
        base = Path(getattr(sys, "_MEIPASS", ""))
        candidate = base / "runtimes"
        return candidate if candidate.is_dir() else None
    # Dev checkout: scripts/installer/src/nexus_installer/engine -> repo root.
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "runtimes" / "diffusion"
        if candidate.is_dir():
            return parent / "runtimes"
    return None


def provision_runtimes_sources(log: LogFn) -> Path | None:
    """Copy the ``runtimes/`` sources next to the other per-user runtimes.

    Returns the directory from which ``runtimes.diffusion.main`` is importable
    (i.e. the PARENT holding the ``runtimes`` package), or None.
    """
    source = _bundled_runtimes_source()
    if source is None:
        log("Diffusion runtime sources not bundled; skipping copy.", "warn")
        return None
    dest = runtimes_sources_root() / "runtimes"
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        shutil.copytree(
            source,
            dest,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".pytest_cache"),
        )
        log(f"Diffusion runtime sources installed at {dest}", "info")
        return dest.parent
    except OSError as e:
        log(f"Could not copy runtime sources: {e}", "warn")
        return None


def write_runtime_config(
    state: InstallerState,
    log: LogFn,
    *,
    node_path: Path | None,
    diffusion_cwd: Path | None,
    diffusion: DiffusionProvisionResult | None = None,
    app_version: str | None = None,
) -> bool:
    """Atomically write ``~/.nexus/runtime.json`` recording what exists."""
    diffusion_python = venv_python(venv_dir())
    models_root = getattr(state, "models_root", None) or str(
        Path.home() / ".nexus" / "models"
    )
    readiness = diffusion or DiffusionProvisionResult(
        status="not_requested",
        backend="none",
        failure_code="NOT_REQUESTED",
    )
    # Record an existing interpreter even when package smoke failed. The
    # sidecar never launches it for generation unless readiness is ``ready``,
    # but the v2.4.1 media-repair service needs the interpreter path to run the
    # bounded in-place repair command.
    diffusion_python_present = diffusion_python.is_file()
    config = {
        "schemaVersion": RUNTIME_CONFIG_SCHEMA_VERSION,
        "nodePath": str(node_path) if node_path else None,
        "diffusionPython": str(diffusion_python) if diffusion_python_present else None,
        "diffusionCwd": str(diffusion_cwd) if diffusion_cwd else None,
        "diffusion": readiness.to_dict(),
        "repairAttempt": {
            "attemptId": readiness.attempt_id or None,
            "status": readiness.status,
            "failureCode": readiness.failure_code or None,
            "ownerPid": readiness.repair_owner_pid or None,
            "startedAt": readiness.repair_started_at or None,
            "finishedAt": datetime.now(UTC).isoformat(),
        },
        "modelsRoot": str(models_root),
        "ollama": {"url": getattr(state, "ollama_url", None)},
        "writtenBy": f"nexus-installer {app_version or ''}".strip(),
        "writtenAt": datetime.now(UTC).isoformat(),
    }
    target = runtime_config_path()
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(
            prefix="runtime-", suffix=".json.tmp", dir=str(target.parent)
        )
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(config, fh, indent=2)
            fh.write("\n")
        os.replace(tmp_name, target)
        log(f"Runtime contract written to {target}", "success")
        return True
    except OSError as e:
        log(f"Could not write runtime.json: {e}", "error")
        return False


def selection_snapshot_path() -> Path:
    """``~/.nexus/selected-models.json`` -- picker ownership contract."""
    return Path.home() / ".nexus" / "selected-models.json"


def _ordered_selected_ids(state: InstallerState) -> list[str]:
    raw = list(getattr(state, "selected_model_ids", None) or [])
    selected = getattr(state, "selected_model", "") or ""
    if not raw and selected:
        raw = [selected]
    ordered: list[str] = []
    seen: set[str] = set()
    for model_id in raw:
        if model_id and model_id not in seen:
            seen.add(model_id)
            ordered.append(model_id)
    return ordered


def _recommended_by_task(ordered_ids: list[str]) -> dict[str, str]:
    catalog: dict[str, object] = {}
    try:
        from nexus_installer.engine.model_router import (
            default_catalog_path,
            load_catalog_index,
        )

        catalog = load_catalog_index(default_catalog_path())
    except (OSError, ImportError, TypeError, ValueError):
        catalog = {}
    recommended: dict[str, str] = {}
    for model_id in ordered_ids:
        entry = catalog.get(model_id) if isinstance(catalog, dict) else None
        task: str | None = None
        if isinstance(entry, dict):
            raw_task = entry.get("task")
            if raw_task in ("chat", "agentic", "image", "video"):
                task = str(raw_task)
            else:
                typ = entry.get("type")
                if typ == "image":
                    task = "image"
                elif typ == "video":
                    task = "video"
                elif typ in ("llm", "embed"):
                    task = "chat"
        if task and task not in recommended:
            recommended[task] = model_id
    return recommended


def write_selection_snapshot(state: InstallerState, log: LogFn) -> bool:
    """Atomically write the installer selection snapshot the sidecar reads."""
    ordered = _ordered_selected_ids(state)
    payload = {
        "schemaVersion": 1,
        "orderedIds": ordered,
        "recommendedByTask": _recommended_by_task(ordered),
        "downloadedSinceInstall": [],
    }
    target = selection_snapshot_path()
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(
            prefix="selected-models-", suffix=".json.tmp", dir=str(target.parent)
        )
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
            fh.write("\n")
        os.replace(tmp_name, target)
        log(f"Selection snapshot written to {target}", "success")
        return True
    except OSError as e:
        log(f"Could not write selected-models.json: {e}", "error")
        return False


class RuntimeProvisioner:
    """One installer step: Node + runtime sources + runtime.json."""

    def __init__(self, payload_dir: Path | None = None) -> None:
        self._payload_dir = payload_dir

    @staticmethod
    def _selection_requires_diffusion(state: InstallerState) -> bool:
        selected = _ordered_selected_ids(state)
        if not selected:
            return False
        try:
            from nexus_installer.engine.model_router import (
                default_catalog_path,
                load_catalog_index,
            )

            catalog = load_catalog_index(default_catalog_path())
        except (OSError, ImportError, TypeError, ValueError):
            return False
        for model_id in selected:
            entry = catalog.get(model_id) if isinstance(catalog, dict) else None
            if isinstance(entry, dict) and (
                entry.get("task") in {"image", "video"}
                or entry.get("type") in {"image", "video"}
            ):
                return True
        return False

    @staticmethod
    def _source_python(state: InstallerState) -> str | None:
        configured = str(getattr(state, "python_path", "") or "").strip()
        if configured and Path(configured).is_file():
            return configured
        for command in ("python3", "python"):
            resolved = shutil.which(command)
            if resolved and Path(resolved).resolve() != Path(sys.executable).resolve():
                return resolved
        if not getattr(sys, "frozen", False) and Path(sys.executable).is_file():
            return sys.executable
        return None

    def install(
        self,
        state: InstallerState,
        log: LogFn,
        progress: Callable[[float], None] | None = None,
    ) -> bool:
        node = provision_node(self._payload_dir, log)
        diffusion_cwd = provision_runtimes_sources(log)
        diffusion = DiffusionProvisionResult(
            status="not_requested",
            backend="none",
            failure_code="NOT_REQUESTED",
        )
        if self._selection_requires_diffusion(state):
            source_python = self._source_python(state)
            if source_python is None:
                diffusion = DiffusionProvisionResult(
                    status="failed",
                    backend="unknown",
                    failure_code="PYTHON_NOT_FOUND",
                )
            else:
                payload = self._payload_dir or Path()
                diffusion = DiffusionVenvProvisioner(
                    payload,
                    python_executable=source_python,
                ).provision_verified(
                    log,
                    gpu_vendor=getattr(state, "gpu_vendor", ""),
                    progress=progress,
                )
            if diffusion.status != "ready":
                log(
                    "Image and video runtime is not ready "
                    f"({diffusion.failure_code}); chat remains available. "
                    "Re-run the installer to repair media generation.",
                    "warn",
                )
        wrote = write_runtime_config(
            state,
            log,
            node_path=node,
            diffusion_cwd=diffusion_cwd,
            diffusion=diffusion,
            app_version=getattr(state, "app_version", None),
        )
        snapshot_ok = write_selection_snapshot(state, log)
        if not snapshot_ok:
            log(
                "Selection snapshot was not written; pickers may show leftover "
                "models from a previous install until this file exists.",
                "warn",
            )
        if node is None:
            log(
                "No Node runtime could be provisioned; the desktop backend "
                "cannot start without one. Re-run the installer with network "
                "access to repair.",
                "error",
            )
            return False
        if self._selection_requires_diffusion(state) and diffusion.status != "ready":
            # Node and runtime.json still exist so chat can start. Selected
            # image/video capability is a required failure, not a successful run.
            return False
        return wrote


__all__ = [
    "NODE_DOWNLOADS",
    "NODE_VERSION",
    "RUNTIME_CONFIG_SCHEMA_VERSION",
    "RuntimeProvisioner",
    "provision_node",
    "provision_runtimes_sources",
    "runtime_config_path",
    "runtimes_sources_root",
    "write_runtime_config",
    "selection_snapshot_path",
    "write_selection_snapshot",
]
