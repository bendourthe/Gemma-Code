"""v1.1.0 Phase 14.2 -- OS-aware provisioner dispatch.

Reads a `HostProfile` and returns the ordered list of provisioner names that
should run for the host. The dispatcher returns *names* rather than concrete
classes so call sites can substitute mocks or build their own chains; the
default factory below wires the canonical implementations together.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from nexus_installer.engine.host_detect import HostProfile

LogFn = Callable[[str, str], None]


@dataclass(frozen=True)
class ProvisionerSpec:
    """A named handle pointing to one provisioner class + constructor kwargs."""

    name: str
    factory: Callable[[Path], Any]


def chain_for(profile: HostProfile) -> list[str]:
    """Return the ordered provisioner names for the given host profile."""
    if profile.os_family == "windows":
        first = "cuda" if profile.cuda_compatible else "cpu-only"
        return [
            first,
            "windows-python",
            "node",
            "ollama-windows",
            "ffmpeg",
        ]
    if profile.os_family == "macos":
        first = "metal" if profile.metal_compatible else "cpu-only"
        return [
            first,
            "macos-python",
            "node",
            "ollama-macos",
            "ffmpeg",
        ]
    if profile.os_family == "linux":
        if profile.cuda_compatible:
            first = "cuda-linux"
        elif profile.rocm_compatible:
            first = "rocm"
        else:
            first = "cpu-only"
        return [
            first,
            "linux-python",
            "node",
            "ollama-linux",
            "ffmpeg",
        ]
    return ["cpu-only", "node", "ffmpeg"]


def default_provisioner_factory(
    payload_dir: Path,
) -> Mapping[str, Any]:
    """Build a name -> provisioner mapping wired to bundled payload paths.

    Imports lazily so test contexts can swap stubs in without dragging the
    heavier provisioner modules onto the import path.
    """
    from nexus_installer.engine.cpu_only_provisioner import CpuOnlyProvisioner
    from nexus_installer.engine.cuda_linux_provisioner import CudaLinuxProvisioner
    from nexus_installer.engine.cuda_provisioner import CudaProvisioner
    from nexus_installer.engine.diffusion_venv_provisioner import (
        DiffusionVenvProvisioner,
    )
    from nexus_installer.engine.ffmpeg_provisioner import FfmpegProvisioner
    from nexus_installer.engine.metal_provisioner import MetalProvisioner
    from nexus_installer.engine.node_provisioner import NodeProvisioner
    from nexus_installer.engine.ollama_linux_provisioner import (
        OllamaLinuxProvisioner,
    )
    from nexus_installer.engine.ollama_macos_provisioner import (
        OllamaMacosProvisioner,
    )
    from nexus_installer.engine.rocm_provisioner import RocmProvisioner

    venv = DiffusionVenvProvisioner(payload_dir)
    return {
        "cuda": CudaProvisioner(payload_dir),
        "cuda-linux": CudaLinuxProvisioner(payload_dir),
        "rocm": RocmProvisioner(payload_dir),
        "metal": MetalProvisioner(payload_dir),
        "cpu-only": CpuOnlyProvisioner(payload_dir),
        "windows-python": venv,
        "macos-python": venv,
        "linux-python": venv,
        "node": NodeProvisioner(payload_dir),
        "ollama-macos": OllamaMacosProvisioner(payload_dir),
        "ollama-linux": OllamaLinuxProvisioner(payload_dir),
        "ffmpeg": FfmpegProvisioner(payload_dir),
    }


def run_chain(
    chain: list[str],
    provisioners: Mapping[str, Any],
    log: LogFn,
) -> tuple[list[str], list[str]]:
    """Run each provisioner in `chain` in order.

    Returns `(done, failed)`. A provisioner that has no `install` method (or
    is missing from `provisioners`) is skipped with a warning so the
    dispatcher remains robust against partially-stubbed test environments.
    """
    done: list[str] = []
    failed: list[str] = []
    for name in chain:
        provisioner = provisioners.get(name)
        if provisioner is None:
            log(f"Provisioner '{name}' missing; skipping", "warn")
            continue
        install = getattr(provisioner, "install", None)
        if install is None or not callable(install):
            log(f"Provisioner '{name}' has no install(); skipping", "warn")
            continue
        try:
            ok = bool(install(log))
        except Exception as exc:  # noqa: BLE001 -- surface failures via log
            log(f"Provisioner '{name}' crashed: {exc}", "error")
            ok = False
        (done if ok else failed).append(name)
    return done, failed


__all__ = [
    "ProvisionerSpec",
    "chain_for",
    "default_provisioner_factory",
    "run_chain",
]
