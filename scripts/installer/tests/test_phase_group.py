"""v1.8.0 Phase 5 -- tests for the per-phase grouped progress UX (T502).

Covers the `PhaseGroup` widget lifecycle (pending -> active -> done/failed,
per-step progress aggregation, collapsible log) and the `InstallingPage`
grouping: group construction from the selected components and engine-signal
routing into the right group.
"""

from __future__ import annotations

from nexus_installer.installer_state import InstallerState
from nexus_installer.widgets.phase_group import (
    STATE_ACTIVE,
    STATE_DONE,
    STATE_FAILED,
    STATE_PENDING,
    PhaseGroup,
)


class TestPhaseGroupLifecycle:
    def test_starts_pending(self, qt_app: object) -> None:
        group = PhaseGroup("Dependencies", ["ollama", "venv"])
        assert group.state == STATE_PENDING
        assert group.progress == 0.0

    def test_mark_started_activates(self, qt_app: object) -> None:
        group = PhaseGroup("Dependencies", ["ollama", "venv"])
        group.mark_started("ollama")
        assert group.state == STATE_ACTIVE

    def test_unknown_step_ignored(self, qt_app: object) -> None:
        group = PhaseGroup("Models", ["model"])
        group.mark_started("desktop")
        group.mark_step_done("desktop")
        assert group.state == STATE_PENDING
        assert group.progress == 0.0

    def test_covers(self, qt_app: object) -> None:
        group = PhaseGroup("Dependencies", ["ollama", "venv"])
        assert group.covers("ollama")
        assert group.covers("venv")
        assert not group.covers("model")

    def test_done_after_all_steps(self, qt_app: object) -> None:
        group = PhaseGroup("Dependencies", ["ollama", "venv"])
        group.mark_started("ollama")
        group.mark_step_done("ollama")
        assert group.state == STATE_ACTIVE  # venv still outstanding
        group.mark_step_done("venv")
        assert group.state == STATE_DONE
        assert group.progress == 1.0

    def test_failed_step_settles_failed(self, qt_app: object) -> None:
        group = PhaseGroup("Dependencies", ["ollama", "venv"])
        group.mark_step_done("ollama")
        group.mark_step_failed("venv")
        assert group.state == STATE_FAILED
        assert group.progress == 1.0

    def test_progress_aggregates_across_steps(self, qt_app: object) -> None:
        group = PhaseGroup("Dependencies", ["ollama", "venv"])
        group.set_step_progress("ollama", 0.5)
        assert group.progress == 0.25
        group.mark_step_done("ollama")
        assert group.progress == 0.5

    def test_progress_clamped(self, qt_app: object) -> None:
        group = PhaseGroup("Models", ["model"])
        group.set_step_progress("model", 1.7)
        assert group.progress == 1.0
        group.set_step_progress("model", -0.3)
        assert group.progress == 0.0


class TestPhaseGroupDetails:
    def test_details_and_logs_hidden_by_default(self, qt_app: object) -> None:
        group = PhaseGroup("Models", ["model"])
        assert group.details_visible is False
        assert group.log_visible is False

    def test_toggle_shows_details(self, qt_app: object) -> None:
        group = PhaseGroup("Models", ["model"])
        group._toggle.setChecked(True)
        assert group.details_visible is True
        group._toggle.setChecked(False)
        assert group.details_visible is False

    def test_logs_toggle_shows_logs(self, qt_app: object) -> None:
        group = PhaseGroup("Models", ["model"])
        group._logs_toggle.setChecked(True)
        assert group.log_visible is True
        group._logs_toggle.setChecked(False)
        assert group.log_visible is False

    def test_append_and_read_log(self, qt_app: object) -> None:
        group = PhaseGroup("Models", ["model"])
        group.append_log("pulling gemma4:e4b", "info")
        assert "pulling gemma4:e4b" in group.log_text()

    def test_failed_step_autoexpands_details(self, qt_app: object) -> None:
        group = PhaseGroup("Models", ["model"])
        group.mark_step_failed("model")
        assert group.details_visible is True
        assert group.state == STATE_FAILED


