"""Tests for the Review page summary (facts card + model summary card)."""

from __future__ import annotations

import pytest

from nexus_installer.constants import ACCENT, SECTION_ACCENTS, TEXT_MUTED
from nexus_installer.engine.installed_models import InstalledReport
from nexus_installer.installer_state import InstallerState
from nexus_installer.pages.review import (
    _COMPONENT_LABELS,
    MARK_DOWNLOADED,
    MARK_PENDING,
    ReviewPage,
)


def _page(state: InstallerState) -> ReviewPage:
    page = ReviewPage(state)
    page._rebuild_summary()
    return page


def _state(downloaded=(), pending=(), downloaded_gb=0.0, pending_gb=0.0):
    state = InstallerState()
    state.selected_model_ids = list(downloaded) + list(pending)
    state.selected_models_gb = downloaded_gb + pending_gb
    # The report is CATALOG-wide, so it also covers models this selection does
    # not include and its sizes are deliberately far larger. Any consumer that
    # reads `report.pending_gb` as a selection size fails here rather than
    # passing because the two happened to coincide.
    state.installed_report = InstalledReport(
        downloaded=frozenset(downloaded) | {"other-catalog-model"},
        pending=frozenset(pending) | {"another-catalog-model"},
        downloaded_gb=downloaded_gb + 500.0,
        pending_gb=pending_gb + 500.0,
    )
    # The selection-scoped figure the picker publishes.
    state.pending_models_gb = pending_gb
    return state


class TestReviewSummary:
    def test_state_fields_populated(self) -> None:
        state = InstallerState()
        state.install_path = "/opt/nexus"
        state.selected_model = "gemma4:e4b"
        state.gpu_name = "NVIDIA RTX 4090"
        state.vram_mb = 24576
        state.components_to_install = ["extension", "ollama", "venv", "model"]
        assert state.install_path == "/opt/nexus"
        assert state.selected_model == "gemma4:e4b"
        assert len(state.components_to_install) == 4

    def test_desktop_component_has_friendly_label(self) -> None:
        assert _COMPONENT_LABELS["desktop"] == "Nexus Desktop app"
        state = InstallerState()
        assert "desktop" in state.components_to_install

    def test_multi_selection_summary(self, qt_app) -> None:
        state = InstallerState()
        state.selected_model_ids = ["gemma4:e4b", "juggernaut-xl-v9"]
        state.selected_models_gb = 9.6
        page = _page(state)
        text = page._summary_text()
        assert "SELECTED 2" in text
        assert page.display_name_for("gemma4:e4b") in text
        assert page.display_name_for("juggernaut-xl-v9") in text
        # With no installed-report the page assumes nothing is downloaded, so
        # the estimate is the whole selection plus the 2 GB venv overhead.
        assert page._tiles["download"].value == "~12 GB"

    def test_models_group_by_catalog_section(self, qt_app) -> None:
        state = InstallerState()
        state.selected_model_ids = ["gemma4:e4b", "juggernaut-xl-v9"]
        page = _page(state)
        cells = page._category_cells
        assert [cell.heading for cell in cells] == ["Chat", "Image"]
        chat, image = cells
        # Models render by display name, never by their catalog id.
        chat_name = page.display_name_for("gemma4:e4b")
        image_name = page.display_name_for("juggernaut-xl-v9")
        assert chat_name != "gemma4:e4b" and image_name != "juggernaut-xl-v9"
        assert chat_name in chat.names_text()
        assert image_name not in chat.names_text()
        assert image_name in image.names_text()
        assert chat_name not in image.names_text()
        # Chat lives in the first column, Image in the second.
        assert (chat.column, image.column) == (0, 1)
        # Each pill carries its category accent.
        assert SECTION_ACCENTS["chat"] in chat.pill.styleSheet()
        assert SECTION_ACCENTS["image"] in image.pill.styleSheet()

    def test_single_model_fallback_summary(self, qt_app) -> None:
        # A lone `selected_model` (a headless --model override) still renders.
        state = InstallerState()
        state.selected_model = "gemma4:e4b"
        page = _page(state)
        assert page._fallback_label.isVisibleTo(page)
        assert "gemma4:e4b" in page._fallback_label.text()
        assert page._gauges["selected"].value == 1
        assert page._category_cells == []

    def test_empty_selection_summary(self, qt_app) -> None:
        state = InstallerState()
        state.selected_model = ""
        page = _page(state)
        assert "none selected" in page._fallback_label.text()
        assert page._gauges["selected"].value == 0
        assert page._tiles["download"].value == "~2 GB"

    def test_unavailable_extension_is_not_queued_in_summary(self, qt_app) -> None:
        state = InstallerState()
        state.components_to_install = [
            component
            for component in state.components_to_install
            if component != "extension"
        ]
        page = _page(state)
        assert _COMPONENT_LABELS["extension"] not in page._summary_text()


