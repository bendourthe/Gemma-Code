"""Display-only VRAM ceil helper (v2.4.2 Phase 6)."""

from __future__ import annotations

from nexus_installer.vram_display import display_vram_gb


class TestDisplayVramGb:
    def test_pins_16384_and_15360_to_sixteen(self) -> None:
        assert display_vram_gb(16384) == 16
        assert display_vram_gb(15360) == 16

    def test_eight_point_one_displays_nine(self) -> None:
        assert display_vram_gb(int(8.1 * 1024)) == 9

    def test_exact_eight_stays_eight(self) -> None:
        assert display_vram_gb(8192) == 8

    def test_unknown_is_zero(self) -> None:
        assert display_vram_gb(0) == 0
        assert display_vram_gb(-1) == 0
