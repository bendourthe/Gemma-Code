"""Pipeline parameter validation.

Each pipeline mode receives slightly different parameters. This module
declares the canonical `PipelineParams` dataclass and parses inbound
dicts (originating from JSON-RPC payloads sent by the Node sidecar) into
typed objects. Validation is intentionally strict so a malformed UI
request fails fast with a structured error before the runner schedules
any GPU work.

The validator is pure Python (no Pydantic, no torch) so it can be unit
tested in CI without paying any heavy import cost.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, List, Mapping, Optional


_VALID_SAMPLERS = {"euler", "euler_a", "dpmpp_2m", "dpmpp_sde", "ddim", "lms"}
_VALID_PREPROCESSORS = {"pose", "depth", "canny", "none"}
_VALID_DIRECTIONS = {"left", "right", "top", "bottom"}
_VALID_MODES = {"txt2img", "img2img", "inpaint", "outpaint"}


class ParamsError(ValueError):
    pass


@dataclass(frozen=True)
class LoRARef:
    id: str
    weight: float


@dataclass(frozen=True)
class ControlNetRef:
    model_id: str
    condition_image: str
    weight: float
    preprocessor: str


@dataclass(frozen=True)
class PipelineParams:
    model_id: str
    prompt: str
    negative_prompt: str
    width: int
    height: int
    steps: int
    cfg_scale: float
    sampler: str
    seed: int
    batch_size: int
    latent_preview: bool
    loras: List[LoRARef] = field(default_factory=list)
    control_net: Optional[ControlNetRef] = None
    # img2img / inpaint / outpaint specific
    source_image: Optional[str] = None
    mask: Optional[str] = None
    strength: Optional[float] = None
    direction: Optional[str] = None
    pixels: Optional[int] = None


def _expect_str(d: Mapping[str, Any], key: str, default: Optional[str] = None) -> str:
    if key not in d:
        if default is not None:
            return default
        raise ParamsError(f"missing field: {key}")
    value = d[key]
    if not isinstance(value, str):
        raise ParamsError(f"{key} must be string, got {type(value).__name__}")
    return value


def _expect_int(d: Mapping[str, Any], key: str, default: Optional[int] = None) -> int:
    if key not in d:
        if default is not None:
            return default
        raise ParamsError(f"missing field: {key}")
    value = d[key]
    if isinstance(value, bool) or not isinstance(value, int):
        raise ParamsError(f"{key} must be int, got {type(value).__name__}")
    return value


def _expect_float(d: Mapping[str, Any], key: str, default: Optional[float] = None) -> float:
    if key not in d:
        if default is not None:
            return default
        raise ParamsError(f"missing field: {key}")
    value = d[key]
    if isinstance(value, bool):
        raise ParamsError(f"{key} must be number, got bool")
    if not isinstance(value, (int, float)):
        raise ParamsError(f"{key} must be number, got {type(value).__name__}")
    return float(value)


def _parse_loras(raw: Any) -> List[LoRARef]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ParamsError("loras must be a list")
    out: List[LoRARef] = []
    for entry in raw:
        if not isinstance(entry, dict):
            raise ParamsError("loras entry must be an object")
        out.append(
            LoRARef(
                id=_expect_str(entry, "id"),
                weight=_expect_float(entry, "weight", 1.0),
            )
        )
    return out


def _parse_control_net(raw: Any) -> Optional[ControlNetRef]:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ParamsError("controlNet must be an object")
    preprocessor = _expect_str(raw, "preprocessor", "none")
    if preprocessor not in _VALID_PREPROCESSORS:
        raise ParamsError(f"invalid preprocessor: {preprocessor}")
    return ControlNetRef(
        model_id=_expect_str(raw, "modelId"),
        condition_image=_expect_str(raw, "conditionImage"),
        weight=_expect_float(raw, "weight", 1.0),
        preprocessor=preprocessor,
    )


def parse(mode: str, request: Mapping[str, Any]) -> PipelineParams:
    if mode not in _VALID_MODES:
        raise ParamsError(f"invalid mode: {mode}")
    sampler = _expect_str(request, "sampler", "euler_a")
    if sampler not in _VALID_SAMPLERS:
        raise ParamsError(f"invalid sampler: {sampler}")
    params = PipelineParams(
        model_id=_expect_str(request, "modelId"),
        prompt=_expect_str(request, "prompt"),
        negative_prompt=_expect_str(request, "negativePrompt", ""),
        width=_expect_int(request, "width"),
        height=_expect_int(request, "height"),
        steps=_expect_int(request, "steps"),
        cfg_scale=_expect_float(request, "cfgScale"),
        sampler=sampler,
        seed=_expect_int(request, "seed"),
        batch_size=_expect_int(request, "batchSize", 1),
        latent_preview=bool(request.get("latentPreview", True)),
        loras=_parse_loras(request.get("loras")),
        control_net=_parse_control_net(request.get("controlNet")),
    )
    if mode == "img2img":
        params = _augment(
            params,
            source_image=_expect_str(request, "sourceImage"),
            strength=_expect_float(request, "strength", 0.75),
        )
    elif mode == "inpaint":
        params = _augment(
            params,
            source_image=_expect_str(request, "sourceImage"),
            mask=_expect_str(request, "mask"),
            strength=_expect_float(request, "strength", 0.85),
        )
    elif mode == "outpaint":
        direction = _expect_str(request, "direction")
        if direction not in _VALID_DIRECTIONS:
            raise ParamsError(f"invalid direction: {direction}")
        params = _augment(
            params,
            source_image=_expect_str(request, "sourceImage"),
            direction=direction,
            pixels=_expect_int(request, "pixels"),
        )
    return params


def _augment(base: PipelineParams, **overrides: Any) -> PipelineParams:
    """Return a copy of `base` with the supplied fields overridden.

    Dataclasses are frozen so direct assignment fails; building a new
    instance keeps the validation pipeline pure.
    """

    from dataclasses import replace

    return replace(base, **overrides)
