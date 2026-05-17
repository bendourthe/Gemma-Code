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


def _emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
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


def main() -> int:
    handlers = build_handlers()
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        dispatch(line, handlers)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
