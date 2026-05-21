"""v1.1.0 Phase 14.5 -- tests for the disk-aware footer + state guard."""

from __future__ import annotations

import pytest

from nexus_installer.installer_state import InstallerState
from nexus_installer.widgets.disk_aware_footer import (
    DiskAwareFooter,
    format_disk_footer_text,
)


class TestCanSelectModel:
    def test_blocks_when_below_reserve(self) -> None:
        state = InstallerState()
        state.free_disk_gb = 90
        state.selected_models_gb = 60
        # 90 - 60 - 21 = 9 < 10 GB reserve -> blocked.
        assert state.can_select_model(21) is False

    def test_allows_when_above_reserve(self) -> None:
        state = InstallerState()
        state.free_disk_gb = 90
        state.selected_models_gb = 60
        # 90 - 60 - 20 = 10 == reserve -> allowed.
        assert state.can_select_model(20) is True

    def test_unknown_disk_returns_true(self) -> None:
        state = InstallerState()
        state.free_disk_gb = 0
        assert state.can_select_model(100) is True

    def test_custom_reserve(self) -> None:
        state = InstallerState()
        state.free_disk_gb = 100
        state.selected_models_gb = 40
        state.disk_reserve_gb = 30
        assert state.can_select_model(30) is True
        assert state.can_select_model(31) is False


class TestFormatDiskFooter:
    def test_small_selection(self) -> None:
        free_t, sel_t, rem_t, color = format_disk_footer_text(100, 5, 10)
        assert "100" in free_t
        assert "5" in sel_t
        assert "95.0" in rem_t

    def test_boundary_remains_green(self) -> None:
        _, _, _, color = format_disk_footer_text(100, 80, 10)
        # Remaining 20 == 2 * reserve -> still above warning threshold.
        assert color != "#ef4444"

    def test_below_reserve_is_red(self) -> None:
        _, _, _, color = format_disk_footer_text(100, 95, 10)
        assert color == "#ef4444"

    def test_unknown_disk_uses_secondary(self) -> None:
        _, _, _, color = format_disk_footer_text(0, 5, 10)
        assert color == "#6b7f96"


class TestDiskAwareFooter:
    def test_refresh_uses_state(self, qt_app) -> None:
        state = InstallerState()
        state.free_disk_gb = 200
        state.selected_models_gb = 50
        widget = DiskAwareFooter(state)
        text = widget._remaining_label.text()
        assert "150.0" in text

    def test_update_selection(self, qt_app) -> None:
        state = InstallerState()
        state.free_disk_gb = 100
        widget = DiskAwareFooter(state)
        widget.update_selection(25.5)
        assert state.selected_models_gb == pytest.approx(25.5)
        assert "25.5" in widget._selected_label.text()
