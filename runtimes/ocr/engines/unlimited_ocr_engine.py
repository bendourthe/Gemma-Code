"""
v1.16.0 Phase 3 (adoption item A5) -- Baidu Unlimited-OCR (CUDA VLM) engine.

The quality half of the pair: a 3B vision-language model that parses a whole
multi-page document in one pass and preserves layout as markdown. MIT-licensed,
CUDA-first (the publisher documents NVIDIA only), and the single place in Nexus
that executes model-supplied Python.

Supply-chain posture -- all three controls are load-bearing:

  1. **Pinned revision.** The catalog entry MUST carry a 40-hex
     ``source.revision``; ``validateSpec`` and the Python puller both refuse a
     ``trustRemoteCode`` entry without one. The weights on disk are therefore a
     specific commit, not whatever ``main`` points at today.
  2. **Local files only.** The loader runs with ``local_files_only=True`` against
     the registry directory, so loading can never silently re-fetch code from the
     network at inference time.
  3. **Sandboxed process.** ``trust_remote_code`` executes only here, inside the
     Python runtime the Tauri shell spawns -- never in the Node sidecar and never
     in the renderer.

A bounded generation window (``max_length``) is enforced so a hostile or
pathological document cannot drive an unbounded decode.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from ..documents import DocumentError, load_pages
from .base import ParsedDocument, ParsedPage, ProgressFn

MODEL_DIR_NAME = "unlimited-ocr-3b"

#: The publisher's documented decode ceiling for the 32K-context model.
DEFAULT_MAX_LENGTH = 32768

#: The publisher's two documented inference presets. `gundam` crops a page into
#: tiles (better on dense text), `base` reads the page whole.
INFER_CONFIGS = ("gundam", "base")
DEFAULT_INFER_CONFIG = "gundam"


def default_models_root() -> Path:
    override = os.environ.get("NEXUS_MODELS_ROOT")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".nexus" / "models"


def resolve_model_dir(model_dir: Optional[str] = None) -> Path:
    if model_dir:
        return Path(model_dir).expanduser()
    return default_models_root() / "weights" / MODEL_DIR_NAME


class UnlimitedOcrEngine:
    """Whole-document parsing via the model's own `infer_multi`."""

    name = "unlimited-ocr"

    def __init__(
        self,
        model_dir: Path,
        *,
        max_length: int = DEFAULT_MAX_LENGTH,
        infer_config: str = DEFAULT_INFER_CONFIG,
    ) -> None:
        self._model_dir = model_dir
        self._max_length = max_length
        self._infer_config = (
            infer_config if infer_config in INFER_CONFIGS else DEFAULT_INFER_CONFIG
        )
        self._model = None
        self._tokenizer = None

    def _load(self) -> None:
        if self._model is not None:
            return
        if not self._model_dir.is_dir():
            raise DocumentError(
                "model-not-installed",
                (
                    "the Unlimited-OCR document model is not installed. "
                    "Install it from Settings > Models, or use the RapidOCR "
                    "document model on a host without an NVIDIA GPU."
                ),
            )
        try:
            import torch  # type: ignore[import-not-found]
            from transformers import (  # type: ignore[import-not-found]
                AutoModel,
                AutoTokenizer,
            )
        except Exception as exc:
            raise DocumentError(
                "engine-unavailable",
                f"PyTorch/transformers are not installed: {exc}",
            ) from exc

        if not (getattr(torch, "cuda", None) and torch.cuda.is_available()):
            raise DocumentError(
                "unavailable-on-host",
                (
                    "Unlimited-OCR requires an NVIDIA GPU with CUDA. "
                    "Use the RapidOCR document model on this host."
                ),
            )

        try:  # pragma: no cover - requires real weights + CUDA
            # trust_remote_code is REQUIRED by this model and is confined to this
            # sandboxed process. local_files_only pins us to the already-verified,
            # revision-pinned files on disk.
            self._tokenizer = AutoTokenizer.from_pretrained(
                str(self._model_dir), trust_remote_code=True, local_files_only=True
            )
            self._model = AutoModel.from_pretrained(
                str(self._model_dir),
                trust_remote_code=True,
                local_files_only=True,
                torch_dtype=torch.bfloat16,
            ).eval()
        except Exception as exc:
            raise DocumentError(
                "execution-failed", f"could not load Unlimited-OCR: {exc}"
            ) from exc

    def parse(
        self,
        document_base64: str,
        *,
        dpi: Optional[int] = None,
        max_pages: int = 200,
        progress: Optional[ProgressFn] = None,
    ) -> ParsedDocument:
        # Rasterize first: this validates the payload and bounds the page count
        # BEFORE a multi-GB model is pulled into VRAM.
        pages = load_pages(document_base64, dpi=dpi, max_pages=max_pages)
        self._load()

        total = len(pages)
        if progress is not None:
            progress(0, total)

        try:  # pragma: no cover - requires real weights + CUDA
            images = [page.png for page in pages]
            raw = self._model.infer_multi(  # type: ignore[union-attr]
                self._tokenizer,
                images,
                config=self._infer_config,
                max_length=self._max_length,
            )
        except Exception as exc:
            raise DocumentError(
                "execution-failed", f"Unlimited-OCR inference failed: {exc}"
            ) from exc

        parsed = _split_pages(raw, total)
        if progress is not None:
            progress(total, total)
        markdown = raw if isinstance(raw, str) else None
        return ParsedDocument(
            pages=tuple(parsed), engine=self.name, markdown=markdown
        )


def _split_pages(raw: object, total: int) -> list[ParsedPage]:
    """Normalize `infer_multi` output into per-page records.

    The model may return one markdown blob for the whole document or a per-page
    list. A single blob is attributed to page 0 rather than being split on a
    guessed delimiter -- inventing page boundaries would be worse than admitting
    we only have document-level output.
    """
    if isinstance(raw, (list, tuple)):
        return [
            ParsedPage(index=i, text=str(item).strip())
            for i, item in enumerate(raw[:total])
        ]
    text = str(raw).strip() if raw is not None else ""
    return [ParsedPage(index=0, text=text)]


def build_unlimited_ocr_engine(model_dir: Optional[str] = None) -> UnlimitedOcrEngine:
    return UnlimitedOcrEngine(resolve_model_dir(model_dir))
