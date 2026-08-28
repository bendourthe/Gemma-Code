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

import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from .. import budget, device
from . import params, workflow_metadata


class RuntimeNotReady(RuntimeError):
    """GPU, weights, or diffusion deps are missing. Fail before a fake complete.

    `kind` names the single probed failure (v2.2.9 T009):
    `cuda-torch-missing`, `weights-missing`, `gpu-not-available`,
    `diffusers-missing`, or the generic `runtime-not-ready`.
    """

    def __init__(self, message: str, kind: str = "runtime-not-ready") -> None:
        super().__init__(message)
        self.error = "runtime-not-ready"
        self.kind = kind


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
        except RuntimeNotReady as exc:
            return {
                "ok": False,
                "error": getattr(exc, "error", "runtime-not-ready"),
                "message": str(exc),
            }
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


def allow_stub() -> bool:
    """True only under pytest. NEXUS_DIFFUSION_ALLOW_STUB is test-scoped: the
    flag alone never enables stub output on a real host (v2.2.9 lock: no stub
    PNG outside the test harness)."""
    return bool(os.environ.get("PYTEST_CURRENT_TEST"))


_SAFE_DIR = re.compile(r"[^A-Za-z0-9._-]")


def models_root() -> Path:
    """Installer models root (`~/.nexus/models`, overridable for tests)."""
    override = os.environ.get("NEXUS_MODELS_ROOT")
    if override:
        return Path(override)
    return Path.home() / ".nexus" / "models"


def resolve_weights_dir(model_id: str) -> Optional[Path]:
    """Return the installer weights directory when it contains files."""
    if not model_id:
        return None
    safe = _SAFE_DIR.sub("-", model_id)
    candidates = [
        models_root() / "weights" / model_id,
        models_root() / "weights" / safe,
    ]
    for path in candidates:
        if not path.is_dir():
            continue
        try:
            next(path.iterdir())
        except StopIteration:
            continue
        return path
    return None


def expected_weights_dir(model_id: str) -> Path:
    """The primary path the installer would have provisioned for `model_id`."""
    return models_root() / "weights" / model_id


def torch_cuda_state() -> str:
    """Classify the diffusion venv's torch/CUDA state (v2.2.9 T009).

    Returns exactly one of:

    - ``"ok"``: a CUDA torch build is installed and reports a usable device.
    - ``"no-cuda-torch"``: torch is not importable in this environment, or
      the installed torch is a CPU-only build (``torch.version.cuda`` is
      unset). This is the packaged-app trap: the app telemetry footer can
      show NVIDIA VRAM because Ollama uses the GPU through its own runtime
      while this Python environment still has no CUDA torch.
    - ``"no-gpu"``: torch is a CUDA build but no usable CUDA device was
      detected (``torch.cuda.is_available()`` is false).
    """
    try:
        import torch  # type: ignore[import-not-found]
    except Exception:
        return "no-cuda-torch"
    cuda_build = getattr(getattr(torch, "version", None), "cuda", None)
    if not cuda_build:
        return "no-cuda-torch"
    try:
        if getattr(torch, "cuda", None) and torch.cuda.is_available():
            return "ok"
    except Exception:
        return "no-gpu"
    return "no-gpu"


def cuda_torch_missing_message(kind: str) -> str:
    """Kind 1: the diffusion Python environment has no CUDA torch."""
    return (
        f"{kind} runtime is not ready: no CUDA torch in the diffusion Python "
        "environment (torch is missing or a CPU-only build); app telemetry can "
        "still show NVIDIA VRAM because Ollama can use the GPU while this "
        "environment stays CPU-only"
    )


def weights_missing_message(kind: str, model_id: str) -> str:
    """Kind 2: weights for the requested model id are not on disk."""
    return (
        f"{kind} runtime is not ready: weights for model {model_id} "
        f"not found at {expected_weights_dir(model_id)}"
    )


def gpu_unavailable_message(kind: str) -> str:
    """Kind 3: CUDA torch is installed but no usable device is present."""
    return (
        f"{kind} runtime is not ready: GPU not available (CUDA torch is "
        "installed but no usable CUDA device was detected)"
    )


def accelerator_not_ready(kind: str) -> RuntimeNotReady:
    """Typed accelerator failure: CUDA-torch-missing vs GPU-not-available."""
    if torch_cuda_state() == "no-cuda-torch":
        return RuntimeNotReady(
            cuda_torch_missing_message(kind), kind="cuda-torch-missing"
        )
    return RuntimeNotReady(gpu_unavailable_message(kind), kind="gpu-not-available")


def classify_runtime_not_ready(kind: str, model_id: Optional[str]) -> RuntimeNotReady:
    """Build the single typed reason a generate cannot run (v2.2.9 T009).

    Probe order is deterministic so exactly one failure kind is reported,
    never a re-combined blur:

    1. torch/CUDA in THIS Python environment: torch missing or a CPU-only
       build reports `cuda-torch-missing`; a CUDA build with no usable
       device reports `gpu-not-available`.
    2. Weights: the installer path for `model_id` under the models root
       (`~/.nexus/models/weights/<id>/`) must exist and be non-empty.
    3. diffusers importability, then a generic wiring fallback.
    """
    state = torch_cuda_state()
    if state == "no-cuda-torch":
        return RuntimeNotReady(
            cuda_torch_missing_message(kind), kind="cuda-torch-missing"
        )
    if state == "no-gpu":
        return RuntimeNotReady(gpu_unavailable_message(kind), kind="gpu-not-available")
    if model_id and resolve_weights_dir(model_id) is None:
        return RuntimeNotReady(
            weights_missing_message(kind, model_id), kind="weights-missing"
        )
    try:  # pragma: no cover - depends on host env
        import diffusers  # type: ignore[import-not-found]  # noqa: F401
    except Exception:
        return RuntimeNotReady(
            f"{kind} runtime is not ready: diffusers is not importable in "
            "the diffusion Python environment",
            kind="diffusers-missing",
        )
    return RuntimeNotReady(
        f"{kind} runtime is not ready: the real executor is not wired for "
        "this pipeline",
        kind="runtime-not-ready",
    )


def fail_closed_execute(mode_label: str) -> ExecuteFn:
    """Refuse to complete with a decorative 1x1 PNG on a real host.

    Raises a single typed `RuntimeNotReady` chosen by the documented probe
    order in `classify_runtime_not_ready` (torch/CUDA first, then weights).
    """

    def execute(ctx: ExecutionContext) -> PipelineOutput:
        raise classify_runtime_not_ready("image", getattr(ctx.params, "model_id", None))

    return execute


def can_run_real() -> bool:
    if not diffusers_available():
        return False
    try:
        import torch  # type: ignore[import-not-found]

        if getattr(torch, "cuda", None) and torch.cuda.is_available():
            return True
    except Exception:
        return False
    flag = os.environ.get("NEXUS_DIFFUSION_ALLOW_CPU", "").strip().lower()
    return flag in {"1", "true", "yes"}


def select_executor(mode: str, real: Optional[ExecuteFn] = None) -> ExecuteFn:
    """Pick real / stub / fail-closed at call time, not at import time."""

    def dispatch(ctx: ExecutionContext) -> PipelineOutput:
        if real is not None and can_run_real():  # pragma: no cover - GPU only
            return real(ctx)
        if allow_stub():
            return stub_execute(mode)(ctx)
        return fail_closed_execute(mode)(ctx)

    return dispatch
