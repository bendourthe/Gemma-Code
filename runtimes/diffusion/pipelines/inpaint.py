"""inpaint pipeline registration.

The on-host executor uses `StableDiffusionXLInpaintPipeline` with the
user-provided alpha-channel mask as the inpaint mask. The CI executor
short-circuits to a deterministic 1x1 PNG.
"""

from __future__ import annotations

from typing import Callable, Dict

from . import base, real_execute


def register(handlers: Dict[str, Callable]) -> None:
    runner = base.PipelineRunner(
        mode="inpaint",
        execute=base.select_executor("inpaint", real=real_execute.image_execute),
    )
    handlers["inpaint"] = lambda params: runner.run(params or {})
