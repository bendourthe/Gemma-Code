"""Video pipeline orchestration primitives.

`VideoPipelineRunner` mirrors `pipelines/base.PipelineRunner` for the
video side. It:

    1. validates inbound parameters against `video_params.VideoParams`
    2. picks an offload strategy via `device.choose_offload`, then
       *upgrades* the strategy to a more conservative tier because video
       models are larger than image diffusion (LTX-Video 12 GB, SVD 9 GB,
       CogVideoX 5B 14 GB) -- per Phase 7 plan: "video models are larger
       than image diffusion - apply more aggressive sequential offload by
       default"
    3. invokes the pipeline-specific execution callback through the
       VRAM lifecycle scope (`vram_lifecycle.vram_scope`)
    4. builds + returns the workflow JSON so the Node side can embed it
       in the produced MP4 via ffmpeg

The runner does not produce the MP4 itself in CI: it returns a
deterministic stub frame strip + an `mp4Path` pointing into the canonical
outputs directory (`~/.nexus/outputs/videos/<jobId>.mp4`). The on-host
executor (operator-driven) writes the actual MP4 via `imageio[ffmpeg]`.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from .. import device, vram_lifecycle
from . import video_params, video_workflow_metadata


@dataclass(frozen=True)
class VideoExecutionContext:
    job_id: str
    params: video_params.VideoParams
    offload_strategy: str
    output_path: str


@dataclass(frozen=True)
class VideoPipelineOutput:
    """Result returned by a video pipeline execution callback.

    `mp4_path` is the absolute path to the produced MP4 (or `None` in CI
    where the stub executor short-circuits before any ffmpeg call).
    `frame_previews` is a list of base64-encoded JPEG thumbnails, one per
    generated second, so the UI can render a thumbnail strip while the
    job runs.
    """

    mp4_path: Optional[str]
    frame_previews: list[str]
    extra: Dict[str, Any]


VideoExecuteFn = Callable[[VideoExecutionContext], VideoPipelineOutput]


def _outputs_dir() -> Path:
    """Resolve the canonical video output directory.

    Defaults to `~/.nexus/outputs/videos/`. Overridable via
    `NEXUS_VIDEO_OUTPUT_DIR` for tests (so the runtime never writes into
    a real home directory during CI).
    """
    override = os.environ.get("NEXUS_VIDEO_OUTPUT_DIR")
    if override:
        return Path(override)
    return Path.home() / ".nexus" / "outputs" / "videos"


def _upgrade_for_video(decision: device.OffloadDecision) -> device.OffloadDecision:
    """Step the image-side offload decision one tier more conservative.

    Phase 7 plan: "apply more aggressive sequential offload by default".
    Image diffusion happily runs `keep_on_gpu` on a 12 GB RTX 4070 with
    SDXL Turbo (~7 GB); the same machine running LTX-Video (12 GB+) needs
    `model_cpu_offload` or `sequential_cpu_offload` to avoid OOM during
    the unet -> vae decode step.
    """
    if decision.strategy == "keep_on_gpu":
        return device.OffloadDecision(
            strategy="model_cpu_offload",
            reason=f"video upgrade: {decision.reason}",
        )
    if decision.strategy == "model_cpu_offload":
        return device.OffloadDecision(
            strategy="sequential_cpu_offload",
            reason=f"video upgrade: {decision.reason}",
        )
    return decision


@dataclass
class VideoPipelineRunner:
    method: str
    execute: VideoExecuteFn
    model_size_gb: float

    def run(self, payload: dict) -> Dict[str, Any]:
        job_id = payload.get("jobId")
        request = payload.get("request") or {}
        mode = payload.get("mode") or request.get("mode")
        if not isinstance(job_id, str) or not job_id:
            return {"ok": False, "error": "invalid-job-id"}
        if not isinstance(mode, str) or not mode:
            return {"ok": False, "error": "invalid-mode"}
        try:
            parsed = video_params.parse(mode, request)
        except video_params.VideoParamsError as exc:
            return {"ok": False, "error": "invalid-params", "message": str(exc)}
        info = device.detect()
        decision = device.choose_offload(info.vram_free_gb, self.model_size_gb)
        decision = _upgrade_for_video(decision)
        if decision.strategy == "insufficient_vram":
            return {
                "ok": False,
                "error": "insufficient-vram",
                "message": decision.reason,
            }
        output_path = str(_outputs_dir() / f"{job_id}.mp4")
        ctx = VideoExecutionContext(
            job_id=job_id,
            params=parsed,
            offload_strategy=decision.strategy,
            output_path=output_path,
        )
        try:
            with vram_lifecycle.vram_scope(
                model_id=parsed.model_id,
                model_size_gb=self.model_size_gb,
            ):
                output = self.execute(ctx)
        except Exception as exc:  # noqa: BLE001 - surface as JSON-RPC error
            return {
                "ok": False,
                "error": "execution-failed",
                "message": f"{type(exc).__name__}: {exc}",
            }
        workflow = video_workflow_metadata.build_workflow(
            parsed, _iso_timestamp()
        )
        return {
            "ok": True,
            "jobId": job_id,
            "method": self.method,
            "mode": parsed.mode,
            "offloadStrategy": decision.strategy,
            "offloadReason": decision.reason,
            "mp4Path": output.mp4_path,
            "framePreviews": list(output.frame_previews),
            "workflow": workflow,
            "extra": output.extra,
        }


def _iso_timestamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def stub_execute(method_label: str) -> VideoExecuteFn:
    """Return an execution callback that produces deterministic stub output.

    Used by the runtime when diffusers/torch/imageio is unavailable so
    the JSON-RPC contract still returns a meaningful response in CI. The
    stub returns one preview thumbnail per generated second so the UI's
    thumbnail-strip rendering can be exercised end-to-end. The "preview"
    is a base64-encoded 1x1 JPEG placeholder.
    """

    def execute(ctx: VideoExecutionContext) -> VideoPipelineOutput:
        seconds = ctx.params.duration_seconds
        previews = [_stub_jpeg_b64() for _ in range(seconds)]
        extra: Dict[str, Any] = {
            "stubbed": True,
            "method": method_label,
            "jobId": ctx.job_id,
            "frameCount": video_params.frame_count(ctx.params),
            "conditionedOnPriorEndingFrames": bool(ctx.params.continue_from),
            "seamQuality": "prototype-unmeasured",
        }
        if ctx.params.continue_from:
            extra["continueFrom"] = ctx.params.continue_from
        return VideoPipelineOutput(
            mp4_path=None,
            frame_previews=previews,
            extra=extra,
        )

    return execute


def _stub_jpeg_b64() -> str:
    """1x1 black JPEG base64 used as a thumbnail placeholder in CI."""
    # Pre-computed via libjpeg; embedded as a constant so the runtime
    # has no Pillow dependency in CI.
    return (
        "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////"
        "////////////////////////////////////////////////////wAALCAABAAEBAREA/8QA"
        "FQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AH//Z"
    )


def diffusers_video_available() -> bool:
    """Probe whether the on-host stack is importable.

    Mirrors `pipelines/base.diffusers_available()` but also requires
    `imageio` for MP4 writing.
    """
    try:  # pragma: no cover - CUDA host path
        import torch  # type: ignore[import-not-found]  # noqa: F401
        import diffusers  # type: ignore[import-not-found]  # noqa: F401
        import imageio  # type: ignore[import-not-found]  # noqa: F401

        return True
    except Exception:
        return False


def select_executor(method: str, real: Optional[VideoExecuteFn] = None) -> VideoExecuteFn:
    if real is not None and diffusers_video_available():  # pragma: no cover - GPU only
        return real
    return stub_execute(method)
