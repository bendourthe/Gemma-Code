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


def _load_text_pipe(weights: Path, model_id: str):
    dtype = _torch_dtype()
    kwargs = {"torch_dtype": dtype, "local_files_only": True}
    if model_id.lower().startswith("sana"):
        try:
            from diffusers import SanaPipeline  # type: ignore[import-not-found]

            return SanaPipeline.from_pretrained(str(weights), **kwargs)
        except Exception:
            pass
    from diffusers import AutoPipelineForText2Image  # type: ignore[import-not-found]

    return AutoPipelineForText2Image.from_pretrained(str(weights), **kwargs)


def _load_image_pipe(weights: Path, model_id: str):
    dtype = _torch_dtype()
    kwargs = {"torch_dtype": dtype, "local_files_only": True}
    if model_id.lower().startswith("sana"):
        try:
            from diffusers import SanaImg2ImgPipeline  # type: ignore[import-not-found]

            return SanaImg2ImgPipeline.from_pretrained(str(weights), **kwargs)
        except Exception:
            pass
    from diffusers import AutoPipelineForImage2Image  # type: ignore[import-not-found]

    return AutoPipelineForImage2Image.from_pretrained(str(weights), **kwargs)


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
    try:
        import imageio  # type: ignore[import-not-found]
        from diffusers import AutoPipelineForText2Video  # type: ignore[import-not-found]

        dtype = _torch_dtype()
        pipe = AutoPipelineForText2Video.from_pretrained(
            str(weights), torch_dtype=dtype, local_files_only=True
        )
        _move_pipe(pipe, ctx.offload_strategy)
        kwargs = {
            "prompt": ctx.params.prompt,
            "num_inference_steps": ctx.params.steps,
            "guidance_scale": ctx.params.cfg_scale,
        }
        if ctx.params.source_image:
            kwargs["image"] = _decode_pil(ctx.params.source_image)
        result = pipe(**kwargs)
        frames = result.frames[0] if hasattr(result, "frames") else result.images
        Path(ctx.output_path).parent.mkdir(parents=True, exist_ok=True)
        writer = imageio.get_writer(ctx.output_path, fps=ctx.params.fps)
        try:
            for frame in frames:
                writer.append_data(frame)
        finally:
            writer.close()
        return VideoPipelineOutput(
            mp4_path=ctx.output_path,
            frame_previews=[],
            extra={"stubbed": False, "method": ctx.params.mode, "jobId": ctx.job_id},
        )
    except RuntimeNotReady:
        raise
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        raise RuntimeNotReady(
            f"video runtime is not ready: {type(exc).__name__}: {exc}"
        ) from exc