class TestAutoExpandCollapse:
    """v1.13.0 Phase 5: the running section auto-expands its details; a finished
    one auto-collapses; a failed one stays expanded."""

    def test_active_expands_details(self, qt_app: object) -> None:
        group = PhaseGroup("Dependencies", ["ollama", "venv"])
        assert group.details_visible is False
        group.mark_started("ollama")
        assert group.details_visible is True

    def test_done_collapses_details(self, qt_app: object) -> None:
        group = PhaseGroup("Dependencies", ["ollama", "venv"])
        group.mark_started("ollama")
        assert group.details_visible is True
        group.mark_step_done("ollama")
        group.mark_step_done("venv")
        assert group.state == STATE_DONE
        assert group.details_visible is False

    def test_failed_keeps_details_expanded(self, qt_app: object) -> None:
        group = PhaseGroup("Models", ["model"])
        group.mark_started("model")
        group.mark_step_failed("model")
        assert group.state == STATE_FAILED
        assert group.details_visible is True


class TestSectionIconAndGrid:
    """v1.13.0 Phase 5: iconed section tile + shared-grid uniform bars."""

    def test_section_icon_rendered_in_tile(self, qt_app: object) -> None:
        group = PhaseGroup("Models", ["model"], icon="◆")
        assert group._icon.text() == "◆"

    def test_model_rows_share_one_stretching_grid(self, qt_app: object) -> None:
        from PyQt5.QtWidgets import QGridLayout

        group = PhaseGroup("Models", ["model"])
        assert isinstance(group._model_rows_layout, QGridLayout)
        group.ensure_model_row("a")
        group.ensure_model_row("b")
        grid = group._model_rows_layout
        # Both rows' bars live in the SAME grid, so the stretched bar column
        # gives every bar the same width (the ragged-bar fix).
        in_grid = {
            grid.itemAt(i).widget()
            for i in range(grid.count())
            if grid.itemAt(i) is not None
        }
        assert group._model_rows["a"].bar in in_grid
        assert group._model_rows["b"].bar in in_grid
        assert grid.columnStretch(1) == 1  # only the bar column stretches


class TestConditionalSubBars:
    """T501: per-step overview rows exist ONLY for multi-step phases."""

    def test_multi_step_phase_has_step_rows(self, qt_app: object) -> None:
        group = PhaseGroup("Dependencies", ["ollama", "venv"])
        assert set(group._step_rows) == {"ollama", "venv"}

    def test_single_step_phase_has_no_step_rows(self, qt_app: object) -> None:
        group = PhaseGroup("VS Code Extension", ["extension"])
        assert group._step_rows == {}


class TestPhaseGroupChrome:
    """v2.3.1 Phase 3: details sit on the card, not BG_WINDOW."""

    def test_details_are_transparent(self, qt_app: object) -> None:
        from nexus_installer.constants import BG_WINDOW

        group = PhaseGroup("Models", ["model"])
        details = group._details
        assert details.objectName() == "phaseGroupDetails"
        assert not details.autoFillBackground()
        assert "transparent" in details.styleSheet()
        assert BG_WINDOW not in details.styleSheet()
        assert "#0a0d14" not in details.styleSheet()


class TestFormattingHelpers:
    def test_size_progress_with_totals(self) -> None:
        from nexus_installer.widgets.phase_group import format_size_progress

        text = format_size_progress(5 * 2**30, int(6.9 * 2**30), 0.72)
        assert text == "5.0 GB / 6.9 GB (72%)"

    def test_size_progress_without_totals_is_bare_percent(self) -> None:
        from nexus_installer.widgets.phase_group import format_size_progress

        assert format_size_progress(0, 0, 0.45) == "45%"

    def test_speed(self) -> None:
        from nexus_installer.widgets.phase_group import format_speed

        assert format_speed(18.4 * 2**20) == "18.4 MB/s"
        assert format_speed(0) == ""

    def test_eta(self) -> None:
        from nexus_installer.widgets.phase_group import format_eta

        assert format_eta(12) == "00:12 remaining"
        assert format_eta(3723) == "1:02:03 remaining"
        assert format_eta(0) == ""