class TestReviewDownloadedMarks:
    """Per-model marks, the pending-only estimate, and the gauges."""

    def test_downloaded_and_pending_carry_different_marks(self, qt_app) -> None:
        state = _state(
            downloaded=["already-here"],
            pending=["needs-fetch"],
            downloaded_gb=70.0,
            pending_gb=18.0,
        )
        page = _page(state)
        # Unknown ids fall into the Other bucket, in one cell.
        (cell,) = page._category_cells
        assert cell.heading == "Other"
        names = cell.names_text()
        assert f"{MARK_DOWNLOADED}</span> already-here" in names
        assert f"{MARK_PENDING}</span> needs-fetch" in names

    def test_legend_shows_only_when_something_is_pending(self, qt_app) -> None:
        pending = _page(_state(downloaded=["x"], pending=["y"], pending_gb=2.0))
        assert pending._legend.isVisibleTo(pending)
        assert "already downloaded" in pending._legend.text()
        assert "to download" in pending._legend.text()
        ready = _page(_state(downloaded=["x", "y"], downloaded_gb=4.0))
        assert not ready._legend.isVisibleTo(ready)

    def test_estimate_counts_pending_only(self, qt_app) -> None:
        # 176 GB present, 18 GB missing: describe the 18, not the 194.
        state = _state(
            downloaded=["big-one"],
            pending=["small-one"],
            downloaded_gb=176.0,
            pending_gb=18.0,
        )
        page = _page(state)
        assert page._tiles["download"].value == "~20 GB"  # 18 pending + 2 overhead
        assert "196" not in page._summary_text()

    def test_already_downloaded_total_is_stated_too(self, qt_app) -> None:
        # Showing only the small number after a 194 GB selection invites the
        # opposite worry -- that the selection was silently dropped.
        state = _state(
            downloaded=["big-one"],
            pending=["small-one"],
            downloaded_gb=176.0,
            pending_gb=18.0,
        )
        page = _page(state)
        assert "176.0 GB already downloaded" in page._tiles["download"].note
        assert page._tiles["cache"].value == "176.0 GB"

    def test_gauges_report_selected_ready_and_pending(self, qt_app) -> None:
        state = _state(
            downloaded=["a", "b"], pending=["c"], downloaded_gb=10.0, pending_gb=5.0
        )
        page = _page(state)
        assert page._gauges["selected"].value == 3
        assert page._gauges["ready"].value == 2
        assert page._gauges["pending"].value == 1
        assert page._gauges["selected"].gauge.fraction == pytest.approx(1.0)
        assert page._gauges["ready"].gauge.fraction == pytest.approx(2 / 3)
        assert page._gauges["pending"].gauge.fraction == pytest.approx(1 / 3)
        assert page._gauges["pending"].gauge.color == ACCENT

    def test_pending_gauge_greys_out_when_nothing_to_download(self, qt_app) -> None:
        page = _page(_state(downloaded=["a", "b"], downloaded_gb=100.0))
        assert page._gauges["pending"].value == 0
        assert page._gauges["pending"].gauge.fraction == 0.0
        assert page._gauges["pending"].gauge.color == TEXT_MUTED

    def test_everything_downloaded_reads_as_a_short_run(self, qt_app) -> None:
        page = _page(_state(downloaded=["a", "b"], downloaded_gb=100.0))
        assert page._tiles["download"].value == "~2 GB"
        assert page._tiles["time"].value == "under 5 minutes"

    def test_unpopulated_report_assumes_nothing_is_downloaded(self, qt_app) -> None:
        # Headless `--model` runs never open the picker, so the report is
        # empty. Unknown must read as "assume nothing present".
        state = InstallerState()
        state.selected_model_ids = ["a", "b"]
        state.selected_models_gb = 50.0
        page = _page(state)
        assert page._tiles["download"].value == "~52 GB"
        assert page._tiles["download"].note == ""
        assert page._tiles["cache"].value == "0.0 GB"
        assert page._gauges["pending"].value == 2

    def test_estimates_sit_in_the_model_summary_card(self, qt_app) -> None:
        page = _page(_state(pending=["a"], pending_gb=4.0))
        for tile in page._tiles.values():
            assert tile.parentWidget() is page._models_card
        # The path box lives in the facts card.
        assert page._path_label.parentWidget().parentWidget() is page._facts_card


