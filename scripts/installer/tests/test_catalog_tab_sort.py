"""v2.2.8 Phase 4 / v2.2.9 Phase 5 -- golden catalog sort dual-asserts.

The installer keeps pure ``collapse_and_sort`` order; Settings partitions
installed-and-ready (downloaded) rows first via ``downloaded_first``, each
partition keeping the installer order. Desktop ``visibleModelsOnTab`` asserts
the same fixtures in desktop/tests/catalogTabs.test.ts.
"""

from __future__ import annotations

import json
from pathlib import Path

from nexus_installer.catalog_tab_sort import (
    canonical_display_order,
    catalog_fingerprint,
    collapse_and_sort,
    downloaded_first,
)

_FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures"
FIXTURE_V228 = _FIXTURES / "v2.2.8-catalog-tab-sort.json"
FIXTURE_V229 = _FIXTURES / "v2.2.9-catalog-tab-sort.json"
FIXTURE_V241 = _FIXTURES / "v2.4.1-model-display-order.json"

# v2.2.9 Phase 5 (T010): embed maps to the Embeddings tab, not Chat.
TASK_TAB = {
    "chat": "chat",
    "embed": "embeddings",
    "agentic": "agentic",
    "image": "image",
    "video": "video",
    "audio": "audio",
    "document": "document",
}

TYPE_TAB = {
    "llm": "chat",
    "embed": "embeddings",
    "image": "image",
    "video": "video",
    "audio": "audio",
    "document": "document",
}


def _tabs_for(row: dict) -> list[str]:
    primary = TASK_TAB.get(str(row.get("task") or "")) or TYPE_TAB.get(
        str(row.get("type") or "")
    )
    if primary is None:
        return ["other"]
    if row.get("agentic") and primary == "chat":
        return ["chat", "agentic"]
    return [primary]


def _opts(data: dict) -> dict:
    return dict(
        host_vram_gb=data["hostVramGB"],
        gpu_vendor=data["gpuVendor"],
        defaults=set(data["defaults"]),
        recommend_order=list(data["recommendOrder"]),
    )


def test_golden_v228_catalog_tab_sort_matches_fixture() -> None:
    data = json.loads(FIXTURE_V228.read_text(encoding="utf-8"))
    models = data["models"]
    opts = _opts(data)
    for tab, expected in data["expectedIds"].items():
        rows = [m for m in models if tab in _tabs_for(m)]
        assert collapse_and_sort(rows, **opts) == expected


def test_golden_v229_installer_order_has_no_downloaded_boost() -> None:
    data = json.loads(FIXTURE_V229.read_text(encoding="utf-8"))
    models = data["models"]
    opts = _opts(data)
    for tab, expected in data["expectedInstallerIds"].items():
        rows = [m for m in models if tab in _tabs_for(m)]
        assert collapse_and_sort(rows, **opts) == expected, tab


def test_golden_v229_settings_order_is_downloaded_first() -> None:
    data = json.loads(FIXTURE_V229.read_text(encoding="utf-8"))
    models = data["models"]
    opts = _opts(data)
    for tab, expected in data["expectedSettingsIds"].items():
        rows = [m for m in models if tab in _tabs_for(m)]
        assert downloaded_first(rows, **opts) == expected, tab


def test_v241_canonical_order_and_fingerprint() -> None:
    fixture = json.loads(FIXTURE_V241.read_text(encoding="utf-8"))
    assert (
        canonical_display_order(fixture["catalog"]["models"]) == fixture["expectedIds"]
    )
    assert catalog_fingerprint(fixture["catalog"]) == fixture["expectedFingerprint"]


def test_v241_incompatible_rows_sort_after_every_compatible_row() -> None:
    rows = [
        {
            "id": "new-required-over-budget",
            "displayName": "New Required",
            "task": "agentic",
            "tags": ["required"],
            "vramGB": 24,
            "releaseDate": "2026-08-01",
        },
        {
            "id": "older-compatible",
            "displayName": "Older Compatible",
            "task": "agentic",
            "tags": [],
            "vramGB": 8,
            "releaseDate": "2025-01-01",
        },
    ]
    assert canonical_display_order(rows, host_vram_gb=16) == [
        "older-compatible",
        "new-required-over-budget",
    ]


def test_gpt_oss_moves_up_within_the_downloaded_partition_once_installed() -> None:
    """Contract: downloaded gpt-oss ranks above LFM (installer rank wins)."""
    data = json.loads(FIXTURE_V229.read_text(encoding="utf-8"))
    models = [dict(m) for m in data["models"]]
    for row in models:
        if row["id"] == "gpt-oss:20b":
            row["installed"] = True
            row["source"] = "registry"
    opts = _opts(data)
    rows = [m for m in models if "agentic" in _tabs_for(m)]
    expected = data["expectedSettingsIdsAfterGptOssDownload"]["agentic"]
    assert downloaded_first(rows, **opts) == expected


def test_patient_tier_row_is_listed_on_both_orders() -> None:
    data = json.loads(FIXTURE_V229.read_text(encoding="utf-8"))
    for key in ("expectedInstallerIds", "expectedSettingsIds"):
        assert "inkling-small" in data[key]["agentic"]
        assert "inkling-small" in data[key]["chat"]
