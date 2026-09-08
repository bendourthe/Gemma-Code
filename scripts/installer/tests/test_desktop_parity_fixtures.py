"""v2.4.8 Phase 4 (T017) -- desktop / installer parity fixtures.

Settings > Models in the desktop mirrors the installer picker: the same tab
order (``TYPE_TABS``) and the same provider card colors (``PROVIDER_COLORS``).
Operator screenshot 4 (2026-09-06) caught the tab order drifting (Document
last in the desktop, second in the installer). Both sides now assert against
one fixture each, so a change on either side without the fixture fails here or
in ``desktop/tests``.
"""

from __future__ import annotations

import json
from pathlib import Path

from nexus_installer.constants import (
    BADGE_DOWNLOADED,
    BADGE_RECOMMENDED,
    PROVIDER_COLORS,
    PROVIDER_FALLBACK,
)
from nexus_installer.pages.typed_catalog import TYPE_TABS

_FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures"
TAB_ORDER_FIXTURE = _FIXTURES / "v2.4.8-catalog-tab-order.json"
PROVIDER_COLORS_FIXTURE = _FIXTURES / "v2.4.8-provider-colors.json"


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_type_tabs_match_shared_tab_order_fixture() -> None:
    shared = _load(TAB_ORDER_FIXTURE)["tabs"]
    installer = [{"id": key, "label": label} for key, label, _icon in TYPE_TABS]
    assert installer == shared


def test_document_tab_sits_right_after_embeddings() -> None:
    ids = [key for key, _label, _icon in TYPE_TABS]
    assert ids[:2] == ["embeddings", "document"]


def test_provider_colors_match_shared_fixture() -> None:
    shared = _load(PROVIDER_COLORS_FIXTURE)
    assert shared["providers"] == PROVIDER_COLORS
    assert shared["fallback"] == PROVIDER_FALLBACK
    assert shared["badgeRecommended"] == BADGE_RECOMMENDED
    assert shared["badgeDownloaded"] == BADGE_DOWNLOADED
