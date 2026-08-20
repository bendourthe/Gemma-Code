"""
v1.16.0 Phase 3 (adoption item A5) -- shared engine contract + orchestration.

`PageEngine` is the one interface both backends implement: given a page image,
return that page's text. `DocumentEngine` is the one interface the runtime calls:
given the whole payload, return the parsed document. RapidOCR is per-page (so it
runs through `PageByPageEngine`, which also gives free per-page progress);
Unlimited-OCR parses a whole document at once via its own `infer_multi`, so it
implements `DocumentEngine` directly.

`stub_engine()` mirrors `runtimes/diffusion/pipelines/base.py::stub_execute` --
a deterministic no-dependency backend so CI can exercise the JSON-RPC round trip,
the progress stream, and the error envelopes without torch, onnxruntime, or any
model weights.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional, Protocol

from ..documents import DocumentError, PageImage, load_pages

#: Called once per completed page so the runtime can emit a progress event.
ProgressFn = Callable[[int, int], None]


@dataclass(frozen=True)
class ParsedPage:
    index: int
    text: str


@dataclass(frozen=True)
class ParsedDocument:
    """The parse result the runtime serializes back to the sidecar."""

    pages: tuple[ParsedPage, ...]
    engine: str
    #: Layout-preserving markdown when the engine produces it; else None, and the
    #: caller falls back to the concatenated plain text.
    markdown: Optional[str] = None
    warnings: tuple[str, ...] = field(default_factory=tuple)

    @property
    def text(self) -> str:
        return "\n\n".join(page.text for page in self.pages).strip()


class PageEngine(Protocol):
    """A backend that reads one page image at a time."""

    name: str

    def read_page(self, page: PageImage) -> str: ...


class DocumentEngine(Protocol):
    """A backend that parses a whole payload."""

    name: str

    def parse(
        self,
        document_base64: str,
        *,
        dpi: Optional[int],
        max_pages: int,
        progress: Optional[ProgressFn],
    ) -> ParsedDocument: ...


class PageByPageEngine:
    """Adapt a `PageEngine` into a `DocumentEngine`.

    Owns rasterization and progress so a per-page backend implements exactly one
    method. Progress is reported after each page completes, which is the only
    honest moment -- a page is either read or it is not.
    """

    def __init__(self, engine: PageEngine) -> None:
        self._engine = engine
        self.name = engine.name

    def parse(
        self,
        document_base64: str,
        *,
        dpi: Optional[int] = None,
        max_pages: int = 200,
        progress: Optional[ProgressFn] = None,
    ) -> ParsedDocument:
        pages = load_pages(document_base64, dpi=dpi, max_pages=max_pages)
        total = len(pages)
        parsed: list[ParsedPage] = []
        for page in pages:
            text = self._engine.read_page(page)
            parsed.append(ParsedPage(index=page.index, text=text))
            if progress is not None:
                progress(page.index + 1, total)
        return ParsedDocument(pages=tuple(parsed), engine=self.name)


class _StubPageEngine:
    """Deterministic stand-in used by CI and by the in-memory runtime."""

    name = "stub"

    def read_page(self, page: PageImage) -> str:
        return f"[stub-ocr] page {page.index + 1} ({len(page.png)} bytes)"


def stub_engine() -> PageByPageEngine:
    """A dependency-free engine that still exercises the whole pipeline."""
    return PageByPageEngine(_StubPageEngine())


def resolve_engine(name: str, *, model_dir: Optional[str] = None) -> DocumentEngine:
    """Build the named engine, importing its dependencies lazily.

    Raises `DocumentError("engine-unavailable", ...)` rather than propagating an
    ImportError, so an incompatible host produces the plan's "cleanly
    unavailable with an explained state" result instead of a crash.
    """
    if name == "stub":
        return stub_engine()
    if name == "rapidocr":
        from .rapidocr_engine import build_rapidocr_engine

        return build_rapidocr_engine(model_dir=model_dir)
    if name == "unlimited-ocr":
        from .unlimited_ocr_engine import build_unlimited_ocr_engine

        return build_unlimited_ocr_engine(model_dir=model_dir)
    raise DocumentError("invalid-params", f"unknown OCR engine: {name!r}")


def resolve_office_engine(kind: str) -> DocumentEngine:
    """Native Office Open XML engines. No OCR weights, no torch.

    Imports are deferred so a host without python-docx still answers PDF/image
    parse, and a host without RapidOCR still parses Word/Excel/PowerPoint.
    """
    if kind == "docx":
        from .docx_engine import DocxEngine

        return DocxEngine()
    if kind == "pptx":
        from .pptx_engine import PptxEngine

        return PptxEngine()
    if kind == "xlsx":
        from .xlsx_engine import XlsxEngine

        return XlsxEngine()
    raise DocumentError("invalid-params", f"unknown Office kind: {kind!r}")
