"""Native DOCX parser (v1.20.0 Phase 2). python-docx, not Docling, no OCR."""

from __future__ import annotations

import io
from typing import Optional

from ..documents import MAX_PAGES, DocumentError, decode_payload
from .base import ParsedDocument, ParsedPage, ProgressFn
from .office_common import markdown_table, raise_office_open_error


class DocxEngine:
    name = "docx"

    def parse(
        self,
        document_base64: str,
        *,
        dpi: Optional[int] = None,
        max_pages: int = MAX_PAGES,
        progress: Optional[ProgressFn] = None,
    ) -> ParsedDocument:
        del dpi  # Word is not rasterized.
        data = decode_payload(document_base64)
        try:
            from docx import Document
            from docx.oxml.table import CT_Tbl
            from docx.oxml.text.paragraph import CT_P
            from docx.table import Table
            from docx.text.paragraph import Paragraph
        except Exception as exc:
            raise DocumentError(
                "engine-unavailable",
                f"python-docx is not installed: {exc}",
            ) from exc

        try:
            document = Document(io.BytesIO(data))
            capped = max(1, min(max_pages, MAX_PAGES))
            chunks: list[list[str]] = [[]]
            for child in document.element.body:
                if isinstance(child, CT_P):
                    paragraph = Paragraph(child, document)
                    rendered = _render_paragraph(paragraph)
                    if _heading_level(paragraph) == 1 and chunks[-1] and len(chunks) < capped:
                        chunks.append([])
                    if rendered:
                        chunks[-1].append(rendered)
                elif isinstance(child, CT_Tbl):
                    table = Table(child, document)
                    rendered = _render_table(table)
                    if rendered:
                        chunks[-1].append(rendered)

            pages_md = ["\n\n".join(part).strip() for part in chunks if any(part)][:capped]
            if not pages_md:
                pages_md = [""]

            pages: list[ParsedPage] = []
            for index, markdown in enumerate(pages_md):
                pages.append(ParsedPage(index=index, text=markdown))
                if progress is not None:
                    progress(index + 1, len(pages_md))

            joined = "\n\n".join(page.text for page in pages).strip()
            return ParsedDocument(
                pages=tuple(pages),
                engine=self.name,
                markdown=joined or None,
            )
        except DocumentError:
            raise
        except Exception as exc:
            raise_office_open_error("Word", exc)


def _heading_level(paragraph: object) -> Optional[int]:
    style = getattr(paragraph, "style", None)
    name = getattr(style, "name", None) if style is not None else None
    if not isinstance(name, str):
        return None
    if name.startswith("Heading"):
        tail = name.split()[-1]
        try:
            return int(tail)
        except ValueError:
            return 1
    return None


def _is_list_item(paragraph: object) -> bool:
    element = getattr(paragraph, "_p", None)
    p_pr = getattr(element, "pPr", None) if element is not None else None
    return p_pr is not None and getattr(p_pr, "numPr", None) is not None


def _render_paragraph(paragraph: object) -> str:
    text = getattr(paragraph, "text", "") or ""
    text = text.strip()
    if not text:
        return ""
    level = _heading_level(paragraph)
    if level is not None:
        return f"{'#' * min(level, 6)} {text}"
    if _is_list_item(paragraph):
        return f"- {text}"
    return text


def _render_table(table: object) -> str:
    rows: list[list[str]] = []
    for row in getattr(table, "rows", []):
        cells = [getattr(cell, "text", "") or "" for cell in getattr(row, "cells", [])]
        rows.append(cells)
    return markdown_table(rows)
