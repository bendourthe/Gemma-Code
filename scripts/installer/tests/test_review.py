"""Tests for the review page summary logic."""

from __future__ import annotations

from nexus_installer.installer_state import InstallerState
from nexus_installer.pages.review import _COMPONENT_LABELS


class TestReviewSummary:
    def test_state_fields_populated(self) -> None:
        state = InstallerState()
        state.install_path = "/opt/nexus"
        state.selected_model = "gemma4:e4b"
        state.gpu_name = "NVIDIA RTX 4090"
        state.vram_mb = 24576
        state.components_to_install = ["extension", "ollama", "venv", "model"]

        # Verify all fields are accessible for summary rendering
        assert state.install_path == "/opt/nexus"
        assert state.selected_model == "gemma4:e4b"
        assert len(state.components_to_install) == 4

    def test_desktop_component_has_friendly_label(self) -> None:
        # v1.8.0 Phase 2: the desktop component renders as a product name,
        # not a bare capitalized id.
        assert _COMPONENT_LABELS["desktop"] == "Nexus Desktop app"
        state = InstallerState()
        assert "desktop" in state.components_to_install

    def test_multi_selection_summary(self, qt_app) -> None:
        # v1.8.0 Phase 4: the typed catalog publishes selected_model_ids;
        # the review summary lists them with the authoritative size total.
        from nexus_installer.pages.review import ReviewPage

        state = InstallerState()
        state.selected_model_ids = ["gemma4:e4b", "juggernaut-xl-v9"]
        state.selected_models_gb = 9.6
        page = ReviewPage(state)
        page._rebuild_summary()
        text = page._summary_text()
        assert "2 selected" in text
        assert "gemma4:e4b" in text
        assert "juggernaut-xl-v9" in text
        # v2.4.5 Phase 3.3: the size moved out of the header and under the
        # model list, as a download estimate rather than a selection total.
        # With no installed-report the page assumes nothing is downloaded, so
        # the estimate is the whole selection plus the 2 GB venv overhead.
        assert "Estimated disk usage" in text
        assert "~12 GB to download" in text

    def test_models_group_by_catalog_section(self, qt_app) -> None:
        from nexus_installer.pages.review import ReviewPage

        state = InstallerState()
        state.selected_model_ids = ["gemma4:e4b", "juggernaut-xl-v9"]
        page = ReviewPage(state)
        page._rebuild_summary()
        text = page._summary_text()
        assert "<b>Chat</b>" in text
        assert "<b>Image</b>" in text
        assert "<b>Video</b>" not in text
        chat_at = text.index("<b>Chat</b>")
        image_at = text.index("<b>Image</b>")
        assert chat_at < image_at
        chat_block = text[chat_at:image_at]
        image_block = text[image_at:]
        assert "gemma4:e4b" in chat_block
        assert "juggernaut-xl-v9" not in chat_block
        assert "juggernaut-xl-v9" in image_block
        assert "gemma4:e4b" not in image_block

    def test_single_model_fallback_summary(self, qt_app) -> None:
        # v1.9.0 Phase 4 (T406): the legacy `_MODEL_SIZES` estimate table is
        # gone; a lone `selected_model` (a headless --model override) still
        # renders by name, using the authoritative `selected_models_gb`.
        from nexus_installer.pages.review import ReviewPage

        state = InstallerState()
        state.selected_model = "gemma4:e4b"
        page = ReviewPage(state)
        page._rebuild_summary()
        text = page._summary_text()
        assert "gemma4:e4b" in text

    def test_empty_selection_summary(self, qt_app) -> None:
        # v1.9.0 Phase 4 (T406): no selection at all reads clearly rather than
        # crashing on the removed size table.
        from nexus_installer.pages.review import ReviewPage

        state = InstallerState()
        state.selected_model = ""
        page = ReviewPage(state)
        page._rebuild_summary()
        text = page._summary_text()
        assert "none selected" in text

    def test_unavailable_extension_is_not_queued_in_summary(self, qt_app) -> None:
        from nexus_installer.pages.review import ReviewPage

        state = InstallerState()
        state.components_to_install = [
            component
            for component in state.components_to_install
            if component != "extension"
        ]
        page = ReviewPage(state)
        page._rebuild_summary()
        assert _COMPONENT_LABELS["extension"] not in page._summary_text()


