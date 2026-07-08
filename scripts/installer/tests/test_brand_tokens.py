"""Token-presence tests for the v1.9.0 glow layer (T202/T204).

Guards that the glow / signature-gradient / radial-background tokens the
constellation + floating-logo primitives depend on exist in the installer
palette with the guide's values.

Also covers the v1.9.0 UI-rework design foundations (Phase 1, T001/T002): the
type scale + weight tokens and the per-provider color palette + family map.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from nexus_installer import constants


def test_bg_deep_present() -> None:
    assert constants.BG_DEEP == "#010608"


def test_constellation_colors_present() -> None:
    assert constants.CONSTELLATION_LINK == "#38bdf8"
    assert constants.CONSTELLATION_NODE == "#7dd3fc"


def test_glow_rgba_and_blur_present() -> None:
    assert constants.GLOW_RGBA == (56, 189, 248, 128)
    assert constants.GLOW_BLUR_SMALL == 8
    assert constants.GLOW_BLUR_MEDIUM == 16
    assert constants.GLOW_BLUR_LARGE == 24


def test_signature_gradient_stops() -> None:
    stops = constants.SIGNATURE_GRADIENT_STOPS
    assert len(stops) == 3
    positions = [p for p, _ in stops]
    assert positions == [0.0, 0.5, 1.0]
    assert stops[0][1] == "#3b82f6"
    assert stops[-1][1] == "#22d3ee"


def test_radial_glow_pools() -> None:
    pools = constants.RADIAL_GLOW_POOLS
    assert len(pools) == 2
    for rgb, alpha in pools:
        assert len(rgb) == 3
        assert 0.0 < alpha < 1.0


# ---------------------------------------------------------------------------
# v1.9.0 UI-rework foundations (Phase 1, T001): type scale
# ---------------------------------------------------------------------------
def test_type_scale_strictly_descending_and_floored() -> None:
    scale = constants.TYPE_SCALE
    # strictly descending (no equal-or-larger neighbour)
    assert list(scale) == sorted(scale, reverse=True)
    assert len(set(scale)) == len(scale)
    # hard 14px floor -- retires the old 8pt/11pt lows
    assert min(scale) >= 14


def test_type_scale_matches_named_tokens() -> None:
    assert constants.TYPE_SCALE == (
        constants.FS_DISPLAY,
        constants.FS_H1,
        constants.FS_H2,
        constants.FS_H3,
        constants.FS_BODY,
        constants.FS_CAPTION,
    )
    # emphasis is a weight, not a larger size
    assert constants.FS_BODY_STRONG == constants.FS_BODY


def test_font_weight_tokens_ascending() -> None:
    assert (
        constants.FW_REGULAR
        < constants.FW_MEDIUM
        < constants.FW_SEMIBOLD
        < constants.FW_BOLD
    )


# ---------------------------------------------------------------------------
# v1.9.0 UI-rework foundations (Phase 1, T002): provider palette
# ---------------------------------------------------------------------------
def _catalog_families() -> set[str]:
    """Distinct `family` values in the shared catalog (repo-relative walk)."""
    root = Path(__file__).resolve()
    for parent in root.parents:
        candidate = parent / "core" / "registry" / "catalog.json"
        if candidate.exists():
            data = json.loads(candidate.read_text(encoding="utf-8"))
            return {m.get("family") for m in data["models"] if m.get("family")}
    pytest.skip("core/registry/catalog.json not found from the test tree")


def test_provider_palette_has_neutral_fallback() -> None:
    assert constants.PROVIDER_FALLBACK == "#94a3b8"
    assert constants.PROVIDER_COLORS["Community"] == constants.PROVIDER_FALLBACK
    for color in constants.PROVIDER_COLORS.values():
        assert color.startswith("#") and len(color) == 7


def test_every_catalog_family_maps_to_a_provider_color() -> None:
    families = _catalog_families()
    assert families, "catalog should list at least one family"
    for family in families:
        publisher = constants.publisher_for_family(family)
        assert publisher in constants.PROVIDER_COLORS, (
            f"{family} -> {publisher} missing from PROVIDER_COLORS"
        )
        color = constants.provider_color(family)
        assert color.startswith("#") and len(color) == 7


def test_unknown_family_falls_back_to_community_slate() -> None:
    assert constants.publisher_for_family("no-such-family") == "Community"
    assert constants.provider_color("no-such-family") == constants.PROVIDER_FALLBACK
