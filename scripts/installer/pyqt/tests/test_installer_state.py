"""Tests for InstallerState dataclass."""

from __future__ import annotations

import sys

from gemma_installer.installer_state import InstallerState


class TestInstallerStateDefaults:
    def test_platform_matches_sys(self) -> None:
        state = InstallerState()
        assert state.platform == sys.platform

    def test_default_install_path_windows(self, monkeypatch: object) -> None:
        import gemma_installer.installer_state as mod

        monkeypatch.setattr(sys, "platform", "win32")  # type: ignore[attr-defined]
        # Re-invoke default factory
        path = mod._default_install_path()
        assert "GemmaCode" in path

    def test_default_install_path_darwin(self, monkeypatch: object) -> None:
        import gemma_installer.installer_state as mod

        monkeypatch.setattr(sys, "platform", "darwin")  # type: ignore[attr-defined]
        path = mod._default_install_path()
        assert "/Applications" in path

    def test_default_install_path_linux(self, monkeypatch: object) -> None:
        import gemma_installer.installer_state as mod

        monkeypatch.setattr(sys, "platform", "linux")  # type: ignore[attr-defined]
        path = mod._default_install_path()
        assert "/usr/local" in path

    def test_default_components(self) -> None:
        state = InstallerState()
        assert "extension" in state.components_to_install
        assert "ollama" in state.components_to_install
        assert "venv" in state.components_to_install
        assert "model" in state.components_to_install

    def test_default_model_empty(self) -> None:
        state = InstallerState()
        assert state.selected_model == ""
        assert state.recommended_model == ""

    def test_gpu_defaults(self) -> None:
        state = InstallerState()
        assert state.gpu_vendor == ""
        assert state.vram_mb == 0

    def test_ollama_url_default(self) -> None:
        state = InstallerState()
        assert state.ollama_url == "http://localhost:11434"

    def test_install_log_empty(self) -> None:
        state = InstallerState()
        assert state.install_log == []
        assert state.failed_steps == []
