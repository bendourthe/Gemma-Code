"""img2img pipeline registration.

See `txt2img.py` for the CI/operator dichotomy.
"""

from __future__ import annotations

from typing import Callable, Dict

from . import base


def register(handlers: Dict[str, Callable]) -> None:
    runner = base.PipelineRunner(mode="img2img", execute=base.stub_execute("img2img"))
    handlers["img2img"] = lambda params: runner.run(params or {})
