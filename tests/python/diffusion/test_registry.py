"""Tests for the pipeline registry loader."""

from __future__ import annotations

import importlib
import sys
from typing import Any, Callable, Dict

from runtimes.diffusion import registry


def test_register_pipeline_handlers_loads_all_four_modes():
    handlers: Dict[str, Callable[[Any], Dict[str, Any]]] = {}
    registry.register_pipeline_handlers(handlers)
    for mode in ("txt2img", "img2img", "inpaint", "outpaint", "segment"):
        assert mode in handlers


def test_register_pipeline_handlers_falls_back_on_import_failure(monkeypatch):
    # Force one of the pipeline imports to raise; the registry should
    # install a fallback handler that surfaces the error envelope.
    original_import = importlib.import_module

    def fake_import(name, *args, **kwargs):
        if name == "runtimes.diffusion.pipelines.outpaint":
            raise ImportError("forced failure")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(registry.importlib, "import_module", fake_import)
    handlers: Dict[str, Callable[[Any], Dict[str, Any]]] = {}
    registry.register_pipeline_handlers(handlers)
    assert "outpaint" in handlers
    response = handlers["outpaint"]({})
    assert response["ok"] is False
    assert response["error"] == "pipeline-unavailable"
    assert "forced failure" in response["message"]
