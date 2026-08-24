"""image2video pipeline registration.

SVD (Stable Video Diffusion) is the v1.0.0 default for image+text-to-
video: it takes a single conditioning image plus a prompt and produces a
4-second clip at 14-25 fps on a 12 GB RTX 4070. The diffusers pipeline
is `StableVideoDiffusionPipeline`. The executor decodes `params.source_image`
(a data URI from the UI) and passes it as the conditioning frame.

CogVideoX-I2V is exposed as an opt-in alternative via `modelId:
"cogvideox-5b-i2v"`; the executor branches at run time. CI uses the
stub executor from `video_base`.
"""

from __future__ import annotations

from typing import Callable, Dict

from . import video_base, real_execute


# SVD weights are ~9 GB on disk; the unet at fp16 inside CUDA is ~7 GB.
# Use 9 GB as the planning size.
_MODEL_SIZE_GB = 9.0


def register(handlers: Dict[str, Callable]) -> None:
    runner = video_base.VideoPipelineRunner(
        method="diffusion.video.image2video",
        execute=video_base.select_executor(
            "image2video", real=real_execute.video_execute
        ),
        model_size_gb=_MODEL_SIZE_GB,
    )
    handlers["diffusion.video.image2video"] = lambda params: runner.run(params or {})
