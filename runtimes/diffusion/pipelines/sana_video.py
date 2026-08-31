"""SANA-Video pipeline (v1.1.0 Phase 12.5).

Registers `diffusion.video.sana.text2video` + `.image2video` for SANA-
Video 2B at 720p -- the "Fast 720p" tier in Video Lab (between LTX-Video
and CogVideoX in terms of speed / quality). The shape mirrors
`video_text2video.py` / `video_image2video.py` so the dispatcher hands
through to the standard `VideoPipelineRunner` orchestration with no
special-casing.

CI executor is the deterministic stub from `pipelines/video_base.py`;
the real diffusers call runs under operator action OA-09 on the
RTX 4070 baseline rig with target <= 60 s for a 4-second 720p clip.
"""

from __future__ import annotations

from typing import Callable, Dict

from . import video_base, real_execute


# Catalog disk size is ~18 GB (transformer + Gemma2 text encoder + VAE).
# CUDA planning stays 8 GB so offload still steps to model_cpu_offload
# on a 12 GB host the same way LTX-Video / SVD / CogVideoX do.
_MODEL_SIZE_GB = 8.0


def register(handlers: Dict[str, Callable]) -> None:
    """Register the two SANA-Video methods.

    `text2video` is the primary surface (Image Studio's Fast 720p tier);
    `image2video` lights up the conditioning-image flow. Both share the
    same offload upgrade because they ride the same underlying weights.
    """
    txt_runner = video_base.VideoPipelineRunner(
        method="diffusion.video.sana.text2video",
        execute=video_base.select_executor(
            "sana_video.text2video", real=real_execute.sana_video_execute
        ),
        model_size_gb=_MODEL_SIZE_GB,
    )
    img_runner = video_base.VideoPipelineRunner(
        method="diffusion.video.sana.image2video",
        execute=video_base.select_executor(
            "sana_video.image2video", real=real_execute.sana_video_execute
        ),
        model_size_gb=_MODEL_SIZE_GB,
    )
    handlers["diffusion.video.sana.text2video"] = lambda params: txt_runner.run(params or {})
    handlers["diffusion.video.sana.image2video"] = lambda params: img_runner.run(params or {})
