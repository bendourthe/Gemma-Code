"""
v1.16.0 Phase 3 (adoption item A5) -- input decoding and PDF page rasterization.

Turns the sidecar's base64 payload into a list of page images both engines
consume. PDF rendering uses **pypdfium2**: it ships PDFium in the wheel, so there
is no Poppler/system dependency to install per platform, and it is Apache-2.0 /
BSD rather than strong-copyleft -- both properties matter for a local-first app
that must work identically on Windows, macOS, and Linux.

Security posture: the input is an untrusted document. This module therefore
bounds what it will do with it -- a page cap, a byte cap, and a DPI cap -- so a
malicious or malformed PDF cannot turn a parse request into an out-of-memory
event. It never writes the payload to disk.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from typing import Optional

#: Rasterization DPI. 200 is the sweet spot for OCR accuracy vs. pixel count;
#: the VLM engine's own pipeline is documented around 1024px on the long edge,
#: which a US-Letter page at 200 DPI comfortably exceeds.
DEFAULT_DPI = 200
MIN_DPI = 72
MAX_DPI = 400

#: Hard caps. A parse request is user-initiated and interactive, so these are
#: about protecting the host, not about licensing throughput.
MAX_PAGES = 200
MAX_DOCUMENT_BYTES = 64 * 1024 * 1024

PDF_MAGIC = b"%PDF-"


class DocumentError(ValueError):
    """The input could not be decoded into pages. Carries a stable code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class PageImage:
    """One rasterized page, as PNG bytes."""

    index: int
    png: bytes


def decode_payload(document_base64: str) -> bytes:
    """Decode the base64 payload, tolerating a `data:` URL prefix.

    The desktop composer produces `data:<mime>;base64,<payload>` while the agent
    tool passes bare base64; accepting both keeps one contract for callers.
    """
    if not isinstance(document_base64, str) or not document_base64.strip():
        raise DocumentError("invalid-params", "documentBase64 is required")
    raw = document_base64.strip()
    if raw.startswith("data:"):
        comma = raw.find(",")
        if comma == -1:
            raise DocumentError("invalid-params", "malformed data URL")
        raw = raw[comma + 1 :]
    try:
        data = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise DocumentError("invalid-params", f"documentBase64 is not valid base64: {exc}") from exc
    if not data:
        raise DocumentError("invalid-params", "documentBase64 decoded to zero bytes")
    if len(data) > MAX_DOCUMENT_BYTES:
        raise DocumentError(
            "document-too-large",
            f"document is {len(data)} bytes, over the {MAX_DOCUMENT_BYTES}-byte limit",
        )
    return data


def looks_like_pdf(data: bytes) -> bool:
    """Sniff the PDF magic rather than trusting a caller-supplied MIME type."""
    return data[:5] == PDF_MAGIC


def clamp_dpi(dpi: Optional[int]) -> int:
    if dpi is None:
        return DEFAULT_DPI
    if not isinstance(dpi, int):
        raise DocumentError("invalid-params", "dpi must be an integer")
    return max(MIN_DPI, min(MAX_DPI, dpi))


def _render_pdf(data: bytes, dpi: int, max_pages: int) -> list[PageImage]:
    """Rasterize PDF pages to PNG via pypdfium2. Imported lazily."""
    try:
        import pypdfium2  # type: ignore[import-not-found]
    except Exception as exc:  # pragma: no cover - exercised only without the dep
        raise DocumentError(
            "engine-unavailable",
            f"pypdfium2 is not installed, so PDFs cannot be rendered: {exc}",
        ) from exc

    try:
        pdf = pypdfium2.PdfDocument(data)
    except Exception as exc:
        raise DocumentError("unsupported-media", f"could not open PDF: {exc}") from exc

    try:
        total = len(pdf)
        if total == 0:
            raise DocumentError("unsupported-media", "PDF has no pages")
        count = min(total, max_pages)
        # pypdfium2 renders at a scale factor relative to 72 DPI.
        scale = dpi / 72.0
        pages: list[PageImage] = []
        for index in range(count):
            page = pdf[index]
            try:
                bitmap = page.render(scale=scale)
                image = bitmap.to_pil()
                try:
                    pages.append(PageImage(index=index, png=_pil_to_png(image)))
                finally:
                    image.close()
            finally:
                page.close()
        return pages
    finally:
        pdf.close()


def _pil_to_png(image) -> bytes:
    """Serialize a PIL image to PNG bytes in memory."""
    import io

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def load_pages(
    document_base64: str,
    *,
    dpi: Optional[int] = None,
    max_pages: int = MAX_PAGES,
) -> list[PageImage]:
    """Decode the payload into one or more page images.

    A PDF becomes N rasterized pages; anything else is treated as a single-page
    image and passed through untouched (the engines accept PNG/JPEG bytes, so
    re-encoding would only lose fidelity).
    """
    data = decode_payload(document_base64)
    capped = max(1, min(max_pages, MAX_PAGES))
    if looks_like_pdf(data):
        return _render_pdf(data, clamp_dpi(dpi), capped)
    return [PageImage(index=0, png=data)]
