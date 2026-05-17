"""Video pipeline parameter validation.

The video pipelines share most of the image-side knobs (modelId / prompt /
negative / width / height / steps / cfgScale / sampler / seed) plus three
video-only fields: `durationSeconds`, `fps`, and `mode` (text2video vs
image2video). For image2video, a `sourceImage` is also required.

This module mirrors the shape of `params.py` but with stricter ranges
matched to the v1.0.0 single-GPU ceiling per the Phase 7 plan:

    - durationSeconds: 1 - 10
    - fps:             12 / 16 / 24 only
    - resolution:      480p (854 x 480) or 720p (1280 x 720)

Validation is intentionally strict so a malformed UI request fails fast
with a structured error before the runner schedules any GPU work.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional


_VALID_VIDEO_MODES = {"text2video", "image2video"}
_VALID_FPS = {12, 16, 24}
_VALID_SAMPLERS = {"euler", "euler_a", "dpmpp_2m", "dpmpp_sde", "ddim", "lms"}
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
    if duration < 1 or duration > 10:
        raise VideoParamsError(
            f"durationSeconds must be between 1 and 10, got {duration}"
        )
    fps = _require_int(request, "fps")
    if fps not in _VALID_FPS:
        raise VideoParamsError(f"invalid fps {fps}; allowed: {sorted(_VALID_FPS)}")
    steps = _require_int(request, "steps")
    if steps < 1 or steps > 150:
        raise VideoParamsError(f"steps must be between 1 and 150, got {steps}")
    source_image: Optional[str] = None
    if mode == "image2video":
        source_image = _require_str(request, "sourceImage")
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
    )


def frame_count(params: VideoParams) -> int:
    """Total frames the pipeline should produce.

    Kept as a free function so the dispatcher can compute thumbnail
    bucketing (one preview per second) without re-deriving the formula.
    """
    return params.duration_seconds * params.fps
