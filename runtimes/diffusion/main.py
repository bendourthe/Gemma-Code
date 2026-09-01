"""
v1.0.0 Phase 6.1 -- Python diffusion sidecar entry point.

The Tauri shell spawns this script alongside the Node sidecar. It speaks
line-delimited JSON-RPC 2.0 over stdin/stdout (one request per line, one
response per line). Keeping the wire format identical to the Node sidecar
means the Rust core can drive both processes through the same `request()`
helper.

PyTorch + diffusers are imported lazily on first job dispatch so the
sidecar boots in environments that only need `health` and `version`
(CI, smoke tests, smoke acceptance tests on machines without CUDA).
The `pipelines/` package keeps each pipeline implementation isolated so
the import cost is paid once per pipeline kind.
"""

from __future__ import annotations

import json
import sys
import threading
import traceback
from typing import Any, Callable, Optional

from . import device, registry, version


JsonRpcParams = Optional[dict]
JsonRpcResult = dict[str, Any]
HandlerFn = Callable[[JsonRpcParams], JsonRpcResult]


PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INTERNAL_ERROR = -32603

#: Methods answered on the reader thread itself. They are pure lookups that
#: return in microseconds, and the caller uses them to ask whether the runtime
#: is alive -- which is exactly the question that must stay answerable while a
#: job is running (v2.4.4 Phase 5.1).
CONTROL_METHODS = frozenset({"health", "version"})

#: Cadence for the progress notifications emitted while a job runs. Diffusers
#: gives no step callback on every pipeline here, so this is a liveness signal
#: rather than a percentage: it proves the runtime is still working.
HEARTBEAT_INTERVAL_S = 2.0

#: One lock around stdout. Job threads and the reader thread both write here,
#: and the wire format is line-delimited JSON -- two interleaved writes would
#: produce one unparseable line and take down the channel.
_STDOUT_LOCK = threading.Lock()


def _emit(payload: dict[str, Any]) -> None:
    line = json.dumps(payload) + "\n"
    with _STDOUT_LOCK:
        sys.stdout.write(line)
        sys.stdout.flush()


def _ok(req_id: Any, result: JsonRpcResult) -> None:
    _emit({"jsonrpc": "2.0", "id": req_id, "result": result})


