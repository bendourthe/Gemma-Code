"""Pipeline handler registration.

Each pipeline module exposes a `register(handlers: dict[str, Handler])`
function. This module imports them lazily so `main.py` can register the
full set without paying the diffusers import cost up front.

When a pipeline import fails (e.g. CUDA runtime not present in CI),
`register_pipeline_handlers` installs a fallback that reports the
import error back to the caller as a structured JSON-RPC error.
"""

from __future__ import annotations

import importlib
from typing import Any, Callable, Dict, Optional


JsonRpcParams = Optional[dict]
JsonRpcResult = Dict[str, Any]
HandlerFn = Callable[[JsonRpcParams], JsonRpcResult]


_PIPELINE_MODULES = (
    "runtimes.diffusion.pipelines.txt2img",
    "runtimes.diffusion.pipelines.img2img",
    "runtimes.diffusion.pipelines.inpaint",
    "runtimes.diffusion.pipelines.outpaint",
    "runtimes.diffusion.pipelines.video_text2video",
    "runtimes.diffusion.pipelines.video_image2video",
    # v1.1.0 Phase 12 -- NVIDIA SANA family.
    "runtimes.diffusion.pipelines.sana",
    "runtimes.diffusion.pipelines.sana_sprint",
    "runtimes.diffusion.pipelines.sana_int4",
    "runtimes.diffusion.pipelines.sana_video",
)


def _make_unavailable_handler(method: str, exc: BaseException) -> HandlerFn:
    def handler(_params: JsonRpcParams) -> JsonRpcResult:
        return {
            "ok": False,
            "method": method,
            "error": "pipeline-unavailable",
            "message": f"{type(exc).__name__}: {exc}",
        }

    return handler


def register_pipeline_handlers(handlers: dict[str, HandlerFn]) -> None:
    for module_path in _PIPELINE_MODULES:
        try:
            mod = importlib.import_module(module_path)
        except Exception as exc:  # noqa: BLE001 - import-time guard
            method = module_path.rsplit(".", 1)[-1]
            handlers[method] = _make_unavailable_handler(method, exc)
            continue
        register = getattr(mod, "register", None)
        if callable(register):
            register(handlers)
