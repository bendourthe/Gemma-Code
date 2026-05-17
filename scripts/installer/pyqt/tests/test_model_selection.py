"""Tests for model selection logic."""

from __future__ import annotations

from nexus_installer.installer_state import InstallerState
from nexus_installer.pages.model_selection import MODEL_OPTIONS


class TestModelOptions:
    def test_four_models_available(self) -> None:
        assert len(MODEL_OPTIONS) == 4

    def test_model_names(self) -> None:
        names = [m[0] for m in MODEL_OPTIONS]
        assert "gemma4:e2b" in names
        assert "gemma4:e4b" in names
        assert "gemma4:26b" in names
        assert "gemma4:31b" in names

    def test_vram_requirements_ascending(self) -> None:
        vram_reqs = [m[4] for m in MODEL_OPTIONS]
        assert vram_reqs == sorted(vram_reqs)


class TestRecommendedBadge:
    def test_recommended_matches_state(self) -> None:
        state = InstallerState()
        state.recommended_model = "gemma4:e4b"
        for model_name, *_ in MODEL_OPTIONS:
            is_recommended = model_name == state.recommended_model
            if model_name == "gemma4:e4b":
                assert is_recommended
            else:
                assert not is_recommended


class TestVramWarning:
    def test_warning_when_vram_exceeded(self) -> None:
        state = InstallerState()
        state.vram_mb = 6000  # 6 GB
        for model_name, _, _, _, vram_req, _ in MODEL_OPTIONS:
            exceeds = vram_req > state.vram_mb
            if model_name in ("gemma4:26b", "gemma4:31b"):
                assert exceeds
            elif model_name == "gemma4:e2b":
                assert not exceeds

    def test_no_warning_with_high_vram(self) -> None:
        state = InstallerState()
        state.vram_mb = 24576
        for _, _, _, _, vram_req, _ in MODEL_OPTIONS:
            assert vram_req <= state.vram_mb


class TestSkipCheckbox:
    def test_removing_model_from_components(self) -> None:
        state = InstallerState()
        assert "model" in state.components_to_install
        state.components_to_install.remove("model")
        assert "model" not in state.components_to_install

    def test_adding_model_back(self) -> None:
        state = InstallerState()
        state.components_to_install.remove("model")
        state.components_to_install.append("model")
        assert "model" in state.components_to_install
