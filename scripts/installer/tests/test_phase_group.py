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


class TestPhaseGroupLog:
    def test_log_hidden_by_default(self, qt_app: object) -> None:
        group = PhaseGroup("Models", ["model"])
        assert group.log_visible is False

    def test_toggle_shows_log(self, qt_app: object) -> None:
        group = PhaseGroup("Models", ["model"])
        group._toggle.setChecked(True)
        assert group.log_visible is True
        group._toggle.setChecked(False)
        assert group.log_visible is False

    def test_append_and_read_log(self, qt_app: object) -> None:
        group = PhaseGroup("Models", ["model"])
        group.append_log("pulling gemma4:e4b", "info")
        assert "pulling gemma4:e4b" in group.log_text()


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
        assert titles == ["VS Code Extension", "Models"]

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
        assert titles == ["Models"]
