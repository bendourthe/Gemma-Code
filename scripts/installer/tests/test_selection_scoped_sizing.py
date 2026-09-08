"""v2.4.7 Phase 1 (T004) -- sizes must describe the SELECTION, not the catalog.

Field reproduction (screenshot, 2026-09-06): the Review card claimed

    Models: 7 selected (7 already downloaded, 0 to download)
    Estimated disk usage: ~157 GB to download
                          233.2 GB already downloaded

Both cannot be true. The counts are computed per id against
`installed_report.is_downloaded`, so they are selection-scoped and correct.
The sizes were read straight off `installed_report.pending_gb` and
`downloaded_gb`, which are CATALOG-wide, because the picker deliberately
probes every catalog entry so each card can show a Downloaded pill.

`pending_download_gb` returned that same catalog-wide number, so the install
guard was demanding headroom for models the user never selected.

**Every fixture here uses a catalog strictly wider than the selection.** That
single property is what the v2.4.5 tests lacked: they always made the report
cover exactly the selection, so catalog-wide and selection-scoped values
coincided and the defect was invisible to a green suite.
"""

from __future__ import annotations

import pytest

from nexus_installer.engine.install_guard import evaluate_install_guard
from nexus_installer.engine.installed_models import (
    InstalledReport,
    pending_download_gb,
)
from nexus_installer.installer_state import InstallerState

#: Sizes of catalog models the user did NOT select. Large on purpose: if any
#: consumer reverts to the report's own totals, it shows up as a wild number
#: rather than a subtle one.
UNSELECTED_CATALOG_DOWNLOADED_GB = 215.2
UNSELECTED_CATALOG_PENDING_GB = 157.0


def _state(
    *,
    selected_gb: float,
    selection_pending_gb: float,
    selected_ids: list[str] | None = None,
    populated: bool = True,
) -> InstallerState:
    """A state whose report is catalog-wide and whose state field is scoped."""
    state = InstallerState()
    state.selected_models_gb = selected_gb
    state.selected_model_ids = selected_ids or ["picked-a", "picked-b"]
    if populated:
        # Keep the fixture internally coherent: when the selection has nothing
        # pending, every selected id must appear in `downloaded`, or the card's
        # per-id counts would contradict the sizes for a reason unrelated to
        # the defect under test.
        ids = state.selected_model_ids
        selected_downloaded = set(ids) if selection_pending_gb == 0 else set(ids[:1])
        state.installed_report = InstalledReport(
            downloaded=frozenset(selected_downloaded | {"unselected-big-one"}),
            pending=frozenset(
                set(ids) - selected_downloaded | {"unselected-missing-one"}
            ),
            downloaded_gb=selected_gb
            - selection_pending_gb
            + UNSELECTED_CATALOG_DOWNLOADED_GB,
            pending_gb=selection_pending_gb + UNSELECTED_CATALOG_PENDING_GB,
        )
        state.pending_models_gb = selection_pending_gb
    return state


class TestPendingDownloadGb:
    def test_returns_the_selection_scoped_figure_not_the_catalog_one(self) -> None:
        state = _state(selected_gb=194.4, selection_pending_gb=18.0)
        # The report's own pending_gb is 175.0 here; reading it would be the bug.
        assert state.installed_report.pending_gb == pytest.approx(175.0)
        assert pending_download_gb(state) == pytest.approx(18.0)

    def test_all_selected_models_already_present_is_zero(self) -> None:
        # The exact field shape: everything selected is on disk, while the
        # catalog still holds 157 GB of models the user did not pick.
        state = _state(selected_gb=233.2, selection_pending_gb=0.0)
        assert pending_download_gb(state) == pytest.approx(0.0)

    def test_unpopulated_report_still_falls_back_to_the_whole_selection(self) -> None:
        # Headless `--model` runs never open the picker, so nothing publishes
        # the scoped figure. Unknown must read as "assume nothing is present".
        state = _state(selected_gb=194.4, selection_pending_gb=0.0, populated=False)
        assert pending_download_gb(state) == pytest.approx(194.4)


