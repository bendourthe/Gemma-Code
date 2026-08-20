"""Pipeline orchestration primitives.

`PipelineRunner` is a thin coordinator that:

    1. validates the inbound parameters against `params.PipelineParams`
    2. picks an offload strategy via `device.choose_offload`
    3. invokes the pipeline-specific execution callback
    4. embeds the request metadata into the produced PNG via
       `workflow_metadata.embed_workflow`

Each pipeline supplies the execution callback. The callback receives a
`ExecutionContext` carrying the parsed params + the chosen offload
strategy and returns a `PipelineOutput`. Splitting the runner from the
diffusers calls means the orchestration is unit-testable with a fake
callback (no torch import).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional

from .. import budget, device
from . import params, workflow_metadata


@dataclass(frozen=True)
class ExecutionContext:
    job_id: str
    mode: str
    params: params.PipelineParams
    offload_strategy: str


@dataclass(frozen=True)
class PipelineOutput:
    """Result returned by a pipeline execution callback.

    `png_bytes` is the raw PNG body before workflow metadata is embedded;
    the runner re-encodes once the workflow object is finalized.
    `extra` allows the pipeline to surface side information (e.g.
    conditioning preview thumbnails) back to the dispatcher.
    """

    png_bytes: bytes
    extra: Dict[str, Any]


ExecuteFn = Callable[[ExecutionContext], PipelineOutput]


@dataclass
class PipelineRunner:
    mode: str
    execute: ExecuteFn
    model_size_gb: float = 6.9  # SDXL ballpark; pipelines may override

    def run(self, payload: dict) -> Dict[str, Any]:
        job_id = payload.get("jobId")
        request = payload.get("request") or {}
        if not isinstance(job_id, str) or not job_id:
            return {"ok": False, "error": "invalid-job-id"}
        try:
            parsed = params.parse(self.mode, request)
        except params.ParamsError as exc:
            return {"ok": False, "error": "invalid-params", "message": str(exc)}
        info = device.detect()
        if parsed.max_cache_vram_gb is not None:
            mem = budget.MemoryBudget(
                max_cache_vram_gb=parsed.max_cache_vram_gb,
                max_cache_ram_gb=parsed.max_cache_ram_gb or parsed.max_cache_vram_gb,
                working_mem_reserve_gb=parsed.working_mem_reserve_gb or 0,
                layer_streaming=parsed.layer_streaming,
            )
            ok, errors, _warnings = budget.validate_budget(mem, self.model_size_gb)
            if not ok:
                return {
                    "ok": False,
                    "error": "invalid-params",
                    "message": "; ".join(errors),
                }
        decision = device.choose_offload(
            info.vram_free_gb,
            self.model_size_gb,
            layer_streaming=parsed.layer_streaming,
        )
        if decision.strategy == "insufficient_vram":
            return {
                "ok": False,
                "error": "insufficient-vram",
                "message": decision.reason,
            }
        ctx = ExecutionContext(
            job_id=job_id,
            mode=self.mode,
            params=parsed,
            offload_strategy=decision.strategy,
        )
        try:
            output = self.execute(ctx)
        except Exception as exc:  # noqa: BLE001 - surface as JSON-RPC error
            return {
                "ok": False,
                "error": "execution-failed",
                "message": f"{type(exc).__name__}: {exc}",
            }
        workflow = workflow_metadata.build_workflow(
            mode=self.mode, params_obj=parsed, timestamp=_iso_timestamp()
        )
        try:
            png_with_metadata = workflow_metadata.embed_workflow(
                output.png_bytes, workflow
            )
        except Exception as exc:  # noqa: BLE001 - propagate as error envelope
            return {
                "ok": False,
                "error": "workflow-embed-failed",
                "message": f"{type(exc).__name__}: {exc}",
            }
        return {
            "ok": True,
            "jobId": job_id,
            "mode": self.mode,
            "offloadStrategy": decision.strategy,
            "offloadReason": decision.reason,
            "pngBase64": _to_base64(png_with_metadata),
            "workflow": workflow,
            "extra": output.extra,
        }


def _iso_timestamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _to_base64(data: bytes) -> str:
    import base64

    return base64.b64encode(data).decode("ascii")


def stub_execute(mode_label: str) -> ExecuteFn:
    """Return an execution callback that produces a deterministic 1x1 PNG.

    Used by the runtime when diffusers/torch is unavailable so the JSON-RPC
    contract still returns a meaningful response in CI. The "image" is a
    one-pixel transparent PNG; the workflow JSON embedded by the runner
    still carries the full request so the round-trip test can verify
    metadata fidelity end-to-end.
    """

    def execute(ctx: ExecutionContext) -> PipelineOutput:
        return PipelineOutput(
            png_bytes=workflow_metadata.minimal_png(),
            extra={"stubbed": True, "mode": mode_label, "jobId": ctx.job_id},
        )

    return execute


def diffusers_available() -> bool:
    """Probe whether the heavy stack is importable.

    The pipelines call this once at registration time and choose the
    stub executor when the real one is unavailable. This keeps the
    runtime usable in CI without dragging in a torch dependency.
    """

    try:  # pragma: no cover - present only on CUDA hosts
        import torch  # type: ignore[import-not-found]  # noqa: F401
        import diffusers  # type: ignore[import-not-found]  # noqa: F401

        return True
    except Exception:
        return False


def select_executor(mode: str, real: Optional[ExecuteFn] = None) -> ExecuteFn:
    if real is not None and diffusers_available():  # pragma: no cover - GPU only
        return real
    return stub_execute(mode)
