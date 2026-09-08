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
import hashlib
import io
import os
import traceback
import uuid
from pathlib import Path

from .. import vram_lifecycle
from . import base, load_progress
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
    "sana_video_execute",
    "is_sana_video_model",
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


def decode_source_image(raw: str):
    """Decode a data URL, raw base64 PNG, or an existing filesystem path."""
    from PIL import Image  # type: ignore[import-not-found]

    payload = raw.strip()
    path = Path(payload)
    if len(payload) < 4096 and path.is_file():
        return Image.open(path).convert("RGB")
    if payload.startswith("data:") and "," in payload:
        payload = payload.split(",", 1)[1]
    data = base64.b64decode(payload)
    return Image.open(io.BytesIO(data)).convert("RGB")


def _decode_pil(raw: str):
    return decode_source_image(raw)


def _png_bytes(image) -> bytes:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _image_digest(raw: bytes) -> str:
    """Short content digest used to prove a restyle actually changed pixels.

    v2.4.4 Phase 3: two field cycles shipped a "restyle" that returned the
    previous PNG. A digest on the decoded source and on the produced PNG makes
    "the output is a clone of the input" an observable fact in `extra` and an
    assertable one in tests, instead of something only a human eye catches.
    """
    return hashlib.sha256(raw).hexdigest()[:16]


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


def _installed_diffusers_version() -> str:
    """Best-effort version string for the missing-class sentence."""
    try:
        import diffusers  # type: ignore[import-not-found]

        return str(getattr(diffusers, "__version__", "unknown"))
    except Exception:  # noqa: BLE001 - the sentence must never itself raise
        return "not installed"


def _import_diffusers_class(surface: str, name: str):
    """Import one Diffusers pipeline class or fail closed with a sentence.

    v2.4.4 Phase 4.2: the packaged venv pinned a Diffusers release that has no
    `SanaVideoPipeline`, and the raw `ImportError: cannot import name ...` was
    what reached the chat bubble. A missing class is a runtime that was never
    provisioned for this model, so it is reported as `diffusers-missing` with
    a sentence naming both the class and the version actually installed -- the
    two facts needed to tell a bad pin from a bad model directory.
    """
    try:
        module = __import__("diffusers", fromlist=[name])
        return getattr(module, name)
    except Exception as exc:  # noqa: BLE001 - typed not-ready, not a traceback
        raise RuntimeNotReady(
            f"{surface} runtime is not ready: diffusers-missing: the installed "
            f"diffusers ({_installed_diffusers_version()}) does not provide "
            f"{name}. Reinstall the media runtime from Settings.",
            kind="diffusers-missing",
        ) from exc


def _load_text_pipe(weights: Path, model_id: str):
    kwargs = _pipeline_load_kwargs(weights)
    if (weights / "model_index.json").is_file():
        if model_id.lower().startswith("sana"):
            sana = _import_diffusers_class("image", "SanaPipeline")
            return sana.from_pretrained(str(weights), **kwargs)
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


#: Applied only when the caller sends no strength at all. Kept as a named
#: constant so `strength=0` stays distinguishable from "unset" (v2.4.4 P3.2).
DEFAULT_IMG2IMG_STRENGTH = 0.75


