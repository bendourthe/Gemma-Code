"""SANA pipeline (v1.1.0 Phase 12.2).

Registers `sana.txt2img` / `sana.img2img` handlers backed by a diffusers
`SanaPipeline` and the linked DC-AE VAE. The real diffusers-backed
executor only runs on a CUDA host (operator action OA-09 on the
RTX 4070 baseline rig); the CI executor falls back to the deterministic
stub from `pipelines/base.py` so the JSON-RPC round-trip and workflow
metadata embedding remain verifiable in environments without a GPU.

The handler shape mirrors the existing `txt2img` / `img2img` modules so
the dispatcher can route into SANA via the standard mode string when the
caller's `modelId` belongs to the SANA family (resolved by the catalog
entry's `linkedVAE` / `family` fields). The VAE id is derived from
`linkedVAE` when present, falling back to the canonical DC-AE id.

CI gate: `pipelines/test_sana.py` exercises register + IPC round-trip.
Real-host timing capture is tracked under operator action OA-09 -- SANA
1.6B 1024x1024 target is <= 1.5 s on the RTX 4070 baseline rig.
"""

from __future__ import annotations

from typing import Callable, Dict, Optional

from . import base, real_execute


# SANA 1.6B at 1024px occupies ~3.2 GB on disk and ~5-6 GB in CUDA at
# bf16. Use 6 GB as the planning size so the offload decision stays
# conservative on 8 GB hosts (which run the int4 variant via
# `sana_int4.py`).
_MODEL_SIZE_GB = 6.0

# Canonical DC-AE VAE id; SANA pipelines auto-load this when an entry's
# `linkedVAE` is omitted. The real diffusers call would be:
#   from diffusers import SanaPipeline, AutoencoderDC
#   vae = AutoencoderDC.from_pretrained(DEFAULT_VAE_ID)
#   pipe = SanaPipeline.from_pretrained(model_id, vae=vae)
DEFAULT_VAE_ID = "mit-han-lab/dc-ae-f32c32-sana-1.1"


def resolve_vae(model_id: str, linked_vae: Optional[str] = None) -> str:
    """Return the DC-AE VAE id linked to a SANA model.

    `linked_vae` is read from the catalog entry's `linkedVAE` field by
    the dispatcher; falling back to the canonical DC-AE id keeps the
    pipeline usable when a caller's catalog snapshot omits the link
    (older registry consumers).
    """
    if linked_vae and isinstance(linked_vae, str) and linked_vae.strip():
        return linked_vae.strip()
    return DEFAULT_VAE_ID


# Mapping from SANA-ControlNet variant id to the matching `controlnet_aux`
# preprocessor name (the Phase 6 v1.0.0 wiring; preprocessors live under
# `runtimes/diffusion/preprocessors/`). The dispatcher passes the
# `preprocessor` field through `params.ControlNetRef` into the SANA
# pipeline; the real diffusers call invokes the listed preprocessor
# against `conditionImage` and feeds the result into
# `ControlNetModel.from_pretrained(modelId)`.
SANA_CONTROLNET_PREPROCESSORS: Dict[str, str] = {
    "sana-controlnet-pose": "pose",
    "sana-controlnet-depth": "depth",
    "sana-controlnet-canny": "canny",
}


def is_sana_controlnet(model_id: str) -> bool:
    """Return True when `model_id` is one of the SANA-ControlNet weights."""
    return model_id in SANA_CONTROLNET_PREPROCESSORS


def preprocessor_for_controlnet(model_id: str) -> Optional[str]:
    """Return the preprocessor name linked to a SANA-ControlNet id.

    Returns `None` for non-SANA-ControlNet ids; callers should treat
    that as "no automatic preprocessor binding, use the user's choice".
    """
    return SANA_CONTROLNET_PREPROCESSORS.get(model_id)


def is_sana_model(model_id: str) -> bool:
    """Heuristic: a model id belongs to the SANA family.

    Used by the dispatcher to route into this pipeline when the caller's
    `modelId` starts with the canonical SANA prefix. Excludes the
    `sana-sprint-*` (handled by `sana_sprint.py`), `sana-*-int4`
    (handled by `sana_int4.py`), and `sana-video-*` (handled by
    `sana_video.py`) variants.
    """
    if not model_id.startswith("sana"):
        return False
    if model_id.startswith("sana-sprint"):
        return False
    if model_id.endswith("-int4"):
        return False
    if model_id.startswith("sana-video"):
        return False
    return True


def register(handlers: Dict[str, Callable]) -> None:
    """Register `sana.txt2img` + `sana.img2img` handlers.

    Each handler runs through the standard `PipelineRunner` so param
    validation, offload selection, and PNG workflow metadata embedding
    are shared with the SDXL / SD1.5 paths. The execution callback is
    the deterministic CI stub by default; on a CUDA host the
    operator-action workflow (OA-09) swaps `execute=` for the real
    diffusers-backed callable.
    """
    txt_runner = base.PipelineRunner(
        mode="txt2img",
        execute=base.select_executor("sana.txt2img", real=real_execute.image_execute),
        model_size_gb=_MODEL_SIZE_GB,
    )
    img_runner = base.PipelineRunner(
        mode="img2img",
        execute=base.select_executor("sana.img2img", real=real_execute.image_execute),
        model_size_gb=_MODEL_SIZE_GB,
    )
    handlers["sana.txt2img"] = lambda params: txt_runner.run(params or {})
    handlers["sana.img2img"] = lambda params: img_runner.run(params or {})
