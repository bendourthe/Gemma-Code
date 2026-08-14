"""v1.16.0 Phase 3 (adoption item A5) -- payload decoding + PDF rasterization.

The security-relevant assertions are the bounds: an untrusted document must not
be able to turn a parse request into an out-of-memory event, so the byte cap,
the page cap, and the DPI clamp are all tested directly.
"""

from __future__ import annotations

import base64
import io

import pytest

from runtimes.ocr.documents import (
    DEFAULT_DPI,
    MAX_DOCUMENT_BYTES,
    MAX_DPI,
    MIN_DPI,
    DocumentError,
    clamp_dpi,
    decode_payload,
    load_pages,
    looks_like_pdf,
)

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"payload" * 4


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def make_pdf(pages: int = 3) -> bytes:
    """Build a real multi-page PDF in memory with pypdfium2."""
    pypdfium2 = pytest.importorskip("pypdfium2")
    pdf = pypdfium2.PdfDocument.new()
    for _ in range(pages):
        pdf.new_page(200, 200)
    buffer = io.BytesIO()
    pdf.save(buffer)
    return buffer.getvalue()


class TestDecodePayload:
    def test_decodes_bare_base64(self):
        assert decode_payload(b64(PNG_BYTES)) == PNG_BYTES

    def test_strips_a_data_url_prefix(self):
        assert decode_payload(f"data:image/png;base64,{b64(PNG_BYTES)}") == PNG_BYTES

    def test_tolerates_surrounding_whitespace(self):
        assert decode_payload(f"  {b64(PNG_BYTES)}  ") == PNG_BYTES

    @pytest.mark.parametrize("value", ["", "   ", None, 42])
    def test_rejects_a_missing_payload(self, value):
        with pytest.raises(DocumentError) as excinfo:
            decode_payload(value)  # type: ignore[arg-type]
        assert excinfo.value.code == "invalid-params"

    def test_rejects_non_base64(self):
        with pytest.raises(DocumentError) as excinfo:
            decode_payload("!!!not base64!!!")
        assert excinfo.value.code == "invalid-params"

    def test_rejects_a_malformed_data_url(self):
        with pytest.raises(DocumentError) as excinfo:
            decode_payload("data:image/png;base64")
        assert excinfo.value.code == "invalid-params"

    def test_rejects_an_empty_decode(self):
        with pytest.raises(DocumentError) as excinfo:
            decode_payload(b64(b""))
        assert excinfo.value.code == "invalid-params"

    def test_rejects_an_oversized_document(self):
        oversized = b64(b"x" * (MAX_DOCUMENT_BYTES + 1))
        with pytest.raises(DocumentError) as excinfo:
            decode_payload(oversized)
        assert excinfo.value.code == "document-too-large"


class TestSniffing:
    def test_detects_a_pdf_by_magic_not_by_mime(self):
        assert looks_like_pdf(b"%PDF-1.7 ...") is True

    def test_a_png_is_not_a_pdf(self):
        assert looks_like_pdf(PNG_BYTES) is False


class TestClampDpi:
    def test_defaults_when_unset(self):
        assert clamp_dpi(None) == DEFAULT_DPI

    def test_clamps_below_and_above(self):
        assert clamp_dpi(1) == MIN_DPI
        assert clamp_dpi(100_000) == MAX_DPI

    def test_passes_a_sane_value_through(self):
        assert clamp_dpi(150) == 150

    def test_rejects_a_non_integer(self):
        with pytest.raises(DocumentError):
            clamp_dpi("300")  # type: ignore[arg-type]


class TestLoadPages:
    def test_a_non_pdf_becomes_one_passthrough_page(self):
        pages = load_pages(b64(PNG_BYTES))
        assert len(pages) == 1
        assert pages[0].index == 0
        # Passed through untouched -- re-encoding would only lose fidelity.
        assert pages[0].png == PNG_BYTES

    def test_renders_every_pdf_page_to_png(self):
        pages = load_pages(b64(make_pdf(3)), dpi=100)
        assert len(pages) == 3
        assert [p.index for p in pages] == [0, 1, 2]
        assert all(p.png[:4] == b"\x89PNG" for p in pages)

    def test_caps_the_page_count(self):
        assert len(load_pages(b64(make_pdf(5)), dpi=72, max_pages=2)) == 2

    def test_a_zero_max_pages_still_renders_one(self):
        assert len(load_pages(b64(make_pdf(3)), dpi=72, max_pages=0)) == 1

    def test_higher_dpi_produces_more_pixels(self):
        small = load_pages(b64(make_pdf(1)), dpi=72)[0]
        large = load_pages(b64(make_pdf(1)), dpi=200)[0]
        assert len(large.png) > len(small.png)

    def test_rejects_a_corrupt_pdf(self):
        corrupt = b64(b"%PDF-1.7 but not actually a pdf at all")
        with pytest.raises(DocumentError) as excinfo:
            load_pages(corrupt)
        assert excinfo.value.code == "unsupported-media"