def _seeded_generator(seed: int) -> dict:
    """Pipeline kwargs carrying a seeded generator, or `{}` when torch is absent.

    v2.4.4 Phase 3.2: `image_execute` never forwarded the seed, so an image
    edit was unreproducible and a bad restyle could not be re-run and compared.
    Returned as kwargs rather than a value so a torch-less environment (the
    stub executor, and the unit tests) still runs the same code path instead
    of failing on an import it does not need.
    """
    try:
        import torch  # type: ignore[import-not-found]
    except Exception:  # noqa: BLE001 - seeding is best-effort, never fatal
        return {}
    device = "cuda" if gpu_ready() else "cpu"
    return {"generator": torch.Generator(device=device).manual_seed(seed)}


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
    source_digest: str | None = None
    strength: float | None = None
    try:
        seeded = _seeded_generator(ctx.params.seed)
        if ctx.mode == "img2img":
            if not ctx.params.source_image:
                raise RuntimeNotReady("img2img requires source image bytes")
            base.emit_stage(ctx.job_id, "loading")
            with load_progress.track_model_load(ctx.job_id, weights):
                pipe = _load_image_pipe(weights, model_id)
            _move_pipe(pipe, ctx.offload_strategy)
            base.emit_stage(ctx.job_id, "generating")
            source = _decode_pil(ctx.params.source_image)
            source_digest = _image_digest(_png_bytes(source))
            # v2.4.4 Phase 3.2: an explicit None check, not `or`. A caller that
            # deliberately sends strength 0 used to be silently rewritten to
            # 0.75, so the number the UI chose never reached the pipeline.
            strength = (
                DEFAULT_IMG2IMG_STRENGTH
                if ctx.params.strength is None
                else ctx.params.strength
            )
            result = pipe(
                prompt=ctx.params.prompt,
                negative_prompt=ctx.params.negative_prompt or None,
                image=source,
                strength=strength,
                num_inference_steps=ctx.params.steps,
                guidance_scale=ctx.params.cfg_scale,
                width=ctx.params.width,
                height=ctx.params.height,
                **seeded,
                **base.step_callback_kwargs(pipe, ctx.job_id, ctx.params.steps),
            )
        elif ctx.mode in {"inpaint", "outpaint"}:
            raise RuntimeNotReady(
                f"image runtime is not ready: {ctx.mode} weights path is not wired"
            )
        else:
            base.emit_stage(ctx.job_id, "loading")
            with load_progress.track_model_load(ctx.job_id, weights):
                pipe = _load_text_pipe(weights, model_id)
            _move_pipe(pipe, ctx.offload_strategy)
            base.emit_stage(ctx.job_id, "generating")
            result = pipe(
                prompt=ctx.params.prompt,
                negative_prompt=ctx.params.negative_prompt or None,
                num_inference_steps=ctx.params.steps,
                guidance_scale=ctx.params.cfg_scale,
                width=ctx.params.width,
                height=ctx.params.height,
                **seeded,
                **base.step_callback_kwargs(pipe, ctx.job_id, ctx.params.steps),
            )
        image = result.images[0]
        png = _png_bytes(image)
        output_digest = _image_digest(png)
        if source_digest is not None and output_digest == source_digest:
            # Fail closed rather than present the previous picture as a new
            # one. Screenshots 3 across two cycles were exactly this: a turn
            # that looked successful and had changed nothing.
            raise RuntimeNotReady(
                "image runtime is not ready: unchanged-output: the edit "
                "returned the source image unchanged",
                kind="unchanged-output",
            )
        return PipelineOutput(
            png_bytes=png,
            extra={
                "stubbed": False,
                "mode": ctx.mode,
                "jobId": ctx.job_id,
                "sourceDigest": source_digest,
                "outputDigest": output_digest,
                "strength": strength,
            },
        )
    except RuntimeNotReady:
        raise
    except Exception as exc:  # noqa: BLE001 - surface as typed not-ready
        traceback.print_exc()
        raise RuntimeNotReady(
            f"image runtime is not ready: {type(exc).__name__}: {exc}"
        ) from exc
    finally:
        # v2.4.8 follow-up: give the VRAM back so the chat model can come back
        # onto the GPU. Without this the torch caching allocator kept the SDXL
        # weights' worth of VRAM reserved between jobs.
        vram_lifecycle.release_vram()


_SANA_VIDEO_LAYOUT_FILES = (
    "model_index.json",
    "scheduler/scheduler_config.json",
    "text_encoder/config.json",
    "tokenizer/tokenizer_config.json",
    "transformer/config.json",
    "vae/config.json",
)


def is_sana_video_model(model_id: str) -> bool:
    """True for SANA-Video catalog ids (not image SANA)."""
    return model_id.lower().startswith("sana-video")


def _require_video_accelerator() -> None:
    if gpu_ready() or allow_cpu():
        return
    raise base.accelerator_not_ready("video")


def _missing_video_layout_file(weights: Path, model_id: str) -> Path | None:
    if is_sana_video_model(model_id):
        for relative in _SANA_VIDEO_LAYOUT_FILES:
            candidate = weights / relative
            if not candidate.is_file():
                return candidate
        return None
    index = weights / "model_index.json"
    if not index.is_file():
        return index
    return None


def _require_video_layout(weights: Path, model_id: str) -> None:
    missing = _missing_video_layout_file(weights, model_id)
    if missing is None:
        return
    raise RuntimeNotReady(
        f"video runtime is not ready: model-layout-invalid: {model_id} is "
        f"missing {missing.name} at {missing}",
        kind="model-layout-invalid",
    )


def _load_video_pipeline(kind: str, weights: Path):
    kwargs: dict[str, object] = {
        "torch_dtype": _torch_dtype(),
        "local_files_only": True,
    }
    if kind == "sana":
        sana_video = _import_diffusers_class("video", "SanaVideoPipeline")
        return sana_video.from_pretrained(str(weights), **kwargs)
    from diffusers import WanPipeline  # type: ignore[import-not-found]

    return WanPipeline.from_pretrained(str(weights), **kwargs)


def video_execute(ctx: VideoExecutionContext) -> VideoPipelineOutput:
    """Run a real text/image-to-video job or raise RuntimeNotReady."""
    if is_sana_video_model(ctx.params.model_id):
        return sana_video_execute(ctx)
    return _run_real_video(ctx, "wan")


def sana_video_execute(ctx: VideoExecutionContext) -> VideoPipelineOutput:
    """Load SanaVideoPipeline for sana-video* ids. Never uses WanPipeline."""
    return _run_real_video(ctx, "sana")


def _run_real_video(ctx: VideoExecutionContext, kind: str) -> VideoPipelineOutput:
    _require_video_accelerator()
    model_id = ctx.params.model_id
    weights = resolve_weights_dir(model_id)
    if weights is None:
        raise RuntimeNotReady(
            base.weights_missing_message("video", model_id), kind="weights-missing"
        )
    _require_video_layout(weights, model_id)
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
        from diffusers.utils import export_to_video  # type: ignore[import-not-found]

        base.emit_stage(ctx.job_id, "loading")
        with load_progress.track_model_load(ctx.job_id, weights):
            pipe = _load_video_pipeline(kind, weights)
        _move_pipe(pipe, ctx.offload_strategy)
        base.emit_stage(ctx.job_id, "generating")
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
            **base.step_callback_kwargs(pipe, ctx.job_id, ctx.params.steps),
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
                "pipeline": kind,
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