class TestModelRows:
    """T502: dynamic per-model rows driven by the engine telemetry."""

    def test_rows_precreate_in_waiting_state(self, qt_app: object) -> None:
        group = PhaseGroup("Models", ["model"])
        group.ensure_model_row("realvisxl-v5")
        group.ensure_model_row("nomic-embed-text")
        assert group.model_row_ids() == ["realvisxl-v5", "nomic-embed-text"]
        assert group._model_rows["realvisxl-v5"].status.text() == "Waiting to start"

    def test_progress_updates_detail_text(self, qt_app: object) -> None:
        group = PhaseGroup("Models", ["model"])
        group.set_model_progress(
            "realvisxl-v5",
            0.72,
            bytes_done=5 * 2**30,
            bytes_total=int(6.9 * 2**30),
            speed_bps=18.4 * 2**20,
            eta_s=12,
        )
        detail = group._model_rows["realvisxl-v5"].detail.text()
        assert "5.0 GB / 6.9 GB (72%)" in detail
        assert "18.4 MB/s" in detail
        assert "00:12 remaining" in detail
        assert group._model_rows["realvisxl-v5"].status.text() == "Downloading..."

    def test_done_and_failed_states(self, qt_app: object) -> None:
        group = PhaseGroup("Models", ["model"])
        group.set_model_done("a")
        assert group._model_rows["a"].status.text() == "Done"
        group.set_model_failed("b", "401 Unauthorized")
        assert "Failed: 401 Unauthorized" in group._model_rows["b"].status.text()
        # A failing model auto-expands the details (T505).
        assert group.details_visible is True


class TestLogResize:
    """T503: the log area resizes by dragging, clamped to sane bounds."""

    def test_resize_grows_and_clamps(self, qt_app: object) -> None:
        from nexus_installer.widgets.phase_group import (
            LOG_MAX_HEIGHT,
            LOG_MIN_HEIGHT,
        )

        group = PhaseGroup("Models", ["model"])
        start = group.log_height
        group._resize_log(60)
        assert group.log_height == start + 60
        group._resize_log(10000)
        assert group.log_height == LOG_MAX_HEIGHT
        group._resize_log(-10000)
        assert group.log_height == LOG_MIN_HEIGHT


class TestCopyFeedback:
    """T504: copy flips to a checkmark + 'Copied', then reverts."""

    def test_copy_shows_transient_feedback(self, qt_app: object) -> None:
        group = PhaseGroup("Models", ["model"])
        group.append_log("hello", "info")
        group._on_copy_logs()
        assert "Copied" in group._copy_btn.text()
        assert group._copy_timer.isActive()
        group._reset_copy_button()
        assert "Copied" not in group._copy_btn.text()


class TestFailureBlock:
    """T505: the plain-language failure reason renders inside the details."""

    def test_show_failure_reason_expands_and_renders(self, qt_app: object) -> None:
        group = PhaseGroup("Dependencies", ["ollama", "venv"])
        assert group.failure_visible is False
        group.show_failure_reason(
            "Ollama could not be downloaded.", "Check the connection."
        )
        assert group.failure_visible is True
        assert group.details_visible is True
        assert group._failure_summary.text() == "Ollama could not be downloaded."
        assert group._failure_suggestion.text() == "Check the connection."


