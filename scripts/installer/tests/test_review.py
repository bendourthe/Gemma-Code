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
        assert "9.6 GB" in text

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
