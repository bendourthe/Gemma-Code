"""Device + VRAM probing for the diffusion runtime.

`detect()` returns a `DeviceInfo` that callers can serialize to JSON
without importing torch. When torch + CUDA are unavailable the function
falls back to a CPU descriptor; this keeps `health` callable in CI
where the runtime is just a stdio shim.

Smart-offload threshold helpers live here so the orchestration in
`pipelines/base.py` can stay framework-agnostic for unit testing.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


_BYTES_PER_GB = 1024 ** 3


@dataclass(frozen=True)
class DeviceInfo:
    torch_version: str
    cuda_version: str
    device_name: str
    vram_total_gb: Optional[float]
    vram_free_gb: Optional[float]


def _try_import_torch():  # pragma: no cover - exercised on CUDA hosts only
    try:
        import torch  # type: ignore[import-not-found]

        return torch
    except Exception:
        return None


def detect() -> DeviceInfo:
    torch = _try_import_torch()
    if torch is None:
        return DeviceInfo(
            torch_version="absent",
            cuda_version="absent",
            device_name="cpu",
            vram_total_gb=None,
            vram_free_gb=None,
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
        )
    try:  # pragma: no cover - CUDA host path
        device_name = torch.cuda.get_device_name(0)
        cuda_version = getattr(torch.version, "cuda", "unknown")
        free_bytes, total_bytes = torch.cuda.mem_get_info()
        return DeviceInfo(
            torch_version=torch_version,
            cuda_version=cuda_version,
            device_name=device_name,
            vram_total_gb=round(total_bytes / _BYTES_PER_GB, 2),
            vram_free_gb=round(free_bytes / _BYTES_PER_GB, 2),
        )
    except Exception:  # pragma: no cover - defensive
        return DeviceInfo(
            torch_version=torch_version,
            cuda_version="error",
            device_name="cpu",
            vram_total_gb=None,
            vram_free_gb=None,
        )


@dataclass(frozen=True)
class OffloadDecision:
    strategy: str
    reason: str


def choose_offload(
    free_vram_gb: Optional[float],
    model_size_gb: float,
    safety_multiplier: float = 1.5,
) -> OffloadDecision:
    """Decide how aggressively to offload weights given available VRAM.

    Mirrors the ComfyUI heuristic in `comfy/model_management.py`, but
    reverse-engineered into a small pure function so the choice is unit
    testable without importing torch:

        - free >= model * safety_multiplier -> `keep_on_gpu`
        - free >= model                     -> `model_cpu_offload`
        - free >= model / 2                 -> `sequential_cpu_offload`
        - otherwise                         -> `insufficient_vram` (caller errors out)

    Returning a struct (not raising) lets the dispatcher record the
    chosen strategy in the progress event for the UI.
    """
    if free_vram_gb is None:
        return OffloadDecision("cpu", "no CUDA device detected")
    if model_size_gb <= 0:
        return OffloadDecision(
            "keep_on_gpu",
            "model_size_gb not provided; assuming fits",
        )
    if free_vram_gb >= model_size_gb * safety_multiplier:
        return OffloadDecision(
            "keep_on_gpu",
            f"free {free_vram_gb:.1f} GB >= {safety_multiplier:.1f} x model {model_size_gb:.1f} GB",
        )
    if free_vram_gb >= model_size_gb:
        return OffloadDecision(
            "model_cpu_offload",
            f"free {free_vram_gb:.1f} GB ~= model {model_size_gb:.1f} GB",
        )
    if free_vram_gb >= model_size_gb / 2:
        return OffloadDecision(
            "sequential_cpu_offload",
            f"free {free_vram_gb:.1f} GB < model {model_size_gb:.1f} GB; sequential offload",
        )
    return OffloadDecision(
        "insufficient_vram",
        f"free {free_vram_gb:.1f} GB << model {model_size_gb:.1f} GB; pipeline cannot load",
    )
