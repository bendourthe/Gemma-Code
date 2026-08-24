"""
v2.0.0 Phase 1 -- Python STT/TTS runtime entry point.

Line-delimited JSON-RPC 2.0 over stdin/stdout, matching `runtimes/ocr/main.py`.
`health` and `version` never import faster-whisper or Kokoro.
"""

from __future__ import annotations

import json
import sys
import traceback
from typing import Any, Callable, Optional

from . import engines, version

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
    return engines.health()


def _handle_version(_params: JsonRpcParams) -> JsonRpcResult:
    return {
        "name": "nexus-audio-runtime",
        "version": version.RUNTIME_VERSION,
        "protocol": version.PROTOCOL_VERSION,
    }


def _handle_transcribe(params: JsonRpcParams) -> JsonRpcResult:
    return engines.transcribe(params)


def _handle_speak(params: JsonRpcParams) -> JsonRpcResult:
    return engines.speak(params)


def build_handlers() -> dict[str, HandlerFn]:
    return {
        "health": _handle_health,
        "version": _handle_version,
        "transcribe": _handle_transcribe,
        "speak": _handle_speak,
    }


def dispatch(line: str, handlers: dict[str, HandlerFn]) -> None:
    try:
        request = json.loads(line)
    except json.JSONDecodeError:
        _err(None, PARSE_ERROR, "parse error")
        return
    if not isinstance(request, dict):
        _err(None, INVALID_REQUEST, "request must be an object")
        return
    method = request.get("method")
    req_id = request.get("id")
    params = request.get("params")
    if not isinstance(method, str):
        _err(req_id, INVALID_REQUEST, "method must be a string")
        return
    if params is not None and not isinstance(params, dict):
        _err(req_id, INVALID_REQUEST, "params must be an object")
        return
    handler = handlers.get(method)
    if handler is None:
        _err(req_id, METHOD_NOT_FOUND, f"unknown method: {method}")
        return
    try:
        result = handler(params)
    except Exception as exc:  # noqa: BLE001 -- surface engine errors on the wire
        _err(req_id, INTERNAL_ERROR, str(exc) or traceback.format_exc())
        return
    _ok(req_id, result)


def main() -> None:
    handlers = build_handlers()
    for line in sys.stdin:
        text = line.strip()
        if text:
            dispatch(text, handlers)


if __name__ == "__main__":
    main()
