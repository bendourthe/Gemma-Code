"""
v1.16.0 Phase 3 (adoption item A5) -- input decoding and PDF page rasterization.

Turns the sidecar's base64 payload into a list of page images both OCR engines
consume, and classifies Office Open XML so native parsers can run without
rasterization. PDF rendering uses **pypdfium2**: it ships PDFium in the wheel, so
there is no Poppler/system dependency to install per platform, and it is Apache-2.0 /
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
import io
import zipfile
from dataclasses import dataclass
from typing import Literal, Optional

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

# OOXML zip bombs: bound member count and declared uncompressed size before
# reading any zip entry. Copied in spirit from layout-engine zip limits, not
# from any vendor package.
MAX_ZIP_MEMBERS = 512
MAX_ZIP_UNCOMPRESSED = 64 * 1024 * 1024
MAX_ZIP_MEMBER_BYTES = 16 * 1024 * 1024

PDF_MAGIC = b"%PDF-"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
JPEG_MAGIC = b"\xff\xd8\xff"
GIF87_MAGIC = b"GIF87a"
GIF89_MAGIC = b"GIF89a"
BMP_MAGIC = b"BM"
TIFF_LE_MAGIC = b"II*\x00"
TIFF_BE_MAGIC = b"MM\x00*"
ZIP_MAGIC = b"PK"

DocumentKind = Literal["pdf", "image", "docx", "pptx", "xlsx", "unsupported"]
OFFICE_KINDS: tuple[str, ...] = ("docx", "pptx", "xlsx")


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


def looks_like_image(data: bytes) -> bool:
    """Sniff common raster magics. Caller MIME is ignored."""
    if data[:8] == PNG_MAGIC:
        return True
    if data[:3] == JPEG_MAGIC:
        return True
    if data[:6] in (GIF87_MAGIC, GIF89_MAGIC):
        return True
    if data[:2] == BMP_MAGIC:
        return True
    if data[:4] in (TIFF_LE_MAGIC, TIFF_BE_MAGIC):
        return True
    # WEBP: RIFF....WEBP
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return True
    return False


def _kind_from_filename(filename_hint: Optional[str]) -> Optional[DocumentKind]:
    if not filename_hint or not isinstance(filename_hint, str):
        return None
    lower = filename_hint.rsplit("/", 1)[-1].rsplit("\\", 1)[-1].lower()
    if lower.endswith(".pdf"):
        return "pdf"
    if lower.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff")):
        return "image"
    if lower.endswith(".docx"):
        return "docx"
    if lower.endswith(".pptx"):
        return "pptx"
    if lower.endswith(".xlsx"):
        return "xlsx"
    return None


def _zip_entry_names(data: bytes) -> list[str]:
    """List zip member names after bounding count and uncompressed size."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise DocumentError("unsupported-media", f"not a valid zip/OOXML package: {exc}") from exc
    except RuntimeError as exc:
        # Encrypted zip members surface here.
        raise DocumentError(
            "unsupported-media",
            f"encrypted or unreadable Office package: {exc}",
        ) from exc

    with archive:
        infos = archive.infolist()
        if len(infos) > MAX_ZIP_MEMBERS:
            raise DocumentError(
                "unsupported-media",
                f"zip has {len(infos)} entries, over the {MAX_ZIP_MEMBERS}-entry limit",
            )
        total = 0
        names: list[str] = []
        for info in infos:
            if info.flag_bits & 0x1:
                raise DocumentError(
                    "unsupported-media",
                    "encrypted Office package is not supported",
                )
            if info.file_size > MAX_ZIP_MEMBER_BYTES:
                raise DocumentError(
                    "unsupported-media",
                    f"zip member {info.filename!r} is {info.file_size} bytes, over the cap",
                )
            total += max(0, info.file_size)
            if total > MAX_ZIP_UNCOMPRESSED:
                raise DocumentError(
                    "unsupported-media",
                    "zip uncompressed size exceeds the document cap",
                )
            names.append(info.filename.replace("\\", "/"))
        return names


def _sniff_ooxml(data: bytes) -> DocumentKind:
    names = _zip_entry_names(data)
    lowered = [n.lower() for n in names]
    if any(n.endswith("word/document.xml") or n == "word/document.xml" for n in lowered):
        return "docx"
    if any(n.endswith("ppt/presentation.xml") or n == "ppt/presentation.xml" for n in lowered):
        return "pptx"
    if any(n.endswith("xl/workbook.xml") or n == "xl/workbook.xml" for n in lowered):
        return "xlsx"
    return "unsupported"


def sniff_bytes(data: bytes) -> DocumentKind:
    """Classify by magic / OOXML internals. Never consults a caller MIME."""
    if looks_like_pdf(data):
        return "pdf"
    if looks_like_image(data):
        return "image"
    # Legacy binary Office / encrypted OLE compound files (not OOXML zip).
    if data[:4] == b"\xd0\xcf\x11\xe0":
        raise DocumentError(
            "unsupported-media",
            "legacy or encrypted OLE Office files are not supported",
        )
    if data[:2] == ZIP_MAGIC:
        try:
            return _sniff_ooxml(data)
        except DocumentError:
            raise
        except Exception as exc:
            raise DocumentError("unsupported-media", f"could not inspect zip: {exc}") from exc
    return "unsupported"


def detect_kind(data: bytes, filename_hint: Optional[str] = None) -> DocumentKind:
    """pdf | image | docx | pptx | xlsx | unsupported.

    Magic always wins. A filename hint is used only when magic is
    ``unsupported`` and the bytes are still a zip (so a ``.docx`` name cannot
    turn a PNG into Word).
    """
    sniffed = sniff_bytes(data)
    if sniffed != "unsupported":
        return sniffed
    hinted = _kind_from_filename(filename_hint)
    if hinted in OFFICE_KINDS and data[:2] == ZIP_MAGIC:
        return hinted
    if hinted == "pdf" and looks_like_pdf(data):
        return "pdf"
    if hinted == "image" and looks_like_image(data):
        return "image"
    return "unsupported"


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

    A PDF becomes N rasterized pages; a raster image is passed through as one
    page. Office Open XML and unknown bytes are not rasterized -- those go
    through native parsers or fail as ``unsupported-media``.
    """
    data = decode_payload(document_base64)
    capped = max(1, min(max_pages, MAX_PAGES))
    kind = detect_kind(data)
    if kind == "pdf":
        return _render_pdf(data, clamp_dpi(dpi), capped)
    if kind == "image":
        return [PageImage(index=0, png=data)]
    raise DocumentError(
        "unsupported-media",
        f"cannot rasterize {kind} as page images; Office files use native parsers",
    )
