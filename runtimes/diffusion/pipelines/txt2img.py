"""txt2img pipeline registration.

The real diffusers-backed executor is intentionally omitted here -- it
only runs on a CUDA host and is exercised by the operator acceptance
test (`docs/v1.0.0/operator-actions.md`). The CI executor produces a
deterministic 1x1 PNG so the JSON-RPC round-trip + workflow embedding
remain verifiable in environments without a GPU.

TAESD latent previews: each progress event includes a base64 preview
placeholder for symmetry with the on-host path; the real implementation
will decode the latent through TAESD every 5 steps.
"""

from __future__ import annotations

from typing import Callable, Dict

from . import base


def register(handlers: Dict[str, Callable]) -> None:
    runner = base.PipelineRunner(mode="txt2img", execute=base.stub_execute("txt2img"))
    handlers["txt2img"] = lambda params: runner.run(params or {})
