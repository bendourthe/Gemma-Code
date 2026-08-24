"""text2video pipeline registration.

LTX-Video is the v1.0.0 default (selected per the Phase 7 plan because
it generates 5-second 768x512 clips in <= 5 minutes on a 12 GB RTX 4070
with diffusers `LTXPipeline`). CogVideoX is exposed as an opt-in
alternative via the same `diffusion.video.text2video` method by passing
`modelId: "cogvideox-5b"` / `"cogvideox-2b"`; the executor picks the
right diffusers pipeline at run time based on `params.model_id`.

The on-host executor calls into the real diffusers pipelines and writes
the MP4 via `imageio[ffmpeg]`. CI uses the stub executor from
`video_base` which short-circuits to deterministic preview thumbnails.
"""

from __future__ import annotations

from typing import Callable, Dict

from . import video_base, real_execute


# LTX-Video weights are ~12 GB on disk; the unet at fp16 inside CUDA is
# ~10 GB. Use 12 GB as the planning size so the offload decision is
# conservative enough for the RTX 4070 baseline tier.
_MODEL_SIZE_GB = 12.0


def register(handlers: Dict[str, Callable]) -> None:
    runner = video_base.VideoPipelineRunner(
        method="diffusion.video.text2video",
        execute=video_base.select_executor(
            "text2video", real=real_execute.video_execute
        ),
        model_size_gb=_MODEL_SIZE_GB,
    )
    handlers["diffusion.video.text2video"] = lambda params: runner.run(params or {})