class TestInstallGuard:
    def test_field_case_is_allowed(self) -> None:
        """7 selected, all present, 157 GB of OTHER catalog models missing."""
        state = _state(selected_gb=233.2, selection_pending_gb=0.0)
        result = evaluate_install_guard(
            free_disk_gb=201.7,
            selection_gb=pending_download_gb(state),
            reserve_gb=10,
        )
        assert result.ok is True

    def test_the_catalog_figure_refuses_a_host_the_truth_would_allow(self) -> None:
        """Pin the defect: the two numbers disagree about whether this fits.

        On the operator's host (201.7 GB free) the catalog-wide figure happened
        to fit, which is why the wizard reached Review at all. On a smaller
        host it refuses an install that downloads nothing -- the v2.4.5 defect
        wearing a different mask.
        """
        state = _state(selected_gb=233.2, selection_pending_gb=0.0)
        free_gb = 100.0
        truthful = evaluate_install_guard(
            free_disk_gb=free_gb,
            selection_gb=pending_download_gb(state),
            reserve_gb=10,
        )
        catalog_wide = evaluate_install_guard(
            free_disk_gb=free_gb,
            selection_gb=state.installed_report.pending_gb,
            reserve_gb=10,
        )
        assert truthful.ok is True
        assert catalog_wide.ok is False

    def test_partially_downloaded_selection_charges_only_the_gap(self) -> None:
        state = _state(selected_gb=194.4, selection_pending_gb=18.0)
        result = evaluate_install_guard(
            free_disk_gb=40.0,
            selection_gb=pending_download_gb(state),
            reserve_gb=10,
        )
        assert result.ok is True

    def test_a_genuinely_oversized_new_selection_still_blocks(self) -> None:
        # The guard must be fixed, not disabled: a wrong relaxation lets a real
        # out-of-space install start and fail partway through a 70 GB download.
        state = _state(selected_gb=500.0, selection_pending_gb=500.0)
        result = evaluate_install_guard(
            free_disk_gb=201.7,
            selection_gb=pending_download_gb(state),
            reserve_gb=10,
        )
        assert result.ok is False


class TestCanSelectModel:
    def test_credits_back_only_selected_downloaded_models(self) -> None:
        state = _state(selected_gb=180.0, selection_pending_gb=4.0)
        state.free_disk_gb = 30
        state.disk_reserve_gb = 10
        # Remaining = 30 - 4 pending - 10 asked = 16, over the reserve.
        assert state.can_select_model(10.0) is True

    def test_a_large_downloaded_catalog_does_not_offset_the_selection(self) -> None:
        # Before v2.4.7 this credited back the catalog-wide downloaded total,
        # so a well-stocked host would accept a selection of any size.
        state = _state(selected_gb=180.0, selection_pending_gb=180.0)
        state.free_disk_gb = 30
        state.disk_reserve_gb = 10
        assert state.can_select_model(100.0) is False

    def test_unknown_disk_still_permits_selection(self) -> None:
        # Unchanged: a failed disk probe must not lock the user out; the final
        # Install-click guard re-checks.
        state = _state(selected_gb=180.0, selection_pending_gb=180.0)
        state.free_disk_gb = 0
        assert state.can_select_model(999.0) is True


class TestReviewEstimate:
    def _summary(self, state: InstallerState) -> str:
        from nexus_installer.pages.review import ReviewPage

        page = ReviewPage(state)
        page._rebuild_summary()
        return page._summary_text()

    def test_all_downloaded_reads_as_overhead_only(self, qt_app) -> None:
        state = _state(
            selected_gb=233.2,
            selection_pending_gb=0.0,
            selected_ids=["picked-a", "picked-b"],
        )
        text = self._summary(state)
        # 0 pending + 2 GB venv/extension overhead.
        assert "REQUIRED DOWNLOAD: ~2 GB" in text
        # The catalog-wide figure must not appear anywhere on the card.
        assert "157" not in text
        assert "under 5 minutes" in text

    def test_counts_and_sizes_agree(self, qt_app) -> None:
        # The contradiction in the field screenshot, asserted directly: if the
        # card says nothing is left to download, the size must agree.
        state = _state(selected_gb=233.2, selection_pending_gb=0.0)
        text = self._summary(state)
        # v2.4.7 Phase 4.2: the counts render as a counter row, so assert the
        # zero pending count and the size agree rather than matching a
        # sentence that no longer exists.
        assert "TO DOWNLOAD" in text
        assert "REQUIRED DOWNLOAD: ~2 GB" in text
        assert "157" not in text

    def test_partially_downloaded_selection_states_both_figures(self, qt_app) -> None:
        state = _state(selected_gb=194.4, selection_pending_gb=18.0)
        text = self._summary(state)
        assert "REQUIRED DOWNLOAD: ~20 GB" in text  # 18 pending + 2 overhead
        assert "176.4 GB already downloaded" in text
