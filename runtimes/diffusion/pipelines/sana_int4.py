"""SANA INT4 pipeline (v1.1.0 Phase 12.4).

Registers `sana_int4.txt2img` -- the 4-bit quantized SANA 1.5 1.6B
pipeline that fits the `diffusion-low` (8 GB VRAM) tier. The
quantization runtime is `nunchaku` (MIT HAN Lab), distributed under
Apache-2.0 per the upstream repo at
`https://github.com/mit-han-lab/nunchaku`. License verification is the
12.4 prompt's gating condition and is recorded as completed in the
Phase 12 known-gaps entry (`12.4.P2.*`); the wheel manifest add is
tracked in `runtimes/diffusion/requirements.txt`.

CI executor is the deterministic stub from `pipelines/base.py`; the
real diffusers + nunchaku call runs on the RTX 3060 8 GB rig under
operator action OA-09 (target <= 2 s for a 1024x1024 image).
"""

from __future__ import annotations

from typing import Callable, Dict

from . import base


# SVDQuant INT4 weights occupy ~1.4 GB on disk; in CUDA the unet at
# int4 is ~3 GB and the DC-AE VAE at bf16 is ~0.5 GB. 5 GB is the
# planning size so the offload decision keeps `keep_on_gpu` on an
# 8 GB host.
_MODEL_SIZE_GB = 5.0

# Required runtime dependency for the SVDQuant kernels. The diffusion
# venv provisioner pins this in `runtimes/diffusion/requirements.txt`;
# missing the dep produces an `execution-failed` JSON-RPC envelope
# (not `pipeline-unavailable`) so the caller can surface a sensible
# error message in the UI.
REQUIRED_RUNTIME_DEP = "nunchaku"


def has_nunchaku() -> bool:
    """Probe whether the `nunchaku` quantization runtime is importable.

    Returns False in CI (where the wheel is absent); the pipeline still
    registers, but the stub executor handles the request.
    """
    try:  # pragma: no cover - GPU-only path
        import nunchaku  # type: ignore[import-not-found]  # noqa: F401

        return True
    except Exception:
        return False


def register(handlers: Dict[str, Callable]) -> None:
    """Register `sana_int4.txt2img`.

    The INT4 pipeline only supports text-to-image. img2img with INT4
    weights is supported by the upstream SVDQuant repo but routes
    through a separate kernel path that's deferred to a later phase.
    """
    runner = base.PipelineRunner(
        mode="txt2img",
        execute=base.select_executor("sana_int4.txt2img"),
        model_size_gb=_MODEL_SIZE_GB,
    )
    handlers["sana_int4.txt2img"] = lambda params: runner.run(params or {})