def _err(req_id: Any, code: int, message: str) -> None:
    _emit({"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}})


def _handle_health(_params: JsonRpcParams) -> JsonRpcResult:
    detected = device.detect()
    return {
        "ok": True,
        "torch": detected.torch_version,
        "cuda": detected.cuda_version,
        "device": detected.device_name,
        "vramTotalGB": detected.vram_total_gb,
        "vramFreeGB": detected.vram_free_gb,
    }


def _handle_version(_params: JsonRpcParams) -> JsonRpcResult:
    return {
        "name": "nexus-diffusion-runtime",
        "version": version.RUNTIME_VERSION,
        "protocol": version.PROTOCOL_VERSION,
    }


def build_handlers() -> dict[str, HandlerFn]:
    """Compose the handler table.

    Phase 6.1 ships `health` + `version`. Subsequent sub-tasks add pipeline
    methods via `registry.register_pipeline_handlers` so this module stays
    short and exercising the dispatcher does not require importing the
    pipelines.
    """
    handlers: dict[str, HandlerFn] = {
        "health": _handle_health,
        "version": _handle_version,
    }
    registry.register_pipeline_handlers(handlers)
    return handlers


def dispatch(line: str, handlers: dict[str, HandlerFn]) -> None:
    try:
        request = json.loads(line)
    except json.JSONDecodeError:
        _err(None, PARSE_ERROR, "ParseError")
        return
    if not isinstance(request, dict):
        _err(None, INVALID_REQUEST, "InvalidRequest")
        return
    req_id = request.get("id")
    method = request.get("method")
    if not isinstance(method, str):
        _err(req_id, INVALID_REQUEST, "InvalidRequest")
        return
    handler = handlers.get(method)
    if handler is None:
        _err(req_id, METHOD_NOT_FOUND, f"MethodNotFound: {method}")
        return
    params = request.get("params")
    if params is not None and not isinstance(params, dict):
        _err(req_id, INVALID_REQUEST, "InvalidParams")
        return
    try:
        result = handler(params)
    except Exception as exc:  # pragma: no cover - defensive
        sys.stderr.write(traceback.format_exc())
        _err(req_id, INTERNAL_ERROR, f"{type(exc).__name__}: {exc}")
        return
    _ok(req_id, result)


def _notify(method: str, params: dict[str, Any]) -> None:
    """Emit a JSON-RPC notification (no `id`, so no response is expected)."""
    _emit({"jsonrpc": "2.0", "method": method, "params": params})


def heartbeat_while(
    job_id: Any,
    method: str,
    done: threading.Event,
    interval: float = HEARTBEAT_INTERVAL_S,
) -> None:
    """Emit `progress` notifications until `done` is set.

    v2.4.4 Phase 5.1: a Wan run on a 16 GB laptop takes minutes during which
    the runtime previously said nothing at all, so the shell had no way to
    distinguish "still working" from "dead". The UI keeps its pending state
    and its animation until a real completion or a written error; these
    notifications are what make that wait honest rather than a guess.
    """
    elapsed = 0.0
    while not done.wait(interval):
        elapsed += interval
        _notify(
            "progress",
            {
                "kind": "progress",
                "jobId": job_id,
                "method": method,
                "elapsedS": elapsed,
            },
        )


def serve(stream, handlers: dict[str, HandlerFn]) -> int:
    """Read requests forever, running job methods off the reader thread.

    Before this, `dispatch` ran the handler to completion inline, so a CUDA
    job held the stdin loop for its whole duration: `health` queued behind it
    and the runtime looked hung. Job methods now run on their own thread, so
    the reader keeps accepting and answering while work is in flight. The wire
    contract is unchanged -- responses are correlated by `id`, so answering
    out of order is exactly what JSON-RPC allows for.
    """
    workers: list[threading.Thread] = []
    for raw in stream:
        line = raw.strip()
        if not line:
            continue
        method = _peek_method(line)
        if method is not None and method not in CONTROL_METHODS:
            worker = threading.Thread(
                target=_dispatch_with_heartbeat,
                args=(line, handlers, method),
                daemon=True,
            )
            worker.start()
            workers.append(worker)
            workers[:] = [w for w in workers if w.is_alive()]
            continue
        dispatch(line, handlers)
    # stdin closed: let work already accepted finish rather than truncating a
    # job the caller is still waiting on.
    for worker in workers:
        worker.join(timeout=HEARTBEAT_INTERVAL_S)
    return 0


def _peek_method(line: str) -> Optional[str]:
    """Method name if the line is a well-formed request, else None.

    A malformed line goes down the inline path so `dispatch` produces the same
    parse/invalid-request error it always has.
    """
    try:
        request = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(request, dict):
        return None
    method = request.get("method")
    return method if isinstance(method, str) else None


def _dispatch_with_heartbeat(
    line: str, handlers: dict[str, HandlerFn], method: str
) -> None:
    job_id = None
    try:
        job_id = (json.loads(line).get("params") or {}).get("jobId")
    except Exception:  # noqa: BLE001 - heartbeats never break dispatch
        job_id = None
    done = threading.Event()
    beat = threading.Thread(
        target=heartbeat_while, args=(job_id, method, done), daemon=True
    )
    beat.start()
    try:
        dispatch(line, handlers)
    finally:
        done.set()
        beat.join(timeout=HEARTBEAT_INTERVAL_S)


def main() -> int:
    handlers = build_handlers()
    return serve(sys.stdin, handlers)


if __name__ == "__main__":
    raise SystemExit(main())
