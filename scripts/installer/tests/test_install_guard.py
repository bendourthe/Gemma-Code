"""v1.1.0 Phase 14.8 -- tests for the final install-click disk guard."""

from __future__ import annotations

import pytest

from nexus_installer.engine.install_guard import evaluate_install_guard


class TestEvaluateInstallGuard:
    def test_passes_with_room(self) -> None:
        r = evaluate_install_guard(free_disk_gb=100, selection_gb=45, reserve_gb=10)
        assert r.ok is True
        assert r.message == "ok"

    def test_boundary_passes(self) -> None:
        r = evaluate_install_guard(free_disk_gb=100, selection_gb=90, reserve_gb=10)
        # 90 + 10 == 100 -> exactly on the boundary; allow.
        assert r.ok is True

    def test_blocks_below_reserve(self) -> None:
        r = evaluate_install_guard(free_disk_gb=50, selection_gb=45, reserve_gb=10)
        assert r.ok is False
        assert "Insufficient disk space" in r.message
        assert "need 55.0" in r.message
        assert "have 50.0" in r.message

    def test_zero_free_disk_blocked(self) -> None:
        r = evaluate_install_guard(free_disk_gb=0, selection_gb=10, reserve_gb=10)
        assert r.ok is False
        assert "Could not read free disk space" in r.message

    @pytest.mark.parametrize(
        ("free", "sel", "reserve", "expected_ok"),
        [
            (90, 80, 10, True),  # exact boundary
            (90, 81, 10, False),  # 81 + 10 = 91 > 90
            (100, 0, 10, True),
            (5, 0, 10, False),  # reserve alone exceeds free
        ],
    )
    def test_matrix(
        self, free: float, sel: float, reserve: float, expected_ok: bool
    ) -> None:
        r = evaluate_install_guard(
            free_disk_gb=free, selection_gb=sel, reserve_gb=reserve
        )
        assert r.ok is expected_ok


class TestPendingDownloadSizing:
    """v2.4.5 Phase 4 (T017) -- the guard must size the REMAINING download.

    Field reproduction: `Insufficient disk space (need 204.4 GB free, have
    201.0 GB)` on a host holding 176 GB of the selected models. The guard was
    handed the whole selection because nothing knew what was already present.
    """

    def _state(self, *, selected_gb, downloaded_gb=0.0, pending_gb=0.0, populated=True):
        from nexus_installer.engine.installed_models import InstalledReport
        from nexus_installer.installer_state import InstallerState

        state = InstallerState()
        state.selected_models_gb = selected_gb
        if populated:
            state.installed_report = InstalledReport(
                downloaded=frozenset({"present"}) if downloaded_gb else frozenset(),
                pending=frozenset({"absent"}) if pending_gb else frozenset(),
                downloaded_gb=downloaded_gb,
                pending_gb=pending_gb,
            )
        return state

    def test_pending_helper_returns_the_remaining_download(self) -> None:
        from nexus_installer.engine.installed_models import pending_download_gb

        state = self._state(selected_gb=194.4, downloaded_gb=176.4, pending_gb=18.0)
        assert pending_download_gb(state) == pytest.approx(18.0)

    def test_unpopulated_report_falls_back_to_the_full_selection(self) -> None:
        # Headless `--model` runs never open the picker. Unknown must read as
        # "assume nothing is present", never as "nothing to download".
        from nexus_installer.engine.installed_models import pending_download_gb

        state = self._state(selected_gb=194.4, populated=False)
        assert pending_download_gb(state) == pytest.approx(194.4)

    def test_field_case_passes_the_guard(self) -> None:
        """194.4 GB selected, 176.4 GB present, 201.0 GB free -> allowed."""
        from nexus_installer.engine.installed_models import pending_download_gb

        state = self._state(selected_gb=194.4, downloaded_gb=176.4, pending_gb=18.0)
        result = evaluate_install_guard(
            free_disk_gb=201.0,
            selection_gb=pending_download_gb(state),
            reserve_gb=10,
        )
        assert result.ok is True

    def test_the_same_selection_was_refused_before_the_fix(self) -> None:
        # The old behavior, pinned so a regression is unambiguous: sizing the
        # whole selection refuses this install.
        result = evaluate_install_guard(
            free_disk_gb=201.0, selection_gb=194.4, reserve_gb=10
        )
        assert result.ok is False
        assert "204.4 GB" in result.message

    def test_a_genuinely_oversized_new_selection_still_blocks(self) -> None:
        # The guard must not have been disabled: nothing downloaded, and more
        # requested than fits, still refuses.
        from nexus_installer.engine.installed_models import pending_download_gb

        state = self._state(selected_gb=500.0, downloaded_gb=0.0, pending_gb=500.0)
        result = evaluate_install_guard(
            free_disk_gb=201.0,
            selection_gb=pending_download_gb(state),
            reserve_gb=10,
        )
        assert result.ok is False

    def test_everything_downloaded_needs_only_the_reserve(self) -> None:
        from nexus_installer.engine.installed_models import pending_download_gb

        state = self._state(selected_gb=194.4, downloaded_gb=194.4, pending_gb=0.0)
        assert pending_download_gb(state) == pytest.approx(0.0)
        result = evaluate_install_guard(
            free_disk_gb=11.0,
            selection_gb=pending_download_gb(state),
            reserve_gb=10,
        )
        assert result.ok is True

    def test_can_select_model_does_not_charge_for_present_weights(self) -> None:
        # The picker and the guard must give one answer. Charging the full
        # selection here would refuse a model the guard would then allow.
        state = self._state(selected_gb=180.0, downloaded_gb=176.0, pending_gb=4.0)
        state.free_disk_gb = 30
        state.disk_reserve_gb = 10
        # Remaining = 30 - (180 - 176) - 10 = 16, comfortably over the reserve.
        assert state.can_select_model(10.0) is True

    def test_can_select_model_still_refuses_a_real_overflow(self) -> None:
        state = self._state(selected_gb=180.0, downloaded_gb=176.0, pending_gb=4.0)
        state.free_disk_gb = 30
        state.disk_reserve_gb = 10
        assert state.can_select_model(100.0) is False

    def test_unknown_disk_still_permits_selection(self) -> None:
        # Unchanged: a failed disk probe must not lock the user out; the final
        # Install-click guard re-checks.
        state = self._state(selected_gb=180.0, downloaded_gb=176.0, pending_gb=4.0)
        state.free_disk_gb = 0
        assert state.can_select_model(999.0) is True
