"""
v1.16.0 Phase 3 (adoption item A5) -- the `parse` job handler.

Owns the request envelope, engine selection, per-page progress emission, and the
error envelope. Mirrors `runtimes/diffusion/pipelines/base.py::PipelineRunner`:
a failed job is returned as a RESULT with ``ok: false`` and a stable ``error``
code, not as a JSON-RPC error, so the sidecar can render a specific message
instead of a generic transport failure.

This is the repo's first real producer of progress NOTIFICATIONS. The diffusion
runtime has the plumbing but never emits any; a multi-page document parse is
genuinely long-running, so it reports after each page.
"""

from __future__ import annotations

import json
import sys
from typing import Any, Callable, Dict, Optional

from . import device
from .documents import DocumentError, MAX_PAGES
from .engines.base import ParsedDocument, resolve_engine

EmitFn = Callable[[Dict[str, Any]], None]


def _default_emit(payload: Dict[str, Any]) -> None:
    """Write one JSON-RPC notification (no `id`) to stdout."""
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def _error(job_id: str, code: str, message: str) -> Dict[str, Any]:
    return {"ok": False, "jobId": job_id, "error": code, "message": message}


def _engine_for_request(request: Dict[str, Any]) -> str:
    """Pick the engine, defaulting to the portable one.

    Defaulting to RapidOCR is deliberate: it is the engine that works on every
    host, so an unspecified request succeeds everywhere rather than failing on
    the majority of machines.
    """
    engine = request.get("engine")
    if engine is None:
        return "rapidocr"
    if not isinstance(engine, str):
        raise DocumentError("invalid-params", "engine must be a string")
    return engine


def run_parse(params: Dict[str, Any], emit: Optional[EmitFn] = None) -> Dict[str, Any]:
    """Execute one document-parse job and return its result envelope."""
    emit_fn = emit if emit is not None else _default_emit

    job_id = params.get("jobId")
    if not isinstance(job_id, str) or not job_id:
        return _error("", "invalid-job-id", "jobId is required")

    request = params.get("request")
    if not isinstance(request, dict):
        return _error(job_id, "invalid-params", "request object is required")

    try:
        engine_name = _engine_for_request(request)
        document_base64 = request.get("documentBase64")
        dpi = request.get("dpi")
        max_pages = request.get("maxPages")
        if max_pages is not None and not isinstance(max_pages, int):
            raise DocumentError("invalid-params", "maxPages must be an integer")

        engine = resolve_engine(engine_name, model_dir=request.get("modelDir"))

        def progress(done: int, total: int) -> None:
            emit_fn(
                {
                    "jsonrpc": "2.0",
                    "kind": "progress",
                    "jobId": job_id,
                    "page": done,
                    "totalPages": total,
                    "stage": "ocr",
                }
            )

        parsed: ParsedDocument = engine.parse(
            document_base64,
            dpi=dpi,
            max_pages=max_pages if isinstance(max_pages, int) else MAX_PAGES,
            progress=progress,
        )
    except DocumentError as exc:
        return _error(job_id, exc.code, exc.message)
    except Exception as exc:  # pragma: no cover - defensive
        return _error(job_id, "execution-failed", f"{type(exc).__name__}: {exc}")

    return {
        "ok": True,
        "jobId": job_id,
        "engine": parsed.engine,
        "text": parsed.text,
        "markdown": parsed.markdown,
        "pageCount": len(parsed.pages),
        "pages": [{"index": p.index, "text": p.text} for p in parsed.pages],
        "warnings": list(parsed.warnings),
    }


def engine_health() -> Dict[str, Any]:
    """Per-engine availability, surfaced through the runtime's `health` method."""
    return device.engine_availability()
