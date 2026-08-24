"""Video pipeline parameter validation.

The video pipelines share most of the image-side knobs (modelId / prompt /
negative / width / height / steps / cfgScale / sampler / seed) plus three
video-only fields: `durationSeconds`, `fps`, and `mode` (text2video vs
image2video vs audio2video). For image2video, a `sourceImage` is also
required. For audio2video, `sourceImage` + `sourceAudio` +
`confirmLocalAvatar` are required. Continuation segments may carry
`continueFrom`.

This module mirrors the shape of `params.py` but with stricter ranges
matched to the v1.0.0 single-GPU ceiling per the Phase 7 plan, plus the
v2.0.0 continuation / avatar exceptions:

    - durationSeconds: 1 - 10 (text2video / image2video per segment)
                       1 - 60 (audio2video, matching a spoken take)
    - fps:             12 / 16 / 24 only
    - resolution:      480p (854 x 480) or 720p (1280 x 720)

Validation is intentionally strict so a malformed UI request fails fast
with a structured error before the runner schedules any GPU work.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional


_VALID_VIDEO_MODES = {"text2video", "image2video", "audio2video"}
_MAX_DURATION_BY_MODE = {
    "text2video": 10,
    "image2video": 10,
    "audio2video": 60,
}
_VALID_FPS = {12, 16, 24}
# v1.1.0 Phase 13.1 -- `flow-dpm-solver` joins the allowed video samplers
# so the SANA-Video 2B "Fast 720p" preset round-trips through the same
# validator as LTX-Video / SVD / CogVideoX.
_VALID_SAMPLERS = {
    "euler",
    "euler_a",
    "dpmpp_2m",
    "dpmpp_sde",
    "ddim",
    "lms",
    "flow-dpm-solver",
}
_VALID_RESOLUTIONS = {(854, 480), (1280, 720)}


class VideoParamsError(ValueError):
    pass


@dataclass(frozen=True)
class VideoParams:
    model_id: str
    mode: str
    prompt: str
    negative_prompt: str
    width: int
    height: int
    duration_seconds: int
    fps: int
    steps: int
    cfg_scale: float
    sampler: str
    seed: int
    latent_preview: bool
    source_image: Optional[str] = None
    source_audio: Optional[str] = None
    confirm_local_avatar: bool = False
    weight_repo: Optional[str] = None
    diffusion_tier: Optional[str] = None
    vram_gb: Optional[float] = None
    continue_from: Optional[dict[str, Any]] = None


def _require_str(d: Mapping[str, Any], key: str, default: Optional[str] = None) -> str:
    if key not in d:
        if default is not None:
            return default
        raise VideoParamsError(f"missing field: {key}")
    value = d[key]
    if not isinstance(value, str):
        raise VideoParamsError(f"{key} must be string, got {type(value).__name__}")
    return value


def _require_int(d: Mapping[str, Any], key: str, default: Optional[int] = None) -> int:
    if key not in d:
        if default is not None:
            return default
        raise VideoParamsError(f"missing field: {key}")
    value = d[key]
    if isinstance(value, bool) or not isinstance(value, int):
        raise VideoParamsError(f"{key} must be int, got {type(value).__name__}")
    return value


def _require_float(d: Mapping[str, Any], key: str, default: Optional[float] = None) -> float:
    if key not in d:
        if default is not None:
            return default
        raise VideoParamsError(f"missing field: {key}")
    value = d[key]
    if isinstance(value, bool):
        raise VideoParamsError(f"{key} must be number, got bool")
    if not isinstance(value, (int, float)):
        raise VideoParamsError(f"{key} must be number, got {type(value).__name__}")
    return float(value)


def parse(mode: str, request: Mapping[str, Any]) -> VideoParams:
    if mode not in _VALID_VIDEO_MODES:
        raise VideoParamsError(f"invalid video mode: {mode}")
    sampler = _require_str(request, "sampler", "euler_a")
    if sampler not in _VALID_SAMPLERS:
        raise VideoParamsError(f"invalid sampler: {sampler}")
    width = _require_int(request, "width")
    height = _require_int(request, "height")
    if (width, height) not in _VALID_RESOLUTIONS:
        raise VideoParamsError(
            f"invalid resolution {width}x{height}; allowed: 854x480, 1280x720"
        )
    duration = _require_int(request, "durationSeconds")
    max_duration = _MAX_DURATION_BY_MODE[mode]
    if duration < 1 or duration > max_duration:
        raise VideoParamsError(
            f"durationSeconds must be between 1 and {max_duration}, got {duration}"
        )
    fps = _require_int(request, "fps")
    if fps not in _VALID_FPS:
        raise VideoParamsError(f"invalid fps {fps}; allowed: {sorted(_VALID_FPS)}")
    steps = _require_int(request, "steps")
    if steps < 1 or steps > 150:
        raise VideoParamsError(f"steps must be between 1 and 150, got {steps}")
    source_image: Optional[str] = None
    source_audio: Optional[str] = None
    if mode == "image2video":
        source_image = _require_str(request, "sourceImage")
    if mode == "audio2video":
        source_image = _require_str(request, "sourceImage")
        source_audio = _require_str(request, "sourceAudio")
        if request.get("confirmLocalAvatar") is not True:
            raise VideoParamsError("confirmLocalAvatar must be true for audio2video")
    continue_from = request.get("continueFrom")
    if continue_from is not None and not isinstance(continue_from, dict):
        raise VideoParamsError("continueFrom must be an object")
    vram_raw = request.get("vramGB")
    vram_gb: Optional[float] = None
    if vram_raw is not None:
        if isinstance(vram_raw, bool) or not isinstance(vram_raw, (int, float)):
            raise VideoParamsError("vramGB must be number")
        vram_gb = float(vram_raw)
    weight_repo = request.get("weightRepo")
    if weight_repo is not None and not isinstance(weight_repo, str):
        raise VideoParamsError("weightRepo must be string")
    diffusion_tier = request.get("diffusionTier")
    if diffusion_tier is not None and not isinstance(diffusion_tier, str):
        raise VideoParamsError("diffusionTier must be string")
    return VideoParams(
        model_id=_require_str(request, "modelId"),
        mode=mode,
        prompt=_require_str(request, "prompt"),
        negative_prompt=_require_str(request, "negativePrompt", ""),
        width=width,
        height=height,
        duration_seconds=duration,
        fps=fps,
        steps=steps,
        cfg_scale=_require_float(request, "cfgScale"),
        sampler=sampler,
        seed=_require_int(request, "seed"),
        latent_preview=bool(request.get("latentPreview", True)),
        source_image=source_image,
        source_audio=source_audio,
        confirm_local_avatar=request.get("confirmLocalAvatar") is True,
        weight_repo=weight_repo,
        diffusion_tier=diffusion_tier,
        vram_gb=vram_gb,
        continue_from=continue_from,
    )


def frame_count(params: VideoParams) -> int:
    """Total frames the pipeline should produce.

    Kept as a free function so the dispatcher can compute thumbnail
    bucketing (one preview per second) without re-deriving the formula.
    """
    return params.duration_seconds * params.fps
