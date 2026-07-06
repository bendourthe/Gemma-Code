"""Token-presence tests for the v1.9.0 glow layer (T202/T204).

Guards that the glow / signature-gradient / radial-background tokens the
constellation + floating-logo primitives depend on exist in the installer
palette with the guide's values.
"""

from __future__ import annotations

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
