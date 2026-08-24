"""outpaint pipeline registration.

The on-host executor expands the canvas by `pixels` in the chosen
direction, computes a feathered edge mask, then defers to the inpaint
pipeline on the new region.
"""

from __future__ import annotations

from typing import Callable, Dict

from . import base, real_execute


def register(handlers: Dict[str, Callable]) -> None:
    runner = base.PipelineRunner(
        mode="outpaint",
        execute=base.select_executor("outpaint", real=real_execute.image_execute),
    )
    handlers["outpaint"] = lambda params: runner.run(params or {})
