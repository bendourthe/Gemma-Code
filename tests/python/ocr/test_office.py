"""v1.20.0 Phase 2 -- native Office ingest without RapidOCR or Docling."""

from __future__ import annotations

import base64
import io
import zipfile

import pytest

from runtimes.ocr.parse import run_parse


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def mark_zip_encrypted(data: bytes) -> bytes:
    patched = bytearray(data)
    patched[6] |= 0x01
    central = patched.find(b"PK\x01\x02")
    if central != -1:
        patched[central + 8] |= 0x01
    return bytes(patched)


def call(request: dict, job_id: str = "job-1") -> tuple[dict, list[dict]]:
    events: list[dict] = []
    result = run_parse({"jobId": job_id, "request": request}, emit=events.append)
    return result, events


def make_docx(paragraphs: list[str] | None = None) -> bytes:
    docx = pytest.importorskip("docx")
    document = docx.Document()
    for text in paragraphs or ["Hello from Word"]:
        document.add_paragraph(text)
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def make_pptx(texts: list[str] | None = None) -> bytes:
    pptx = pytest.importorskip("pptx")
    presentation = pptx.Presentation()
    layout = presentation.slide_layouts[0]
    for text in texts or ["Hello from PowerPoint"]:
        slide = presentation.slides.add_slide(layout)
        box = slide.shapes.add_textbox(0, 0, 1_000_000, 500_000)
        box.text_frame.text = text
    buffer = io.BytesIO()
    presentation.save(buffer)
    return buffer.getvalue()


def make_xlsx(sheets: dict[str, list[list[object]]] | None = None) -> bytes:
    openpyxl = pytest.importorskip("openpyxl")
    workbook = openpyxl.Workbook()
    payload = sheets or {"Sheet": [["Name", "Qty"], ["Widget", 3]]}
    first = True
    for title, rows in payload.items():
        sheet = workbook.active if first else workbook.create_sheet(title)
        if first:
            sheet.title = title
            first = False
        for row in rows:
            sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    workbook.close()
    return buffer.getvalue()


class TestOfficeRoundTrip:
    def test_docx_parses_without_calling_ocr(self, monkeypatch: pytest.MonkeyPatch):
        from runtimes.ocr import parse as parse_mod

        def boom(*_args, **_kwargs):
            raise AssertionError("RapidOCR must not load for Office files")

        monkeypatch.setattr(parse_mod, "resolve_engine", boom)
        result, _events = call({"documentBase64": b64(make_docx(["Invoice 99"]))})
        assert result["ok"] is True
        assert result["engine"] == "docx"
        assert "Invoice 99" in result["text"]
        assert result["markdown"]
        assert "Invoice 99" in result["markdown"]

    def test_pptx_round_trips_slide_text(self, monkeypatch: pytest.MonkeyPatch):
        from runtimes.ocr import parse as parse_mod

        monkeypatch.setattr(
            parse_mod,
            "resolve_engine",
            lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("ocr")),
        )
        result, _events = call({"documentBase64": b64(make_pptx(["Quarterly review"]))})
        assert result["ok"] is True
        assert result["engine"] == "pptx"
        assert "Quarterly review" in result["text"]

    def test_xlsx_round_trips_sheet_cells(self, monkeypatch: pytest.MonkeyPatch):
        from runtimes.ocr import parse as parse_mod

        monkeypatch.setattr(
            parse_mod,
            "resolve_engine",
            lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("ocr")),
        )
        result, _events = call({"documentBase64": b64(make_xlsx())})
        assert result["ok"] is True
        assert result["engine"] == "xlsx"
        assert "Widget" in result["text"]
        assert "Qty" in (result["markdown"] or "")

    def test_xlsx_honours_max_sheets(self):
        result, _events = call(
            {
                "documentBase64": b64(
                    make_xlsx(
                        {
                            "One": [["a"]],
                            "Two": [["b"]],
                            "Three": [["c"]],
                        }
                    )
                ),
                "maxPages": 2,
            }
        )
        assert result["ok"] is True
        assert result["pageCount"] == 2

    def test_html_is_unsupported_media(self):
        result, _events = call(
            {"documentBase64": b64(b"<html><body>nope</body></html>"), "engine": "stub"}
        )
        assert result["ok"] is False
        assert result["error"] == "unsupported-media"

    def test_random_bytes_are_unsupported_media(self):
        result, _events = call({"documentBase64": b64(b"not-a-document"), "engine": "stub"})
        assert result["error"] == "unsupported-media"

    def test_filename_hint_cannot_override_png_magic(self):
        png = b"\x89PNG\r\n\x1a\n" + b"payload" * 4
        result, _events = call(
            {"documentBase64": b64(png), "filename": "notes.docx", "engine": "stub"}
        )
        assert result["ok"] is True
        assert result["engine"] == "stub"

    def test_corrupt_office_zip_fails_closed(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("word/document.xml", "not-xml-at-all <<<")
        result, _events = call({"documentBase64": b64(buffer.getvalue())})
        assert result["ok"] is False
        assert result["error"] == "unsupported-media"

    def test_encrypted_zip_flag_fails_closed(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("word/document.xml", "<w:document/>")
        result, _events = call({"documentBase64": b64(mark_zip_encrypted(buffer.getvalue()))})
        assert result["error"] == "unsupported-media"
        assert "encrypt" in result["message"].lower()

    def test_portable_requirements_do_not_list_torch(self):
        from pathlib import Path

        root = Path(__file__).resolve().parents[3]
        lines = [
            line.strip()
            for line in (root / "runtimes/ocr/requirements.txt").read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        packages = [line.split(">")[0].split("=")[0].split("<")[0].strip().lower() for line in lines]
        assert "torch" not in packages
        assert "torchvision" not in packages
        assert "docling" not in packages
        assert "python-docx" in packages
        assert "python-pptx" in packages
        assert "openpyxl" in packages

    def test_second_parse_does_not_leak_the_previous_workbook(self):
        first, _ = call({"documentBase64": b64(make_xlsx({"Alpha": [["secret"]]}))})
        second, _ = call({"documentBase64": b64(make_xlsx({"Beta": [["public"]]}))})
        assert first["ok"] and second["ok"]
        assert "secret" in first["text"]
        assert "secret" not in second["text"]
        assert "public" in second["text"]
