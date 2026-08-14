"""
v1.16.0 Phase 3 (adoption item A5) -- device probing + engine capability gating.

Mirrors `runtimes/diffusion/device.py`'s shape (a JSON-serializable `DeviceInfo`
that never raises and never requires torch) but stays a separate module on
purpose: the OCR runtime must be installable and runnable WITHOUT the diffusion
runtime's dependency tree, and coupling the two would defeat that.

The capability question this module answers is the one the plan's stability gate
turns on: "on an incapable/incompatible host the capability is cleanly
unavailable with an explained state, not a crash". `engine_availability` returns
a reason string per engine so the UI can say *why* rather than just failing.
"""

from __future__ import annotations

import importlib.util
import platform
from dataclasses import dataclass
from typing import Callable, Optional

_BYTES_PER_GB = 1024**3

#: VRAM the CUDA vision-language engine needs, mirroring the catalog entry's
#: ``requiredVramGB``. Kept in sync by ``tests/python/ocr/test_device.py``.
UNLIMITED_OCR_REQUIRED_VRAM_GB = 12.0


@dataclass(frozen=True)
class DeviceInfo:
    torch_version: str
    cuda_version: str
    device_name: str
    vram_total_gb: Optional[float]
    vram_free_gb: Optional[float]
    platform_system: str
    platform_machine: str


@dataclass(frozen=True)
class EngineAvailability:
    """Whether one engine can run here, and the reason when it cannot."""

    engine: str
    available: bool
    reason: str


def _module_present(name: str) -> bool:
    """True when a module is importable WITHOUT importing it.

    `find_spec` avoids paying torch's multi-second import just to answer a
    health probe, and avoids executing a broken install's side effects.
    """
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):  # pragma: no cover - malformed install
        return False


def _try_import_torch():  # pragma: no cover - exercised on CUDA hosts only
    try:
        import torch  # type: ignore[import-not-found]

        return torch
    except Exception:
        return None


def detect() -> DeviceInfo:
    """Probe the host. Never raises; degrades to a CPU descriptor."""
    system = platform.system()
    machine = platform.machine()
    torch = _try_import_torch()
    if torch is None:
        return DeviceInfo(
            torch_version="absent",
            cuda_version="absent",
            device_name="cpu",
            vram_total_gb=None,
            vram_free_gb=None,
            platform_system=system,
            platform_machine=machine,
        )
    torch_version = getattr(torch, "__version__", "unknown")
    cuda_available = bool(getattr(torch, "cuda", None) and torch.cuda.is_available())
    if not cuda_available:
        return DeviceInfo(
            torch_version=torch_version,
            cuda_version="absent",
            device_name="cpu",
            vram_total_gb=None,
            vram_free_gb=None,
            platform_system=system,
            platform_machine=machine,
        )
    try:  # pragma: no cover - CUDA host path
        free_bytes, total_bytes = torch.cuda.mem_get_info()
        return DeviceInfo(
            torch_version=torch_version,
            cuda_version=getattr(torch.version, "cuda", "unknown"),
            device_name=torch.cuda.get_device_name(0),
            vram_total_gb=round(total_bytes / _BYTES_PER_GB, 2),
            vram_free_gb=round(free_bytes / _BYTES_PER_GB, 2),
            platform_system=system,
            platform_machine=machine,
        )
    except Exception:  # pragma: no cover - defensive
        return DeviceInfo(
            torch_version=torch_version,
            cuda_version="error",
            device_name="cpu",
            vram_total_gb=None,
            vram_free_gb=None,
            platform_system=system,
            platform_machine=machine,
        )


def rapidocr_availability(info: DeviceInfo) -> EngineAvailability:
    """RapidOCR runs anywhere ONNX Runtime does -- no GPU, no OS restriction."""
    if not _module_present("rapidocr_onnxruntime"):
        return EngineAvailability(
            engine="rapidocr",
            available=False,
            reason=(
                "rapidocr_onnxruntime is not installed in this Python "
                "environment; reinstall the Nexus document runtime"
            ),
        )
    del info  # RapidOCR has no hardware precondition; kept for a uniform signature.
    return EngineAvailability("rapidocr", True, "ready (CPU)")


def unlimited_ocr_availability(
    info: DeviceInfo,
    required_vram_gb: float = UNLIMITED_OCR_REQUIRED_VRAM_GB,
    module_present: Optional[Callable[[str], bool]] = None,
) -> EngineAvailability:
    """The VLM engine needs torch, CUDA, and enough VRAM.

    Each failure returns a DIFFERENT reason, because "you have no NVIDIA GPU" and
    "your GPU is too small" lead a user to different actions.

    Check ORDER is deliberate: an unfixable HARDWARE fact outranks a fixable
    dependency one. Telling a Mac user "transformers is not installed" would send
    them to install a package that still leaves the model unusable; telling them
    "this model is NVIDIA-only, use RapidOCR" is actionable. The one exception is
    torch itself -- without it we cannot probe the hardware at all, so its
    absence is reported first as the genuinely blocking unknown.
    """
    present = module_present if module_present is not None else _module_present

    if info.torch_version == "absent":
        return EngineAvailability(
            engine="unlimited-ocr",
            available=False,
            reason="PyTorch is not installed in this Python environment",
        )
    if info.cuda_version == "absent":
        return EngineAvailability(
            engine="unlimited-ocr",
            available=False,
            reason=(
                f"no CUDA device detected on {info.platform_system}/"
                f"{info.platform_machine}; this model is NVIDIA-only. "
                "Use the RapidOCR document model instead."
            ),
        )
    total = info.vram_total_gb
    if total is not None and total < required_vram_gb:
        return EngineAvailability(
            engine="unlimited-ocr",
            available=False,
            reason=(
                f"needs about {required_vram_gb:.0f} GB VRAM, this GPU reports "
                f"{total:.1f} GB. Use the RapidOCR document model instead."
            ),
        )
    # Hardware is fine; only now does a missing Python dependency become the
    # actionable blocker.
    if not present("transformers"):
        return EngineAvailability(
            engine="unlimited-ocr",
            available=False,
            reason="transformers is not installed in this Python environment",
        )
    return EngineAvailability("unlimited-ocr", True, "ready (CUDA)")


def engine_availability(info: Optional[DeviceInfo] = None) -> dict[str, dict[str, object]]:
    """Availability of every engine, as a JSON-serializable map for `health`."""
    detected = info if info is not None else detect()
    results = [rapidocr_availability(detected), unlimited_ocr_availability(detected)]
    return {
        r.engine: {"available": r.available, "reason": r.reason} for r in results
    }
