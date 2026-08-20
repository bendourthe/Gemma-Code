"""audio2video pipeline registration.

Photo + audio -> lip-synced talking-head clip, gated to diffusion-pro
and the official meituan-longcat Avatar-1.5 INT8 weights. CI uses the
stub executor. Live DiT inference is not vendored this cycle; see
`longcat_avatar.preflight` and the Phase 3 scan note.
"""

from __future__ import annotations

from typing import Callable, Dict

from . import longcat_avatar, video_base
from .video_base import VideoExecutionContext, VideoPipelineOutput

# INT8 DiT shards on disk are ~16 GB; plan conservatively so the offload
# upgrade still runs on a 24 GB card.
_MODEL_SIZE_GB = 16.0


def _execute(ctx: VideoExecutionContext) -> VideoPipelineOutput:
    err = longcat_avatar.preflight(ctx.params)
    if err:
        raise RuntimeError(err)
    output = video_base.stub_execute("audio2video")(ctx)
    extra = dict(output.extra)
    extra["localOnly"] = True
    extra["neverLeftDevice"] = True
    extra["weightRepo"] = ctx.params.weight_repo or longcat_avatar.OFFICIAL_REPO
    extra["weightVariant"] = "int8"
    extra["seamQuality"] = "prototype-unmeasured"
    return VideoPipelineOutput(
        mp4_path=output.mp4_path,
        frame_previews=output.frame_previews,
        extra=extra,
    )


def register(handlers: Dict[str, Callable]) -> None:
    runner = video_base.VideoPipelineRunner(
        method="diffusion.video.audio2video",
        execute=_execute,
        model_size_gb=_MODEL_SIZE_GB,
    )
    handlers["diffusion.video.audio2video"] = lambda params: runner.run(params or {})
