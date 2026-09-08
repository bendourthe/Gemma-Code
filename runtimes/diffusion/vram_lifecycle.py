"""VRAM lifecycle management for video pipelines.

Phase 7.4 plan: each video job must explicitly free VRAM at the end so
the next job (image, video, or LLM) can claim the freed memory. This
module wraps each job in a `vram_scope(model_id, model_size_gb)` context
manager that:

    - records VRAM usage on entry (`vram_acquired` telemetry event)
    - on exit, runs `del pipe; torch.cuda.empty_cache(); gc.collect()`
    - records VRAM usage on exit (`vram_released` telemetry event)

The actual `del pipe` happens inside the pipeline's execute callback
(the runner cannot reach into the pipeline's local variables); the
context manager runs the cache + gc cleanup on exit and publishes the
telemetry envelope. The Phase 8 GpuScheduler subscribes to these events
to flip its FIFO queue from "occupied" to "available".

Telemetry envelope:

    {"kind": "vram_acquired" | "vram_released",
     "modelId": str,
     "bytes": int | None,
     "timestamp": iso8601}

The publisher is injected so unit tests can capture events without a
running IPC channel. Production callers pass `publish_telemetry_event`
which routes to the JSON-RPC stdout via `main.py`.
"""

from __future__ import annotations

import contextlib
import gc
import time
from typing import Any, Callable, Iterator, List, Optional


TelemetryEvent = dict
TelemetryPublisher = Callable[[TelemetryEvent], None]


_BYTES_PER_GB = 1024 ** 3


_publisher: Optional[TelemetryPublisher] = None


def set_publisher(fn: Optional[TelemetryPublisher]) -> None:
    """Install a telemetry publisher. Pass `None` to suppress events."""
    global _publisher
    _publisher = fn


def _publish(event: TelemetryEvent) -> None:
    if _publisher is not None:
        _publisher(event)


def release_vram() -> None:
    """Drop cached CUDA blocks after a job so another runtime can use them.

    v2.4.8 follow-up: image jobs ran outside `vram_scope`, so the weights'
    VRAM stayed reserved by the caching allocator after the picture was done.
    Safe without torch or CUDA (both helpers no-op).
    """
    _empty_cache()


def _vram_allocated_bytes() -> Optional[int]:
    """Read `torch.cuda.memory_allocated()` if available, else None."""
    try:  # pragma: no cover - exercised on CUDA hosts
        import torch  # type: ignore[import-not-found]

        if not (getattr(torch, "cuda", None) and torch.cuda.is_available()):
            return None
        return int(torch.cuda.memory_allocated())
    except Exception:
        return None


def _empty_cache() -> None:
    """Run the gpu-cache + python-gc sweep used after every video job."""
    try:  # pragma: no cover - exercised on CUDA hosts
        import torch  # type: ignore[import-not-found]

        if getattr(torch, "cuda", None) and torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass
    gc.collect()


def _iso_timestamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


@contextlib.contextmanager
def vram_scope(
    model_id: str,
    model_size_gb: float,
) -> Iterator[dict]:
    """Run a video job inside a VRAM-managed scope.

    Yields a small mutable dict the pipeline can stash references in
    (`scope["pipe"] = pipe`); the dict is *not* used by the cleanup
    path -- the empty_cache + gc.collect calls free everything that has
    fallen out of scope by the time the `with` block exits.
    """
    started_bytes = _vram_allocated_bytes()
    _publish(
        {
            "kind": "vram_acquired",
            "modelId": model_id,
            "modelSizeGB": model_size_gb,
            "bytes": started_bytes,
            "timestamp": _iso_timestamp(),
        }
    )
    state: dict = {}
    try:
        yield state
    finally:
        # Clear any references the pipeline stashed before invoking the
        # cache + gc sweep so weights are actually unreachable.
        state.clear()
        _empty_cache()
        released_bytes = _vram_allocated_bytes()
        _publish(
            {
                "kind": "vram_released",
                "modelId": model_id,
                "modelSizeGB": model_size_gb,
                "bytes": released_bytes,
                "timestamp": _iso_timestamp(),
            }
        )


class CapturingPublisher:
    """Test helper: collects telemetry events instead of emitting them.

    Tests construct one of these, install via `set_publisher`, run the
    scope, then introspect `events` to assert acquire/release pairing.
    """

    def __init__(self) -> None:
        self.events: List[TelemetryEvent] = []

    def __call__(self, event: TelemetryEvent) -> None:
        self.events.append(event)

    def kinds(self) -> List[str]:
        return [str(ev.get("kind", "")) for ev in self.events]