class TestInstallingPageModelEvents:
    """T502/T505 page wiring: engine model events route into the Models group."""

    def _page(self, qt_app: object):
        from nexus_installer.pages.installing import InstallingPage

        state = InstallerState(selected_model_ids=["m1", "m2"])
        return InstallingPage(state), state

    def test_model_progress_routes_to_row(self, qt_app: object) -> None:
        from nexus_installer.engine.model_router import ModelProgress

        page, _state = self._page(qt_app)
        sample = ModelProgress(
            model_id="m1",
            fraction=0.5,
            bytes_done=2**30,
            bytes_total=2 * 2**30,
            speed_bps=10 * 2**20,
            eta_s=100,
        )
        page._on_model_progress(sample)
        group = page._models_group()
        assert group is not None
        assert "50%" in group._model_rows["m1"].detail.text()

    def test_model_failed_routes_with_reason(self, qt_app: object) -> None:
        page, _state = self._page(qt_app)
        page._on_model_failed("m2", "Ollama server unavailable")
        group = page._models_group()
        assert group is not None
        assert "Failed" in group._model_rows["m2"].status.text()

    def test_marshalled_started_updates_row_on_gui_thread(self, qt_app: object) -> None:
        import threading
        import time

        from PyQt5.QtCore import QThread
        from PyQt5.QtWidgets import QApplication

        from nexus_installer.engine.installer import InstallEngine

        page, _state = self._page(qt_app)
        engine = InstallEngine()
        seen: list[QThread] = []

        def on_started(model_id: str) -> None:
            seen.append(QThread.currentThread())
            page._on_model_started(model_id)

        engine.model_started.connect(on_started)

        def worker() -> None:
            engine.marshal_model_started("m1")

        t = threading.Thread(target=worker)
        t.start()
        t.join(5)
        deadline = time.time() + 3
        while not seen and time.time() < deadline:
            qt_app.processEvents()
            time.sleep(0.01)
        qt_app.processEvents()
        assert seen
        assert seen[0] is QApplication.instance().thread()
        group = page._models_group()
        assert group is not None
        assert "m1" in group._model_rows

    def test_step_failure_reason_surfaces_in_group(self, qt_app: object) -> None:
        page, state = self._page(qt_app)
        state.record_step_failure(
            "ollama", "Ollama could not be downloaded.", "Check the connection."
        )
        page._on_step_failed("ollama")
        deps_group = page._group_for("ollama")
        assert deps_group is not None
        assert deps_group.failure_visible is True


class TestInstallingPageGroups:
    def test_default_components_build_four_groups(self, qt_app: object) -> None:
        from nexus_installer.pages.installing import InstallingPage

        state = InstallerState()
        page = InstallingPage(state)
        titles = [g._title.text() for g in page.phase_groups]
        assert titles == [
            "Dependencies",
            "VS Code Extension",
            "Models",
            "Nexus Desktop",
        ]

    def test_deselected_components_drop_groups(self, qt_app: object) -> None:
        from nexus_installer.pages.installing import InstallingPage

        state = InstallerState(components_to_install=["extension", "model"])
        page = InstallingPage(state)
        titles = [g._title.text() for g in page.phase_groups]
        assert titles == ["VS Code Extension", "Models", "Nexus Desktop"]

    def test_step_signals_route_to_groups(self, qt_app: object) -> None:
        from nexus_installer.pages.installing import InstallingPage

        state = InstallerState()
        page = InstallingPage(state)
        deps, ext, models, desktop = page.phase_groups

        page._on_step_started("ollama")
        assert deps.state == STATE_ACTIVE
        page._on_step_completed("ollama")
        page._on_step_started("venv")
        page._on_step_completed("venv")
        assert deps.state == STATE_DONE

        page._on_step_started("model")
        page._on_step_progress("model", 0.5)
        assert models.state == STATE_ACTIVE
        assert models.progress == 0.5

        page._on_step_started("desktop")
        page._on_step_failed("desktop")
        assert desktop.state == STATE_ACTIVE
        page._on_step_started("runtime")
        page._on_step_completed("runtime")
        page._on_step_started("hub-catalog")
        page._on_step_completed("hub-catalog")
        assert desktop.state == STATE_FAILED
        assert ext.state == STATE_PENDING

    def test_logs_route_to_active_group(self, qt_app: object) -> None:
        from nexus_installer.pages.installing import InstallingPage

        state = InstallerState()
        page = InstallingPage(state)
        deps, _, models, _ = page.phase_groups

        page._on_step_started("ollama")
        page._on_log("installing ollama", "info")
        page._on_step_started("model")
        page._on_log("pulling model weights", "info")

        assert "installing ollama" in deps.log_text()
        assert "pulling model weights" in models.log_text()
        assert "pulling model weights" not in deps.log_text()

    def test_log_before_any_step_goes_to_first_group(self, qt_app: object) -> None:
        from nexus_installer.pages.installing import InstallingPage

        state = InstallerState()
        page = InstallingPage(state)
        page._on_log("preflight", "info")
        assert "preflight" in page.phase_groups[0].log_text()

    def test_get_log_text_aggregates_all_lines(self, qt_app: object) -> None:
        from nexus_installer.pages.installing import InstallingPage

        state = InstallerState()
        page = InstallingPage(state)
        page._on_step_started("ollama")
        page._on_log("line one", "info")
        page._on_step_started("model")
        page._on_log("line two", "info")
        text = page.get_log_text()
        assert "line one" in text
        assert "line two" in text

    def test_group_rebuild_reflects_component_change(self, qt_app: object) -> None:
        from nexus_installer.pages.installing import InstallingPage

        state = InstallerState()
        page = InstallingPage(state)
        assert len(page.phase_groups) == 4
        state.components_to_install = ["model"]
        page._build_groups()
        titles = [g._title.text() for g in page.phase_groups]
        assert titles == ["Models", "Nexus Desktop"]

    def test_desktop_group_stays_active_through_visible_finalization(
        self, qt_app: object
    ) -> None:
        from nexus_installer.pages.installing import InstallingPage

        page = InstallingPage(InstallerState())
        desktop = page.phase_groups[-1]
        page._on_step_started("desktop")
        page._on_step_completed("desktop")
        assert desktop.state != STATE_DONE
        page._on_step_started("runtime")
        page._on_step_completed("runtime")
        assert desktop.state != STATE_DONE
        page._on_step_started("hub-catalog")
        page._on_step_completed("hub-catalog")
        assert desktop.state == STATE_DONE


