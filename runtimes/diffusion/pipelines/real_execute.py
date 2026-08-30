"""On-host diffusion executors (v2.2.5 Phase 2).

CI and hosts without CUDA keep using the stub / fail-closed wrappers in
`base.select_executor`. This module is the real generate path: load
installer-provisioned weights from `~/.nexus/models/weights/<id>/` with
`local_files_only=True` (never a silent Hugging Face download) and run
diffusers. Missing GPU, missing weights, or a failed import become
`RuntimeNotReady` so the Node sidecar can fail before `complete`.

v2.2.9 T009: the not-ready reasons are typed, probed in a documented
order (torch/CUDA in THIS Python environment first, then weights for the
requested model id). Note that Ollama can drive the NVIDIA GPU through
its own runtime, so the app telemetry footer showing VRAM never proves
this diffusion venv has a CUDA torch build.
"""

from __future__ import annotations

import base64
import io
import os
import traceback
import uuid
from pathlib import Path

from . import base
from .base import (
    ExecutionContext,
    PipelineOutput,
    RuntimeNotReady,
    models_root,
    resolve_weights_dir,
)
from .video_base import VideoExecutionContext, VideoPipelineOutput

__all__ = [
    "models_root",
    "resolve_weights_dir",
    "image_execute",
    "video_execute",
    "gpu_ready",
    "allow_cpu",
]


def allow_cpu() -> bool:
    flag = os.environ.get("NEXUS_DIFFUSION_ALLOW_CPU", "").strip().lower()
    return flag in {"1", "true", "yes"}


def gpu_ready() -> bool:
    try:
        import torch  # type: ignore[import-not-found]

        return bool(getattr(torch, "cuda", None) and torch.cuda.is_available())
    except Exception:
        return False


def _require_accelerator() -> None:
    if gpu_ready() or allow_cpu():
        return
    raise base.accelerator_not_ready("image")


def _decode_pil(raw: str):
    from PIL import Image  # type: ignore[import-not-found]

    payload = raw.strip()
    if payload.startswith("data:") and "," in payload:
        payload = payload.split(",", 1)[1]
    data = base64.b64decode(payload)
    return Image.open(io.BytesIO(data)).convert("RGB")


def _png_bytes(image) -> bytes:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _torch_dtype():
    import torch  # type: ignore[import-not-found]

    if gpu_ready() and hasattr(torch, "bfloat16"):
        return torch.bfloat16
    return torch.float32


def _move_pipe(pipe, offload_strategy: str) -> None:
    import torch  # type: ignore[import-not-found]

    if not gpu_ready():
        pipe.to("cpu")
        return
    if offload_strategy in {"model_cpu_offload", "sequential_cpu_offload"}:
        enable = getattr(pipe, "enable_model_cpu_offload", None)
        if callable(enable):
            enable()
            return
    pipe.to("cuda" if torch.cuda.is_available() else "cpu")


def _clip_frames_for_export(result) -> list:
    """Convert a Diffusers video output into a list of frames.

    WanPipeline returns a numpy batch of shape (1, frames, height, width, channels).
    Boolean tests on that array raise ValueError, so callers must use length.
    """
    raw = getattr(result, "frames", None)
    if raw is None:
        return []
    try:
        if len(raw) == 0:
            return []
        clip = raw[0]
        return [clip[index] for index in range(len(clip))]
    except TypeError:
        return []


