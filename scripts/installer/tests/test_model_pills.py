"""v2.2.9 Phase 5 (T010) -- golden name-row pill strings (WN-7 dual-assert).

The installer's ``derive_fact_pills`` and the desktop's ``buildModelPills``
(desktop/tests/modelPills.test.ts) must both reproduce the exact strings in
tests/fixtures/v2.2.9-model-pills.json, in order. A pill with a missing source
value is omitted -- never Unknown, never an invented Community.
"""

from __future__ import annotations

import json
from pathlib import Path

from PyQt5.QtWidgets import QLabel, QWidget

from nexus_installer.pages.typed_catalog import (
    build_fact_pills,
    derive_fact_pills,
    format_context_window_pill,
    format_released_pill,
    load_catalog_models,
    multimodal_pill_value,
)

FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "tests"
    / "fixtures"
    / "v2.2.9-model-pills.json"
)


def _positive(value: object) -> int:
    return int(value) if isinstance(value, (int, float)) and value > 0 else 0


def _pills_for_row(row: dict) -> list[str]:
    """Adapter: fixture row (DTO camelCase) -> derive_fact_pills kwargs."""
    tokens = (
        _positive(row.get("contextWindowIn"))
        or _positive(row.get("contextWindow"))
        or _positive(row.get("contextWindowOut"))
    )
    return derive_fact_pills(
        family=str(row.get("family") or ""),
        origin=str(row.get("origin") or ""),
        task=str(row.get("task") or ""),
        type_=str(row.get("type") or ""),
        agentic=bool(row.get("agentic")),
        context_tokens=tokens,
        modalities=[str(m) for m in row.get("modalities") or []],
        vision=row.get("vision"),
        uncensored=row.get("uncensored"),
        license_name=str(row.get("license") or ""),
        release_date=str(row.get("releaseDate") or ""),
    )


def test_golden_pill_strings_match_fixture() -> None:
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for case in data["cases"]:
        assert _pills_for_row(case["model"]) == case["expected"], case["name"]


def test_release_pill_is_ascii_en_us() -> None:
    assert format_released_pill("2025-01-15") == "Released: January 2025"
    assert format_released_pill("2026-12") == "Released: December 2026"
    assert format_released_pill("") is None
    assert format_released_pill("2026") is None
    assert format_released_pill("2026-13-01") is None
    pill = format_released_pill("2026-05-01")
    assert pill is not None and pill.isascii()


def test_context_window_pill_formats() -> None:
    assert format_context_window_pill(262144) == "Context window: 262k tokens"
    assert format_context_window_pill(2048) == "Context window: 2k tokens"
    assert format_context_window_pill(512) == "Context window: 512 tokens"
    assert format_context_window_pill(0) is None


def test_multimodal_pill_tri_state() -> None:
    assert multimodal_pill_value([], None) is None
    assert multimodal_pill_value(["text"], None) is False
    assert multimodal_pill_value(["text", "image"], None) is True
    assert multimodal_pill_value([], True) is True
    assert multimodal_pill_value([], False) is False


def test_never_renders_unknown_or_community(tmp_path: Path) -> None:
    entry = {
        "id": "mystery",
        "displayName": "Mystery",
        "type": "llm",
        "task": "chat",
        "family": "totally-new-lab",
        "sizeGB": 1.0,
        "requiredVramGB": 4,
    }
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps({"models": [entry]}), encoding="utf-8")
    model = load_catalog_models(path)[0]
    pills = build_fact_pills(model)
    assert pills == ["Agentic: No"]
    assert not any("Unknown" in p or "Community" in p for p in pills)


def test_card_renders_pills_on_the_name_row(qt_app, tmp_path: Path) -> None:
    """Name row = display name first, then the locked pill order (T010)."""
    from nexus_installer.pages.typed_catalog import _ModelCard

    entry = {
        "id": "gemma-4-12b-it-gguf",
        "displayName": "Gemma 4 12B",
        "type": "llm",
        "task": "chat",
        "family": "gemma4",
        "origin": "USA",
        "agentic": True,
        "sizeGB": 8.1,
        "requiredVramGB": 11,
        "contextWindow": 262144,
        "modalities": ["text", "image"],
        "vision": True,
        "uncensored": False,
        "license": "Gemma Terms of Use",
        "releaseDate": "2026-05-01",
        "description": "Multimodal chat model.",
    }
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps({"models": [entry]}), encoding="utf-8")
    model = load_catalog_models(path)[0]
    card = _ModelCard(
        model,
        recommended=True,
        checked=True,
        host_vram_gb=16,
        host_ram_gb=32,
        gpu_vendor="nvidia",
    )
    header_widget = card.findChild(QWidget, "cardHeaderRow")
    assert header_widget is not None
    texts = [lbl.text() for lbl in header_widget.findChildren(QLabel)]
    assert texts == [
        "Gemma 4 12B",
        "Company: Google",
        "Country: USA",
        "Agentic: Yes",
        "Context window: 262k tokens",
        "Multimodal: Yes",
        "Guardrails: Censored",
        "License: Gemma Terms of Use",
        "Released: May 2026",
        "Recommended",
    ]
    assert header_widget.objectName() == "cardHeaderRow"
    assert not header_widget.autoFillBackground()
    assert "transparent" in header_widget.styleSheet()
    assert "#0a0d14" not in header_widget.styleSheet()
    flow = header_widget.layout()
    assert flow is not None and flow.hasHeightForWidth()
    assert flow.heightForWidth(360) > flow.heightForWidth(900)


def test_card_header_row_is_not_window_fill(qt_app, tmp_path: Path) -> None:
    """v2.3.1 Phase 3: name row sits on the card, not BG_WINDOW."""
    from nexus_installer.constants import BG_CARD, BG_WINDOW
    from nexus_installer.pages.typed_catalog import _ModelCard

    entry = {
        "id": "gemma-4-12b-it-gguf",
        "displayName": "Gemma 4 12B",
        "type": "llm",
        "task": "chat",
        "family": "gemma4",
        "sizeGB": 8.1,
        "requiredVramGB": 11,
    }
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps({"models": [entry]}), encoding="utf-8")
    card = _ModelCard(
        load_catalog_models(path)[0],
        recommended=True,
        checked=True,
        host_vram_gb=16,
        host_ram_gb=32,
        gpu_vendor="nvidia",
    )
    # The card is tinted with its provider color rather than the flat card fill.
    assert "rgba(" in card.styleSheet()
    assert BG_CARD not in card.styleSheet()
    header = card.findChild(QWidget, "cardHeaderRow")
    assert header is not None
    assert BG_WINDOW not in header.styleSheet()
    assert BG_WINDOW not in card.styleSheet()
