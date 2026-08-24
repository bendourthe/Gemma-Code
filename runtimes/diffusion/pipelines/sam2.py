"""SAM2 segmentation stub.

The real Hiera Tiny checkpoint is installer-provisioned. CI and missing-weights
hosts use this handler: no torch import, a 1x1 mask PNG, and a structured
weights_missing code so Image Studio can fall back to the painted-mask flow.
"""

from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Any, Callable, Dict, List

from . import workflow_metadata


def _weights_present(weights_dir: str | None) -> bool:
    if not weights_dir:
        return False
    root = Path(weights_dir)
    if not root.is_dir():
        return False
    for suffix in (".pt", ".pth", ".safetensors", ".bin"):
        if any(root.rglob(f"*{suffix}")):
            return True
    return False


def _ambiguous(phrase: str) -> bool:
    lowered = phrase.lower()
    return any(token in lowered for token in ("people", "them", "these", "those", "cars", "dogs"))


def segment(params: Dict[str, Any] | None) -> Dict[str, Any]:
    payload = params or {}
    weights_dir = payload.get("weightsDir") or os.environ.get("NEXUS_SAM2_WEIGHTS")
    stub = bool(payload.get("stub")) or os.environ.get("NEXUS_SAM2_STUB") == "1"
    if not stub and not _weights_present(str(weights_dir) if weights_dir else None):
        return {
            "ok": False,
            "code": "weights_missing",
            "message": (
                "SAM2 weights are not installed. Install sam2:hiera-tiny from "
                "Settings > Models, or paint a mask to continue."
            ),
        }
    hint = payload.get("hint") if isinstance(payload.get("hint"), dict) else {}
    phrase = str(payload.get("phrase") or hint.get("text") or "object")
    count = 2 if _ambiguous(phrase) else 1
    mask = base64.b64encode(workflow_metadata.minimal_png()).decode("ascii")
    candidates: List[Dict[str, Any]] = []
    for index in range(count):
        candidates.append(
            {
                "id": f"c{index}",
                "maskPngBase64": mask,
                "score": round(0.9 - index * 0.15, 2),
                "label": phrase,
            }
        )
    return {"ok": True, "candidates": candidates}


def register(handlers: Dict[str, Callable]) -> None:
    handlers["segment"] = lambda params: segment(params or {})
