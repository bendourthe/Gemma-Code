"""
v1.16.0 Phase 3 (adoption item A5) -- OCR handler registration.

Mirrors `runtimes/diffusion/registry.py`: the parse handler is registered here so
`main.py` stays short and the dispatcher is testable without importing any
engine. Unlike the diffusion runtime, engine imports are deferred all the way to
job execution (`resolve_engine` / `resolve_office_engine`), because the OCR
backends have disjoint and heavy dependency trees and Office parsers must not
import RapidOCR. Dispatch lives in `parse.run_parse` (magic-byte kind first).
"""

from __future__ import annotations

from typing import Any, Callable, Dict

from . import parse as parse_module

HandlerFn = Callable[[Any], Dict[str, Any]]


def register_ocr_handlers(handlers: Dict[str, HandlerFn]) -> None:
    """Register the OCR job methods on the dispatcher's handler table."""
    handlers["parse"] = lambda params: parse_module.run_parse(params or {})
