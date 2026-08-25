"""v2.2.8 Phase 4 -- golden catalog sort matches desktop visibleModelsOnTab."""

from __future__ import annotations

import json
from pathlib import Path

from nexus_installer.catalog_tab_sort import collapse_and_sort

FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "tests"
    / "fixtures"
    / "v2.2.8-catalog-tab-sort.json"
)

TASK_TAB = {
    "chat": "chat",
    "embed": "chat",
    "agentic": "agentic",
    "image": "image",
    "video": "video",
    "audio": "audio",
    "document": "document",
}

TYPE_TAB = {
    "llm": "chat",
    "embed": "chat",
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


def test_golden_catalog_tab_sort_matches_fixture() -> None:
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    models = data["models"]
    opts = dict(
        host_vram_gb=data["hostVramGB"],
        gpu_vendor=data["gpuVendor"],
        defaults=set(data["defaults"]),
        recommend_order=list(data["recommendOrder"]),
    )
    for tab, expected in data["expectedIds"].items():
        rows = [m for m in models if tab in _tabs_for(m)]
        assert collapse_and_sort(rows, **opts) == expected