class TestReviewDownloadedMarks:
    """v2.4.5 Phase 3 (T013) -- two columns, per-model marks, pending estimate.

    Field screenshot: the Review page listed 14 models in one tall column and
    reported `~196 GB` estimated disk usage, on a host that already held 176 GB
    of them. The size was the selection total, not the remaining download.
    """

    def _page(self, state):
        from nexus_installer.pages.review import ReviewPage

        page = ReviewPage(state)
        page._rebuild_summary()
        return page

    def _state(self, downloaded=(), pending=(), downloaded_gb=0.0, pending_gb=0.0):
        from nexus_installer.engine.installed_models import InstalledReport

        state = InstallerState()
        state.selected_model_ids = list(downloaded) + list(pending)
        state.selected_models_gb = downloaded_gb + pending_gb
        # v2.4.7: the report is CATALOG-wide, so it also covers models this
        # selection does not include and its sizes are deliberately far larger.
        # Any consumer that reads `report.pending_gb` as a selection size fails
        # here rather than passing because the two happened to coincide -- the
        # coincidence that hid this defect through v2.4.5 and v2.4.6.
        state.installed_report = InstalledReport(
            downloaded=frozenset(downloaded) | {"other-catalog-model"},
            pending=frozenset(pending) | {"another-catalog-model"},
            downloaded_gb=downloaded_gb + 500.0,
            pending_gb=pending_gb + 500.0,
        )
        # The selection-scoped figure the picker publishes.
        state.pending_models_gb = pending_gb
        return state

    def test_models_render_in_two_columns(self, qt_app) -> None:
        state = self._state(pending=[f"model-{i}" for i in range(6)], pending_gb=6.0)
        text = self._page(state)._summary_text()
        assert "<table" in text
        # Six models over two columns is three rows, not six.
        assert text.count("<tr>") == 3
        for i in range(6):
            assert f"model-{i}" in text

    def test_odd_count_leaves_one_empty_cell(self, qt_app) -> None:
        state = self._state(pending=["a", "b", "c"], pending_gb=3.0)
        text = self._page(state)._summary_text()
        assert text.count("<tr>") == 2
        for mid in ("a", "b", "c"):
            assert mid in text

    def test_downloaded_and_pending_carry_different_marks(self, qt_app) -> None:
        state = self._state(
            downloaded=["already-here"],
            pending=["needs-fetch"],
            downloaded_gb=70.0,
            pending_gb=18.0,
        )
        text = self._page(state)._summary_text()
        # A check for present, a down-arrow for pending: distinguishable
        # without relying on color alone.
        assert "✓</span> already-here" in text
        assert "↓</span> needs-fetch" in text

    def test_a_legend_explains_both_marks(self, qt_app) -> None:
        state = self._state(
            downloaded=["x"], pending=["y"], downloaded_gb=1.0, pending_gb=2.0
        )
        text = self._page(state)._summary_text()
        assert "already downloaded" in text
        assert "to download" in text

    def test_estimate_counts_pending_only(self, qt_app) -> None:
        # The field case in miniature: 176 GB present, 18 GB missing. The
        # estimate must describe the 18, not the 194.
        state = self._state(
            downloaded=["big-one"],
            pending=["small-one"],
            downloaded_gb=176.0,
            pending_gb=18.0,
        )
        text = self._page(state)._summary_text()
        assert "~20 GB to download" in text  # 18 pending + 2 overhead
        assert "196" not in text

    def test_already_downloaded_total_is_stated_too(self, qt_app) -> None:
        # Showing only the small number after a 194 GB selection invites the
        # opposite worry -- that the selection was silently dropped.
        state = self._state(
            downloaded=["big-one"],
            pending=["small-one"],
            downloaded_gb=176.0,
            pending_gb=18.0,
        )
        text = self._page(state)._summary_text()
        assert "176.0 GB already downloaded" in text

    def test_counts_appear_in_the_header(self, qt_app) -> None:
        state = self._state(
            downloaded=["a", "b"], pending=["c"], downloaded_gb=10.0, pending_gb=5.0
        )
        text = self._page(state)._summary_text()
        assert "3 selected" in text
        assert "2 already downloaded, 1 to download" in text

    def test_everything_downloaded_reads_as_a_short_run(self, qt_app) -> None:
        state = self._state(downloaded=["a", "b"], downloaded_gb=100.0, pending_gb=0.0)
        text = self._page(state)._summary_text()
        assert "~2 GB to download" in text
        assert "under 5 minutes" in text

    def test_unpopulated_report_assumes_nothing_is_downloaded(self, qt_app) -> None:
        # Headless `--model` runs never open the picker, so the report is
        # empty. Unknown must read as "assume nothing present", never as
        # "nothing to download".
        state = InstallerState()
        state.selected_model_ids = ["a", "b"]
        state.selected_models_gb = 50.0
        text = self._page(state)._summary_text()
        assert "~52 GB to download" in text
        assert "already downloaded" not in text.split("Estimated disk usage")[1]

    def test_estimate_sits_under_the_model_list(self, qt_app) -> None:
        state = self._state(pending=["a"], pending_gb=4.0)
        page = self._page(state)
        models_text = page._models_label.text()
        facts_text = page._facts_label.text()
        # The operator asked for it under the models; it must not remain in
        # the left-hand facts column.
        assert "Estimated disk usage" in models_text
        assert "Estimated disk usage" not in facts_text
        assert "Install path" in facts_text