class TestPhase4Layout:
    """v1.14.0 Phase 4: uniform dependency rows + View Logs button inset."""

    def test_step_rows_span_metric_column(self, qt_app: object) -> None:
        # Dependency (step) rows carry no metric, so their bar spans the metric
        # column -- no wide dead space before the status.
        from PyQt5.QtWidgets import QProgressBar

        from nexus_installer.widgets.phase_group import PhaseGroup

        group = PhaseGroup("Dependencies", ["ollama", "venv"])
        grid = group._rows_layout
        spans = [
            grid.getItemPosition(i)[3]
            for i in range(grid.count())
            if isinstance(grid.itemAt(i).widget(), QProgressBar)
        ]
        assert spans and all(cs == 2 for cs in spans)

    def test_model_rows_keep_metric_column(self, qt_app: object) -> None:
        # Per-model rows keep the bar in its own column (metric alongside).
        from PyQt5.QtWidgets import QProgressBar

        from nexus_installer.widgets.phase_group import PhaseGroup

        group = PhaseGroup("Models", ["model"])
        group.ensure_model_row("m1")
        grid = group._model_rows_layout
        spans = [
            grid.getItemPosition(i)[3]
            for i in range(grid.count())
            if isinstance(grid.itemAt(i).widget(), QProgressBar)
        ]
        assert spans and all(cs == 1 for cs in spans)

    def test_view_logs_button_has_inset_margins(self, qt_app: object) -> None:
        # The View Logs button sits in a row with left + bottom margins so it
        # does not touch the section outline.
        from nexus_installer.widgets.phase_group import PhaseGroup

        group = PhaseGroup("Dependencies", ["ollama", "venv"])
        details_layout = group._details.layout()
        margins = None
        for i in range(details_layout.count()):
            lay = details_layout.itemAt(i).layout()
            if lay is None:
                continue
            for j in range(lay.count()):
                if lay.itemAt(j).widget() is group._logs_toggle:
                    margins = lay.contentsMargins()
        assert margins is not None
        assert margins.left() > 0 and margins.bottom() > 0
