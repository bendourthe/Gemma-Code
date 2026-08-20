"""Shared helpers for native Office Open XML engines (v1.20.0 Phase 2).

These wrap python-docx / python-pptx / openpyxl. They are not Docling.
"""

from __future__ import annotations

from typing import NoReturn

from ..documents import DocumentError


def raise_office_open_error(label: str, exc: BaseException) -> NoReturn:
    """Fail closed on corrupt or encrypted packages. Never crack a password."""
    message = str(exc).lower()
    if any(token in message for token in ("password", "encrypt", "drm", "encrypted")):
        raise DocumentError(
            "unsupported-media",
            f"{label} file is encrypted or password-protected",
        ) from exc
    raise DocumentError(
        "unsupported-media",
        f"could not open {label} file: {exc}",
    ) from exc


def markdown_table(rows: list[list[str]]) -> str:
    """Render a rectangular cell grid as GitHub-flavored markdown."""
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    normalized = [row + [""] * (width - len(row)) for row in rows]
    cleaned = [[_cell(value) for value in row] for row in normalized]
    header = cleaned[0]
    body = cleaned[1:] if len(cleaned) > 1 else []
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join("---" for _ in header) + " |",
    ]
    for row in body:
        lines.append("| " + " | ".join(row) + " |")
    if not body:
        lines.append("| " + " | ".join("" for _ in header) + " |")
    return "\n".join(lines)


def _cell(value: object) -> str:
    text = "" if value is None else str(value)
    return text.replace("|", "\\|").replace("\n", " ").strip()
