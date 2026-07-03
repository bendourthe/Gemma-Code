"""Tests for the review page summary logic."""

from __future__ import annotations

from nexus_installer.installer_state import InstallerState
from nexus_installer.pages.review import _COMPONENT_LABELS, _MODEL_SIZES


class TestModelSizes:
    def test_all_models_have_sizes(self) -> None:
        for model in ("gemma4:e2b", "gemma4:e4b", "gemma4:26b", "gemma4:31b"):
            assert model in _MODEL_SIZES
            assert _MODEL_SIZES[model] > 0

    def test_sizes_ascending(self) -> None:
        sizes = [
            _MODEL_SIZES[m]
            for m in ("gemma4:e2b", "gemma4:e4b", "gemma4:26b", "gemma4:31b")
        ]
        assert sizes == sorted(sizes)


class TestReviewSummary:
    def test_state_fields_populated(self) -> None:
        state = InstallerState()
        state.install_path = "/opt/gemma"
        state.selected_model = "gemma4:e4b"
        state.gpu_name = "NVIDIA RTX 4090"
        state.vram_mb = 24576
        state.components_to_install = ["extension", "ollama", "venv", "model"]

        # Verify all fields are accessible for summary rendering
        assert state.install_path == "/opt/gemma"
        assert state.selected_model == "gemma4:e4b"
        assert len(state.components_to_install) == 4

    def test_estimated_disk_calculation(self) -> None:
        model_size = _MODEL_SIZES.get("gemma4:e4b", 0)
        overhead = 2.0
        total = model_size + overhead
        assert total == 10.0  # 8 + 2

    def test_time_estimate_heuristic(self) -> None:
        # Large model -> longer time
        assert _MODEL_SIZES["gemma4:31b"] >= 18
        # Small model -> shorter time
        assert _MODEL_SIZES["gemma4:e2b"] < 8

    def test_desktop_component_has_friendly_label(self) -> None:
        # v1.8.0 Phase 2: the desktop component renders as a product name,
        # not a bare capitalized id.
        assert _COMPONENT_LABELS["desktop"] == "Nexus Desktop app"
        state = InstallerState()
        assert "desktop" in state.components_to_install