def _align_spatial(value: int, multiple: int = 16) -> int:
    """Round spatial size down to a model-legal multiple, never below the multiple.

    Wan / Diffusers reject sizes that are not divisible by 16. The product
    contract still advertises 854x480, so the executor aligns at the GPU
    boundary instead of failing the advertised 480p preset.
    """
    aligned = (int(value) // multiple) * multiple
    return max(multiple, aligned)


def _pipeline_load_kwargs(weights: Path) -> dict[str, object]:
    kwargs: dict[str, object] = {
        "torch_dtype": _torch_dtype(),
        "local_files_only": True,
    }
    if next(weights.rglob("*.fp16.safetensors"), None) is not None:
        kwargs["variant"] = "fp16"
    return kwargs


def _load_text_pipe(weights: Path, model_id: str):
    kwargs = _pipeline_load_kwargs(weights)
    if (weights / "model_index.json").is_file():
        if model_id.lower().startswith("sana"):
            from diffusers import SanaPipeline  # type: ignore[import-not-found]

            return SanaPipeline.from_pretrained(str(weights), **kwargs)
        from diffusers import (
            AutoPipelineForText2Image,  # type: ignore[import-not-found]
        )

        return AutoPipelineForText2Image.from_pretrained(str(weights), **kwargs)
    checkpoints = sorted(weights.glob("*.safetensors"))
    if len(checkpoints) == 1 and not model_id.lower().startswith("sana"):
        from diffusers import (
            StableDiffusionXLPipeline,  # type: ignore[import-not-found]
        )

        return StableDiffusionXLPipeline.from_single_file(
            str(checkpoints[0]),
            **{key: value for key, value in kwargs.items() if key != "variant"},
        )
    raise RuntimeNotReady(
        f"image runtime is not ready: model-layout-invalid: {model_id} does not "
        "contain a complete pipeline or one supported SDXL checkpoint",
        kind="model-layout-invalid",
    )


def _load_image_pipe(weights: Path, model_id: str):
    from diffusers import AutoPipelineForImage2Image  # type: ignore[import-not-found]

    return AutoPipelineForImage2Image.from_pipe(_load_text_pipe(weights, model_id))


def image_execute(ctx: ExecutionContext) -> PipelineOutput:
    """Run a real txt2img / img2img (and friends) or raise RuntimeNotReady."""
    _require_accelerator()
    model_id = ctx.params.model_id
    weights = resolve_weights_dir(model_id)
    if weights is None:
        raise RuntimeNotReady(
            base.weights_missing_message("image", model_id), kind="weights-missing"
        )
    if ctx.mode == "img2img" and model_id.lower().endswith("-int4"):
        raise RuntimeNotReady("img2img is not supported for INT4 SANA weights")
    try:
        if ctx.mode == "img2img":
            if not ctx.params.source_image:
                raise RuntimeNotReady("img2img requires source image bytes")
            pipe = _load_image_pipe(weights, model_id)
            _move_pipe(pipe, ctx.offload_strategy)
            source = _decode_pil(ctx.params.source_image)
            result = pipe(
                prompt=ctx.params.prompt,
                negative_prompt=ctx.params.negative_prompt or None,
                image=source,
                strength=ctx.params.strength or 0.75,
                num_inference_steps=ctx.params.steps,
                guidance_scale=ctx.params.cfg_scale,
                width=ctx.params.width,
                height=ctx.params.height,
            )
        elif ctx.mode in {"inpaint", "outpaint"}:
            raise RuntimeNotReady(
                f"image runtime is not ready: {ctx.mode} weights path is not wired"
            )
        else:
            pipe = _load_text_pipe(weights, model_id)
            _move_pipe(pipe, ctx.offload_strategy)
            result = pipe(
                prompt=ctx.params.prompt,
                negative_prompt=ctx.params.negative_prompt or None,
                num_inference_steps=ctx.params.steps,
                guidance_scale=ctx.params.cfg_scale,
                width=ctx.params.width,
                height=ctx.params.height,
            )
        image = result.images[0]
        return PipelineOutput(
            png_bytes=_png_bytes(image),
            extra={"stubbed": False, "mode": ctx.mode, "jobId": ctx.job_id},
        )
    except RuntimeNotReady:
        raise
    except Exception as exc:  # noqa: BLE001 - surface as typed not-ready
        traceback.print_exc()
        raise RuntimeNotReady(
            f"image runtime is not ready: {type(exc).__name__}: {exc}"
        ) from exc


def _require_video_accelerator() -> None:
    if gpu_ready() or allow_cpu():
        return
    raise base.accelerator_not_ready("video")


def video_execute(ctx: VideoExecutionContext) -> VideoPipelineOutput:
    """Run a real text/image-to-video job or raise RuntimeNotReady."""
    _require_video_accelerator()
    model_id = ctx.params.model_id
    weights = resolve_weights_dir(model_id)
    if weights is None:
        raise RuntimeNotReady(
            base.weights_missing_message("video", model_id), kind="weights-missing"
        )
    if not (weights / "model_index.json").is_file():
        raise RuntimeNotReady(
            f"video runtime is not ready: model-layout-invalid: {model_id} is "
            "missing model_index.json and complete Diffusers components",
            kind="model-layout-invalid",
        )
    if ctx.params.mode != "text2video":
        raise RuntimeNotReady(
            "video runtime is not ready: mode-unsupported: "
            f"{model_id} supports text2video only",
            kind="mode-unsupported",
        )
    temporary = Path(ctx.output_path).with_name(
        f".{Path(ctx.output_path).name}.{uuid.uuid4().hex}.partial.mp4"
    )
    try:
        import torch  # type: ignore[import-not-found]
        from diffusers import WanPipeline  # type: ignore[import-not-found]
        from diffusers.utils import export_to_video  # type: ignore[import-not-found]

        dtype = _torch_dtype()
        pipe = WanPipeline.from_pretrained(
            str(weights), torch_dtype=dtype, local_files_only=True
        )
        _move_pipe(pipe, ctx.offload_strategy)
        requested_frames = max(1, ctx.params.duration_seconds * ctx.params.fps)
        num_frames = ((requested_frames - 1 + 3) // 4) * 4 + 1
        width = _align_spatial(ctx.params.width)
        height = _align_spatial(ctx.params.height)
        generator_device = "cuda" if gpu_ready() else "cpu"
        kwargs = {
            "prompt": ctx.params.prompt,
            "negative_prompt": ctx.params.negative_prompt or None,
            "num_inference_steps": ctx.params.steps,
            "guidance_scale": ctx.params.cfg_scale,
            "width": width,
            "height": height,
            "num_frames": num_frames,
            "generator": torch.Generator(device=generator_device).manual_seed(
                ctx.params.seed
            ),
        }
        result = pipe(**kwargs)
        frames = _clip_frames_for_export(result)
        if len(frames) == 0:
            raise RuntimeNotReady(
                "video runtime is not ready: zero-frames: the model returned no frames",
                kind="zero-frames",
            )
        output = Path(ctx.output_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        export_to_video(frames, str(temporary), fps=ctx.params.fps)
        if not temporary.is_file() or temporary.stat().st_size < 12:
            raise RuntimeNotReady(
                "video runtime is not ready: encode-failed: "
                "no finalized video was written",
                kind="encode-failed",
            )
        with temporary.open("rb") as handle:
            signature = handle.read(12)
        if signature[4:8] != b"ftyp":
            raise RuntimeNotReady(
                "video runtime is not ready: encode-failed: "
                "output is not an MP4 container",
                kind="encode-failed",
            )
        os.replace(temporary, output)
        return VideoPipelineOutput(
            mp4_path=ctx.output_path,
            frame_previews=[],
            extra={
                "stubbed": False,
                "method": ctx.params.mode,
                "jobId": ctx.job_id,
                "frames": len(frames),
                "requestedWidth": ctx.params.width,
                "requestedHeight": ctx.params.height,
                "width": width,
                "height": height,
            },
        )
    except RuntimeNotReady:
        raise
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        raise RuntimeNotReady(
            f"video runtime is not ready: {type(exc).__name__}: {exc}"
        ) from exc
    finally:
        temporary.unlink(missing_ok=True)
