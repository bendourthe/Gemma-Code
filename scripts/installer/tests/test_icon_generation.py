"""Icon alpha + rounding assertions for the brand icon generator (T204).

Covers two things:
  1. the generator's rounding helpers (superellipse mask preserves/creates
     transparency and never paints an opaque fill), and
  2. the committed brand icons the generator produced -- every checked frame
     must have transparent (rounded) corners and a non-opaque background, so a
     black-box regression cannot slip back in.

`scripts/desktop/generate-icons.py` has a hyphenated filename, so it is loaded
by path via importlib. Pillow is required (skip cleanly if it is absent).
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

Image = pytest.importorskip("PIL.Image", reason="Pillow required for icon tests")


def _repo_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "assets" / "nexus-ai-primary_no-background.png").is_file():
            return parent
    raise AssertionError("could not locate repo root from the test file")


ROOT = _repo_root()


def _load_generator():
    path = ROOT / "scripts" / "desktop" / "generate-icons.py"
    spec = importlib.util.spec_from_file_location("_nexus_icon_gen", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GEN = _load_generator()


def _corner_alphas(img) -> list[int]:
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    return [px[0, 0][3], px[w - 1, 0][3], px[0, h - 1][3], px[w - 1, h - 1][3]]


def _opaque_ratio(img) -> float:
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    step = max(1, w // 48)
    opaque = total = 0
    for x in range(0, w, step):
        for y in range(0, h, step):
            total += 1
            if px[x, y][3] == 255:
                opaque += 1
    return opaque / total


class TestSuperellipseMask:
    def test_mask_is_L_mode_and_sized(self) -> None:
        mask = GEN._superellipse_alpha_mask(64)
        assert mask.mode == "L"
        assert mask.size == (64, 64)

    def test_mask_center_opaque_corners_clear(self) -> None:
        mask = GEN._superellipse_alpha_mask(64)
        px = mask.load()
        assert px[32, 32] == 255  # center inside the squircle
        assert px[0, 0] == 0  # corner outside
        assert px[63, 63] == 0


class TestRenderSquareRounding:
    def test_rounding_clears_corners_of_opaque_source(self) -> None:
        # A fully opaque source becomes transparent-cornered when rounded.
        source = Image.new("RGBA", (256, 256), (34, 211, 238, 255))
        rounded = GEN.render_square(128, source, rounded=True)
        assert _corner_alphas(rounded) == [0, 0, 0, 0]
        # Center stays fully opaque -- rounding only removes corner alpha.
        px = rounded.load()
        assert px[64, 64][3] == 255
        # And it is not a solid opaque block anymore.
        assert _opaque_ratio(rounded) < 1.0

    def test_unrounded_preserves_full_alpha(self) -> None:
        source = Image.new("RGBA", (256, 256), (34, 211, 238, 255))
        flat = GEN.render_square(128, source, rounded=False)
        assert _corner_alphas(flat) == [255, 255, 255, 255]

    def test_never_composites_onto_opaque_fill(self) -> None:
        # A transparent source stays transparent (no black-box fill).
        source = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
        rendered = GEN.render_square(64, source, rounded=True)
        assert _opaque_ratio(rendered) == 0.0


class TestCommittedIcons:
    # The frames the generator wrote in this phase must be transparent+rounded.
    RELATIVE_PATHS = [
        "assets/icon.png",
        "assets/icon.ico",
        "desktop/src-tauri/icons/icon.png",
        "desktop/src-tauri/icons/128x128.png",
        "desktop/src-tauri/icons/icon.ico",
        "desktop/src-tauri/icons/StoreLogo.png",
    ]

    @pytest.mark.parametrize("rel", RELATIVE_PATHS)
    def test_corners_transparent(self, rel: str) -> None:
        img = Image.open(ROOT / rel)
        assert _corner_alphas(img) == [0, 0, 0, 0], f"{rel} has opaque corners"

    @pytest.mark.parametrize("rel", RELATIVE_PATHS)
    def test_background_not_opaque(self, rel: str) -> None:
        img = Image.open(ROOT / rel)
        assert _opaque_ratio(img) < 0.9, f"{rel} reads as a black box"