class TestReviewMockupStructure:
    """The mockup's building blocks: path box with copy, check rows, GPU pill,
    two-column category grid, and stacking when narrow."""

    def _state(self) -> InstallerState:
        return InstallerState(
            install_path=r"C:\Program Files\NexusAI",
            gpu_name="NVIDIA GeForce RTX 3080 Ti Laptop GPU",
            vram_mb=16384,
            selected_model_ids=["gemma4:e4b", "juggernaut-xl-v9", "wan2.1-t2v-1.3b"],
            selected_models_gb=30.0,
            components_to_install=["extension", "ollama", "venv", "model", "desktop"],
        )

    def test_path_box_has_a_copy_action(self, qt_app) -> None:
        page = _page(self._state())
        assert page._path_label.text() == r"C:\Program Files\NexusAI"
        assert page._copy_btn.accessibleName() == "Copy install path"
        page._copy_install_path()  # must not raise

    def test_components_render_as_check_rows(self, qt_app) -> None:
        state = self._state()
        page = _page(state)
        assert len(page._component_rows) == len(state.components_to_install)
        for row in page._component_rows:
            assert MARK_DOWNLOADED in row.text()
        joined = " ".join(row.text() for row in page._component_rows)
        for label in _COMPONENT_LABELS.values():
            assert label in joined

    def test_gpu_pill_names_gpu_and_vram(self, qt_app) -> None:
        page = _page(self._state())
        assert page._gpu_pill.objectName() == "successPill"
        assert page._gpu_pill.text() == (
            "GPU: NVIDIA GeForce RTX 3080 Ti Laptop GPU (16 GB VRAM)"
        )

    def test_no_gpu_pill_reads_none_detected(self, qt_app) -> None:
        page = _page(InstallerState(gpu_name="", vram_mb=0))
        assert "None detected" in page._gpu_pill.text()
        assert "GB VRAM" not in page._gpu_pill.text()

    def test_categories_fill_two_fixed_columns(self, qt_app) -> None:
        # Column 1: Embeddings, Chat, Agentic. Column 2: Document, Image,
        # Video, Audio. Pills share one width so the model columns line up.
        from nexus_installer.pages.review import _PILL_WIDTH_PX

        page = _page(self._state())
        by_heading = {cell.heading: cell for cell in page._category_cells}
        assert set(by_heading) == {"Chat", "Image", "Video"}
        assert by_heading["Chat"].column == 0
        assert by_heading["Image"].column == 1
        assert by_heading["Video"].column == 1
        right = page._category_grids[1]
        assert right.getItemPosition(right.indexOf(by_heading["Image"].pill))[:2] == (
            0,
            0,
        )
        assert right.getItemPosition(right.indexOf(by_heading["Video"].pill))[:2] == (
            1,
            0,
        )
        for cell in page._category_cells:
            assert cell.pill.width() == _PILL_WIDTH_PX or cell.pill.minimumWidth() == (
                _PILL_WIDTH_PX
            )
            # First model sits in the first model column beside the pill.
            grid = page._category_grids[cell.column]
            first = cell.model_labels[0]
            assert grid.getItemPosition(grid.indexOf(first))[1] == 1

    def test_models_wrap_into_aligned_columns(self, qt_app) -> None:
        from nexus_installer.pages.review import _MODELS_PER_ROW

        state = _state(pending=[f"m-{i}" for i in range(5)], pending_gb=5.0)
        page = _page(state)
        (cell,) = page._category_cells  # all unknown ids -> Other
        grid = page._category_grids[cell.column]
        cols = [grid.getItemPosition(grid.indexOf(lbl))[1] for lbl in cell.model_labels]
        assert cols == [1 + i % _MODELS_PER_ROW for i in range(5)]

    def test_note_sits_under_the_components_in_the_facts_column(self, qt_app) -> None:
        page = _page(self._state())
        assert page._callout.parentWidget() is page._facts_column
        layout = page._facts_column.layout()
        assert layout.indexOf(page._facts_card) < layout.indexOf(page._callout)
        assert page._split.getItemPosition(page._split.indexOf(page._facts_column))[
            :2
        ] == (
            0,
            0,
        )
        # The facts column is the narrow one.
        assert page._split.columnStretch(0) < page._split.columnStretch(1)

    def test_facts_captions_match_the_model_summary_head(self, qt_app) -> None:
        from PyQt5.QtWidgets import QLabel

        page = _page(self._state())
        heads = [
            lbl.text()
            for lbl in page._facts_card.findChildren(QLabel)
            if lbl.objectName() == "cardHead"
        ]
        assert heads == ["Install path", "Components"]

    def test_narrow_width_stacks_cards(self, qt_app) -> None:
        from PyQt5.QtCore import QSize
        from PyQt5.QtGui import QResizeEvent

        page = _page(self._state())
        page.resizeEvent(QResizeEvent(QSize(400, 700), QSize(900, 700)))
        assert page._narrow_columns is True
        index = page._split.indexOf(page._models_card)
        assert page._split.getItemPosition(index)[:2] == (1, 0)
        assert page._split.getItemPosition(page._split.indexOf(page._facts_column))[
            :2
        ] == (0, 0)
        page.resizeEvent(QResizeEvent(QSize(900, 700), QSize(400, 700)))
        assert page._narrow_columns is False
        index = page._split.indexOf(page._models_card)
        assert page._split.getItemPosition(index)[:2] == (0, 1)
