"""
v1.16.0 Phase 3 (adoption item A5) -- RapidOCR (ONNX Runtime) engine.

The portable half of the document-OCR pair: detect-then-recognize over ONNX
Runtime, so it needs no GPU and runs identically on Windows, macOS (Intel and
Apple Silicon), and Linux. Apache-2.0 across both the ONNX weights
(``SWHL/RapidOCR``) and the Python package.

Model files come from the Nexus registry (``<models_root>/weights/rapidocr-ppocrv4/``)
rather than RapidOCR's bundled defaults, so the weights a user runs are the
pinned ones the catalog records and the app can manage them like any other model.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from ..documents import DocumentError, PageImage
from .base import PageByPageEngine

#: Registry directory name for the catalog entry (see `safe_dir_name`).
MODEL_DIR_NAME = "rapidocr-ppocrv4"
DET_MODEL_RELPATH = "PP-OCRv4/ch_PP-OCRv4_det_infer.onnx"
REC_MODEL_RELPATH = "PP-OCRv4/ch_PP-OCRv4_rec_infer.onnx"


def default_models_root() -> Path:
    """`~/.nexus/models`, honouring the sidecar's NEXUS_MODELS_ROOT override."""
    override = os.environ.get("NEXUS_MODELS_ROOT")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".nexus" / "models"


def resolve_model_dir(model_dir: Optional[str] = None) -> Path:
    if model_dir:
        return Path(model_dir).expanduser()
    return default_models_root() / "weights" / MODEL_DIR_NAME


class RapidOcrPageEngine:
    """Reads one page image with a lazily-constructed RapidOCR instance."""

    name = "rapidocr"

    def __init__(self, model_dir: Path) -> None:
        self._model_dir = model_dir
        self._reader = None

    def _build_reader(self):
        try:
            from rapidocr_onnxruntime import RapidOCR  # type: ignore[import-not-found]
        except Exception as exc:
            raise DocumentError(
                "engine-unavailable",
                f"rapidocr_onnxruntime is not installed: {exc}",
            ) from exc

        det = self._model_dir / DET_MODEL_RELPATH
        rec = self._model_dir / REC_MODEL_RELPATH
        missing = [str(p.name) for p in (det, rec) if not p.is_file()]
        if missing:
            raise DocumentError(
                "model-not-installed",
                (
                    "the RapidOCR document model is not installed "
                    f"(missing {', '.join(missing)}). Install it from "
                    "Settings > Models."
                ),
            )
        try:
            return RapidOCR(det_model_path=str(det), rec_model_path=str(rec))
        except Exception as exc:
            raise DocumentError(
                "engine-unavailable", f"could not initialize RapidOCR: {exc}"
            ) from exc

    def read_page(self, page: PageImage) -> str:
        if self._reader is None:
            self._reader = self._build_reader()
        try:
            # RapidOCR accepts encoded image bytes directly and returns
            # (results, elapsed); `results` is a list of [box, text, score].
            result, _elapsed = self._reader(page.png)
        except DocumentError:
            raise
        except Exception as exc:
            raise DocumentError(
                "execution-failed", f"RapidOCR failed on page {page.index + 1}: {exc}"
            ) from exc
        return _lines_to_text(result)


def _lines_to_text(result: object) -> str:
    """Flatten RapidOCR's [box, text, score] triples into page text.

    Returns an empty string for a blank page rather than raising: a page with no
    detected text is a legitimate outcome, not an error.
    """
    if not result:
        return ""
    lines: list[str] = []
    for entry in result:  # type: ignore[union-attr]
        if isinstance(entry, (list, tuple)) and len(entry) >= 2:
            text = entry[1]
            if isinstance(text, str) and text.strip():
                lines.append(text.strip())
    return "\n".join(lines)


def build_rapidocr_engine(model_dir: Optional[str] = None) -> PageByPageEngine:
    return PageByPageEngine(RapidOcrPageEngine(resolve_model_dir(model_dir)))
